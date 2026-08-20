import { describe, expect, it } from "vitest";
import algosdk from "algosdk";
import { buildSiwaMessage, newChallenge, verifySiwaSignature, walletEmail } from "./siwa.js";

describe("siwa", () => {
  it("round-trips a signature using algosdk.signBytes (MX prefix compatibility)", () => {
    const acct = algosdk.generateAccount();
    const address = acct.addr.toString();
    const challenge = newChallenge();
    const message = buildSiwaMessage("http://localhost:8787", address, challenge);

    // Mirrors Pera's signData -> algosdk.signBytes
    const signature = algosdk.signBytes(new TextEncoder().encode(message), acct.sk);
    const b64 = Buffer.from(signature).toString("base64");

    expect(verifySiwaSignature(message, address, b64)).toBe(true);
    expect(verifySiwaSignature(`${message}\nTampered: true`, address, b64)).toBe(false);
    expect(verifySiwaSignature(message, address, Buffer.from("x".repeat(64)).toString("base64"))).toBe(false);
    expect(verifySiwaSignature(message, "not-an-address", b64)).toBe(false);
  });

  it("builds a stable synthetic email per address", () => {
    const a = algosdk.generateAccount().addr.toString();
    const b = algosdk.generateAccount().addr.toString();
    expect(walletEmail(a)).toBe(walletEmail(a));
    expect(walletEmail(a)).not.toBe(walletEmail(b));
    expect(walletEmail(a)).toMatch(/^pera-.*@wallet\.kron\.dev$/);
  });
});