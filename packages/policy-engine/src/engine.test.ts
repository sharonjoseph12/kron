import { describe, expect, it } from "vitest";
import { evaluatePayment, type PolicyRuleSet } from "../src/engine.js";

const MERCHANT = "MERCHANTALGORANDADDRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function makePolicy(overrides: Partial<PolicyRuleSet> = {}): PolicyRuleSet {
  return {
    version: 1,
    name: "test",
    perCallLimitMicro: 50_000n, // 0.05
    hardCeilingMicro: 1_000_000n, // 1.0
    sessionBudgetMicro: 1_000_000n, // 1.0
    dailyBudgetMicro: 5_000_000n, // 5.0
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

const ctx = {
  sessionSpendMicro: 0n,
  dailySpendMicro: 0n,
  dailyPaymentCount: 0,
  knownRecipients: new Set([MERCHANT.toLowerCase()]),
  knownServices: new Set(["market"]),
};

describe("evaluatePayment", () => {
  it("auto-approves a small payment to a known recipient (PRD demo step 4)", () => {
    const r = evaluatePayment(
      makePolicy(),
      { amountMicro: 18_000n, recipient: MERCHANT, service: "market" },
      ctx,
    );
    expect(r.decision).toBe("AUTO_APPROVED");
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("escalates when above the per-call limit but under the hard ceiling", () => {
    const r = evaluatePayment(
      makePolicy(),
      { amountMicro: 800_000n, recipient: MERCHANT, service: "market" }, // 0.80
      ctx,
    );
    expect(r.decision).toBe("ESCALATED");
    expect(r.reasons.join(" ")).toContain("per-call limit");
  });

  it("blocks when above the hard ceiling", () => {
    const r = evaluatePayment(
      makePolicy(),
      { amountMicro: 5_000_000n, recipient: MERCHANT, service: "market" }, // 5.0
      ctx,
    );
    expect(r.decision).toBe("BLOCKED");
    expect(r.reasons.join(" ")).toContain("hard ceiling");
  });

  it("blocks unknown recipients when policy says block", () => {
    const r = evaluatePayment(
      makePolicy({ unknownRecipient: "block" }),
      { amountMicro: 1_000n, recipient: "UNKNOWN" + MERCHANT.slice(7), service: "market" },
      ctx,
    );
    expect(r.decision).toBe("BLOCKED");
  });

  it("escalates unknown recipients when policy says escalate", () => {
    const r = evaluatePayment(
      makePolicy({ unknownRecipient: "escalate" }),
      { amountMicro: 1_000n, recipient: "UNKNOWN" + MERCHANT.slice(7), service: "market" },
      ctx,
    );
    expect(r.decision).toBe("ESCALATED");
  });

  it("blocks when daily budget would be exceeded", () => {
    const r = evaluatePayment(
      makePolicy({ dailyBudgetMicro: 100_000n }),
      { amountMicro: 90_000n, recipient: MERCHANT, service: "market" },
      { ...ctx, dailySpendMicro: 80_000n },
    );
    expect(r.decision).toBe("BLOCKED");
    expect(r.reasons.join(" ")).toContain("daily budget");
  });

  it("blocks when session budget would be exceeded", () => {
    const r = evaluatePayment(
      makePolicy({ sessionBudgetMicro: 100_000n }),
      { amountMicro: 50_000n, recipient: MERCHANT, service: "market" },
      { ...ctx, sessionSpendMicro: 90_000n },
    );
    expect(r.decision).toBe("BLOCKED");
  });

  it("respects recipient blocklist", () => {
    const r = evaluatePayment(
      makePolicy({ recipientBlocklist: [MERCHANT] }),
      { amountMicro: 1_000n, recipient: MERCHANT, service: "market" },
      ctx,
    );
    expect(r.decision).toBe("BLOCKED");
  });

  it("enforces recipient allowlist", () => {
    const r = evaluatePayment(
      makePolicy({ recipientAllowlist: ["OTHERADDR"] }),
      { amountMicro: 1_000n, recipient: MERCHANT, service: "market" },
      ctx,
    );
    expect(r.decision).toBe("BLOCKED");
  });

  it("emergency stop blocks everything", () => {
    const r = evaluatePayment(
      makePolicy({ emergencyStop: true }),
      { amountMicro: 1_000n, recipient: MERCHANT, service: "market" },
      ctx,
    );
    expect(r.decision).toBe("BLOCKED");
  });

  it("enforces daily payment count", () => {
    const r = evaluatePayment(
      makePolicy({ maxDailyPayments: 3 }),
      { amountMicro: 1_000n, recipient: MERCHANT, service: "market" },
      { ...ctx, dailyPaymentCount: 3 },
    );
    expect(r.decision).toBe("BLOCKED");
  });

  it("first-time service escalates by default", () => {
    const r = evaluatePayment(
      makePolicy(),
      { amountMicro: 1_000n, recipient: MERCHANT, service: "brand-new-service" },
      ctx,
    );
    expect(r.decision).toBe("ESCALATED");
  });

  it("records the policy version on every evaluation", () => {
    const r = evaluatePayment(makePolicy({ version: 7 }), { amountMicro: 1_000n, recipient: MERCHANT, service: "market" }, ctx);
    expect(r.policyVersion).toBe(7);
  });

  it("blocks on velocity spike threshold breach", () => {
    const r = evaluatePayment(
      makePolicy({ velocityLimitCount: 5, velocityWindowSeconds: 60, velocityAction: "block" }),
      { amountMicro: 10_000n, recipient: MERCHANT, service: "market" },
      { ...ctx, recentPaymentCountInWindow: 5 },
    );
    expect(r.decision).toBe("BLOCKED");
    expect(r.reasons.join(" ")).toContain("Velocity anomaly");
  });

  it("escalates on velocity spike when configured", () => {
    const r = evaluatePayment(
      makePolicy({ velocityLimitCount: 5, velocityWindowSeconds: 60, velocityAction: "escalate" }),
      { amountMicro: 10_000n, recipient: MERCHANT, service: "market" },
      { ...ctx, recentPaymentCountInWindow: 5 },
    );
    expect(r.decision).toBe("ESCALATED");
    expect(r.reasons.join(" ")).toContain("Velocity spike");
  });
});
