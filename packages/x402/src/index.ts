/**
 * x402 protocol primitives for KRON.
 *
 * KRON is the *payer*. These helpers build x402 payment instructions,
 * sign Algorand payment transactions for a payment token, decode incoming
 * payment tokens, and verify them against an Algorand indexer.
 */
import algosdk from "algosdk";
import {
  algoToMicro,
  microToAlgo,
  type Network,
  type X402Instruction,
} from "@kron/shared";

export {
  buildArc2Note,
  parseArc2Note,
  verifyPolicyAnchorProof,
  buildAtomicPaymentGroup,
  buildAtomicAssetPaymentGroup,
  buildStandalonePayment,
  buildPolicyHash,
  buildAnchorPolicyArgs,
  arc4MethodSelector,
  arc4EncodeString,
  arc4EncodeUint64,
  ARC4_METHODS,
  STABLECOIN_ASSETS,
  compileTeal,
  deployKronContract,
  APPROVAL_TEAL,
  CLEAR_TEAL,
} from "./contract.js";
export type {
  Arc2NotePayload,
  PolicyHashInput,
  PolicyVerificationResult,
  AtomicGroupArgs,
  AtomicGroupResult,
  DeployAppArgs,
  DeployedApp,
} from "./contract.js";

export interface CreateInstructionArgs {
  amountAlgo: number;
  recipient: string;
  network: Network;
  resource: { id: string; name: string; description?: string };
  note?: string;
  paymentUrl: string;
  expiresAt?: string;
  /** Asset to pay in. Omit for ALGO, or pass { type: "asa", assetId } for USDC/USDT. */
  asset?: { type: "asa"; assetId: number; decimals?: number };
}

/** Build an x402 payment instruction document. */
export function createInstruction(args: CreateInstructionArgs): X402Instruction {
  return {
    schemaVersion: "1.0",
    paymentUrl: args.paymentUrl,
    amount: algoToMicro(args.amountAlgo),
    asset: args.asset ? { ...args.asset, decimals: args.asset.decimals ?? 6 } : { type: "algo", decimals: 6 },
    network: args.network,
    recipient: args.recipient,
    note: args.note,
    expiresAt: args.expiresAt,
    resource: args.resource,
  };
}

/** Parse and validate an x402 instruction from a remote payment URL. */
export function parseInstruction(json: unknown): X402Instruction {
  if (typeof json !== "object" || json === null) {
    throw new Error("Invalid x402 payment instruction: not an object");
  }
  const i = json as Record<string, unknown>;
  if (typeof i.amount !== "string" || Number.isNaN(Number(i.amount))) {
    throw new Error("Invalid x402 payment instruction: amount must be a numeric string");
  }
  if (typeof i.recipient !== "string" || !i.recipient) {
    throw new Error("Invalid x402 payment instruction: missing recipient");
  }
  const network = i.network;
  if (network !== "localnet" && network !== "testnet" && network !== "mainnet") {
    throw new Error(`Unsupported network in x402 instruction: ${String(network)}`);
  }
  const rawAsset = (i.asset ?? {}) as Record<string, unknown>;
  const asset =
    rawAsset.type === "asa" && typeof rawAsset.assetId === "number" && rawAsset.assetId > 0
      ? {
          type: "asa" as const,
          assetId: rawAsset.assetId,
          decimals: typeof rawAsset.decimals === "number" ? rawAsset.decimals : 6,
        }
      : { type: "algo" as const, decimals: 6 };
  return {
    schemaVersion: "1.0",
    paymentUrl: String(i.paymentUrl ?? ""),
    amount: String(i.amount),
    asset,
    network: network as Network,
    recipient: String(i.recipient),
    note: typeof i.note === "string" ? i.note : undefined,
    expiresAt: typeof i.expiresAt === "string" ? i.expiresAt : undefined,
    resource: {
      id: String((i.resource as Record<string, unknown>)?.id ?? "unknown"),
      name: String((i.resource as Record<string, unknown>)?.name ?? "Resource"),
      description:
        typeof (i.resource as Record<string, unknown>)?.description === "string"
          ? String((i.resource as Record<string, unknown>)?.description)
          : undefined,
    },
  };
}

export interface SignPaymentArgs {
  mnemonic: string;
  amountMicro: bigint;
  recipient: string;
  note?: string;
  firstValidRound: number;
  lastValidRound: number;
  /** base64-encoded genesis hash. */
  genesisHash: string;
  genesisId: string;
  feeMicro?: number;
}

export interface SignedPayment {
  signedTxnB64: string;
  txId: string;
  sender: string;
}

/**
 * Sign an Algorand payment transaction from a wallet mnemonic.
 * Does NOT submit anything — the caller owns submission + confirmation.
 */
export function signPaymentTransaction(args: SignPaymentArgs): SignedPayment {
  const account = algosdk.mnemonicToSecretKey(args.mnemonic);
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: account.addr,
    receiver: args.recipient,
    amount: args.amountMicro,
    note: args.note ? new TextEncoder().encode(args.note) : undefined,
    suggestedParams: {
      fee: args.feeMicro ?? 1000,
      minFee: 1000,
      flatFee: true,
      firstValid: args.firstValidRound,
      lastValid: args.lastValidRound,
      genesisID: args.genesisId,
      genesisHash: Uint8Array.from(Buffer.from(args.genesisHash, "base64")),
    },
  });
  const signed = algosdk.signTransaction(txn, account.sk);
  return {
    signedTxnB64: Buffer.from(signed.blob).toString("base64"),
    txId: signed.txID,
    sender: account.addr.toString(),
  };
}

export interface DecodedPayment {
  txId: string;
  sender: string;
  receiver: string;
  amountMicro: bigint;
  note: string | undefined;
  type: string;
  /** Present when type === "axfer" (e.g. USDC/USDT transfers). */
  assetId: number | null;
}

/** Decode a payment token (base64 signed transaction) without trusting it. */
export function decodePaymentToken(signedTxnB64: string): DecodedPayment {
  let blob: Buffer;
  try {
    blob = Buffer.from(signedTxnB64, "base64");
  } catch {
    throw new Error("Payment token is not valid base64");
  }
  const signedTxn = algosdk.decodeSignedTransaction(new Uint8Array(blob));
  const txn = signedTxn.txn as algosdk.Transaction;
  if (txn.type !== "pay" && txn.type !== "axfer") {
    throw new Error(`Payment token is not a payment/asset-transfer transaction (type=${txn.type})`);
  }
  const receiver =
    txn.type === "pay" ? (txn.payment?.receiver.toString() ?? "") : (txn.assetTransfer?.receiver.toString() ?? "");
  const amount = BigInt(txn.type === "pay" ? txn.payment?.amount ?? 0 : txn.assetTransfer?.amount ?? 0);
  const note = txn.note && txn.note.byteLength > 0 ? Buffer.from(txn.note).toString("utf8") : undefined;
  return {
    txId: txn.txID(),
    sender: txn.sender.toString(),
    receiver,
    amountMicro: amount,
    note,
    type: txn.type,
    assetId: txn.type === "axfer" ? Number(txn.assetTransfer?.assetIndex ?? 0) || null : null,
  };
}

/** Amount the instruction requires, as microAlgo bigint. */
export function instructionAmountMicro(instruction: X402Instruction): bigint {
  return BigInt(instruction.amount);
}

export interface VerifyOptions {
  signedTxnB64: string;
  /**
   * Algorand indexer base URL (e.g. https://mainnet-idx.algonode.cloud).
   * Either this or `algodUrl` must be provided.
   */
  indexerUrl?: string;
  indexerToken?: string;
  /**
   * algod base URL. Used instead of the indexer when set (algod is the
   * canonical on-chain authority and works on devnet without a block explorer).
   */
  algodUrl?: string;
  algodToken?: string;
  expected: {
    recipient: string;
    amountMicro: bigint;
    sender?: string;
    network: Network;
    /** Required when the instruction is an ASA payment (e.g. USDC). */
    assetId?: number;
  };
  /** Retry window while the node/indexer catches up (ms). */
  retryMs?: number;
}

export interface VerificationResult {
  ok: boolean;
  reason?: string;
  txId?: string;
  confirmedRound?: number;
  details?: Record<string, unknown>;
}

/**
 * Verify that a payment token actually settled on-chain and matches the
 * expected instruction (recipient + amount + sender). Uses the indexer REST
 * API, or algod's pending-transaction endpoint when `algodUrl` is provided
 * (handy on private devnets with no block explorer). Safe against fake /
 * replayed tokens.
 */
export async function verifyPaymentToken(opts: VerifyOptions): Promise<VerificationResult> {
  const retryMs = opts.retryMs ?? 10_000;
  const deadline = Date.now() + retryMs;
  const decoded = decodePaymentToken(opts.signedTxnB64);

  if (!opts.indexerUrl && !opts.algodUrl) {
    return { ok: false, reason: "verifyPaymentToken requires indexerUrl or algodUrl" };
  }

  let lastErr = "verification failed";
  let confirmed: { round: number; sender: string; receiver: string; amount: bigint; assetId: number | null } | null = null;

  while (Date.now() < deadline) {
    try {
      const found = opts.indexerUrl
        ? await lookupViaIndexer(opts, decoded.txId)
        : await lookupViaAlgod(opts, decoded.txId);
      if (found) {
        confirmed = found;
        break;
      }
      lastErr = "transaction not yet confirmed";
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "verifier unreachable";
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  if (!confirmed) {
    return { ok: false, reason: `Payment not confirmed on-chain: ${lastErr}` };
  }

  const problems: string[] = [];
  if (opts.expected.sender && confirmed.sender !== opts.expected.sender) {
    problems.push(`sender mismatch: on-chain ${confirmed.sender} != expected ${opts.expected.sender}`);
  }
  if (confirmed.receiver !== opts.expected.recipient) {
    problems.push(`recipient mismatch: on-chain ${confirmed.receiver} != expected ${opts.expected.recipient}`);
  }
  if (opts.expected.assetId != null && confirmed.assetId !== opts.expected.assetId) {
    problems.push(`asset mismatch: on-chain ASA#${confirmed.assetId ?? 0} != expected ASA#${opts.expected.assetId}`);
  }
  if (confirmed.amount !== opts.expected.amountMicro) {
    problems.push(
      `amount mismatch: on-chain ${confirmed.amount} != expected ${opts.expected.amountMicro} base units`,
    );
  }

  if (problems.length > 0) {
    return {
      ok: false,
      reason: problems.join("; "),
      txId: decoded.txId,
      confirmedRound: confirmed.round,
      details: { sender: confirmed.sender, receiver: confirmed.receiver, amountMicro: confirmed.amount.toString(), assetId: confirmed.assetId, round: confirmed.round },
    };
  }

  return {
    ok: true,
    txId: decoded.txId,
    confirmedRound: confirmed.round,
    details: { sender: confirmed.sender, receiver: confirmed.receiver, amountMicro: confirmed.amount.toString(), assetId: confirmed.assetId, round: confirmed.round },
  };
}

async function lookupViaIndexer(
  opts: VerifyOptions,
  txId: string,
): Promise<{ round: number; sender: string; receiver: string; amount: bigint; assetId: number | null } | null> {
  const url = `${opts.indexerUrl!.replace(/\/$/, "")}/v2/transactions/${txId}`;
  const res = await fetch(url, {
    headers: opts.indexerToken
      ? { "X-Indexer-API-Token": opts.indexerToken, Accept: "application/json" }
      : { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as Record<string, any>;
  const tx = body.transaction ?? body;
  if (tx["confirmed-round"] == null) return null;
  const pay = tx["payment-transaction"] ?? {};
  const axfer = tx["asset-transfer-transaction"] ?? {};
  return {
    round: Number(tx["confirmed-round"]),
    sender: String(tx.sender ?? ""),
    receiver: String(pay.receiver ?? axfer.receiver ?? txNestedAddress(tx, "rcv") ?? ""),
    amount: BigInt(pay.amount ?? axfer.amount ?? txNestedAmount(tx) ?? 0),
    assetId: axfer["asset-id"] != null ? Number(axfer["asset-id"]) : null,
  };
}

async function lookupViaAlgod(
  opts: VerifyOptions,
  txId: string,
): Promise<{ round: number; sender: string; receiver: string; amount: bigint; assetId: number | null } | null> {
  const url = `${opts.algodUrl!.replace(/\/$/, "")}/v2/transactions/pending/${txId}?format=json`;
  const res = await fetch(url, {
    headers: {
      "X-Algo-API-Token": opts.algodToken ?? "",
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as Record<string, any>;
  if (body["confirmed-round"] == null) return null;
  const pay = body["payment-transaction"] ?? {};
  const axfer = body["asset-transfer-transaction"] ?? {};
  const nested = body.txn?.txn ?? {};
  return {
    round: Number(body["confirmed-round"]),
    sender: String(body.sender ?? nested.snd ?? ""),
    receiver: String(pay.receiver ?? axfer.receiver ?? nested.rcv ?? ""),
    amount: BigInt(pay.amount ?? axfer.amount ?? nested.aamt ?? 0),
    assetId: axfer["asset-id"] != null ? Number(axfer["asset-id"]) : null,
  };
}

function txNestedAddress(tx: Record<string, any>, key: "snd" | "rcv"): string {
  const nested = tx.txn?.txn ?? {};
  return String(nested[key] ?? "");
}

function txNestedAmount(tx: Record<string, any>): string {
  const nested = tx.txn?.txn ?? {};
  return String(nested.amt ?? "");
}

export { microToAlgo, algoToMicro };
