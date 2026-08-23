import { describe, expect, it } from "vitest";
import {
  ARC4_METHODS,
  arc4MethodSelector,
  arc4EncodeString,
  arc4EncodeUint64,
  arc4EncodeBool,
  buildAnchorPolicyArgs,
  buildGetAgentPolicyHashArgs,
  buildSetEmergencyStopArgs,
  buildFlushArgs,
  buildSetRuntimeArgs,
  buildConfigureAgentArgs,
  buildPolicyHash,
} from "../src/contract.js";

describe("ARC-4 ABI helpers", () => {
  it("computes the documented method selectors", () => {
    expect(Buffer.from(arc4MethodSelector(ARC4_METHODS.anchorPolicy)).toString("hex")).toBe("ec5e4747");
    expect(Buffer.from(arc4MethodSelector(ARC4_METHODS.getPaymentCount)).toString("hex")).toBe("817d3e72");
    expect(Buffer.from(arc4MethodSelector(ARC4_METHODS.getLastPolicyHash)).toString("hex")).toBe("22a4fb91");
    expect(Buffer.from(arc4MethodSelector(ARC4_METHODS.getAgentPolicyHash)).toString("hex")).toBe("9fba667f");
    expect(Buffer.from(arc4MethodSelector(ARC4_METHODS.setRuntime)).toString("hex")).toBe("f691fde4");
    expect(Buffer.from(arc4MethodSelector(ARC4_METHODS.configureAgent)).toString("hex")).toBe("817a20d3");
    expect(Buffer.from(arc4MethodSelector(ARC4_METHODS.setEmergencyStop)).toString("hex")).toBe("481676f5");
    expect(Buffer.from(arc4MethodSelector(ARC4_METHODS.flush)).toString("hex")).toBe("7f9acc63");
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

  it("encodes bools as 0x00 (false) or 0x80 (true)", () => {
    expect(Buffer.from(arc4EncodeBool(false)).toString("hex")).toBe("00");
    expect(Buffer.from(arc4EncodeBool(true)).toString("hex")).toBe("80");
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

  it("builds set_emergency_stop / get_agent_policy_hash / flush app args", () => {
    const stop = buildSetEmergencyStopArgs(true);
    expect(Buffer.from(stop[0]!).toString("hex")).toBe("481676f5");
    expect(Buffer.from(stop[1]!).toString("hex")).toBe("80");

    const resume = buildSetEmergencyStopArgs(false);
    expect(Buffer.from(resume[1]!).toString("hex")).toBe("00");

    const get = buildGetAgentPolicyHashArgs("agent-abc");
    expect(Buffer.from(get[0]!).toString("hex")).toBe("9fba667f");
    expect(new TextDecoder().decode(get[1]!.slice(2))).toBe("agent-abc");

    const flush = buildFlushArgs();
    expect(flush.length).toBe(1);
    expect(Buffer.from(flush[0]!).toString("hex")).toBe("7f9acc63");
  });

  it("builds set_runtime / configure_agent app args", () => {
    const addr = "M4GODAWKTANDGRGDQMUPO5I7X4KAICRQ2B7HCS2ZGZ2EPVEHHM7MXAQ4YI";
    const rt = buildSetRuntimeArgs(addr);
    expect(Buffer.from(rt[0]!).toString("hex")).toBe("f691fde4");
    expect(rt[1]!.length).toBe(32);

    const ca = buildConfigureAgentArgs({ agentId: "researcher-01", perCallLimitMicro: 50_000n, dailyLimitMicro: 2_000_000n });
    expect(Buffer.from(ca[0]!).toString("hex")).toBe("817a20d3");
    expect(new TextDecoder().decode(ca[1]!.slice(2))).toBe("researcher-01");
    expect(new DataView(ca[2]!.buffer).getBigUint64(0, false)).toBe(50_000n);
    expect(new DataView(ca[3]!.buffer).getBigUint64(0, false)).toBe(2_000_000n);
  });

  it("the TEAL source embeds the exact selectors it dispatches on", async () => {
    const { APPROVAL_TEAL } = await import("../src/contract.js");
    expect(APPROVAL_TEAL).toContain("0xec5e4747");
    expect(APPROVAL_TEAL).toContain("0x817d3e72");
    expect(APPROVAL_TEAL).toContain("0x22a4fb91");
    expect(APPROVAL_TEAL).toContain("0x9fba667f");
    expect(APPROVAL_TEAL).toContain("0xf691fde4");
    expect(APPROVAL_TEAL).toContain("0x817a20d3");
    expect(APPROVAL_TEAL).toContain("0x481676f5");
    expect(APPROVAL_TEAL).toContain("0x7f9acc63");
  });

  it("the TEAL source implements box storage, emergency stop and inner-txn flush", async () => {
    const { APPROVAL_TEAL } = await import("../src/contract.js");
    expect(APPROVAL_TEAL).toContain("box_put");
    expect(APPROVAL_TEAL).toContain("box_get");
    expect(APPROVAL_TEAL).toContain("emergency_stop");
    expect(APPROVAL_TEAL).toContain("itxn_begin");
    expect(APPROVAL_TEAL).toContain("itxn_submit");
  });

  it("anchor_policy enforces the atomic group, caller allowlist and amount linkage on-chain", async () => {
    const { APPROVAL_TEAL } = await import("../src/contract.js");
    expect(APPROVAL_TEAL).toContain("global GroupSize");
    expect(APPROVAL_TEAL).toContain("gtxn 1 TypeEnum");
    expect(APPROVAL_TEAL).toContain("gtxn 1 Sender");
    expect(APPROVAL_TEAL).toContain("gtxn 1 Amount");
    expect(APPROVAL_TEAL).toContain('byte "runtime"');
    expect(APPROVAL_TEAL).toContain("handle_set_runtime");
    expect(APPROVAL_TEAL).toContain("handle_configure_agent");
  });

  it("getters return ARC-4 ABI values via log with the 0x151f prefix", async () => {
    const { APPROVAL_TEAL } = await import("../src/contract.js");
    const logCount = APPROVAL_TEAL.split("\n").filter((l) => l.trim() === "log").length;
    expect(logCount).toBe(4);
    expect(APPROVAL_TEAL).toContain("byte 0x151f");
  });

  it("on-chain limits: configure_agent writes lim boxes, anchor enforces per-call + daily", async () => {
    const { APPROVAL_TEAL } = await import("../src/contract.js");
    expect(APPROVAL_TEAL).toContain('byte "lim:"');
    expect(APPROVAL_TEAL).toContain('byte "ds:"');
    expect(APPROVAL_TEAL).toContain("int 86400");
    expect(APPROVAL_TEAL).toContain("anchor_limit_exceeded");
    expect(APPROVAL_TEAL).toContain("anchor_daily_exceeded");
  });

  it("embedded APPROVAL_TEAL stays in sync with teal/approval.teal", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const file = fs.readFileSync(path.join(__dirname, "..", "teal", "approval.teal"), "utf8").replace(/\r\n/g, "\n");
    const { APPROVAL_TEAL } = await import("../src/contract.js");
    expect(APPROVAL_TEAL.replace(/\r\n/g, "\n")).toBe(file);
  });
});