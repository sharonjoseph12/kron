import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import algosdk from "algosdk";
import { config } from "./config.js";
import { algod } from "./algod.js";

const STATE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "merchant-wallet.json");
const FUNDING_ALGO_MICRO = 5_000_000n;

export interface MerchantWallet {
  address: string;
  funded: boolean;
}

export function loadMerchantWallet(): MerchantWallet | null {
  if (config.merchantMnemonic) {
    const account = algosdk.mnemonicToSecretKey(config.merchantMnemonic);
    return { address: account.addr.toString(), funded: true };
  }
  const fromState = readState();
  if (fromState) {
    const account = algosdk.mnemonicToSecretKey(fromState.mnemonic);
    return { address: account.addr.toString(), funded: true };
  }
  return null;
}

export async function bootstrapMerchantWallet(): Promise<MerchantWallet> {
  const existing = loadMerchantWallet();
  if (existing) return existing;

  if (!config.fundingMnemonic) {
    throw new Error("FUNDING_MNEMONIC is required on first boot to create the merchant wallet");
  }

  const account = algosdk.generateAccount();
  const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
  const address = account.addr.toString();

  const sent = await algod.sendPayment({
    mnemonic: config.fundingMnemonic,
    amountMicro: FUNDING_ALGO_MICRO,
    recipient: address,
    note: "kron:merchant-funding",
  });

  persistState(mnemonic);
  console.log(`[wallet] merchant wallet created + funded: ${address} (tx ${sent.txId}, round ${sent.confirmedRound})`);
  return { address, funded: true };
}

/**
 * Persist the merchant mnemonic to a gitignored state file (data/), NOT .env —
 * keeps the merchant identity stable across restarts without mutating config
 * files at runtime.
 */
function persistState(mnemonic: string): void {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify({ mnemonic }, null, 2), { mode: 0o600 });
}

function readState(): { mnemonic: string } | null {
  try {
    if (!fs.existsSync(STATE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as { mnemonic?: string };
    return raw.mnemonic ? { mnemonic: raw.mnemonic } : null;
  } catch {
    return null;
  }
}