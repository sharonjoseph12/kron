import { describe, expect, it } from "vitest";
import { assessAnomaly, ANOMALY_DEFAULTS } from "./anomaly.js";

const T0 = 1_700_000_000_000;
const MIN = 60_000;

function history(entries: Array<[bigint, string, number]>) {
  return entries.map(([amountMicro, recipient, timestampMs]) => ({ amountMicro, recipient, timestampMs }));
}

describe("assessAnomaly", () => {
  it("scores zero with no signals for a routine payment", () => {
    const a = assessAnomaly({
      request: { amountMicro: 10_000n, recipient: "A", timestampMs: T0 },
      history: history([[10_000n, "a", T0 - MIN]]),
    });
    expect(a.score).toBe(0);
    expect(a.signals).toHaveLength(0);
  });

  it("flags burst at exactly 3 payments in the window but not 2", () => {
    const two = assessAnomaly({
      request: { amountMicro: 10_000n, recipient: "a", timestampMs: T0 },
      history: history([
        [10_000n, "a", T0 - 10_000],
        [10_000n, "a", T0 - 20_000],
      ]),
    });
    expect(two.signals.find((s) => s.code === "BURST")).toBeUndefined();

    const three = assessAnomaly({
      request: { amountMicro: 10_000n, recipient: "a", timestampMs: T0 },
      history: history([
        [10_000n, "a", T0 - 10_000],
        [10_000n, "a", T0 - 20_000],
        [10_000n, "b", T0 - 30_000],
      ]),
    });
    expect(three.signals.find((s) => s.code === "BURST")).toBeDefined();
    expect(three.score).toBeGreaterThan(0);
  });

  it("ignores burst payments outside the window", () => {
    const a = assessAnomaly({
      request: { amountMicro: 10_000n, recipient: "a", timestampMs: T0 },
      burstWindowSeconds: 60,
      history: history([
        [10_000n, "a", T0 - 2 * MIN],
        [10_000n, "a", T0 - 3 * MIN],
        [10_000n, "a", T0 - 4 * MIN],
      ]),
    });
    expect(a.signals).toHaveLength(0);
  });

  it("weights bursts harder when the amount approaches the per-call limit", () => {
    const args = {
      request: { amountMicro: 50_000n, recipient: "a", timestampMs: T0 },
      history: history([
        [10_000n, "a", T0 - 5_000],
        [10_000n, "a", T0 - 15_000],
        [10_000n, "a", T0 - 25_000],
      ]),
    };
    const small = assessAnomaly({ ...args, perCallLimitMicro: 1_000_000n });
    const large = assessAnomaly({ ...args, perCallLimitMicro: 50_000n });
    const smallBurst = small.signals.find((s) => s.code === "BURST")!.weight;
    const largeBurst = large.signals.find((s) => s.code === "BURST")!.weight;
    expect(largeBurst).toBeGreaterThan(smallBurst);
  });

  it("flags first-seen recipients", () => {
    const a = assessAnomaly({
      request: { amountMicro: 10_000n, recipient: "STRANGER", timestampMs: T0 },
      history: history([[10_000n, "friend", T0 - MIN]]),
    });
    expect(a.signals.map((s) => s.code)).toContain("RECIPIENT_NOVELTY");
  });

  it("does not flag amount outliers without enough history", () => {
    const a = assessAnomaly({
      request: { amountMicro: 900_000n, recipient: "a", timestampMs: T0 },
      history: history([
        [10_000n, "a", T0 - MIN],
        [12_000n, "a", T0 - 2 * MIN],
      ]),
    });
    expect(a.signals.map((s) => s.code)).not.toContain("AMOUNT_OUTLIER");
  });

  it("escalates on statistical amount outliers (z >= 3)", () => {
    const hist = [10_000n, 11_000n, 9_500n, 10_500n, 10_200n].map(
      (amt, i) => ({ amountMicro: BigInt(amt), recipient: "a", timestampMs: T0 - (i + 1) * MIN }),
    );
    const a = assessAnomaly({
      request: { amountMicro: 900_000n, recipient: "a", timestampMs: T0 },
      history: hist,
    });
    const outlier = a.signals.find((s) => s.code === "AMOUNT_OUTLIER");
    expect(outlier).toBeDefined();
    expect(outlier!.weight).toBe(35);
  });

  it("caps the composite score at 100 and respects thresholds", () => {
    const hist = [10_000n, 10_100n, 9_900n, 10_050n, 10_000n].map(
      (amt, i) => ({ amountMicro: BigInt(amt), recipient: "a", timestampMs: T0 - (i + 1) * 5_000 }),
    );
    const a = assessAnomaly({
      request: { amountMicro: 500_000n, recipient: "stranger", timestampMs: T0 },
      history: hist,
      perCallLimitMicro: 500_000n,
    });
    // BURST(heavy) + NOVELTY + OUTLIER should exceed the default block threshold.
    expect(a.score).toBeGreaterThanOrEqual(ANOMALY_DEFAULTS.blockThreshold);
  });
});
