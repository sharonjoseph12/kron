import "dotenv/config";
import crypto from "node:crypto";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/**
 * Read a secret from the environment. If it is missing or shorter than
 * `minLength`, generate a fresh cryptographically-random one so the server
 * never boots with a default/weak secret. Generated values are NOT persisted
 * back to .env — set them explicitly for stable sessions across restarts.
 */
function secret(name: string, minLength: number): string {
  const v = process.env[name];
  if (v && v.length >= minLength) return v;
  const generated = crypto.randomBytes(Math.ceil(minLength / 2)).toString("hex");
  console.warn(`[kron-config] ${name} missing or too short — generated a random value. Set it in .env for stable restarts.`);
  return generated;
}

export interface KronConfig {
  nodeEnv: string;
  apiPort: number;
  apiPublicUrl: string;
  dashboardUrl: string;
  resourceServerUrl: string;
  databaseUrl: string;
  algorandNetwork: "localnet" | "testnet" | "mainnet";
  algodUrl: string;
  algodToken: string;
  indexerUrl: string;
  indexerToken: string;
  fundingMnemonic: string;
  sessionSecret: string;
  encryptionKey: string;
  seedAdminEmail: string;
  seedAdminPassword: string;
  forceEscalate: boolean;
  demoMode: boolean;
}

export const config: KronConfig = {
  nodeEnv: optional("NODE_ENV", "development"),
  apiPort: Number(optional("API_PORT", "8787")),
  apiPublicUrl: optional("API_PUBLIC_URL", "http://localhost:8787"),
  dashboardUrl: optional("DASHBOARD_URL", "http://localhost:5173"),
  resourceServerUrl: optional("RESOURCE_SERVER_URL", "http://localhost:9100"),
  databaseUrl: required("DATABASE_URL"),
  algorandNetwork: (optional("ALGORAND_NETWORK", "testnet") as KronConfig["algorandNetwork"]),
  algodUrl: optional(
    "ALGOD_URL",
    process.env.ALGORAND_NETWORK === "mainnet"
      ? "https://mainnet-api.algonode.cloud"
      : "https://testnet-api.algonode.cloud"
  ),
  algodToken: optional("ALGOD_TOKEN", ""),
  indexerUrl: optional(
    "INDEXER_URL",
    process.env.ALGORAND_NETWORK === "mainnet"
      ? "https://mainnet-idx.algonode.cloud"
      : "https://testnet-idx.algonode.cloud"
  ),
  indexerToken: optional("INDEXER_TOKEN", ""),

  fundingMnemonic: optional("FUNDING_MNEMONIC", ""),
  sessionSecret: secret("SESSION_SECRET", 32),
  encryptionKey: secret("ENCRYPTION_KEY", 64),
  seedAdminEmail: optional("SEED_ADMIN_EMAIL", "admin@kron.dev"),
  seedAdminPassword: optional("SEED_ADMIN_PASSWORD", "admin1234"),
  forceEscalate: optional("FORCE_ESCALATE", "false") === "true",
  demoMode: optional("DEMO_MODE", "false") === "true",
};

export const IS_DEV = config.nodeEnv !== "production";