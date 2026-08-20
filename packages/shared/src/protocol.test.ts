import { describe, expect, it } from "vitest";
import { algoToMicro, clientRequestId, microToAlgo } from "./protocol.js";
import { DEFAULT_POLICY } from "./constants.js";
import { MCP_PAYMENT_TOKEN_ARG, X402_PAYMENT_REQUIRED, extractPaymentRequired } from "./mcp.js";

describe("shared protocol helpers", () => {
  it("converts micro <-> algo without float drift", () => {
    expect(algoToMicro(0.018)).toBe("18000");
    expect(algoToMicro(2)).toBe("2000000");
    expect(microToAlgo("18000")).toBe(0.018);
  });

  it("produces a deterministic idempotency key", () => {
    const parts = {
      agentId: "a1",
      sessionId: "s1",
      toolCallId: "t1",
      resourceId: "r1",
      amountMicro: "18000",
    };
    expect(clientRequestId(parts)).toBe(clientRequestId(parts));
    expect(clientRequestId(parts)).not.toBe(clientRequestId({ ...parts, amountMicro: "20000" }));
  });

  it("keeps a safe default policy", () => {
    expect(DEFAULT_POLICY.name).toBe("Default agent policy");
    expect(DEFAULT_POLICY.hardCeilingAlgo).toBeGreaterThan(DEFAULT_POLICY.perCallLimitAlgo);
    expect(DEFAULT_POLICY.emergencyStop).toBe(false);
  });

  it("detects a payment-required marker in MCP output", () => {
    const marker = extractPaymentRequired({
      content: [{ type: "text", text: "402 Payment Required" }],
      structuredContent: {
        type: X402_PAYMENT_REQUIRED,
        challenge: { scheme: "x402", paymentUrl: "http://localhost:9100/instructions/abc" },
        instruction: { amount: "18000", recipient: "ADDR", network: "localnet", resource: { id: "r", name: "R" } },
      },
    });
    expect(marker?.instruction.recipient).toBe("ADDR");
    expect(MCP_PAYMENT_TOKEN_ARG).toBe("paymentToken");
  });
});