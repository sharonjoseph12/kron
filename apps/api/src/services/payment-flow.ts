/**
 * Payment Flow — the economic orchestrator (PRD §8, §17).
 *
 *   agent + session + tool call -> PaymentRequest -> policy decision
 *     -> AUTO_APPROVED: sign / submit / confirm / prove
 *     -> ESCALATED:    human review (approve -> settle, deny -> blocked)
 *     -> BLOCKED:      explained, never paid
 *
 * Idempotency: the deterministic clientRequestId guarantees a retried call
 * never pays twice (FR §9.4). Confirmation timeouts move to RECONCILING and
 * never fabricate a success.
 */
import type { Network, PaymentDTO, PaymentStatus, PolicyDecision } from "@kron/shared";
import { clientRequestId, microToAlgo, explorerTxUrl } from "@kron/shared";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { algorand } from "../algorand/client.js";
import { getWalletMnemonic } from "../algorand/vault.js";
import { buildKronPayment, ensureOnChainEnforcement } from "../algorand/contract.js";
import { algoToMicro, toAlgo } from "../lib/money.js";
import { evaluateForAgent, createPolicyVersion, type CreatePolicyInput } from "./policies.js";
import { appendTimeline } from "./timeline.js";
import { recordAudit } from "./audit.js";
import { hub } from "../events/hub.js";
import { reportToGoPlausible } from "./goplausible.js";

const FEE_MICRO = 2000n;
const MIN_BALANCE_MICRO = 100_000n;

export interface ExecutePaymentArgs {
  agentId: string;
  sessionId: string;
  toolCallId: string;
  mcpServerId: string;
  toolName: string;
  service: string;
  resourceId: string;
  resourceName: string;
  recipient: string;
  amountAlgo: number;
  network?: Network;
  instructionUrl?: string;
  note?: string;
  /** Exact base units when the instruction is an ASA payment (e.g. USDC). */
  amountMicro?: string;
  asset?: { type: "asa"; assetId: number; decimals?: number };
}

export type ExecutePaymentStatus = "AUTO_APPROVED" | "ESCALATED" | "BLOCKED" | "RECONCILING";

export interface ExecutePaymentResult {
  status: ExecutePaymentStatus;
  payment: PaymentDTO;
  decision: PolicyDecision | null;
  reasons: string[];
  token: string | null;
  txId: string | null;
  escalationId: string | null;
}

export function toPaymentDTO(row: {
  id: string;
  clientRequestId: string;
  agentId: string;
  sessionId: string;
  toolCallId: string;
  resourceId: string;
  resourceName: string;
  service: string;
  recipient: string;
  amountMicro: bigint;
  network: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  decision?: { decision: string; reasons: unknown; policyVersionNumber: number } | null;
  settlement?: { txId: string; appId?: number | null; policyHash?: string | null; appCallTxId?: string | null; network?: string } | null;
}): PaymentDTO {
  const txId = row.settlement?.txId ?? null;
  const network = row.network as Network;
  return {
    id: row.id,
    clientRequestId: row.clientRequestId,
    agentId: row.agentId,
    sessionId: row.sessionId,
    toolCallId: row.toolCallId,
    resourceId: row.resourceId,
    resourceName: row.resourceName,
    service: row.service,
    recipient: row.recipient,
    amountAlgo: toAlgo(row.amountMicro),
    network,
    status: row.status as PaymentStatus,
    policyVersion: row.decision?.policyVersionNumber ?? null,
    decision: (row.decision?.decision as PolicyDecision) ?? null,
    decisionReasons: (row.decision?.reasons as string[]) ?? [],
    txId,
    appId: row.settlement?.appId ?? null,
    policyHash: row.settlement?.policyHash ?? null,
    appCallTxId: row.settlement?.appCallTxId ?? null,
    explorerUrl: txId ? explorerTxUrl(network, txId) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function publishPayment(row: Parameters<typeof toPaymentDTO>[0], kind: "created" | "updated") {
  const dto = toPaymentDTO(row);
  hub.publish({ type: kind === "created" ? "payment.created" : "payment.updated", payment: dto });
}

/**
 * Run an agent's payment request through the full KRON flow.
 * Executed by the MCP gateway and by escalation approvals.
 */
export async function executePaymentFlow(args: ExecutePaymentArgs): Promise<ExecutePaymentResult> {
  const amountMicro = args.amountMicro ? BigInt(args.amountMicro) : algoToMicro(args.amountAlgo);
  const requestId = clientRequestId({
    agentId: args.agentId,
    sessionId: args.sessionId,
    toolCallId: args.toolCallId,
    resourceId: args.resourceId,
    amountMicro: amountMicro.toString(),
  });

  // Idempotency — never let a retry become a second payment.
  const existing = await prisma.paymentRequest.findUnique({ where: { clientRequestId: requestId } });
  if (existing) {
    return hydrateResult(existing.id);
  }

  const agent = await prisma.agent.findUnique({ where: { id: args.agentId }, include: { wallet: true } });
  if (!agent) throw new Error("Agent not found");
  if (!agent.wallet) throw new Error("Agent has no wallet");

  const network: Network = args.network ?? (config.algorandNetwork as Network);
  if (agent.wallet.network !== network) {
    throw new Error(`Wallet network ${agent.wallet.network} does not match payment network ${network}`);
  }

  await appendTimeline({ sessionId: args.sessionId, agentId: args.agentId, step: "REQUEST", status: "pending", message: `Agent requests paid resource: ${args.resourceName}` });
  await appendTimeline({ sessionId: args.sessionId, agentId: args.agentId, step: "402_DETECTED", status: "pending", message: "402 Payment Required detected" });
  await appendTimeline({
    sessionId: args.sessionId,
    agentId: args.agentId,
    step: "PRICE_DISCOVERED",
    status: "pending",
    message: `Cost: ${microToAlgo(amountMicro).toFixed(4)} ALGO to ${shortAddr(args.recipient)}`,
    detail: { resourceId: args.resourceId, recipient: args.recipient, amountMicro: amountMicro.toString() },
  });
  await appendTimeline({ sessionId: args.sessionId, agentId: args.agentId, step: "POLICY_EVALUATED", status: "pending", message: "Evaluating against economic policy…" });

  const { evaluation, policyVersion } = await evaluateForAgent(args.agentId, args.sessionId, {
    amountMicro,
    recipient: args.recipient,
    service: args.service,
  });

  const baseRow = {
    clientRequestId: requestId,
    agentId: args.agentId,
    sessionId: args.sessionId,
    toolCallId: args.toolCallId,
    service: args.service,
    resourceId: args.resourceId,
    resourceName: args.resourceName,
    recipient: args.recipient,
    amountMicro,
    network,
    instructionUrl: args.instructionUrl ?? null,
    note: args.note ?? null,
  };

  let decision = decisionFor(args, evaluation.decision);

  // Persist the decision record for full traceability on every path.
  const payment = await prisma.paymentRequest.create({
    data: {
      ...baseRow,
      status: "evaluated",
      decision: {
        create: {
          decision: decision,
          reasons: evaluation.reasons,
          rulesTriggered: evaluation.rulesTriggered as unknown as object,
          policyVersionId: policyVersion!.id,
          policyVersionNumber: policyVersion!.version,
        },
      },
    },
    include: { decision: true, settlement: true },
  });

  hub.publish({ type: "decision", decision: evaluation, paymentId: payment.id, request: baseRow });
  await recordAudit({
    actorType: "agent",
    actorId: args.agentId,
    action: "payment.decision",
    targetType: "PaymentRequest",
    targetId: payment.id,
    policyVersion: policyVersion!.version,
    summary: `${decision} ${microToAlgo(amountMicro).toFixed(4)} ALGO to ${shortAddr(args.recipient)} (${args.resourceName})`,
    detail: { reasons: evaluation.reasons },
  });

  if (decision !== "AUTO_APPROVED") {
    await appendTimeline({
      sessionId: args.sessionId,
      agentId: args.agentId,
      step: decision === "BLOCKED" ? "BLOCKED" : "ESCALATED",
      status: decision === "BLOCKED" ? "blocked" : "pending",
      message: explanationFor(evaluation.reasons),
      detail: { reasons: evaluation.reasons },
    });
    let escalationId: string | null = null;
    if (decision === "ESCALATED") {
      const esc = await prisma.escalation.create({
        data: {
          paymentId: payment.id,
          decisionId: payment.decision!.id,
          summary: explanationFor(evaluation.reasons),
          expiresAt: new Date(Date.now() + config.escalationTtlMinutes * 60_000),
        },
      });
      escalationId = esc.id;
    } else {
      await recordAudit({ actorType: "agent", actorId: args.agentId, action: "payment.blocked", targetType: "PaymentRequest", targetId: payment.id, policyVersion: policyVersion!.version, summary: `Blocked: ${explanationFor(evaluation.reasons)}` });
    }
    const updated = await prisma.paymentRequest.update({
      where: { id: payment.id },
      data: { status: decision === "BLOCKED" ? "blocked" : "escalated" },
      include: { decision: true, settlement: true },
    });
    await publishPayment(updated, "updated");
    return {
      status: decision as ExecutePaymentStatus,
      payment: toPaymentDTO(updated),
      decision,
      reasons: evaluation.reasons,
      token: null,
      txId: null,
      escalationId,
    };
  }

  // AUTO_APPROVED: sign, submit, confirm, prove.
  await appendTimeline({ sessionId: args.sessionId, agentId: args.agentId, step: "AUTHORIZED", status: "confirmed", message: explanationFor(evaluation.reasons) });

  const balance = await algorand.getBalanceAlgo(agent.wallet.address);
  const balanceMicro = BigInt(Math.round(balance * 1_000_000));

  let insufficientReason: string | null = null;
  if (args.asset?.type === "asa") {
    const assetBalance = await algorand.getAssetBalance(agent.wallet.address, args.asset.assetId);
    if (assetBalance < amountMicro) {
      insufficientReason = `Insufficient ${args.asset.assetId > 10000 ? "USDC" : "asset"} balance: ${assetBalance.toString()} base units available, ${amountMicro.toString()} required (asset ${args.asset.assetId})`;
    } else if (balanceMicro < FEE_MICRO + MIN_BALANCE_MICRO) {
      insufficientReason = `Insufficient ALGO for fees: ${toAlgo(balanceMicro).toFixed(4)} ALGO available, ${toAlgo(FEE_MICRO + MIN_BALANCE_MICRO).toFixed(4)} required`;
    }
  } else if (balanceMicro < amountMicro + FEE_MICRO + MIN_BALANCE_MICRO) {
    insufficientReason = `Insufficient wallet balance: ${toAlgo(balanceMicro).toFixed(4)} ALGO available, ${microToAlgo(amountMicro).toFixed(4)} required`;
  }

  if (insufficientReason) {
    const reason = insufficientReason;
    await prisma.paymentRequest.update({ where: { id: payment.id }, data: { status: "blocked" } });
    await appendTimeline({ sessionId: args.sessionId, agentId: args.agentId, step: "BLOCKED", status: "blocked", message: "PAYMENT BLOCKED — INSUFFICIENT WALLET BALANCE", detail: { reason } });
    const blocked = (await prisma.paymentRequest.findUnique({
      where: { id: payment.id },
      include: { decision: true, settlement: true },
    }))!;
    return { status: "BLOCKED", payment: toPaymentDTO(blocked), decision: "BLOCKED", reasons: [reason], token: null, txId: null, escalationId: null };
  }

  const mnemonic = getWalletMnemonic(agent.wallet.encryptedKey);
  await appendTimeline({ sessionId: args.sessionId, agentId: args.agentId, step: "SIGNED", status: "pending", message: "Signing atomic transaction group (app call + payment)" });
  await appendTimeline({ sessionId: args.sessionId, agentId: args.agentId, step: "SUBMITTED", status: "pending", message: "Submitting atomic group to Algorand…" });

  try {
    // One-time on-chain bootstrap: register this wallet as an authorized
    // anchor signer and mirror policy limits into the contract (memoized).
    if (policyVersion) {
      await ensureOnChainEnforcement(
        args.agentId,
        agent.wallet.address,
        policyVersion.perCallLimitMicro,
        policyVersion.dailyBudgetMicro,
      );
    }
    // Build atomic group: app call (policy anchor) + payment
    const built = await buildKronPayment({
      mnemonic,
      amountMicro,
      recipient: args.recipient,
      policyVersion: policyVersion!.version,
      decision: evaluation.decision,
      reasons: evaluation.reasons,
      agentId: args.agentId,
      resourceId: args.resourceId,
      service: args.service,
      clientRequestId: requestId,
      asset: args.asset,
    });

    // Submit the signed group
    const { txId: submittedTxId } = await algorand.submitRawTransaction(built.signedB64);
    // Wait for the payment tx to confirm
    const paymentTxId = submittedTxId || built.paymentTxId;
    const conf = await algorand.waitForConfirmation(paymentTxId);

    const settlement = await prisma.settlement.create({
      data: {
        paymentId: payment.id,
        txId: paymentTxId,
        round: conf.confirmedRound,
        sender: built.sender,
        recipient: args.recipient,
        amountMicro,
        network,
        verified: true,
        appId: built.appId,
        policyHash: built.policyHash,
        appCallTxId: built.appCallTxId,
      },
    });

    const settled = await prisma.paymentRequest.update({
      where: { id: payment.id },
      data: { status: "confirmed" },
      include: { decision: true, settlement: true },
    });

    const atomicMsg = built.appId
      ? `Confirmed on Algorand (round ${conf.confirmedRound}) — atomic group with policy anchor (app ${built.appId})`
      : `Confirmed on Algorand (round ${conf.confirmedRound})`;
    await appendTimeline({ sessionId: args.sessionId, agentId: args.agentId, step: "CONFIRMED", status: "confirmed", message: atomicMsg, detail: { txId: paymentTxId, round: conf.confirmedRound, appId: built.appId, policyHash: built.policyHash, appCallTxId: built.appCallTxId } });
    await appendTimeline({ sessionId: args.sessionId, agentId: args.agentId, step: "PROOF_VERIFIED", status: "confirmed", message: built.policyHash ? `Policy hash ${built.policyHash.slice(0, 16)}… anchored on-chain` : "Payment proof verified on-chain" });
    await appendTimeline({ sessionId: args.sessionId, agentId: args.agentId, step: "RESOURCE_DELIVERED", status: "confirmed", message: `${args.resourceName} delivered to agent` });
    await appendTimeline({ sessionId: args.sessionId, agentId: args.agentId, step: "AGENT_CONTINUES", status: "confirmed", message: "Agent continues task" });

    await publishPayment(settled, "updated");
    await recordAudit({
      actorType: "agent",
      actorId: args.agentId,
      action: "payment.settled",
      targetType: "Settlement",
      targetId: settlement.id,
      policyVersion: policyVersion!.version,
      summary: `Settled ${microToAlgo(amountMicro).toFixed(4)} ALGO on ${network} (${paymentTxId})${built.appId ? ` — atomic group, app ${built.appId}` : ""}`,
    });

    // Report to GoPlausible facilitator (fire-and-forget)
    reportToGoPlausible({
      signedTxnB64: built.signedB64,
      paymentTxId,
      appCallTxId: built.appCallTxId,
      recipient: args.recipient,
      amountMicro,
      resourceUrl: args.instructionUrl ?? `kron://${args.service}/${args.resourceId}`,
      asset: args.asset,
    }).catch(() => {});

    return {
      status: "AUTO_APPROVED",
      payment: toPaymentDTO(settled),
      decision: "AUTO_APPROVED",
      reasons: evaluation.reasons,
      token: built.signedB64,
      txId: paymentTxId,
      escalationId: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "payment failed";
    const isTimeout = message.toLowerCase().includes("timeout");
    await prisma.paymentRequest.update({
      where: { id: payment.id },
      data: { status: isTimeout ? "reconciling" : "failed" },
    });
    await appendTimeline({
      sessionId: args.sessionId,
      agentId: args.agentId,
      step: isTimeout ? "RECONCILING" : "FAILED",
      status: "failed",
      message: isTimeout ? "Payment confirmation pending — reconciling on-chain" : `Payment failed: ${message}`,
    });
    const updated = (await prisma.paymentRequest.findUnique({
      where: { id: payment.id },
      include: { decision: true, settlement: true },
    }))!;
    return {
      status: isTimeout ? "RECONCILING" : "BLOCKED",
      payment: toPaymentDTO(updated),
      decision: null,
      reasons: [message],
      token: null,
      txId: null,
      escalationId: null,
    };
  }
}

function decisionFor(args: ExecutePaymentArgs, evalDecision: PolicyDecision): PolicyDecision {
  if (config.forceEscalate && evalDecision === "AUTO_APPROVED") return "ESCALATED";
  return evalDecision;
}

function explanationFor(reasons: string[]): string {
  return reasons[0] ?? "Payment decision";
}

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr;
}

/** Load a payment (with decision + settlement) by id and DTO-ize it. */
export async function hydrateResult(paymentId: string): Promise<ExecutePaymentResult> {
  const row = await prisma.paymentRequest.findUnique({
    where: { id: paymentId },
    include: { decision: true, settlement: true },
  });
  if (!row) throw new Error("Payment not found");
  const dto = toPaymentDTO(row);
  const status: ExecutePaymentStatus =
    dto.status === "confirmed"
      ? "AUTO_APPROVED"
      : dto.status === "escalated"
        ? "ESCALATED"
        : dto.status === "reconciling"
          ? "RECONCILING"
          : "BLOCKED";
  return {
    status,
    payment: dto,
    decision: dto.decision,
    reasons: dto.decisionReasons,
    token: null,
    txId: dto.txId,
    escalationId: null,
  };
}

export type { PolicyDecision };

/**
 * Settle an already-ESCALATED payment after a human approves it.
 * Pays directly from the persisted record (recipient/amount/network) — it must
 * NOT re-enter executePaymentFlow, whose deterministic clientRequestId would
 * collide with the original request and re-return ESCALATED.
 */
export async function settleEscalatedPayment(
  paymentId: string,
  decidedBy?: string,
): Promise<ExecutePaymentResult> {
  const payment = await prisma.paymentRequest.findUnique({
    where: { id: paymentId },
    include: { decision: true, agent: { include: { wallet: true } } },
  });
  if (!payment) throw new Error("Payment not found");
  if (payment.status !== "escalated") {
    throw new Error(`Cannot settle payment in status "${payment.status}"`);
  }
  if (!payment.agent?.wallet) throw new Error("Agent has no wallet");

  const network = payment.network as Network;
  const amountMicro = payment.amountMicro;

  await appendTimeline({
    sessionId: payment.sessionId,
    agentId: payment.agentId,
    step: "ESCALATION_APPROVED",
    status: "confirmed",
    message: decidedBy ? `Escalation approved by ${decidedBy}` : "Escalation approved by operator",
  });
  await appendTimeline({ sessionId: payment.sessionId, agentId: payment.agentId, step: "AUTHORIZED", status: "confirmed", message: "Operator approved — settlement authorized" });

  const balance = await algorand.getBalanceAlgo(payment.agent.wallet.address);
  const balanceMicro = BigInt(Math.round(balance * 1_000_000));
  if (balanceMicro < amountMicro + FEE_MICRO + MIN_BALANCE_MICRO) {
    const reason = `Insufficient wallet balance: ${toAlgo(balanceMicro).toFixed(4)} ALGO available, ${microToAlgo(amountMicro).toFixed(4)} required`;
    await appendTimeline({ sessionId: payment.sessionId, agentId: payment.agentId, step: "BLOCKED", status: "blocked", message: "PAYMENT BLOCKED — INSUFFICIENT WALLET BALANCE", detail: { reason } });
    return { status: "BLOCKED", payment: toPaymentDTO(payment), decision: "BLOCKED", reasons: [reason], token: null, txId: null, escalationId: null };
  }

  const mnemonic = getWalletMnemonic(payment.agent.wallet.encryptedKey);
  await appendTimeline({ sessionId: payment.sessionId, agentId: payment.agentId, step: "SIGNED", status: "pending", message: "Payment transaction signed by agent wallet" });
  await appendTimeline({ sessionId: payment.sessionId, agentId: payment.agentId, step: "SUBMITTED", status: "pending", message: "Submitting to Algorand…" });

  try {
    // Use atomic group (app call + payment) so escalated approvals get same on-chain policy anchoring as auto-approved
    const policyVersion = payment.decision?.policyVersionNumber ?? 1;
    const decisionReasons = (payment.decision?.reasons as string[]) ?? ["Escalation approved by operator"];
    const built = await buildKronPayment({
      mnemonic,
      amountMicro,
      recipient: payment.recipient,
      policyVersion,
      decision: "ESCALATED",
      reasons: decisionReasons,
      agentId: payment.agentId,
      resourceId: payment.resourceId,
      service: payment.service,
      clientRequestId: payment.clientRequestId,
    });
    const { txId: submittedTxId } = await algorand.submitRawTransaction(built.signedB64);
    const paymentTxId = submittedTxId || built.paymentTxId;
    const conf = await algorand.waitForConfirmation(paymentTxId);

    const settlement = await prisma.settlement.create({
      data: {
        paymentId: payment.id,
        txId: paymentTxId,
        round: conf.confirmedRound,
        sender: built.sender,
        recipient: payment.recipient,
        amountMicro,
        network,
        verified: true,
        appId: built.appId,
        policyHash: built.policyHash,
        appCallTxId: built.appCallTxId,
      },
    });

    const settled = await prisma.paymentRequest.update({
      where: { id: payment.id },
      data: { status: "confirmed" },
      include: { decision: true, settlement: true },
    });

    const atomicMsg = built.appId
      ? `Confirmed on Algorand (round ${conf.confirmedRound}) — atomic group with policy anchor (app ${built.appId})`
      : `Confirmed on Algorand (round ${conf.confirmedRound})`;
    await appendTimeline({ sessionId: payment.sessionId, agentId: payment.agentId, step: "CONFIRMED", status: "confirmed", message: atomicMsg, detail: { txId: paymentTxId, round: conf.confirmedRound, appId: built.appId, policyHash: built.policyHash, appCallTxId: built.appCallTxId } });
    await appendTimeline({ sessionId: payment.sessionId, agentId: payment.agentId, step: "PROOF_VERIFIED", status: "confirmed", message: built.policyHash ? `Policy hash ${built.policyHash.slice(0, 16)}… anchored on-chain` : "Payment proof verified on-chain" });
    await appendTimeline({ sessionId: payment.sessionId, agentId: payment.agentId, step: "RESOURCE_DELIVERED", status: "confirmed", message: `${payment.resourceName} delivered to agent` });
    await appendTimeline({ sessionId: payment.sessionId, agentId: payment.agentId, step: "AGENT_CONTINUES", status: "confirmed", message: "Agent continues task" });

    await publishPayment(settled, "updated");
    await recordAudit({
      actorType: decidedBy ? "user" : "system",
      actorId: decidedBy ?? undefined,
      action: "payment.settled",
      targetType: "Settlement",
      targetId: settlement.id,
      policyVersion: payment.decision?.policyVersionNumber ?? undefined,
      summary: `Escalation approved — settled ${microToAlgo(amountMicro).toFixed(4)} ALGO on ${network} (${paymentTxId})${built.appId ? ` — atomic group, app ${built.appId}` : ""}`,
    });

    // Report to GoPlausible facilitator (fire-and-forget)
    reportToGoPlausible({
      signedTxnB64: built.signedB64,
      paymentTxId,
      appCallTxId: built.appCallTxId,
      recipient: payment.recipient,
      amountMicro,
      resourceUrl: payment.instructionUrl ?? `kron://${payment.service}/${payment.resourceId}`,
    }).catch(() => {});

    return {
      status: "AUTO_APPROVED",
      payment: toPaymentDTO(settled),
      decision: "AUTO_APPROVED",
      reasons: ["Escalation approved by operator"],
      token: built.signedB64,
      txId: paymentTxId,
      escalationId: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "payment failed";
    const isTimeout = message.toLowerCase().includes("timeout");
    await prisma.paymentRequest.update({
      where: { id: payment.id },
      data: { status: isTimeout ? "reconciling" : "failed" },
    });
    await appendTimeline({
      sessionId: payment.sessionId,
      agentId: payment.agentId,
      step: isTimeout ? "RECONCILING" : "FAILED",
      status: "failed",
      message: isTimeout ? "Payment confirmation pending — reconciling on-chain" : `Escalation settlement failed: ${message}`,
    });
    const updated = (await prisma.paymentRequest.findUnique({
      where: { id: payment.id },
      include: { decision: true, settlement: true },
    }))!;
    return {
      status: isTimeout ? "RECONCILING" : "BLOCKED",
      payment: toPaymentDTO(updated),
      decision: null,
      reasons: [message],
      token: null,
      txId: null,
      escalationId: null,
    };
  }
}

/** Create an initial policy for an agent (used by seed/agent creation). */
export async function createInitialPolicy(agentId: string): Promise<void> {
  const input: CreatePolicyInput = {};
  await createPolicyVersion(agentId, input);
}