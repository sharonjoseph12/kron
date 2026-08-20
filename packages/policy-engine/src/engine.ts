/**
 * KRON Economic Policy Engine — the decision layer between an agent and the
 * payment rail (PRD §6.1, §8).
 *
 * Every payment request runs through the same ordered rule pipeline. The
 * result is always exactly one primary decision:
 *
 *   AUTO_APPROVED  -> inside configured constraints, sign & pay
 *   ESCALATED      -> may be valid but requires human review
 *   BLOCKED        -> violates a hard constraint, never paid
 */
import type { PolicyEvaluation, PolicyDecision, RuleHit } from "@kron/shared";

/** Policy fields the engine needs. Amounts are exact microAlgo integers. */
export interface PolicyRuleSet {
  version: number;
  name: string;
  perCallLimitMicro: bigint;
  hardCeilingMicro: bigint;
  sessionBudgetMicro: bigint;
  dailyBudgetMicro: bigint;
  maxDailyPayments: number;
  unknownRecipient: "block" | "escalate" | "allow";
  firstTimeService: "block" | "escalate" | "allow";
  recipientAllowlist: string[];
  recipientBlocklist: string[];
  serviceAllowlist: string[];
  serviceBlocklist: string[];
  emergencyStop: boolean;
  /** Velocity limit: max allowed payments within the rolling window (e.g., 5). */
  velocityLimitCount?: number;
  /** Velocity window in seconds (default: 60s). */
  velocityWindowSeconds?: number;
  /** Action on velocity spike (default: "block"). */
  velocityAction?: "block" | "escalate";
}

export interface EvaluateRequest {
  amountMicro: bigint;
  recipient: string;
  service: string;
}

/** Spend / trust facts known at evaluation time. */
export interface EvaluateContext {
  sessionSpendMicro: bigint;
  dailySpendMicro: bigint;
  dailyPaymentCount: number;
  /** Count of payments by this agent within the rolling velocity window. */
  recentPaymentCountInWindow?: number;
  /** Addresses the agent (or org) has paid before. */
  knownRecipients: ReadonlySet<string>;
  /** Services the agent has used before. */
  knownServices: ReadonlySet<string>;
}

type Outcome = PolicyDecision;

interface RuleResult {
  outcome: Outcome;
  reason: string;
}

function hit(rule: string, description: string, severity: RuleHit["severity"]): RuleHit {
  return { rule, description, severity };
}

/**
 * Run a single payment request through the full policy pipeline.
 * Order is fixed and deterministic (PRD §8.1).
 */
export function evaluatePayment(
  policy: PolicyRuleSet,
  request: EvaluateRequest,
  ctx: EvaluateContext,
): PolicyEvaluation {
  const { amountMicro, recipient, service } = request;
  const reasons: string[] = [];
  const rulesTriggered: RuleHit[] = [];
  let outcome: Outcome = "AUTO_APPROVED";

  const hardBlock = (reason: string): void => {
    // Hard constraints always dominate: they upgrade AUTO_APPROVED and
    // ESCALATED alike (PRD: "hard policy violations must never be converted
    // into approval by frontend behavior").
    outcome = "BLOCKED";
    reasons.push(reason);
  };
  const escalate = (reason: string): void => {
    if (outcome === "AUTO_APPROVED") {
      outcome = "ESCALATED";
      reasons.push(reason);
    }
  };
  const note = (reason: string): void => {
    reasons.push(reason);
  };

  const push = (r: RuleHit): void => { rulesTriggered.push(r); };

  // 1. Emergency stop — hard override (FR-POLICY-006)
  if (policy.emergencyStop) {
    hardBlock(`Emergency stop is active: autonomous payments disabled for this agent.`);
    push(hit("emergency_stop", "Operator disabled autonomous payments", "block"));
    return finalize(policy, request, ctx, outcome, reasons, rulesTriggered);
  }

  // 2. Amount sanity
  if (amountMicro <= 0n) {
    hardBlock(`Requested amount ${request.amountMicro} microALGO is invalid.`);
    push(hit("amount_valid", "Amount must be positive", "block"));
    return finalize(policy, request, ctx, outcome, reasons, rulesTriggered);
  }

  // 3. Recipient blocklist
  if (policy.recipientBlocklist.some((a) => a.toLowerCase() === recipient.toLowerCase())) {
    hardBlock(`Recipient ${recipient} is on the blocklist.`);
    push(hit("recipient_blocklist", "Recipient is blocked", "block"));
    return finalize(policy, request, ctx, outcome, reasons, rulesTriggered);
  }

  // 4. Service blocklist
  if (policy.serviceBlocklist.includes(service)) {
    hardBlock(`Service "${service}" is on the blocklist.`);
    push(hit("service_blocklist", "Service is blocked", "block"));
    return finalize(policy, request, ctx, outcome, reasons, rulesTriggered);
  }

  // 5. Recipient allowlist (when configured, non-listed recipients cannot be paid)
  if (policy.recipientAllowlist.length > 0 && !policy.recipientAllowlist.some((a) => a.toLowerCase() === recipient.toLowerCase())) {
    hardBlock(`Recipient ${recipient} is not on the allowlist.`);
    push(hit("recipient_allowlist", "Recipient not allowlisted", "block"));
    return finalize(policy, request, ctx, outcome, reasons, rulesTriggered);
  }

  // 6. Service allowlist
  if (policy.serviceAllowlist.length > 0 && !policy.serviceAllowlist.includes(service)) {
    hardBlock(`Service "${service}" is not on the allowlist.`);
    push(hit("service_allowlist", "Service not allowlisted", "block"));
    return finalize(policy, request, ctx, outcome, reasons, rulesTriggered);
  }

  // 7. First-time recipient
  if (!ctx.knownRecipients.has(recipient.toLowerCase())) {
    const action = policy.unknownRecipient;
    if (action === "block") {
      hardBlock(`Recipient ${recipient} is unknown to this agent.`);
      push(hit("unknown_recipient", "Unknown recipient", "block"));
    } else if (action === "escalate") {
      escalate(`Recipient ${recipient} is unknown to this agent.`);
      push(hit("unknown_recipient", "Unknown recipient requires review", "warn"));
    } else {
      note(`Recipient ${recipient} is unknown but allowed by policy.`);
      push(hit("unknown_recipient", "Unknown recipient allowed", "info"));
    }
  }

  // 8. First-time service
  if (!ctx.knownServices.has(service)) {
    const action = policy.firstTimeService;
    if (action === "block") {
      hardBlock(`Service "${service}" is being used for the first time.`);
      push(hit("first_time_service", "First-time service", "block"));
    } else if (action === "escalate") {
      escalate(`Service "${service}" is being used for the first time.`);
      push(hit("first_time_service", "First-time service requires review", "warn"));
    } else {
      note(`Service "${service}" is first-time but allowed by policy.`);
      push(hit("first_time_service", "First-time service allowed", "info"));
    }
  }

  // 9. Per-call limit — the auto-approve ceiling
  if (amountMicro > policy.perCallLimitMicro) {
    if (amountMicro > policy.hardCeilingMicro) {
      hardBlock(
        `Requested ${algo(amountMicro)} ALGO exceeds the hard ceiling of ${algo(policy.hardCeilingMicro)} ALGO.`,
      );
      push(hit("hard_ceiling", "Above hard payment ceiling", "block"));
    } else {
      escalate(
        `Requested ${algo(amountMicro)} ALGO exceeds the autonomous per-call limit of ${algo(policy.perCallLimitMicro)} ALGO.`,
      );
      push(hit("per_call_limit", "Above autonomous per-call limit", "warn"));
    }
  }

  // 10. Session budget
  if (ctx.sessionSpendMicro + amountMicro > policy.sessionBudgetMicro) {
    hardBlock(
      `Session spend ${algo(ctx.sessionSpendMicro)} + ${algo(amountMicro)} ALGO exceeds session budget ${algo(policy.sessionBudgetMicro)} ALGO.`,
    );
    push(hit("session_budget", "Session budget exhausted", "block"));
  }

  // 11. Daily budget
  if (ctx.dailySpendMicro + amountMicro > policy.dailyBudgetMicro) {
    hardBlock(
      `Daily spend ${algo(ctx.dailySpendMicro)} + ${algo(amountMicro)} ALGO exceeds daily budget ${algo(policy.dailyBudgetMicro)} ALGO.`,
    );
    push(hit("daily_budget", "Daily budget exhausted", "block"));
  }

  // 12. Daily payment count
  if (ctx.dailyPaymentCount + 1 > policy.maxDailyPayments) {
    hardBlock(`Daily payment count ${ctx.dailyPaymentCount} exceeds max ${policy.maxDailyPayments}.`);
    push(hit("max_daily_payments", "Daily payment count exhausted", "block"));
  }

  // 13. Velocity spike / loop anomaly detection
  if (
    policy.velocityLimitCount &&
    policy.velocityLimitCount > 0 &&
    (ctx.recentPaymentCountInWindow ?? 0) >= policy.velocityLimitCount
  ) {
    const action = policy.velocityAction ?? "block";
    const windowSec = policy.velocityWindowSeconds ?? 60;
    if (action === "block") {
      hardBlock(
        `Velocity anomaly: ${(ctx.recentPaymentCountInWindow ?? 0) + 1} payments in ${windowSec}s exceeds threshold of ${policy.velocityLimitCount}.`,
      );
      push(hit("velocity_spike", "Spending velocity spike anomaly detected", "block"));
    } else {
      escalate(
        `Velocity spike: ${(ctx.recentPaymentCountInWindow ?? 0) + 1} payments in ${windowSec}s requires review.`,
      );
      push(hit("velocity_spike", "Spending velocity warning", "warn"));
    }
  }

  return finalize(policy, request, ctx, outcome, reasons, rulesTriggered);
}

function finalize(
  policy: PolicyRuleSet,
  request: EvaluateRequest,
  _ctx: EvaluateContext,
  decision: Outcome,
  reasons: string[],
  rulesTriggered: RuleHit[],
): PolicyEvaluation {
  if (decision === "AUTO_APPROVED") {
    reasons.unshift(
      `Requested ${algo(request.amountMicro)} ALGO is within the autonomous per-call limit of ${algo(policy.perCallLimitMicro)} ALGO.`,
    );
    rulesTriggered.unshift(hit("auto_approve", "Within autonomous limits", "info"));
  }
  return {
    decision,
    reasons,
    rulesTriggered,
    policyVersion: policy.version,
    requestedAlgo: Number(request.amountMicro) / 1_000_000,
    remainingSessionAlgo: null,
    remainingDailyAlgo: null,
    dailySpendAlgo: null,
  };
}

export function algo(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const frac = (micro % 1_000_000n).toString().padStart(6, "0").slice(0, 4).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Human-readable, dashboard-friendly explanation of a decision (PRD §6.3). */
export function formatExplanation(evaluation: PolicyEvaluation): string {
  const head =
    evaluation.decision === "AUTO_APPROVED"
      ? "AUTHORIZED"
      : evaluation.decision === "ESCALATED"
        ? "ESCALATION REQUIRED"
        : "BLOCKED";
  return [head, ...evaluation.reasons].join("\n");
}
