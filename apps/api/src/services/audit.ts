/**
 * Audit service (FR §9.7). Every sensitive action — policy changes, payment
 * decisions, wallet operations, security events — is recorded and broadcast.
 */
import type { AuditAction } from "@kron/shared";
import { prisma } from "../db.js";
import { hub } from "../events/hub.js";

export interface AuditInput {
  actorId?: string | null;
  actorType?: "user" | "system" | "agent";
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  summary: string;
  detail?: Record<string, unknown> | null;
  policyVersion?: number | null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  const row = await prisma.auditEvent.create({
    data: {
      actorId: input.actorId ?? null,
      actorType: input.actorType ?? "system",
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      summary: input.summary,
      detail: (input.detail as object) ?? undefined,
      policyVersion: input.policyVersion ?? null,
    },
  });
  hub.publish({
    type: "audit",
    entry: {
      id: row.id,
      ts: row.ts.toISOString(),
      actorId: row.actorId,
      actorType: row.actorType as "user" | "system" | "agent",
      action: row.action as AuditAction,
      targetType: row.targetType,
      targetId: row.targetId,
      summary: row.summary,
      detail: (row.detail as Record<string, unknown>) ?? null,
      policyVersion: row.policyVersion,
    },
  });
}

export async function listAudit(opts: { limit?: number; action?: string } = {}) {
  return prisma.auditEvent.findMany({
    orderBy: { ts: "desc" },
    take: opts.limit ?? 100,
    where: opts.action ? { action: opts.action } : undefined,
  });
}
