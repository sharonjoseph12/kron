/**
 * Wallet vault — dedicated, isolated agent wallets (FR-WALLET-003).
 * Signing material (the mnemonic) is encrypted at rest with AES-256-GCM
 * (FR §9.2/§9.3) and is never returned by any API response or log.
 */
import crypto from "node:crypto";
import algosdk from "algosdk";
import { config } from "../config.js";
import { algorand } from "./client.js";

const ALGORITHM = "aes-256-gcm";
const encKey = Buffer.from(config.encryptionKey, "hex");

if (encKey.length !== 32) {
  throw new Error("ENCRYPTION_KEY must be a 32-byte hex string (64 hex chars)");
}

export function encryptMnemonic(mnemonic: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encKey, iv);
  const ct = Buffer.concat([cipher.update(mnemonic, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decryptMnemonic(encrypted: string): string {
  const [ivB64, tagB64, ctB64] = encrypted.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Corrupt encrypted key");
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    encKey,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Create a fresh dedicated agent wallet. Never reuse a user's primary wallet. */
export function createWalletKeys(): { address: string; encryptedKey: string } {
  const account = algosdk.generateAccount();
  const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
  return { address: account.addr.toString(), encryptedKey: encryptMnemonic(mnemonic) };
}

const MIN_FUNDING_ALGO = 4;

/**
 * Top up an agent wallet from the configured funding account.
 * The transfer is clamped to what the funding account can actually spend, so
 * a small TestNet treasury (dispenser gives 10 ALGO) never triggers an
 * overspend rejection — it tops up as far as it can and reports the balance.
 */
export async function ensureFunded(address: string, targetAlgo: number = MIN_FUNDING_ALGO): Promise<number> {
  const balance = await algorand.getBalanceAlgo(address);
  if (!config.fundingMnemonic || balance >= targetAlgo) {
    return balance;
  }
  const FEE_ALGO = 0.001;
  const MIN_BALANCE_BUFFER = 0.1;
  const fundingAccount = algosdk.mnemonicToSecretKey(config.fundingMnemonic);
  const fundingBalance = await algorand
    .getBalanceAlgo(fundingAccount.addr.toString())
    .catch(() => 0);
  const needed = targetAlgo - balance + MIN_BALANCE_BUFFER;
  const spendable = Math.max(0, fundingBalance - FEE_ALGO - MIN_BALANCE_BUFFER);
  const amountAlgo = Math.min(needed, spendable);
  if (amountAlgo < FEE_ALGO) {
    // Funding treasury exhausted — report current balance rather than failing.
    return balance;
  }
  await algorand.sendPayment({
    mnemonic: config.fundingMnemonic,
    amountMicro: BigInt(Math.round(amountAlgo * 1_000_000)),
    recipient: address,
    note: "kron:wallet-funding",
  });
  return await algorand.getBalanceAlgo(address);
}

export function getWalletMnemonic(encryptedKey: string): string {
  return decryptMnemonic(encryptedKey);
}
