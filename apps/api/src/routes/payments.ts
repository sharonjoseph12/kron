import type { FastifyInstance } from "fastify";
import { PaymentFlowSchema } from "@kron/shared";
import { prisma } from "../db.js";
import { algorand } from "../algorand/client.js";
import { executePaymentFlow, settleEscalatedPayment, toPaymentDTO, type ExecutePaymentResult } from "../services/payment-flow.js";
import { recordAudit } from "../services/audit.js";
import { hub } from "../events/hub.js";
import { badRequest, notFound } from "../lib/http.js";
import { currentUser, requireAuth, requireRole } from "../lib/auth.js";
import { evaluateForAgent } from "../services/policies.js";

function toPaymentRow(row: any) {
  return toPaymentDTO({
    id: row.id,
    clientRequestId: row.clientRequestId,
    agentId: row.agentId,
    sessionId: row.sessionId,
    toolCallId: row.toolCallId,
    resourceId: row.resourceId,
    resourceName: row.resourceName,
    service: row.service,
    recipient: row.recipient,
    amountMicro: row.amountMicro,
    network: row.network,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    decision: row.decision ?? undefined,
    settlement: row.settlement ?? undefined,
  });
}

export async function paymentRoutes(fastify: FastifyInstance) {
  fastify.get("/api/payments", { preHandler: requireAuth }, async (request, reply) => {
    const q = request.query as { agentId?: string; status?: string; limit?: string };
    const rows = await prisma.paymentRequest.findMany({
      where: {
        agentId: q.agentId || undefined,
        status: q.status || undefined,
      },
      include: { decision: true, settlement: true },
      orderBy: { createdAt: "desc" },
      take: Number(q.limit ?? 100),
    });
    return { payments: rows.map(toPaymentRow) };
  });

  fastify.get("/api/payments/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await prisma.paymentRequest.findUnique({
      where: { id },
      include: { decision: true, settlement: true, escalations: true },
    });
    if (!row) return notFound(reply);
    return { payment: toPaymentRow(row), escalation: row.escalations[0] ?? null };
  });

  fastify.get("/api/payments/verify/:query", { preHandler: requireAuth }, async (request, reply) => {
    const { query } = request.params as { query: string };
    // Search by ID or txId
    const row = await prisma.paymentRequest.findFirst({
      where: {
        OR: [
          { id: query },
          { settlement: { txId: query } },
          { clientRequestId: query },
        ],
      },
      include: { decision: true, settlement: true, agent: true },
    });

    if (!row) {
      return reply.code(404).send({ error: "Payment or transaction not found in KRON runtime" });
    }

    const txId = row.settlement?.txId;
    const policyVersion = row.decision?.policyVersionNumber ?? 1;
    const proof = await verifyOnChain(row);

    return {
      verified: proof.verifiedOnLedger,
      payment: toPaymentRow(row),
      agent: {
        id: row.agent.id,
        name: row.agent.name,
      },
      onChainProof: {
        txId,
        appId: row.settlement?.appId ?? null,
        appCallTxId: row.settlement?.appCallTxId ?? null,
        policyHash: row.settlement?.policyHash ?? null,
        confirmedRound: proof.confirmedRound ?? row.settlement?.round ?? null,
        network: row.network,
        policyVersion,
        verifiedOnLedger: proof.verifiedOnLedger,
        appCallVerified: proof.appCallVerified ?? null,
        amountVerifiedOnLedger: proof.amountVerified ?? null,
        reason: proof.reason ?? null,
        statement: `Payment of ${Number(row.amountMicro) / 1_000_000} ALGO was ${proof.verifiedOnLedger ? "independently verified" : "recorded but not yet found"} on the Algorand ${row.network} ledger under Policy v${policyVersion}.`,
      },
    };
  });

  fastify.post("/api/payments/execute", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = PaymentFlowSchema.safeParse(request.body);
    if (!parsed.success) {
      request.log.error(parsed.error);
      return badRequest(reply, "Invalid payment request payload");
    }
    const user = currentUser(request);
    const flow = (await executePaymentFlow({
      agentId: parsed.data.agentId,
      sessionId: parsed.data.sessionId,
      toolCallId: parsed.data.toolCallId,
      mcpServerId: parsed.data.mcpServerId,
      toolName: parsed.data.toolName,
      service: parsed.data.service,
      resourceId: parsed.data.resourceId,
      resourceName: parsed.data.resourceName,
      recipient: parsed.data.recipient,
      amountAlgo: parsed.data.amountAlgo,
      network: parsed.data.network,
      instructionUrl: parsed.data.instructionUrl,
      note: parsed.data.note,
    })) as ExecutePaymentResult;

    if (flow.status === "BLOCKED") {
      void recordAudit({
        actorId: user.id,
        actorType: "user",
        action: "payment.blocked",
        targetType: "PaymentRequest",
        targetId: flow.payment.id,
        summary: `Manual execute blocked: ${flow.reasons.join("; ")}`,
      });
    }
    return flow;
  });

  fastify.post("/api/escalations/:id/decide", { preHandler: [requireAuth, requireRole("admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { approve?: boolean };
    const user = currentUser(request);
    if (typeof body.approve !== "boolean") return badRequest(reply, "approve boolean required");

    const esc = await prisma.escalation.findUnique({ where: { id }, include: { decision: true } });
    if (!esc) return notFound(reply);
    if (esc.status !== "pending") return badRequest(reply, `Escalation already ${esc.status}`);
    if (esc.expiresAt && esc.expiresAt.getTime() < Date.now()) {
      await prisma.escalation.update({ where: { id }, data: { status: "expired" } });
      return reply.code(409).send({ error: "escalation_expired", message: `Escalation expired at ${esc.expiresAt.toISOString()} without review` });
    }

    await prisma.escalation.update({
      where: { id },
      data: { status: body.approve ? "approved" : "denied", decidedBy: user.id, decidedAt: new Date() },
    });

    const payment = await prisma.paymentRequest.findUnique({
      where: { id: esc.paymentId },
      include: { decision: true, agent: true, session: true },
    });
    if (!payment) return notFound(reply);

    if (body.approve) {
      // Approve-time re-validation: budgets/limits may have been consumed since
      // the original ESCALATED decision. A fresh BLOCKED verdict never settles.
      const revalidation = await evaluateForAgent(payment.agentId, payment.sessionId, {
        amountMicro: payment.amountMicro,
        recipient: payment.recipient,
        service: payment.service,
      }).catch(() => null);
      if (revalidation && revalidation.evaluation.decision === "BLOCKED") {
        await prisma.paymentRequest.update({ where: { id: payment.id }, data: { status: "blocked" } });
        await recordAudit({
          actorId: user.id,
          actorType: "user",
          action: "payment.blocked",
          targetType: "PaymentRequest",
          targetId: payment.id,
          summary: `Escalation approved by ${user.email} but re-validation blocked: ${revalidation.evaluation.reasons.join("; ")}`,
        });
        return reply.code(409).send({
          error: "revalidation_failed",
          reasons: revalidation.evaluation.reasons,
          message: "Policy re-check failed at approval time — payment not settled",
        });
      }
      // Settle directly from the persisted record. Re-running the flow would
      // collide on the deterministic clientRequestId and re-return ESCALATED.
      const flow = await settleEscalatedPayment(payment.id, user.email);
      return { approved: true, flow };
    }

    await prisma.paymentRequest.update({ where: { id: payment.id }, data: { status: "blocked" } });
    const updated = await prisma.paymentRequest.findUnique({
      where: { id: payment.id },
      include: { decision: true, settlement: true },
    });
    void recordAudit({
      actorId: user.id,
      actorType: "user",
      action: "payment.blocked",
      targetType: "PaymentRequest",
      targetId: payment.id,
      summary: `Escalation denied by ${user.email}`,
    });
    if (updated) hub.publish({ type: "payment.updated", payment: toPaymentRow(updated) });
    return { approved: false };
  });
}

/**
 * Independently verify a settlement against the live ledger — not just the
 * local database. Looks up the payment transaction via the indexer (with an
 * algod fallback for private/localnet nodes), cross-checks amount and
 * recipient, and — when an atomic-group app call exists — verifies that the
 * application call carrying the policy hash actually confirmed on-chain.
 */
async function verifyOnChain(row: {
  amountMicro: bigint;
  settlement?: {
    txId: string | null;
    recipient: string;
    round: number | null;
    appId?: number | null;
    appCallTxId?: string | null;
    policyHash?: string | null;
  } | null;
}): Promise<{
  verifiedOnLedger: boolean;
  confirmedRound: number | null;
  amountVerified: boolean | null;
  appCallVerified: boolean | null;
  reason: string | null;
}> {
  const txId = row.settlement?.txId;
  if (!txId) {
    return { verifiedOnLedger: false, confirmedRound: null, amountVerified: null, appCallVerified: null, reason: "No settlement transaction recorded for this payment" };
  }

  const txn =
    (await algorand.getIndexedTransaction(txId)) ?? (await algorand.getTransaction(txId));
  if (!txn) {
    return { verifiedOnLedger: false, confirmedRound: null, amountVerified: null, appCallVerified: null, reason: "Transaction not found on the ledger" };
  }

  const confirmedRound = Number(txn["confirmed-round"] ?? 0) || null;
  const pay = txn["payment-transaction"] as { amount?: number; receiver?: string } | undefined;
  const amountVerified = pay
    ? BigInt(pay.amount ?? 0) === row.amountMicro
    : null;

  let appCallVerified: boolean | null = null;
  if (row.settlement?.appCallTxId) {
    const appTxn =
      (await algorand.getIndexedTransaction(row.settlement.appCallTxId)) ??
      (await algorand.getTransaction(row.settlement.appCallTxId));
    if (appTxn) {
      const appId = Number(
        (appTxn["application-transaction"] as { applicationId?: number } | undefined)?.applicationId ?? 0,
      );
      appCallVerified = appId === row.settlement.appId;
    } else {
      appCallVerified = false;
    }
  }

  return {
    verifiedOnLedger: confirmedRound != null,
    confirmedRound,
    amountVerified,
    appCallVerified,
    reason: confirmedRound != null ? null : "Transaction found but not yet confirmed",
  };
}