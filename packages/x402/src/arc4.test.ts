import { describe, expect, it } from "vitest";
import {
  ARC4_METHODS,
  arc4MethodSelector,
  arc4EncodeString,
  arc4EncodeUint64,
  buildAnchorPolicyArgs,
  buildPolicyHash,
} from "../src/contract.js";

describe("ARC-4 ABI helpers", () => {
  it("computes the documented method selectors", () => {
    expect(Buffer.from(arc4MethodSelector(ARC4_METHODS.anchorPolicy)).toString("hex")).toBe("ec5e4747");
    expect(Buffer.from(arc4MethodSelector(ARC4_METHODS.getPaymentCount)).toString("hex")).toBe("817d3e72");
    expect(Buffer.from(arc4MethodSelector(ARC4_METHODS.getLastPolicyHash)).toString("hex")).toBe("22a4fb91");
  });

  it("encodes strings with a 2-byte big-endian length prefix", () => {
    const enc = arc4EncodeString("agent-123");
    expect(enc.length).toBe(2 + "agent-123".length);
    expect(new DataView(enc.buffer).getUint16(0, false)).toBe("agent-123".length);
    expect(new TextDecoder().decode(enc.slice(2))).toBe("agent-123");
  });

  it("encodes uint64 big-endian in exactly 8 bytes", () => {
    const enc = arc4EncodeUint64(18_000n);
    expect(enc.length).toBe(8);
    expect(new DataView(enc.buffer).getBigUint64(0, false)).toBe(18_000n);
    expect(Buffer.from(arc4EncodeUint64(1n)).toString("hex")).toBe("0000000000000001");
  });

  it("builds anchor_policy app args matching the TEAL dispatch contract", () => {
    const policyHash = buildPolicyHash({
      policyVersion: 3,
      decision: "AUTO_APPROVED",
      reasons: ["within per-call limit"],
      agentId: "agent-123",
      recipient: "RRZ5UEO2XGYIGEYSKXWQJJ4LJSBBXNXC6TAGD4U3FBN4TXO3Q6JZ2VQTOI",
      amountMicro: "18000",
      clientRequestId: "abc123",
    });
    const args = buildAnchorPolicyArgs({ policyHash, agentId: "agent-123", amountMicro: 18_000n });

    expect(args.length).toBe(4);
    // [0] selector, [1] raw 32-byte digest, [2] arc4 string, [3] uint64
    expect(Buffer.from(args[0]!).toString("hex")).toBe("ec5e4747");
    expect(args[1]!.length).toBe(32);
    expect(Buffer.from(args[1]!).toString("hex")).toBe(policyHash);
    expect(new TextDecoder().decode(args[2]!.slice(2))).toBe("agent-123");
    expect(new DataView(args[3]!.buffer).getBigUint64(0, false)).toBe(18_000n);
  });

  it("the TEAL source embeds the exact selectors it dispatches on", async () => {
    const { APPROVAL_TEAL } = await import("../src/contract.js");
    expect(APPROVAL_TEAL).toContain("0xec5e4747");
    expect(APPROVAL_TEAL).toContain("0x817d3e72");
    expect(APPROVAL_TEAL).toContain("0x22a4fb91");
  });
});