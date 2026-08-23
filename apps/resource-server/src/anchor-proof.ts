/**
 * On-chain policy-anchor proof verification.
 *
 * A KRON settlement is only trustworthy when its payment transaction is part
 * of an atomic group that also contains an app call to the KRON Policy Anchor
 * contract. The merchant verifies this independently from the indexer before
 * delivering paid content — closing the loop: payments without an on-chain
 * policy anchor are rejected, so the runtime cannot bypass the contract.
 */
import { parseArc2Note } from "@kron/x402";

export interface AnchorProofArgs {
  paymentTxId: string;
  algodUrl: string;
  algodToken: string;
  indexerUrl: string;
  indexerToken: string;
  /** KRON Policy Anchor app ID. Must be > 0. */
  anchorAppId: number;
}

export interface AnchorProofResult {
  ok: boolean;
  reason?: string;
  /** App call tx id inside the group that carries the anchor. */
  appCallTxId?: string;
  round?: number;
}

interface IndexerTxn {
  "tx-type"?: string;
  round?: number;
  group?: string;
  id?: string;
  note?: string;
  "application-transaction"?: {
    "application-id"?: number;
    "application-args"?: string[];
  };
}

async function indexerGet(url: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: token ? { "X-Algo-API-Token": token } : {} });
  if (!res.ok) throw new Error(`indexer ${res.status} for ${url.replace(/\?.*$/, "")}`);
  return (await res.json()) as Record<string, unknown>;
}

function decodeBase64(value: string): Buffer {
  return Buffer.from(value, "base64");
}

/**
 * Verify that `paymentTxId` belongs to an atomic group containing an app call
 * to `anchorAppId` in the same round, and — when the payment carries a KRON
 * ARC-2 note — that the note's policy-hash prefix matches the hash anchored in
 * the app call's args.
 */
export async function verifyGroupedPolicyAnchor(args: AnchorProofArgs): Promise<AnchorProofResult> {
  if (!Number.isInteger(args.anchorAppId) || args.anchorAppId <= 0) {
    return { ok: false, reason: "anchor app id not configured" };
  }

  const lookup = await indexerGet(
    `${args.indexerUrl.replace(/\/+$/, "")}/v2/transactions?txid=${encodeURIComponent(args.paymentTxId)}`,
    args.indexerToken,
  );
  const payment = lookup["transaction"] as IndexerTxn | undefined;
  if (!payment) return { ok: false, reason: "payment transaction not found on ledger" };

  const round = Number(payment.round ?? 0);
  const groupId = payment.group;
  if (!groupId) return { ok: false, reason: "payment has no atomic group — unanchored settlement" };

  const query = new URLSearchParams({ group: groupId, "min-round": String(round), "max-round": String(round), limit: "20" });
  const search = await indexerGet(
    `${args.indexerUrl.replace(/\/+$/, "")}/v2/transactions?${query.toString()}`,
    args.indexerToken,
  );
  const txns = (search["transactions"] as IndexerTxn[] | undefined) ?? [];
  const anchor = txns.find(
    (t) =>
      t["tx-type"] === "appl" &&
      t.id !== args.paymentTxId &&
      t["application-transaction"]?.["application-id"] === args.anchorAppId,
  );
  if (!anchor) {
    return { ok: false, reason: `no app call to KRON anchor app ${args.anchorAppId} in group`, round };
  }
  if (anchor.round !== undefined && round !== 0 && Number(anchor.round) !== round) {
    return { ok: false, reason: "anchor app call confirmed in a different round than the payment", round };
  }

  // Cryptographic linkage: ARC-2 note policy-hash prefix must equal the first
  // 16 hex chars of the anchored 32-byte hash argument.
  const notePayload = payment.note != null ? parseArc2Note(decodeBase64(payment.note)) : null;
  const anchorHashArg = anchor["application-transaction"]?.["application-args"]?.[1];
  if (notePayload?.ph && anchorHashArg) {
    const anchoredHex = decodeBase64(anchorHashArg).toString("hex");
    if (!anchoredHex.startsWith(notePayload.ph.toLowerCase())) {
      return { ok: false, reason: "anchored policy hash does not match the payment's ARC-2 note", round };
    }
  }

  return { ok: true, appCallTxId: anchor.id, round: round || undefined };
}
