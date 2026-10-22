/**
 * One-shot capability grants (FR-2).
 *
 * A grant is issued only after the gateway has decided an action may run. It
 * is scoped to exactly one agent, tool and canonical action hash, expires
 * quickly, and is consumed with an atomic conditional update before the tool
 * adapter touches the sandbox. Replaying the same action needs a fresh grant,
 * which in turn needs a fresh pipeline decision.
 */
import type { CapabilityGrantDTO } from "@kron/shared";
import type { CapabilityGrant } from "@prisma/client";
import { prisma } from "../db.js";

const DEFAULT_TTL_SECONDS = 60;

export class CapabilityError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, code = "capability_denied", statusCode = 403) {
    super(message);
    this.name = "CapabilityError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface IssueGrantInput {
  agentId: string;
  sessionId?: string | null;
  approvalId?: string | null;
  tool: string;
  kind: string;
  actionHash: string;
  reason: string;
  rows?: number | null;
  ttlSeconds?: number;
}

export async function issueGrant(input: IssueGrantInput): Promise<CapabilityGrantDTO> {
  if (!/^[a-f0-9]{64}$/.test(input.actionHash)) {
    throw new CapabilityError("Capability grants require a canonical SHA-256 action hash", "invalid_action_hash", 400);
  }
  const ttl = Math.max(1, input.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const row = await prisma.capabilityGrant.create({
    data: {
      agentId: input.agentId,
      sessionId: input.sessionId ?? null,
      approvalId: input.approvalId ?? null,
      tool: input.tool,
      kind: input.kind,
      actionHash: input.actionHash,
      scope: {
        tool: input.tool,
        kind: input.kind,
        rows: input.rows ?? null,
        approvalId: input.approvalId ?? null,
      } as object,
      reason: input.reason,
      status: "active",
      maxUses: 1,
      useCount: 0,
      expiresAt: new Date(Date.now() + ttl * 1000),
    },
  });
  return toGrantDTO(row);
}

/**
 * Atomically claim a grant. Only one caller can win the conditional update;
 * every other attempt gets a 403 and the tool is never invoked.
 */
export async function consumeGrant(input: {
  id: string;
  agentId: string;
  tool: string;
  actionHash: string;
}): Promise<CapabilityGrantDTO> {
  const now = new Date();
  const claimed = await prisma.capabilityGrant.updateMany({
    where: {
      id: input.id,
      agentId: input.agentId,
      tool: input.tool,
      actionHash: input.actionHash,
      status: "active",
      expiresAt: { gt: now },
    },
    data: { status: "consumed", consumedAt: now, useCount: { increment: 1 } },
  });

  if (claimed.count !== 1) {
    const row = await prisma.capabilityGrant.findUnique({ where: { id: input.id } });
    if (!row) throw new CapabilityError("Capability grant not found", "grant_not_found");
    if (row.agentId !== input.agentId) throw new CapabilityError("Grant belongs to a different agent", "grant_agent_mismatch");
    if (row.tool !== input.tool) throw new CapabilityError("Grant is scoped to a different tool", "grant_tool_mismatch");
    if (row.actionHash !== input.actionHash) {
      throw new CapabilityError("Grant is bound to a different action hash", "grant_hash_mismatch");
    }
    if (row.status === "consumed") throw new CapabilityError("Grant was already consumed (one-shot)", "grant_consumed");
    if (row.status === "revoked") throw new CapabilityError("Grant was revoked", "grant_revoked");
    if (row.expiresAt.getTime() <= now.getTime()) throw new CapabilityError("Grant expired", "grant_expired");
    throw new CapabilityError(`Grant is ${row.status}`, "grant_unavailable");
  }

  const row = await prisma.capabilityGrant.findUniqueOrThrow({ where: { id: input.id } });
  return toGrantDTO(row);
}

export async function revokeGrant(id: string): Promise<void> {
  await prisma.capabilityGrant.updateMany({
    where: { id, status: "active" },
    data: { status: "revoked" },
  });
}

export async function getGrant(id: string): Promise<CapabilityGrantDTO | null> {
  const row = await prisma.capabilityGrant.findUnique({ where: { id } });
  return row ? toGrantDTO(row) : null;
}

export async function listGrants(limit = 50): Promise<CapabilityGrantDTO[]> {
  const rows = await prisma.capabilityGrant.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return rows.map(toGrantDTO);
}

export async function recentConsumedGrant(approvalId: string): Promise<CapabilityGrantDTO | null> {
  const row = await prisma.capabilityGrant.findFirst({
    where: { approvalId },
    orderBy: { createdAt: "desc" },
  });
  return row ? toGrantDTO(row) : null;
}

export function toGrantDTO(row: CapabilityGrant): CapabilityGrantDTO {
  const expired = row.status === "active" && row.expiresAt.getTime() <= Date.now();
  return {
    id: row.id,
    agentId: row.agentId,
    sessionId: row.sessionId,
    approvalId: row.approvalId,
    tool: row.tool,
    kind: row.kind,
    actionHash: row.actionHash,
    status: expired ? "expired" : (row.status as CapabilityGrantDTO["status"]),
    maxUses: row.maxUses,
    useCount: row.useCount,
    scope: (row.scope as Record<string, unknown>) ?? {},
    expiresAt: row.expiresAt.toISOString(),
    consumedAt: row.consumedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
