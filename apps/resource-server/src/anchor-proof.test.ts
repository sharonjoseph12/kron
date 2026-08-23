import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyGroupedPolicyAnchor } from "./anchor-proof.js";

const baseArgs = {
  paymentTxId: "PAY123",
  algodUrl: "http://localhost:4001",
  algodToken: "",
  indexerUrl: "http://localhost:8980",
  indexerToken: "",
  anchorAppId: 1001,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyGroupedPolicyAnchor", () => {
  it("fails when the anchor app id is not configured", async () => {
    const result = await verifyGroupedPolicyAnchor({ ...baseArgs, anchorAppId: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not configured/);
  });

  it("rejects payments without an atomic group", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      transaction: { id: "PAY123", round: 500, "tx-type": "pay" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyGroupedPolicyAnchor(baseArgs);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no atomic group/);
  });

  it("rejects when the group has no app call to the anchor app", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ transaction: { id: "PAY123", round: 500, group: "grp==" } }))
      .mockResolvedValueOnce(jsonResponse({
        transactions: [{ id: "OTHER", round: 500, "tx-type": "pay" }],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyGroupedPolicyAnchor(baseArgs);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no app call to KRON anchor/);
  });

  it("accepts a settlement grouped with an anchor app call in the same round", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ transaction: { id: "PAY123", round: 500, group: "grp==" } }))
      .mockResolvedValueOnce(jsonResponse({
        transactions: [
          { id: "PAY123", round: 500, "tx-type": "pay" },
          {
            id: "APPL1",
            round: 500,
            "tx-type": "appl",
            "application-transaction": { "application-id": 1001 },
          },
        ],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyGroupedPolicyAnchor(baseArgs);
    expect(result.ok).toBe(true);
    expect(result.appCallTxId).toBe("APPL1");
    expect(result.round).toBe(500);
  });
});
