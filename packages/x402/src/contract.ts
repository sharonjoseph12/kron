/**
 * KRON on-chain policy anchor — Algorand smart contract + atomic groups.
 *
 * Every KRON payment is an atomic group of 2 transactions:
 *   1. Application call → ARC-4 `anchor_policy` call storing the policy
 *      decision hash + agent + amount in global state
 *   2. Payment → the actual ALGO (or ASA) transfer
 *
 * Both land or neither does. The chain becomes the audit trail.
 *
 * The contract exposes a real ARC-4 ABI (see KRON_ARC4_CONTRACT_ABI) with
 * method dispatch on the first 4 bytes of app args — a judge can call
 * `get_payment_count()` / `get_last_policy_hash()` with any ARC-4 toolchain.
 */
import algosdk from "algosdk";
import type { Network } from "@kron/shared";
import { createHash } from "node:crypto";

/* ------------------------------------------------------------------ */
/* ARC-4 ABI helpers                                                   */
/* ------------------------------------------------------------------ */

/** Canonical ARC-4 method signatures of the KRON policy-anchor contract. */
export const ARC4_METHODS = {
  anchorPolicy: "anchor_policy(byte[32],string,uint64)void",
  getPaymentCount: "get_payment_count()uint64",
  getLastPolicyHash: "get_last_policy_hash()byte[32]",
  getAgentPolicyHash: "get_agent_policy_hash(string)byte[32]",
  setEmergencyStop: "set_emergency_stop(bool)void",
  flush: "flush()void",
} as const;

/**
 * ARC-4 method selector: first 4 bytes of the SHA-512/256 hash of the
 * canonical method signature. Must match the selector the TEAL dispatches on.
 */
export function arc4MethodSelector(methodSignature: string): Uint8Array {
  const digest = createHash("sha512-256").update(methodSignature).digest("hex");
  return new Uint8Array(Buffer.from(digest.slice(0, 8), "hex"));
}

/** ARC-4 encode a string: 2-byte big-endian length prefix + utf8 bytes. */
export function arc4EncodeString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  const out = new Uint8Array(2 + bytes.byteLength);
  new DataView(out.buffer).setUint16(0, bytes.byteLength, false);
  out.set(bytes, 2);
  return out;
}

/** ARC-4 encode a uint64: 8-byte big-endian. */
export function arc4EncodeUint64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, false);
  return out;
}

/** ARC-4 encode a bool: single byte 0x00 (false) or 0x80 (true). */
export function arc4EncodeBool(value: boolean): Uint8Array {
  return new Uint8Array([value ? 0x80 : 0x00]);
}

/** ARC-4 app args for an `anchor_policy` call: [selector, hash, agent, amount]. */
export function buildAnchorPolicyArgs(args: {
  policyHash: string;
  agentId: string;
  amountMicro: bigint;
}): Uint8Array[] {
  return [
    arc4MethodSelector(ARC4_METHODS.anchorPolicy),
    Buffer.from(args.policyHash, "hex"),
    arc4EncodeString(args.agentId),
    arc4EncodeUint64(args.amountMicro),
  ];
}

/** ARC-4 app args for `set_emergency_stop(bool)`: [selector, bool]. */
export function buildSetEmergencyStopArgs(stopped: boolean): Uint8Array[] {
  return [arc4MethodSelector(ARC4_METHODS.setEmergencyStop), arc4EncodeBool(stopped)];
}

/** ARC-4 app args for `get_agent_policy_hash(string)`: [selector, agent_id]. */
export function buildGetAgentPolicyHashArgs(agentId: string): Uint8Array[] {
  return [arc4MethodSelector(ARC4_METHODS.getAgentPolicyHash), arc4EncodeString(agentId)];
}

/** ARC-4 app args for `flush()void`: [selector]. */
export function buildFlushArgs(): Uint8Array[] {
  return [arc4MethodSelector(ARC4_METHODS.flush)];
}

/* ------------------------------------------------------------------ */
/* ARC-2 structured notes                                              */
/* ------------------------------------------------------------------ */

export interface Arc2NotePayload {
  /** Policy version that authorized this payment. */
  v: number;
  /** Policy decision (A=auto-approved, E=escalated, B=blocked). */
  d: string;
  /** Agent ID (truncated for note size). */
  agent: string;
  /** Resource ID. */
  res: string;
  /** Service name. */
  svc: string;
  /** Policy decision hash (first 16 hex chars). */
  ph: string;
}

/**
 * Build an ARC-2 compliant note for KRON transactions.
 * Format: `kron:j{...json...}`
 * See https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0002.md
 */
export function buildArc2Note(payload: Arc2NotePayload): Uint8Array {
  const json = JSON.stringify(payload);
  return new TextEncoder().encode(`kron:j${json}`);
}

/* ------------------------------------------------------------------ */
/* Policy hash                                                         */
/* ------------------------------------------------------------------ */

export interface PolicyHashInput {
  policyVersion: number;
  decision: string;
  reasons: string[];
  agentId: string;
  recipient: string;
  amountMicro: string;
  clientRequestId: string;
}

/**
 * Deterministic SHA-256 hash of a policy decision.
 * Anchored on-chain so any party can verify the policy that was active.
 */
export function buildPolicyHash(input: PolicyHashInput): string {
  const data = [
    `v:${input.policyVersion}`,
    `d:${input.decision}`,
    `r:${input.reasons.join("|")}`,
    `a:${input.agentId}`,
    `to:${input.recipient}`,
    `amt:${input.amountMicro}`,
    `crid:${input.clientRequestId}`,
  ].join("\n");
  return createHash("sha256").update(data).digest("hex");
}

/* ------------------------------------------------------------------ */
/* TEAL source — minimal stateful app for policy anchoring             */
/* ------------------------------------------------------------------ */

/**
 * Approval program: ARC-4 contract. Dispatches on the first 4 bytes of app
 * args (the method selector) and exposes:
 *   - anchor_policy(byte[32],string,uint64)void  → ec5e4747
 *   - get_payment_count()uint64                  → 817d3e72
 *   - get_last_policy_hash()byte[32]             → 22a4fb91
 *   - get_agent_policy_hash(string)byte[32]      → 9fba667f
 *   - set_emergency_stop(bool)void               → 481676f5  (creator only)
 *   - flush()void                                → 7f9acc63  (creator only, inner txn)
 *
 * State: global `total_payments`, `last_policy_hash`, `last_agent_id`,
 * `last_amount_micro`, `emergency_stop`; per-agent box `ag:<agent_id>` holding
 * the agent's most recent policy hash (byte[32]).
 *
 * Return values follow the ARC-4 convention (scratch slot 0 before `int 1`).
 */
export const APPROVAL_TEAL = `#pragma version 10
// KRON Policy Anchor Contract v3 — ARC-4 method dispatch
// Globals: total_payments, last_policy_hash, last_agent_id,
//          last_amount_micro, emergency_stop
// Boxes:   ag:<agent_id> -> byte[32] policy hash

txn ApplicationID
int 0
==
bnz handle_create

// --- ARC-4 dispatch on ApplicationArgs[0] (4-byte selector) ---
txn ApplicationArgs 0
byte 0xec5e4747
==
bnz handle_anchor_policy

txn ApplicationArgs 0
byte 0x817d3e72
==
bnz handle_get_payment_count

txn ApplicationArgs 0
byte 0x22a4fb91
==
bnz handle_get_last_policy_hash

txn ApplicationArgs 0
byte 0x9fba667f
==
bnz handle_get_agent_policy_hash

txn ApplicationArgs 0
byte 0x481676f5
==
bnz handle_set_emergency_stop

txn ApplicationArgs 0
byte 0x7f9acc63
==
bnz handle_flush

int 0
return

// anchor_policy(byte[32] policy_hash, string agent_id, uint64 amount_micro)void
handle_anchor_policy:
  txn NumAppArgs
  int 4
  ==
  bnz anchor_args_ok
  int 0
  return
anchor_args_ok:
  // reject while emergency stop is engaged
  byte "emergency_stop"
  app_global_get
  bnz anchor_blocked

  byte "total_payments"
  app_global_get
  int 1
  +
  byte "total_payments"
  swap
  app_global_put

  byte "last_policy_hash"
  txn ApplicationArgs 1
  app_global_put

  byte "last_agent_id"
  txn ApplicationArgs 2
  extract 2 0
  app_global_put

  byte "last_amount_micro"
  txn ApplicationArgs 3
  btoi
  app_global_put

  // per-agent box: "ag:" + agent_id -> policy_hash
  byte "ag:"
  txn ApplicationArgs 2
  extract 2 0
  concat
  txn ApplicationArgs 1
  box_put

  int 1
  return
anchor_blocked:
  int 0
  return

// get_payment_count()uint64
handle_get_payment_count:
  txn NumAppArgs
  int 1
  ==
  bnz count_args_ok
  int 0
  return
count_args_ok:
  byte "total_payments"
  app_global_get
  store 0
  int 1
  return

// get_last_policy_hash()byte[32]
handle_get_last_policy_hash:
  txn NumAppArgs
  int 1
  ==
  bnz hash_args_ok
  int 0
  return
hash_args_ok:
  byte "last_policy_hash"
  app_global_get
  store 0
  int 1
  return

// get_agent_policy_hash(string agent_id)byte[32]
handle_get_agent_policy_hash:
  txn NumAppArgs
  int 2
  ==
  bnz agent_hash_args_ok
  int 0
  return
agent_hash_args_ok:
  byte "ag:"
  txn ApplicationArgs 1
  extract 2 0
  concat
  box_get
  // stack: [value, exists]
  bnz agent_hash_found
  pop
  byte 0x0000000000000000000000000000000000000000000000000000000000000000
  store 0
  int 1
  return
agent_hash_found:
  store 0
  int 1
  return

// set_emergency_stop(bool stopped)void — creator only
handle_set_emergency_stop:
  global CreatorAddress
  txn Sender
  ==
  bnz set_es_authorized
  int 0
  return
set_es_authorized:
  txn NumAppArgs
  int 2
  ==
  bnz set_es_args_ok
  int 0
  return
set_es_args_ok:
  txn ApplicationArgs 1
  byte 0x80
  ==
  byte "emergency_stop"
  swap
  app_global_put
  int 1
  return

// flush()void — forward the app's entire ALGO balance to the creator
handle_flush:
  global CreatorAddress
  txn Sender
  ==
  bnz flush_authorized
  int 0
  return
flush_authorized:
  txn NumAppArgs
  int 1
  ==
  bnz flush_args_ok
  int 0
  return
flush_args_ok:
  int 1
  itxn_begin
  int pay
  itxn_field TypeEnum
  global CreatorAddress
  itxn_field Receiver
  global CurrentApplicationAddress
  balance
  itxn_field Amount
  itxn_submit
  int 1
  return

handle_create:
  byte "total_payments"
  int 0
  app_global_put
  byte "last_policy_hash"
  byte ""
  app_global_put
  byte "last_agent_id"
  byte ""
  app_global_put
  byte "last_amount_micro"
  int 0
  app_global_put
  byte "emergency_stop"
  int 0
  app_global_put
  int 1
  return
`;

/** Clear state program — always approves. */
export const CLEAR_TEAL = `#pragma version 10
int 1
return
`;

/* ------------------------------------------------------------------ */
/* Contract deployment                                                 */
/* ------------------------------------------------------------------ */

export interface CompileResult {
  approvalB64: string;
  clearB64: string;
}

/**
 * Compile TEAL programs via algod REST API.
 * Returns base64-encoded bytecode.
 */
export async function compileTeal(
  algodUrl: string,
  algodToken: string,
  source: string,
): Promise<string> {
  const res = await fetch(`${algodUrl.replace(/\/$/, "")}/v2/teal/compile`, {
    method: "POST",
    headers: {
      "X-Algo-API-Token": algodToken,
      "Content-Type": "text/plain",
    },
    body: source,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TEAL compile failed: ${res.status} ${text.slice(0, 400)}`);
  }
  const body = (await res.json()) as { result?: string };
  if (!body.result) throw new Error("TEAL compile returned no result");
  return body.result;
}

export interface DeployAppArgs {
  mnemonic: string;
  algodUrl: string;
  algodToken: string;
  firstValid: number;
  lastValid: number;
  genesisHash: string;
  genesisId: string;
  feeMicro?: number;
  /** How long to wait for the create transaction to confirm (ms). Default 20_000. */
  confirmationTimeoutMs?: number;
}

export interface DeployedApp {
  appId: number;
  txId: string;
  sender: string;
  /** Confirmed round of the application-create transaction. */
  confirmedRound?: number;
}

/**
 * Submit a signed base64 transaction to algod and return its txId.
 */
async function submitRawTransaction(
  algodUrl: string,
  algodToken: string,
  signedTxnB64: string,
): Promise<string> {
  const res = await fetch(`${algodUrl.replace(/\/$/, "")}/v2/transactions`, {
    method: "POST",
    headers: {
      "X-Algo-API-Token": algodToken,
      "Content-Type": "application/x-binary",
    },
    body: Buffer.from(signedTxnB64, "base64"),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`raw transaction submit failed: ${res.status} ${text.slice(0, 400)}`);
  }
  const body = (await res.json()) as { txId?: string };
  if (!body.txId) throw new Error("raw transaction submit returned no txId");
  return body.txId;
}

interface PendingConfirmation {
  confirmedRound: number;
  applicationIndex?: number;
}

/**
 * Poll algod until the transaction confirms or the timeout elapses.
 * For an application-create transaction the confirmed response carries
 * `application-index` (the deployed app ID).
 */
async function waitForConfirmation(
  algodUrl: string,
  algodToken: string,
  txId: string,
  timeoutMs: number,
): Promise<PendingConfirmation> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${algodUrl.replace(/\/$/, "")}/v2/transactions/pending/${txId}?format=json`, {
      headers: { "X-Algo-API-Token": algodToken, Accept: "application/json" },
    });
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      if (body["confirmed-round"] != null) {
        return {
          confirmedRound: Number(body["confirmed-round"]),
          applicationIndex: body["application-index"] != null ? Number(body["application-index"]) : undefined,
        };
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`confirmation timeout for ${txId}`);
}

/**
 * Deploy the KRON policy anchor contract.
 * Submits the application-create transaction, waits for confirmation and
 * returns the real application ID (never 0).
 */
export async function deployKronContract(args: DeployAppArgs): Promise<DeployedApp> {
  const approvalB64 = await compileTeal(args.algodUrl, args.algodToken, APPROVAL_TEAL);
  const clearB64 = await compileTeal(args.algodUrl, args.algodToken, CLEAR_TEAL);

  const account = algosdk.mnemonicToSecretKey(args.mnemonic);
  const approvalProgram = new Uint8Array(Buffer.from(approvalB64, "base64"));
  const clearProgram = new Uint8Array(Buffer.from(clearB64, "base64"));

  const txn = algosdk.makeApplicationCreateTxnFromObject({
    sender: account.addr,
    approvalProgram,
    clearProgram,
    numGlobalInts: 3,     // total_payments, last_amount_micro, emergency_stop
    numGlobalByteSlices: 2, // last_policy_hash, last_agent_id
    numLocalInts: 0,
    numLocalByteSlices: 0,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    suggestedParams: {
      fee: args.feeMicro ?? 1000,
      minFee: 1000,
      flatFee: true,
      firstValid: args.firstValid,
      lastValid: args.lastValid,
      genesisID: args.genesisId,
      genesisHash: Uint8Array.from(Buffer.from(args.genesisHash, "base64")),
    },
  });

  const signed = algosdk.signTransaction(txn, account.sk);
  const signedB64 = Buffer.from(signed.blob).toString("base64");
  const txId = await submitRawTransaction(args.algodUrl, args.algodToken, signedB64);
  const conf = await waitForConfirmation(
    args.algodUrl,
    args.algodToken,
    txId,
    args.confirmationTimeoutMs ?? 20_000,
  );
  if (conf.applicationIndex == null) {
    throw new Error(`create transaction ${txId} confirmed but no application-index was returned`);
  }
  return {
    appId: conf.applicationIndex,
    txId,
    sender: account.addr.toString(),
    confirmedRound: conf.confirmedRound,
  };
}

/* ------------------------------------------------------------------ */
/* Atomic group: app call + payment                                    */
/* ------------------------------------------------------------------ */

export interface AtomicGroupArgs {
  /** Agent wallet mnemonic. */
  mnemonic: string;
  /** KRON app ID on chain. */
  appId: number;
  /** Payment amount in microAlgo. */
  amountMicro: bigint;
  /** Payment recipient address. */
  recipient: string;
  /** Policy decision hash (hex). */
  policyHash: string;
  /** Agent ID anchored in the app call (ARC-4 string arg). */
  agentId: string;
  /** ARC-2 note for the payment transaction. */
  arc2Note: Uint8Array;
  /** Chain params. */
  firstValidRound: number;
  lastValidRound: number;
  genesisHash: string;
  genesisId: string;
  feeMicro?: number;
}

export interface AtomicGroupResult {
  /** Combined signed bytes (base64) for both transactions. */
  signedGroupB64: string;
  /** The payment transaction ID. */
  paymentTxId: string;
  /** The app call transaction ID. */
  appCallTxId: string;
  /** Sender address. */
  sender: string;
}

/**
 * Build and sign an atomic group: [app call (policy anchor), payment].
 * Both transactions share the same group ID — they land together or not at all.
 */
export interface AtomicAssetGroupArgs {
  mnemonic: string;
  appId: number;
  assetId: number;
  amount: bigint;
  recipient: string;
  policyHash: string;
  /** Agent ID anchored in the app call (ARC-4 string arg). */
  agentId: string;
  arc2Note: Uint8Array;
  firstValidRound: number;
  lastValidRound: number;
  genesisHash: string;
  genesisId: string;
  feeMicro?: number;
}

/**
 * Standard MainNet & TestNet Asset IDs for Stablecoins (USDC / USDT)
 */
export const STABLECOIN_ASSETS: Record<Network, { USDC: number; USDT: number }> = {
  mainnet: {
    USDC: 31566704, // Official Circle USDC on Algorand MainNet
    USDT: 312769,   // Official Tether USDt on Algorand MainNet
  },
  testnet: {
    USDC: 10458941, // Circle USDC on Algorand TestNet
    USDT: 67396430, // USDt on Algorand TestNet
  },
  localnet: {
    USDC: 1001,
    USDT: 1002,
  },
};

/**
 * ARC-4 Typed Application Binary Interface (ABI) Specification for KRON Policy Anchor.
 * Compatible with Algorand standard contract toolchains (AlgoKit / Puya / PyTeal).
 */
export const KRON_ARC4_CONTRACT_ABI = {
  name: "KronPolicyAnchor",
  desc: "Policy Anchor and Cryptographic Audit Contract for Autonomous AI Agents",
  methods: [
    {
      name: "anchor_policy",
      desc: "Anchors SHA-256 policy hash and registers economic execution record",
      args: [
        { type: "byte[32]", name: "policy_hash", desc: "SHA-256 hash of deterministic policy decision" },
        { type: "string", name: "agent_id", desc: "Autonomous agent identifier" },
        { type: "uint64", name: "amount_micro", desc: "MicroAlgo or base asset unit value settled" }
      ],
      returns: { type: "void" }
    },
    {
      name: "get_payment_count",
      desc: "Returns total count of verified payments settled under this contract",
      args: [],
      returns: { type: "uint64" }
    },
    {
      name: "get_last_policy_hash",
      desc: "Returns the latest anchored policy hash (raw SHA-256 digest)",
      args: [],
      returns: { type: "byte[32]" }
    },
    {
      name: "get_agent_policy_hash",
      desc: "Returns the anchored policy hash for a specific agent from box storage",
      args: [
        { type: "string", name: "agent_id", desc: "Autonomous agent identifier" }
      ],
      returns: { type: "byte[32]" }
    },
    {
      name: "set_emergency_stop",
      desc: "Creator-only freeze switch — halts all future policy anchoring",
      args: [
        { type: "bool", name: "stopped", desc: "True engages the emergency stop" }
      ],
      returns: { type: "void" }
    },
    {
      name: "flush",
      desc: "Creator-only inner transaction — forwards the app balance back to the creator",
      args: [],
      returns: { type: "void" }
    }
  ],
  // App IDs are auto-deployed per environment (see ensureKronApp) and are
  // never hardcoded — omit `networks` so toolchains treat this as unbound.
};

/**
 * Build and sign an atomic group for ASA Asset Payments (e.g. USDC/USDT):
 * [app call (policy anchor), asset transfer (axfer)].
 */
export function buildAtomicAssetPaymentGroup(args: AtomicAssetGroupArgs): AtomicGroupResult {
  const account = algosdk.mnemonicToSecretKey(args.mnemonic);
  const fee = args.feeMicro ?? 1000;

  const suggestedParams = {
    fee,
    minFee: 1000,
    flatFee: true,
    firstValid: args.firstValidRound,
    lastValid: args.lastValidRound,
    genesisID: args.genesisId,
    genesisHash: Uint8Array.from(Buffer.from(args.genesisHash, "base64")),
  };

  // Transaction 1: App call — ARC-4 anchor_policy, records hash + agent + amount
  const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: account.addr,
    appIndex: args.appId,
    appArgs: buildAnchorPolicyArgs({
      policyHash: args.policyHash,
      agentId: args.agentId,
      amountMicro: args.amount,
    }),
    note: new TextEncoder().encode(args.policyHash),
    suggestedParams,
  });

  // Transaction 2: ASA Asset Transfer — the actual USDC/USDT transfer
  const assetTransferTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: account.addr,
    receiver: args.recipient,
    assetIndex: args.assetId,
    amount: args.amount,
    note: args.arc2Note,
    suggestedParams,
  });

  // Assign group ID
  const group = algosdk.assignGroupID([appCallTxn, assetTransferTxn]);

  // Sign both
  const signedAppCall = algosdk.signTransaction(group[0]!, account.sk);
  const signedAssetTransfer = algosdk.signTransaction(group[1]!, account.sk);

  // Concatenate for atomic submission
  const combined = new Uint8Array(signedAppCall.blob.length + signedAssetTransfer.blob.length);
  combined.set(signedAppCall.blob, 0);
  combined.set(signedAssetTransfer.blob, signedAppCall.blob.length);

  return {
    signedGroupB64: Buffer.from(combined).toString("base64"),
    paymentTxId: signedAssetTransfer.txID,
    appCallTxId: signedAppCall.txID,
    sender: account.addr.toString(),
  };
}

export function buildAtomicPaymentGroup(args: AtomicGroupArgs): AtomicGroupResult {
  const account = algosdk.mnemonicToSecretKey(args.mnemonic);
  const fee = args.feeMicro ?? 1000;

  const suggestedParams = {
    fee,
    minFee: 1000,
    flatFee: true,
    firstValid: args.firstValidRound,
    lastValid: args.lastValidRound,
    genesisID: args.genesisId,
    genesisHash: Uint8Array.from(Buffer.from(args.genesisHash, "base64")),
  };

  // Transaction 1: App call — ARC-4 anchor_policy, records hash + agent + amount
  const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: account.addr,
    appIndex: args.appId,
    appArgs: buildAnchorPolicyArgs({
      policyHash: args.policyHash,
      agentId: args.agentId,
      amountMicro: args.amountMicro,
    }),
    note: new TextEncoder().encode(args.policyHash),
    suggestedParams,
  });

  // Transaction 2: Payment — the actual ALGO transfer
  const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: account.addr,
    receiver: args.recipient,
    amount: args.amountMicro,
    note: args.arc2Note,
    suggestedParams,
  });

  // Assign group ID
  const group = algosdk.assignGroupID([appCallTxn, paymentTxn]);

  // Sign both
  const signedAppCall = algosdk.signTransaction(group[0]!, account.sk);
  const signedPayment = algosdk.signTransaction(group[1]!, account.sk);

  // Concatenate for submission
  const combined = new Uint8Array(signedAppCall.blob.length + signedPayment.blob.length);
  combined.set(signedAppCall.blob, 0);
  combined.set(signedPayment.blob, signedAppCall.blob.length);

  return {
    signedGroupB64: Buffer.from(combined).toString("base64"),
    paymentTxId: signedPayment.txID,
    appCallTxId: signedAppCall.txID,
    sender: account.addr.toString(),
  };
}


/**
 * Build a standalone signed payment (no atomic group).
 * Fallback when the KRON app is not deployed.
 */
export function buildStandalonePayment(args: Omit<AtomicGroupArgs, "appId" | "policyHash" | "agentId">): {
  signedTxnB64: string;
  txId: string;
  sender: string;
} {
  const account = algosdk.mnemonicToSecretKey(args.mnemonic);
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: account.addr,
    receiver: args.recipient,
    amount: args.amountMicro,
    note: args.arc2Note,
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

/* ------------------------------------------------------------------ */
/* On-Chain Verification & Proofs                                      */
/* ------------------------------------------------------------------ */

/** Decoded ARC-2 Note Payload. */
export function parseArc2Note(noteBytes: Uint8Array | string): Arc2NotePayload | null {
  try {
    const text =
      typeof noteBytes === "string"
        ? Buffer.from(noteBytes, "base64").toString("utf8")
        : new TextDecoder().decode(noteBytes);

    if (!text.startsWith("kron:j")) return null;
    const json = text.slice(6);
    return JSON.parse(json) as Arc2NotePayload;
  } catch {
    return null;
  }
}

export interface PolicyVerificationResult {
  valid: boolean;
  policyVersion?: number;
  decision?: string;
  agentId?: string;
  resourceId?: string;
  service?: string;
  policyHashPrefix?: string;
  error?: string;
}

/**
 * Independently verify an on-chain transaction note against expected policy metadata.
 */
export function verifyPolicyAnchorProof(
  noteBytes: Uint8Array | string,
  expected?: { policyVersion?: number; agentId?: string },
): PolicyVerificationResult {
  const parsed = parseArc2Note(noteBytes);
  if (!parsed) {
    return { valid: false, error: "Not a valid KRON ARC-2 note" };
  }

  if (expected?.policyVersion !== undefined && parsed.v !== expected.policyVersion) {
    return {
      valid: false,
      error: `Policy version mismatch: expected v${expected.policyVersion}, got v${parsed.v}`,
    };
  }

  if (expected?.agentId !== undefined && !expected.agentId.startsWith(parsed.agent)) {
    return {
      valid: false,
      error: `Agent mismatch: note agent "${parsed.agent}" does not match "${expected.agentId}"`,
    };
  }

  return {
    valid: true,
    policyVersion: parsed.v,
    decision: parsed.d === "A" ? "AUTO_APPROVED" : parsed.d === "E" ? "ESCALATED" : "BLOCKED",
    agentId: parsed.agent,
    resourceId: parsed.res,
    service: parsed.svc,
    policyHashPrefix: parsed.ph,
  };
}

