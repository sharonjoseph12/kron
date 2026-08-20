import "dotenv/config";
import type { Network } from "@kron/shared";

export interface Config {
  port: number;
  baseUrl: string;
  network: Network;
  algodUrl: string;
  algodToken: string;
  indexerUrl: string;
  indexerToken: string;
  fundingMnemonic: string;
  merchantMnemonic: string;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : fallback;
}

export const config: Config = {
  port: Number(optional("PORT", "9100")),
  baseUrl: optional("KRON_BASE_URL", "http://localhost:9100").replace(/\/+$/, ""),
  network: optional("ALGORAND_NETWORK", "testnet") as Network,
  algodUrl: optional("ALGOD_URL", "https://testnet-api.algonode.cloud").replace(/\/+$/, ""),
  algodToken: optional("ALGOD_TOKEN", ""),
  indexerUrl: optional("INDEXER_URL", "https://testnet-idx.algonode.cloud").replace(/\/+$/, ""),
  indexerToken: optional("INDEXER_TOKEN", ""),
  fundingMnemonic: optional("FUNDING_MNEMONIC", ""),
  merchantMnemonic: optional("MERCHANT_MNEMONIC", ""),
};