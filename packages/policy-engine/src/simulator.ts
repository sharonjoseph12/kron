/**
 * Policy Simulation (PRD §6.2, §15) — replay a historical set of payment
 * requests through a *draft* policy before it is activated, so the operator
 * can see projected outcomes and spend before granting autonomy.
 *
 * During simulation the recipient/service "known" sets are built from the
 * transactions themselves (first occurrence is treated as unknown), so
 * unknown-recipient / first-time-service rules have a realistic effect.
 */
import type { SimulationResult, SimulationTally } from "@kron/shared";
import { evaluatePayment, type PolicyRuleSet } from "./engine.js";

export interface SimTransaction {
  requestId: string;
  amountMicro: bigint;
  recipient: string;
  service: string;
  ts: string; // ISO timestamp, used for daily bucketing
  /** Optional session grouping — enables the session-budget rule in simulation. */
  sessionId?: string;
}

export interface SimulateArgs {
  draft: PolicyRuleSet;
  transactions: SimTransaction[];
}

interface Bucket {
  day: string;
  spendMicro: bigint;
  count: number;
}

function dayKey(ts: string): string {
  return ts.slice(0, 10);
}

/**
 * Replay transactions (chronological) against a draft policy.
 * Returns current (what actually happened) vs simulated (what would have
 * happened under the draft) tallies, plus details of blocked payments.
 */
export function simulatePolicy(args: SimulateArgs): SimulationResult {
  const { draft, transactions } = args;
  const sorted = [...transactions].sort((a, b) => a.ts.localeCompare(b.ts));

  const buckets = new Map<string, Bucket>();
  const seenRecipients = new Set<string>();
  const seenServices = new Set<string>();
  const sessionSpend = new Map<string, bigint>();
  /** Timestamps (epoch ms) of payments auto-approved under the draft, for velocity replay. */
  const approvedTimestamps: number[] = [];
  /** Draft-approved payment trail feeding behavioral anomaly scoring. */
  const approvedHistory: { amountMicro: bigint; recipient: string; timestampMs: number }[] = [];
  const velocityWindowMs = (draft.velocityWindowSeconds ?? 60) * 1000;

  const current: SimulationTally = { autoApproved: 0, escalated: 0, blocked: 0, spendAlgo: 0 };
  const simulated: SimulationTally = { autoApproved: 0, escalated: 0, blocked: 0, spendAlgo: 0 };
  const blockedDetails: { requestId: string; amountAlgo: number; reason: string }[] = [];

  // Pre-scan: everything historical actually happened (was paid in the old policy).
  for (const t of sorted) {
    current.spendAlgo += Number(t.amountMicro) / 1_000_000;
  }

  for (const t of sorted) {
    const key = dayKey(t.ts);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { day: key, spendMicro: 0n, count: 0 };
      buckets.set(key, bucket);
    }

    const isUnknownRecipient = !seenRecipients.has(t.recipient.toLowerCase());
    const isUnknownService = !seenServices.has(t.service);
    seenRecipients.add(t.recipient.toLowerCase());
    seenServices.add(t.service);

    // Known sets exclude the current transaction's "discovery", so the
    // unknown-recipient / first-time-service rules fire on first occurrence.
    const knownRecipients = new Set<string>();
    for (const r of seenRecipients) {
      if (!(isUnknownRecipient && r === t.recipient.toLowerCase())) knownRecipients.add(r);
    }
    const knownServices = new Set<string>();
    for (const s of seenServices) {
      if (!(isUnknownService && s === t.service)) knownServices.add(s);
    }

    // Velocity replay: count draft-approved payments within the rolling window
    // before this transaction (mirrors the runtime's confirmed-payments query).
    const tsMs = Date.parse(t.ts);
    const windowStart = tsMs - velocityWindowMs;
    let recentPaymentCountInWindow = 0;
    for (const approved of approvedTimestamps) {
      if (approved >= windowStart && approved <= tsMs) recentPaymentCountInWindow += 1;
    }

    const sessionKey = t.sessionId ?? "";
    const evaluation = evaluatePayment(
      draft,
      { amountMicro: t.amountMicro, recipient: t.recipient, service: t.service, timestampMs: tsMs },
      {
        sessionSpendMicro: sessionSpend.get(sessionKey) ?? 0n,
        dailySpendMicro: bucket.spendMicro,
        dailyPaymentCount: bucket.count,
        recentPaymentCountInWindow,
        knownRecipients,
        knownServices,
        recentPayments: approvedHistory,
      },
    );

    if (evaluation.decision === "AUTO_APPROVED") {
      simulated.autoApproved += 1;
      simulated.spendAlgo += Number(t.amountMicro) / 1_000_000;
      bucket.spendMicro += t.amountMicro;
      bucket.count += 1;
      if (sessionKey) {
        sessionSpend.set(sessionKey, (sessionSpend.get(sessionKey) ?? 0n) + t.amountMicro);
      }
      approvedTimestamps.push(tsMs);
      approvedHistory.push({ amountMicro: t.amountMicro, recipient: t.recipient, timestampMs: tsMs });
    } else if (evaluation.decision === "ESCALATED") {
      simulated.escalated += 1;
      // Escalated payments do NOT auto-spend.
    } else {
      simulated.blocked += 1;
      blockedDetails.push({
        requestId: t.requestId,
        amountAlgo: Number(t.amountMicro) / 1_000_000,
        reason: evaluation.reasons.join(" "),
      });
    }
  }

  const transactionsAnalyzed = sorted.length;
  const reductionPct =
    current.spendAlgo > 0
      ? Math.max(0, ((current.spendAlgo - simulated.spendAlgo) / current.spendAlgo) * 100)
      : 0;

  return {
    transactionsAnalyzed,
    current,
    simulated,
    reductionPct,
    blockedDetails,
  };
}
