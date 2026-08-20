/**
 * x402 payment protocol primitives shared by the KRON payment engine
 * (client side) and the resource-server (server side).
 *
 * Wire protocol used across KRON:
 *
 *   1. Client GETs a paid resource without a token
 *        -> 402 Payment Required
 *        -> WWW-Authenticate: x402 payment_url="https://host/instructions/<id>"
 *   2. Client GETs the instruction URL
 *        -> { schemaVersion, amount (microAlgo), recipient, network,
 *             asset, resource, expiresAt }
 *   3. KRON evaluates the instruction against policy and signs an Algorand
 *      payment transaction from the agent wallet.
 *   4. Client retries the resource with
 *        Authorization: x402 <base64url( signedTxnBytes )>
 *   5. Server verifies the transaction on-chain (indexer) and serves the resource.
 */
import { z } from "zod";
import type { Network } from "./types.js";

export const X402_AUTH_SCHEME = "x402";
export const X402_CHALLENGE_HEADER = "www-authenticate";
export const X402_AUTH_HEADER = "authorization";

export const X402_VERSION = "1.0";

/** Networks KRON can pay on. */
export const NETWORK = z.enum(["localnet", "testnet", "mainnet"]);
export type X402Network = z.infer<typeof NETWORK>;

/** Validate a Network string (kept in sync with types.Network). */
export function isNetwork(v: string): v is Network {
  return v === "localnet" || v === "testnet" || v === "mainnet";
}

export const X402Asset = z.object({
  type: z.enum(["algo", "asa"]),
  decimals: z.number().int().default(6),
  /** Asset ID required when type === "asa" (e.g. USDC 31566704 on MainNet). */
  assetId: z.number().int().positive().optional(),
});
export type X402Asset = z.infer<typeof X402Asset>;

/** Human-readable asset label helper (e.g. "ALGO" / "USDC"). */
export function assetLabel(asset: X402Asset): string {
  return asset.type === "algo" ? "ALGO" : `ASA#${asset.assetId ?? 0}`;
}

/** Payment instruction document returned at the payment_url. */
export const X402Instruction = z.object({
  schemaVersion: z.string().default(X402_VERSION),
  paymentUrl: z.string().url(),
  /** Amount in microAlgo (string to avoid float drift). */
  amount: z.string(),
  asset: X402Asset,
  network: NETWORK,
  /** Address that must receive the funds. */
  recipient: z.string(),
  note: z.string().optional(),
  expiresAt: z.string().optional(),
  resource: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
  }),
});
export type X402Instruction = z.infer<typeof X402Instruction>;

/** Response payload for a 402 challenge. */
export const X402Challenge = z.object({
  scheme: z.literal(X402_AUTH_SCHEME),
  paymentUrl: z.string().url(),
  message: z.string().optional(),
});
export type X402Challenge = z.infer<typeof X402Challenge>;

/** A signed Algorand payment transaction as transported in the auth header. */
export interface X402PaymentToken {
  /** base64 of the signed transaction bytes. */
  signedTxnB64: string;
  txId: string;
}

export function buildAuthorizationHeader(token: X402PaymentToken): string {
  return `${X402_AUTH_SCHEME} ${token.signedTxnB64}`;
}

export function parseAuthorizationHeader(header: string): X402PaymentToken | null {
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith(X402_AUTH_SCHEME)) return null;
  const b64 = trimmed.slice(X402_AUTH_SCHEME.length).trim();
  if (!b64) return null;
  return { signedTxnB64: b64, txId: "" };
}

export function parseChallengeHeader(header: string): X402Challenge | null {
  const lower = header.toLowerCase();
  if (!lower.includes(X402_AUTH_SCHEME)) return null;
  // Match: x402 payment_url="https://..."
  const m = header.match(/x402\s+payment_url\s*=\s*"([^"]+)"/i);
  if (!m?.[1]) return null;
  return { scheme: "x402", paymentUrl: m[1] };
}

/** Convert microAlgo string/number/bigint -> ALGO number (6 decimals). */
export function microToAlgo(micro: string | number | bigint): number {
  return Number(micro) / 1_000_000;
}

/** Convert ALGO number -> microAlgo int string. */
export function algoToMicro(algo: number): string {
  return String(Math.round(algo * 1_000_000));
}

/** Deterministic idempotency key for a payment request. */
export function clientRequestId(parts: {
  agentId: string;
  sessionId: string;
  toolCallId: string;
  resourceId: string;
  amountMicro: string;
}): string {
  const raw = [
    parts.agentId,
    parts.sessionId,
    parts.toolCallId,
    parts.resourceId,
    parts.amountMicro,
  ].join("|");
  // FNV-1a 64-bit-ish hash -> hex string. Deterministic, dependency-free.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (Math.imul(h2 ^ c, 0x01000193)) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}
