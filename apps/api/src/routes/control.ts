/**
 * PS 2.1 control-plane HTTP surface.
 *
 * Authenticated operator routes evaluate actions, list approval cards and
 * decide them. The public approval card is intentionally tokenless for the
 * video demo (the card id is high-entropy) but the decision still has to
 * present the exact bound action hash.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { ApprovalDecisionSchema, ActionRequestSchema } from "@kron/shared";
import { z } from "zod";
import { openSandbox, proofPane } from "@kron/business-tools";
import { requireAuth, requireRole, currentUser } from "../lib/auth.js";
import {
  ApprovalError,
  decideApproval,
  evaluateAction,
} from "../services/action-gateway.js";
import { getApproval, listApprovals } from "../services/control-approvals.js";
import { CapabilityError, getGrant, listGrants } from "../services/capability-grants.js";
import { getReceipt, listReceipts, verifyReceipts } from "../services/control-receipts.js";
import { ToolInvocationError } from "../services/tool-adapter.js";
import { getSessionState } from "../services/control-session.js";
import {
  listControlAudit,
  tamperLatestControlAudit,
  verifyControlAudit,
} from "../services/control-audit.js";

const EvaluateSchema = ActionRequestSchema.extend({
  mode: z.enum(["kron", "baseline"]).optional(),
});

function handleError(reply: FastifyReply, err: unknown) {
  if (err instanceof ApprovalError) {
    return reply.code(err.statusCode).send({ error: err.message, code: err.code, details: err.details });
  }
  if (err instanceof CapabilityError) {
    return reply.code(err.statusCode).send({ error: err.message, code: err.code });
  }
  if (err instanceof ToolInvocationError) {
    return reply.code(err.statusCode).send({ error: err.message, code: err.code });
  }
  return reply.code(500).send({ error: err instanceof Error ? err.message : "Internal error" });
}

export async function controlRoutes(fastify: FastifyInstance) {
  fastify.post("/api/actions/evaluate", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = EvaluateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid action" });
    const body = request.body as { mode?: "kron" | "baseline" };
    try {
      const result = await evaluateAction(parsed.data, { mode: body.mode });
      return { result };
    } catch (err) {
      return handleError(reply, err);
    }
  });

  fastify.get("/api/approvals", { preHandler: requireAuth }, async (request) => {
    const q = request.query as { status?: string };
    const approvals = await listApprovals(q.status);
    return { approvals };
  });

  fastify.get("/api/approvals/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const approval = await getApproval(id);
    if (!approval) return reply.code(404).send({ error: "Approval not found" });
    return { approval };
  });

  fastify.post(
    "/api/approvals/:id/decide",
    { preHandler: [requireAuth, requireRole("operator")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = ApprovalDecisionSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid decision" });
      try {
        const result = await decideApproval({
          approvalId: id,
          decision: parsed.data.decision,
          target: parsed.data.target,
          presentedHash: parsed.data.actionHash,
          userId: currentUser(request).id,
        });
        return { ...result, proof: proofPane(await openSandbox()) };
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  fastify.get("/api/proof", { preHandler: requireAuth }, async () => {
    const db = await openSandbox();
    return { proof: proofPane(db) };
  });

  // ---- capability grants: what was authorised, what was actually used ----
  fastify.get("/api/grants", { preHandler: requireAuth }, async (request) => {
    const q = request.query as { limit?: string };
    return { grants: await listGrants(Number(q.limit ?? 50)) };
  });

  fastify.get("/api/grants/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const grant = await getGrant(id);
    if (!grant) return reply.code(404).send({ error: "Grant not found" });
    return { grant };
  });

  // ---- enforcement receipts: durable, hash-chained proof ----
  fastify.get("/api/receipts", { preHandler: requireAuth }, async (request) => {
    const q = request.query as { limit?: string };
    return { receipts: await listReceipts(Number(q.limit ?? 50)) };
  });

  fastify.get("/api/receipts/verify", { preHandler: requireAuth }, async () => {
    return { verification: await verifyReceipts() };
  });

  fastify.get("/api/receipts/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const receipt = await getReceipt(id);
    if (!receipt) return reply.code(404).send({ error: "Receipt not found" });
    return { receipt };
  });

  // Public receipt link for the video/phone flow. Contains no secrets; the
  // id is high-entropy and the hash chain makes it tamper-evident.
  fastify.get("/api/public/receipts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const receipt = await getReceipt(id);
    if (!receipt) return reply.code(404).send({ error: "Receipt not found" });
    return { receipt };
  });

  fastify.get("/api/control/sessions/:sessionId", { preHandler: requireAuth }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const q = request.query as { agentId?: string };
    if (!q.agentId) return reply.code(400).send({ error: "agentId is required" });
    return { state: await getSessionState(q.agentId, sessionId) };
  });

  fastify.get("/api/control/audit", { preHandler: requireAuth }, async (request) => {
    const q = request.query as { limit?: string };
    return { entries: await listControlAudit(Number(q.limit ?? 200)) };
  });

  fastify.get("/api/control/audit/verify", { preHandler: requireAuth }, async () => {
    return { verification: await verifyControlAudit() };
  });

  fastify.post(
    "/api/control/audit/tamper",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (_request, reply) => {
      const entry = await tamperLatestControlAudit();
      if (!entry) return reply.code(404).send({ error: "No audit entries to tamper with" });
      return { ok: true, tampered: entry };
    },
  );

  // Public phone card. The id is the capability; the hash is the integrity
  // check. No cookies, no API key, no external network.
  fastify.get("/api/public/approvals/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const approval = await getApproval(id);
    if (!approval) return reply.code(404).send({ error: "Approval not found" });
    return { approval };
  });

  fastify.post("/api/public/approvals/:id/decide", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ApprovalDecisionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid decision" });
    try {
      const result = await decideApproval({
        approvalId: id,
        decision: parsed.data.decision,
        target: parsed.data.target,
        presentedHash: parsed.data.actionHash,
        userId: "phone-operator",
      });
      return { ...result, proof: proofPane(await openSandbox()) };
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

export type ControlEvaluateBody = z.infer<typeof EvaluateSchema>;
