import { describe, expect, it } from "vitest";
import { simulatePolicy, type SimTransaction } from "../src/simulator.js";
import type { PolicyRuleSet } from "../src/engine.js";

const MERCHANT = "MERCHANTALGORANDADDRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "OTHERALGORANDADDRBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function draft(overrides: Partial<PolicyRuleSet> = {}): PolicyRuleSet {
  return {
    version: 9,
    name: "draft",
    perCallLimitMicro: 50_000n,
    hardCeilingMicro: 1_000_000n,
    sessionBudgetMicro: 1_000_000n,
    dailyBudgetMicro: 5_000_000n,
    maxDailyPayments: 50,
    unknownRecipient: "block",
    firstTimeService: "escalate",
    recipientAllowlist: [],
    recipientBlocklist: [],
    serviceAllowlist: [],
    serviceBlocklist: [],
    emergencyStop: false,
    ...overrides,
  };
}

const txs: SimTransaction[] = Array.from({ length: 100 }, (_, i) => ({
  requestId: `req-${i}`,
  amountMicro: i % 10 === 0 ? 600_000n : 18_000n, // every 10th is 0.60 ALGO
  recipient: MERCHANT,
  service: "market",
  ts: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T10:0${i % 10}:00.000Z`,
}));

describe("simulatePolicy", () => {
  it("analyzes the full transaction set", () => {
    const r = simulatePolicy({ draft: draft(), transactions: txs });
    expect(r.transactionsAnalyzed).toBe(100);
  });

  it("projects fewer approvals when the ceiling is lower", () => {
    const loose = simulatePolicy({ draft: draft(), transactions: txs });
    const tight = simulatePolicy({
      draft: draft({ perCallLimitMicro: 20_000n }),
      transactions: txs,
    });
    expect(tight.simulated.autoApproved).toBeLessThanOrEqual(loose.simulated.autoApproved);
  });

  it("projects reduced spend and a reduction percentage", () => {
    const r = simulatePolicy({
      draft: draft({ perCallLimitMicro: 20_000n }),
      transactions: txs,
    });
    expect(r.simulated.spendAlgo).toBeLessThan(r.current.spendAlgo);
    expect(r.reductionPct).toBeGreaterThan(0);
    expect(r.reductionPct).toBeLessThanOrEqual(100);
  });

  it("blocks large payments when the hard ceiling is tight", () => {
    const r = simulatePolicy({
      draft: draft({ hardCeilingMicro: 100_000n }),
      transactions: txs,
    });
    expect(r.simulated.blocked).toBeGreaterThan(0);
    expect(r.blockedDetails.length).toBeGreaterThan(0);
    expect(r.blockedDetails[0]?.requestId).toBeDefined();
  });

  it("treats first-time recipients as unknown", () => {
    const firstTime: SimTransaction[] = [
      {
        requestId: "first",
        amountMicro: 1_000n,
        recipient: OTHER,
        service: "newsvc",
        ts: "2026-08-01T00:00:00.000Z",
      },
    ];
    const r = simulatePolicy({ draft: draft({ unknownRecipient: "block", firstTimeService: "block" }), transactions: firstTime });
    expect(r.simulated.blocked).toBe(1);
    expect(r.simulated.autoApproved).toBe(0);
  });

  it("respects emergency stop in the draft", () => {
    const r = simulatePolicy({ draft: draft({ emergencyStop: true }), transactions: txs });
    expect(r.simulated.autoApproved).toBe(0);
    expect(r.simulated.blocked).toBe(txs.length);
  });
});

describe("simulatePolicy — velocity & session rule coverage", () => {
  it("velocity rule fires in simulation when approved payments spike", () => {
    const burstDraft = draft({ unknownRecipient: "allow", velocityLimitCount: 3, velocityWindowSeconds: 60, velocityAction: "block" });
    const burstTxs: SimTransaction[] = Array.from({ length: 6 }, (_, i) => ({
      requestId: `v-${i}`,
      amountMicro: 10_000n,
      recipient: MERCHANT,
      service: "market",
      ts: `2026-08-01T10:00:0${i}.000Z`, // one per second
      sessionId: "s1",
    }));
    const r = simulatePolicy({ draft: burstDraft, transactions: burstTxs });
    expect(r.simulated.blocked).toBeGreaterThan(0);
    expect(r.blockedDetails.some((b) => /Velocity anomaly/.test(b.reason))).toBe(true);
  });

  it("session-budget rule fires in simulation when a session overspends", () => {
    const tight = draft({ unknownRecipient: "allow", firstTimeService: "allow", perCallLimitMicro: 500_000n, sessionBudgetMicro: 100_000n });
    const sessionTxs: SimTransaction[] = [
      { requestId: "s-a", amountMicro: 40_000n, recipient: MERCHANT, service: "market", ts: "2026-08-02T09:00:00.000Z", sessionId: "sess-1" },
      { requestId: "s-b", amountMicro: 40_000n, recipient: MERCHANT, service: "market", ts: "2026-08-02T09:01:00.000Z", sessionId: "sess-1" },
      // 80k spent in sess-1; this 40k call crosses the 100k session budget
      { requestId: "s-c", amountMicro: 40_000n, recipient: MERCHANT, service: "market", ts: "2026-08-02T09:02:00.000Z", sessionId: "sess-1" },
    ];
    const r = simulatePolicy({ draft: tight, transactions: sessionTxs });
    expect(r.simulated.autoApproved).toBe(2);
    expect(r.simulated.blocked).toBe(1);
    expect(r.blockedDetails[0]?.reason).toMatch(/session budget/i);
  });

  it("session budgets reset between sessions", () => {
    const tight = draft({ unknownRecipient: "allow", firstTimeService: "allow", perCallLimitMicro: 500_000n, sessionBudgetMicro: 100_000n });
    const sessionTxs: SimTransaction[] = [
      { requestId: "a1", amountMicro: 80_000n, recipient: MERCHANT, service: "market", ts: "2026-08-03T09:00:00.000Z", sessionId: "one" },
      { requestId: "b1", amountMicro: 80_000n, recipient: MERCHANT, service: "market", ts: "2026-08-03T09:05:00.000Z", sessionId: "two" },
    ];
    const r = simulatePolicy({ draft: tight, transactions: sessionTxs });
    expect(r.simulated.blocked).toBe(0);
    expect(r.simulated.autoApproved).toBe(2);
  });
});
