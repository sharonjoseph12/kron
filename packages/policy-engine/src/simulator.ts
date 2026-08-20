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

    const evaluation = evaluatePayment(draft, { amountMicro: t.amountMicro, recipient: t.recipient, service: t.service }, {
      sessionSpendMicro: 0n,
      dailySpendMicro: bucket.spendMicro,
      dailyPaymentCount: bucket.count,
      knownRecipients,
      knownServices,
    });

    if (evaluation.decision === "AUTO_APPROVED") {
      simulated.autoApproved += 1;
      simulated.spendAlgo += Number(t.amountMicro) / 1_000_000;
      bucket.spendMicro += t.amountMicro;
      bucket.count += 1;
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
