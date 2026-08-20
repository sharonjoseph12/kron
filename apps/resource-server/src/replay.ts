/**
 * One-time-use payment token registry. A verified signed transaction is
 * consumed on first redemption; a replay of the same token is rejected —
 * even though the on-chain transaction is still valid, the merchant must
 * not deliver the same resource twice for one payment.
 *
 * The consumed set is persisted to disk so a redeployed/restarted merchant
 * still rejects replays of already-redeemed tokens.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const STATE_FILE = resolve(import.meta.dirname, "../data/replay.json");

const consumed = new Set<string>();

function load(): void {
  try {
    if (!existsSync(STATE_FILE)) return;
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { consumed?: string[] };
    for (const txId of raw.consumed ?? []) consumed.add(txId);
  } catch {
    // corrupt/missing state file is treated as an empty set — no crash.
  }
}

function persist(): void {
  try {
    mkdirSync(resolve(import.meta.dirname, "../data"), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ consumed: [...consumed] }, null, 2));
  } catch {
    // persistence is best-effort; in-memory protection still applies.
  }
}

load();

export function tryConsumePayment(txId: string): boolean {
  if (consumed.has(txId)) return false;
  consumed.add(txId);
  persist();
  return true;
}

export function isConsumed(txId: string): boolean {
  return consumed.has(txId);
}