import { describe, expect, it } from "vitest";
import algosdk from "algosdk";
import {
  createInstruction,
  decodePaymentToken,
  instructionAmountMicro,
  parseInstruction,
  signPaymentTransaction,
  verifyPaymentToken,
} from "../src/index.js";
import { buildAuthorizationHeader, parseAuthorizationHeader } from "@kron/shared";

const SENDER_ACCOUNT = algosdk.generateAccount();
const RECEIVER_ACCOUNT = algosdk.generateAccount();
const MNEMONIC = algosdk.secretKeyToMnemonic(SENDER_ACCOUNT.sk);
const RECIPIENT = RECEIVER_ACCOUNT.addr.toString();

const dummyParams = {
  firstValidRound: 1001,
  lastValidRound: 2001,
  genesisHash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  genesisId: "devmodenet",
};

// Real genesis hash of algod private devnet (devnet genesis) for signature validity in decode test
function signWith(amountMicro: bigint) {
  return signPaymentTransaction({
    mnemonic: MNEMONIC,
    amountMicro,
    recipient: RECIPIENT,
    note: "kron:test",
    ...dummyParams,
  });
}

describe("x402 protocol", () => {
  it("creates and parses an instruction", () => {
    const instruction = createInstruction({
      amountAlgo: 0.018,
      recipient: RECIPIENT,
      network: "localnet",
      resource: { id: "premium/market-data", name: "Premium Market Data" },
      paymentUrl: "http://localhost:9100/instructions/abc123",
    });
    expect(instructionAmountMicro(instruction)).toBe(18_000n);
    const parsed = parseInstruction(JSON.parse(JSON.stringify(instruction)));
    expect(parsed.amount).toBe("18000");
    expect(parsed.recipient).toBe(RECIPIENT);
    expect(parsed.resource.id).toBe("premium/market-data");
  });

  it("rejects malformed instructions", () => {
    expect(() => parseInstruction({ amount: "not-a-number", recipient: RECIPIENT })).toThrow();
    expect(() => parseInstruction({ amount: "1000", recipient: RECIPIENT, network: "moon" })).toThrow();
  });

  it("signs a payment and decodes it back", () => {
    const signed = signWith(18_000n);
    const account = algosdk.mnemonicToSecretKey(MNEMONIC);
    const decoded = decodePaymentToken(signed.signedTxnB64);
    expect(decoded.txId).toBe(signed.txId);
    expect(decoded.sender).toBe(account.addr.toString());
    expect(decoded.receiver).toBe(RECIPIENT);
    expect(decoded.amountMicro).toBe(18_000n);
    expect(decoded.note).toBe("kron:test");
  });

  it("round-trips the authorization header", () => {
    const token = { signedTxnB64: "QUJD", txId: "TX1" };
    const header = buildAuthorizationHeader(token);
    const parsed = parseAuthorizationHeader(header);
    expect(parsed?.signedTxnB64).toBe("QUJD");
  });

  it("rejects a token against a mismatched amount during verification", async () => {
    const signed = signWith(18_000n);
    const result = await verifyPaymentToken({
      signedTxnB64: signed.signedTxnB64,
      indexerUrl: "http://localhost:8980",
      expected: {
        recipient: RECIPIENT,
        amountMicro: 99_999n,
        sender: algosdk.mnemonicToSecretKey(MNEMONIC).addr.toString(),
        network: "localnet",
      },
      retryMs: 1500,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not confirmed");
  });
});
