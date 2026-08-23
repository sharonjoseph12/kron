/**
 * Anomaly Scoring v1 — deterministic behavioral risk scoring for payment
 * requests (PRD §6.4 "Trust-Aware Payment Guardrails", §22 Phase 2).
 *
 * The velocity guard counts payments in a rolling window; anomaly scoring is
 * the smarter sibling: it weights bursts by amount, flags first-seen
 * recipients and statistical amount outliers, and produces a single 0-100
 * score the policy engine can act on (block / escalate thresholds).
 *
 * Pure and deterministic: no randomness, no clock reads — callers pass
 * timestamps explicitly so simulations and tests are reproducible.
 */

export interface AnomalyRequest {
  amountMicro: bigint;
  recipient: string;
  /** Request time in epoch ms. Passed explicitly for determinism. */
  timestampMs: number;
}

export interface AnomalyHistoryItem {
  amountMicro: bigint;
  recipient: string;
  timestampMs: number;
}

export interface AnomalySignal {
  code: "BURST" | "RECIPIENT_NOVELTY" | "AMOUNT_OUTLIER";
  weight: number;
  detail: string;
}

export interface AnomalyAssessment {
  /** 0-100 rounded composite risk score. */
  score: number;
  signals: AnomalySignal[];
}

/** Default engine actions: >= escalateThreshold -> ESCALATED, >= blockThreshold -> BLOCKED. */
export const ANOMALY_DEFAULTS = {
  escalateThreshold: 60,
  blockThreshold: 85,
  burstWindowSeconds: 60,
  burstMinCount: 3,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Score a payment request against recent history.
 * Weights: BURST up to 40 (scales with count and amount/per-call-limit ratio),
 * RECIPIENT_NOVELTY 20, AMOUNT_OUTLIER up to 35 (z-score >= 2 / >= 3).
 */
export function assessAnomaly(args: {
  request: AnomalyRequest;
  history: ReadonlyArray<AnomalyHistoryItem>;
  perCallLimitMicro?: bigint;
  burstWindowSeconds?: number;
}): AnomalyAssessment {
  const { request, history } = args;
  const burstWindowMs = (args.burstWindowSeconds ?? ANOMALY_DEFAULTS.burstWindowSeconds) * 1000;
  const signals: AnomalySignal[] = [];

  // BURST — rapid-fire spending, weighted by how large each call is relative
  // to the agent's autonomous per-call limit.
  const windowStart = request.timestampMs - burstWindowMs;
  const burst = history.filter((h) => h.timestampMs >= windowStart && h.timestampMs <= request.timestampMs);
  if (burst.length + 1 >= ANOMALY_DEFAULTS.burstMinCount) {
    const ratio =
      args.perCallLimitMicro && args.perCallLimitMicro > 0n
        ? Number((request.amountMicro * 100n) / args.perCallLimitMicro) / 100
        : 1;
    const amountFactor = 0.5 + 0.5 * clamp(ratio, 0, 1);
    const weight = Math.round(clamp((burst.length - 1) * 10, 5, 30) * amountFactor);
    signals.push({
      code: "BURST",
      weight,
      detail: `${burst.length + 1} payments within ${Math.round(burstWindowMs / 1000)}s`,
    });
  }

  // RECIPIENT_NOVELTY — first-seen recipient.
  const recipientLower = request.recipient.toLowerCase();
  if (!history.some((h) => h.recipient.toLowerCase() === recipientLower)) {
    signals.push({ code: "RECIPIENT_NOVELTY", weight: 20, detail: "recipient never paid before" });
  }

  // AMOUNT_OUTLIER — z-score vs trailing history (needs >= 5 samples).
  if (history.length >= 5) {
    const amounts = history.map((h) => Number(h.amountMicro));
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length;
    const std = Math.sqrt(variance);
    if (std > 0) {
      const z = Math.abs(Number(request.amountMicro) - mean) / std;
      if (z >= 3) {
        signals.push({ code: "AMOUNT_OUTLIER", weight: 35, detail: `amount z-score ${z.toFixed(1)} vs trailing history` });
      } else if (z >= 2) {
        signals.push({ code: "AMOUNT_OUTLIER", weight: 20, detail: `amount z-score ${z.toFixed(1)} vs trailing history` });
      }
    }
  }

  const raw = signals.reduce((a, s) => a + s.weight, 0);
  return { score: Math.min(100, Math.round(raw)), signals };
}
