/**
 * KRON policy-anchor contract management — deploy once per environment,
 * cache the app ID, and provide helpers for building atomic payment groups.
 *
 * The contract stores a running count of payments and the last policy hash,
 * making every KRON payment independently verifiable on-chain.
 */
import { config } from "../config.js";
import { algorand } from "./client.js";
import {
  APPROVAL_TEAL,
  CLEAR_TEAL,
  buildPolicyHash,
  buildArc2Note,
  buildAtomicPaymentGroup,
  buildAtomicAssetPaymentGroup,
  buildStandalonePayment,
  type Arc2NotePayload,
  type PolicyHashInput,
  type AtomicGroupResult,
} from "@kron/x402";
import algosdk from "algosdk";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve to packages/x402/dist/teal/*.b64 (produced by `compile:teal`).
// Runtime TEAL compilation against algod is the fallback when these are absent.
const PRECOMPILED_APPROVAL = path.join(__dirname, "..", "..", "..", "..", "packages", "x402", "dist", "teal", "approval.b64");
const PRECOMPILED_CLEAR = path.join(__dirname, "..", "..", "..", "..", "packages", "x402", "dist", "teal", "clear.b64");

let cachedAppId: number | null = null;

/**
 * Deploy the KRON policy-anchor contract if not already deployed.
 * Returns the app ID. Caches the result in memory (and optionally in env).
 *
 * On localnet/testnet, auto-deploys using the funding mnemonic.
 * In production, the app ID would be set via environment variable.
 */
export async function ensureKronApp(): Promise<number | null> {
  // If already cached, return it
  if (cachedAppId != null) return cachedAppId;

  // Check env first (set manually or by previous deploy)
  const envAppId = process.env.KRON_APP_ID;
  if (envAppId && Number(envAppId) > 0) {
    cachedAppId = Number(envAppId);
    return cachedAppId;
  }

  // No funding mnemonic = can't deploy
  if (!config.fundingMnemonic) {
    console.warn("[kron-contract] No FUNDING_MNEMONIC — atomic groups disabled, using standalone payments.");
    return null;
  }

  try {
    console.log("[kron-contract] Deploying KRON policy-anchor contract...");

    // Prefer pre-compiled TEAL (faster, no runtime compile dependency)
    let approvalB64: string | null = null;
    let clearB64: string | null = null;
    try {
      approvalB64 = readFileSync(PRECOMPILED_APPROVAL, "utf8").trim();
      clearB64 = readFileSync(PRECOMPILED_CLEAR, "utf8").trim();
      console.log("[kron-contract] Using pre-compiled TEAL bytecode.");
    } catch {
      console.log("[kron-contract] Pre-compiled TEAL not found, compiling at runtime...");
    }

    if (!approvalB64 || !clearB64) {
      const { compileTeal } = await import("@kron/x402");
      approvalB64 = await compileTeal(algorand.algodUrl, algorand.algodToken, APPROVAL_TEAL);
      clearB64 = await compileTeal(algorand.algodUrl, algorand.algodToken, CLEAR_TEAL);
    }

    const account = algosdk.mnemonicToSecretKey(config.fundingMnemonic);
    const params = await algorand.getChainParams();

    const approvalProgram = new Uint8Array(Buffer.from(approvalB64, "base64"));
    const clearProgram = new Uint8Array(Buffer.from(clearB64, "base64"));

    const txn = algosdk.makeApplicationCreateTxnFromObject({
      sender: account.addr,
      approvalProgram,
      clearProgram,
      numGlobalInts: 2,       // total_payments, last_amount_micro
      numGlobalByteSlices: 2, // last_policy_hash, last_agent_id
      numLocalInts: 0,
      numLocalByteSlices: 0,
      onComplete: algosdk.OnApplicationComplete.NoOpOC,
      suggestedParams: {
        fee: Math.max(params.minFee, 1000),
        minFee: 1000,
        flatFee: true,
        firstValid: params.firstValid,
        lastValid: params.lastValid,
        genesisID: params.genesisID,
        genesisHash: Uint8Array.from(Buffer.from(params.genesisHash, "base64")),
      },
    });

    const signed = algosdk.signTransaction(txn, account.sk);
    const { txId } = await algorand.submitRawTransaction(
      Buffer.from(signed.blob).toString("base64"),
    );
    const conf = await algorand.waitForConfirmation(txId);

    // Extract the created app ID from the confirmed transaction
    const pending = await fetch(
      `${algorand.algodUrl}/v2/transactions/pending/${txId}?format=json`,
      { headers: { "X-Algo-API-Token": algorand.algodToken, Accept: "application/json" } },
    );
    if (pending.ok) {
      const body = (await pending.json()) as Record<string, any>;
      const appIndex = body["application-index"] ?? body["txn"]?.["txn"]?.["apid"];
      if (appIndex) {
        cachedAppId = Number(appIndex);
        console.log(`[kron-contract] Deployed KRON app ID: ${cachedAppId} (round ${conf.confirmedRound})`);
        return cachedAppId;
      }
    }

    console.warn("[kron-contract] Deployed but could not read app ID from confirmation.");
    return null;
  } catch (err) {
    console.warn(`[kron-contract] Deploy failed (atomic groups disabled): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Build the signed transaction(s) for a KRON payment.
 * If the KRON app is deployed, returns an atomic group (app call + payment).
 * Otherwise, falls back to a standalone payment with ARC-2 note.
 */
export async function buildKronPayment(args: {
  mnemonic: string;
  amountMicro: bigint;
  recipient: string;
  policyVersion: number;
  decision: string;
  reasons: string[];
  agentId: string;
  resourceId: string;
  service: string;
  clientRequestId: string;
  /** When present, pays in an ASA (e.g. USDC) instead of ALGO. */
  asset?: { type: "asa"; assetId: number; decimals?: number };
}): Promise<{
  signedB64: string;
  paymentTxId: string;
  appCallTxId: string | null;
  policyHash: string;
  appId: number | null;
  sender: string;
}> {
  const params = await algorand.getChainParams();
  const fee = Math.max(params.minFee, 1000);

  // Build the policy hash
  const policyHash = buildPolicyHash({
    policyVersion: args.policyVersion,
    decision: args.decision,
    reasons: args.reasons,
    agentId: args.agentId,
    recipient: args.recipient,
    amountMicro: args.amountMicro.toString(),
    clientRequestId: args.clientRequestId,
  });

  // Build the ARC-2 note
  const arc2Payload: Arc2NotePayload = {
    v: args.policyVersion,
    d: args.decision.charAt(0), // A, E, or B
    agent: args.agentId.slice(0, 12),
    res: args.resourceId.slice(0, 30),
    svc: args.service.slice(0, 20),
    ph: policyHash.slice(0, 16),
  };
  const arc2Note = buildArc2Note(arc2Payload);

  const appId = await ensureKronApp();

  if (appId != null) {
    // Atomic group: app call + payment (or asset transfer for USDC/USDT)
    const result = args.asset
      ? buildAtomicAssetPaymentGroup({
          mnemonic: args.mnemonic,
          appId,
          assetId: args.asset.assetId,
          amount: args.amountMicro,
          recipient: args.recipient,
          policyHash,
          agentId: args.agentId,
          arc2Note,
          firstValidRound: params.firstValid,
          lastValidRound: params.lastValid,
          genesisHash: params.genesisHash,
          genesisId: params.genesisID,
          feeMicro: fee,
        })
      : buildAtomicPaymentGroup({
          mnemonic: args.mnemonic,
          appId,
          amountMicro: args.amountMicro,
          recipient: args.recipient,
          policyHash,
          agentId: args.agentId,
          arc2Note,
          firstValidRound: params.firstValid,
          lastValidRound: params.lastValid,
          genesisHash: params.genesisHash,
          genesisId: params.genesisID,
          feeMicro: fee,
        });

    return {
      signedB64: result.signedGroupB64,
      paymentTxId: result.paymentTxId,
      appCallTxId: result.appCallTxId,
      policyHash,
      appId,
      sender: result.sender,
    };
  }

  // Fallback: standalone payment with ARC-2 note
  const result = buildStandalonePayment({
    mnemonic: args.mnemonic,
    amountMicro: args.amountMicro,
    recipient: args.recipient,
    arc2Note,
    firstValidRound: params.firstValid,
    lastValidRound: params.lastValid,
    genesisHash: params.genesisHash,
    genesisId: params.genesisID,
    feeMicro: fee,
  });

  return {
    signedB64: result.signedTxnB64,
    paymentTxId: result.txId,
    appCallTxId: null,
    policyHash,
    appId: null,
    sender: result.sender,
  };
}
