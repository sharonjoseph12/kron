import { describe, it, expect } from "vitest";
import {
  buildArc2Note,
  buildPolicyHash,
  verifyPolicyAnchorProof,
  type Arc2NotePayload,
  type PolicyHashInput,
} from "./contract.js";

describe("ARC-2 note builder", () => {
  it("produces a note prefixed with 'kron:j'", () => {
    const payload: Arc2NotePayload = {
      v: 3,
      d: "AUTO_APPROVED",
      agent: "agent123",
      res: "premium-market-report",
      svc: "market",
      ph: "abc123",
    };
    const note = buildArc2Note(payload);
    const text = new TextDecoder().decode(note);
    expect(text.startsWith("kron:j")).toBe(true);
    const json = JSON.parse(text.slice("kron:j".length));
    expect(json.v).toBe(3);
    expect(json.d).toBe("AUTO_APPROVED");
    expect(json.agent).toBe("agent123");
    expect(json.res).toBe("premium-market-report");
  });

  it("produces valid UTF-8 bytes", () => {
    const payload: Arc2NotePayload = { v: 1, d: "BLOCKED", agent: "x", res: "y", svc: "z", ph: "ff" };
    const note = buildArc2Note(payload);
    expect(note).toBeInstanceOf(Uint8Array);
    expect(note.length).toBeGreaterThan(0);
  });
});

describe("policy hash builder", () => {
  it("produces a 64-char hex string (SHA-256)", () => {
    const input: PolicyHashInput = {
      policyVersion: 3,
      decision: "AUTO_APPROVED",
      reasons: ["Within limits"],
      agentId: "agent123",
      recipient: "RECIPIENT_ADDR",
      amountMicro: "50000",
      clientRequestId: "abc123",
    };
    const hash = buildPolicyHash(input);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    const input: PolicyHashInput = {
      policyVersion: 1,
      decision: "BLOCKED",
      reasons: ["Over limit", "Unknown recipient"],
      agentId: "a1",
      recipient: "r1",
      amountMicro: "1000000",
      clientRequestId: "req1",
    };
    expect(buildPolicyHash(input)).toBe(buildPolicyHash(input));
  });

  it("changes when input changes", () => {
    const base: PolicyHashInput = {
      policyVersion: 1,
      decision: "AUTO_APPROVED",
      reasons: [],
      agentId: "a1",
      recipient: "r1",
      amountMicro: "1000",
      clientRequestId: "req1",
    };
    const modified = { ...base, decision: "BLOCKED" };
    expect(buildPolicyHash(base)).not.toBe(buildPolicyHash(modified));
  });
});

describe("on-chain proof verification", () => {
  it("decodes and verifies valid ARC-2 notes", () => {
    const payload: Arc2NotePayload = {
      v: 2,
      d: "A",
      agent: "researcher-01",
      res: "market/report",
      svc: "market",
      ph: "e3b0c44298fc1c14",
    };
    const note = buildArc2Note(payload);
    const result = verifyPolicyAnchorProof(note, { policyVersion: 2, agentId: "researcher-01" });
    expect(result.valid).toBe(true);
    expect(result.policyVersion).toBe(2);
    expect(result.decision).toBe("AUTO_APPROVED");
    expect(result.policyHashPrefix).toBe("e3b0c44298fc1c14");
  });

  it("detects policy version tampering", () => {
    const payload: Arc2NotePayload = {
      v: 1,
      d: "A",
      agent: "trader-01",
      res: "market/sentiment",
      svc: "market",
      ph: "abc123",
    };
    const note = buildArc2Note(payload);
    const result = verifyPolicyAnchorProof(note, { policyVersion: 2 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Policy version mismatch");
  });

  it("rejects non-KRON notes", () => {
    const randomNote = new TextEncoder().encode("random note content");
    const result = verifyPolicyAnchorProof(randomNote);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Not a valid KRON ARC-2 note");
  });
});

