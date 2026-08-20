import { describe, expect, it } from "vitest";
import { extractPaymentRequired, X402_PAYMENT_REQUIRED } from "@kron/shared";
import { instructionFor, PAID_RESOURCES, paymentRequiredContent } from "./instructions.js";

const MERCHANT = "A".repeat(58);
const BASE_URL = "http://localhost:9100";

describe("x402 payment marker", () => {
  it("builds a valid instruction for the paid resource", () => {
    const resource = PAID_RESOURCES["premium-market-report"]!;
    const instruction = instructionFor(BASE_URL, MERCHANT, resource);

    expect(instruction.schemaVersion).toBe("1.0");
    expect(instruction.amount).toBe("18000");
    expect(instruction.asset).toEqual({ type: "algo", decimals: 6 });
    expect(instruction.network).toBe("testnet");
    expect(instruction.recipient).toBe(MERCHANT);
    expect(instruction.note).toBe("kron:premium-market-report");
    expect(instruction.paymentUrl).toBe(`${BASE_URL}/instructions/premium-market-report`);
    expect(instruction.resource).toMatchObject({ id: "premium-market-report", name: "Premium Market Research Report" });
    expect(instruction.expiresAt).toBeTypeOf("string");
  });

  it("round-trips through extractPaymentRequired", () => {
    const resource = PAID_RESOURCES["premium-market-report"]!;
    const result = paymentRequiredContent(BASE_URL, MERCHANT, resource);

    const extracted = extractPaymentRequired(result);
    expect(extracted).not.toBeNull();
    expect(extracted!.type).toBe(X402_PAYMENT_REQUIRED);
    expect(extracted!.challenge.scheme).toBe("x402");
    expect(extracted!.challenge.paymentUrl).toBe(`${BASE_URL}/instructions/premium-market-report`);
    expect(extracted!.instruction.amount).toBe("18000");
    expect(extracted!.instruction.recipient).toBe(MERCHANT);
    expect(extracted!.instruction.resource.id).toBe("premium-market-report");
  });

  it("prices stablecoin resources in the asset declared by the catalog", () => {
    const resource = PAID_RESOURCES["premium-defi-yield"]!;
    const instruction = instructionFor(BASE_URL, MERCHANT, resource);

    expect(instruction.asset.type).toBe("asa");
    expect(instruction.asset.assetId).toBeTypeOf("number");
    expect(instruction.asset.assetId).toBeGreaterThan(0);
    expect(instruction.asset.decimals).toBe(6);
    expect(instruction.amount).toBe("2500000");
  });

  it("returns null for free tool results", () => {
    expect(extractPaymentRequired({ content: [{ type: "text", text: "plain" }] })).toBeNull();
    expect(extractPaymentRequired(null)).toBeNull();
  });
});