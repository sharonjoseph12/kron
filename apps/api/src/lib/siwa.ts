/**
 * Sign-in with Algorand (SIWA) helpers — used by Pera Wallet QR-code login.
 *
 * Flow: the dashboard asks for a challenge, the user signs the returned
 * message with Pera Wallet (`signData`), and the API verifies the Ed25519
 * signature against the Algorand address before creating a session.
 *
 * Verification uses `algosdk.verifyBytes`, which prepends the standard "MX"
 * domain separator — matching `algosdk.signBytes` used by Pera's `signData`.
 */
import algosdk from "algosdk";
import crypto from "node:crypto";

export interface SiwaChallenge {
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function newChallenge(now = new Date()): SiwaChallenge {
  return {
    nonce: crypto.randomBytes(24).toString("hex"),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
  };
}

/** Build the exact message a wallet must sign. Deterministic for a given challenge. */
export function buildSiwaMessage(origin: string, address: string, challenge: SiwaChallenge): string {
  return [
    "KRON Operator Login",
    "",
    `Origin: ${origin}`,
    `Address: ${address}`,
    `Nonce: ${challenge.nonce}`,
    `Issued At: ${challenge.issuedAt}`,
    `Expires At: ${challenge.expiresAt}`,
  ].join("\n");
}

/**
 * Verify an Ed25519 signature (base64) over `message` for `address`.
 * Returns false on any malformed input or signature mismatch — never throws.
 */
export function verifySiwaSignature(message: string, address: string, signatureB64: string): boolean {
  try {
    if (!algosdk.isValidAddress(address)) return false;
    const messageBytes = new TextEncoder().encode(message);
    const signature = new Uint8Array(Buffer.from(signatureB64, "base64"));
    if (signature.length !== 64) return false;
    return algosdk.verifyBytes(messageBytes, signature, address);
  } catch {
    return false;
  }
}

/** Stable synthetic email so existing auth code (email unique/required) keeps working. */
export function walletEmail(address: string): string {
  return `pera-${address.toLowerCase()}@wallet.kron.dev`;
}