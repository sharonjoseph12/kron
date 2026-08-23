import type { PolicyConfig } from "./types.js";

/** Sensible defaults for a brand-new agent policy (dev-friendly). */
export const DEFAULT_POLICY: Omit<
  PolicyConfig,
  "id" | "version" | "createdAt" | "active"
> = {
  name: "Default agent policy",
  perCallLimitAlgo: 0.02,
  hardCeilingAlgo: 0.05,
  sessionBudgetAlgo: 0.05,
  dailyBudgetAlgo: 0.1,
  maxDailyPayments: 50,
  unknownRecipient: "block",
  firstTimeService: "escalate",
  recipientAllowlist: [],
  recipientBlocklist: [],
  serviceAllowlist: [],
  serviceBlocklist: [],
  emergencyStop: false,
  velocityLimitCount: 5,
  velocityWindowSeconds: 60,
  velocityAction: "block",
};

export const ALGO_DECIMALS = 6;

export const NETWORK_NAMES: Record<string, string> = {
  localnet: "Local DevNet",
  testnet: "TestNet",
  mainnet: "MainNet",
};

/** Block explorer base URLs by network. */
export const EXPLORER_URLS: Record<string, { tx: string; addr: string; app: string } | null> = {
  localnet: null,
  testnet: {
    tx: "https://testnet.explorer.perawallet.app/tx",
    addr: "https://testnet.explorer.perawallet.app/address",
    app: "https://testnet.explorer.perawallet.app/application",
  },
  mainnet: {
    tx: "https://explorer.perawallet.app/tx",
    addr: "https://explorer.perawallet.app/address",
    app: "https://explorer.perawallet.app/application",
  },
};

/** Get block explorer URL for a transaction, or null on localnet. */
export function explorerTxUrl(network: string, txId: string): string | null {
  const base = EXPLORER_URLS[network];
  return base ? `${base.tx}/${txId}` : null;
}

/** Get block explorer URL for an address, or null on localnet. */
export function explorerAddrUrl(network: string, address: string): string | null {
  const base = EXPLORER_URLS[network];
  return base ? `${base.addr}/${address}` : null;
}

/** Get block explorer URL for an application, or null on localnet. */
export function explorerAppUrl(network: string, appId: number): string | null {
  const base = EXPLORER_URLS[network];
  return base ? `${base.app}/${appId}` : null;
}
