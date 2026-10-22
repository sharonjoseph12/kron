/**
 * Approval cards are bound to sha256(canonical action JSON). The dashboard,
 * the phone card and the executor all verify the same hash, so a changed
 * argument cannot ride on an old human approval.
 */
import type { ActionRequest, ApprovalDTO, ControlDecision, ControlMode, ImpactPreview, SafeVersion } from "@kron/shared";
import { actionHash } from "@kron/safe-rewrite";
import type { Approval } from "@prisma/client";
import { prisma } from "../db.js";
import { config } from "../config.js";

export interface CreateApprovalInput {
  mode: ControlMode;
  action: ActionRequest;
  safe: SafeVersion | null;
  preview: ImpactPreview | null;
  reasons: string[];
  riskScore: number;
  decision: ControlDecision;
  expiresInMinutes?: number;
}

export async function createApproval(input: CreateApprovalInput): Promise<ApprovalDTO> {
  const expiresInMinutes = input.expiresInMinutes ?? 15;
  const row = await prisma.approval.create({
    data: {
      mode: input.mode,
      status: "pending",
      agentId: input.action.agentId,
      sessionId: input.action.sessionId ?? null,
      missionId: input.action.missionId ?? null,
      tool: input.action.tool,
      actionJson: input.action as object,
      actionHash: actionHash(input.action),
      safeActionJson: input.safe ? (input.safe.action as object) : undefined,
      safeActionHash: input.safe ? actionHash(input.safe.action) : null,
      safeLabel: input.safe?.label ?? null,
      safeRevalidation: input.safe ? (input.safe.revalidation as object) : undefined,
      differences: (input.safe?.differences ?? []) as object,
      preview: input.preview ? (input.preview as object) : undefined,
      reasons: input.reasons as object,
      riskScore: input.riskScore,
      decision: input.decision,
      expiresAt: new Date(Date.now() + expiresInMinutes * 60_000),
    },
  });
  return toApprovalDTO(row);
}

export async function getApproval(id: string): Promise<ApprovalDTO | null> {
  const row = await prisma.approval.findUnique({ where: { id } });
  return row ? toApprovalDTO(row) : null;
}

export async function getApprovalRow(id: string): Promise<Approval | null> {
  return prisma.approval.findUnique({ where: { id } });
}

export async function listApprovals(status?: string): Promise<ApprovalDTO[]> {
  const rows = await prisma.approval.findMany({
    where: status ? { status } : { status: "pending" },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map(toApprovalDTO);
}

/** Pick the exact action a human is approving and return its hash. */
export function approvalTarget(
  row: Approval,
  target: "safe" | "original",
): { action: ActionRequest; hash: string; isSafe: boolean } | null {
  if (target === "safe" && row.safeActionJson) {
    const action = row.safeActionJson as unknown as ActionRequest;
    return { action, hash: actionHash(action), isSafe: true };
  }
  if (target === "safe") return null;
  const action = row.actionJson as unknown as ActionRequest;
  return { action, hash: actionHash(action), isSafe: false };
}

export function approvalExpired(row: Approval): boolean {
  return row.expiresAt.getTime() < Date.now();
}

export function safeRevalidationDecision(row: Approval): string | null {
  const value = row.safeRevalidation as { decision?: string } | null;
  return value?.decision ?? null;
}

export function toApprovalDTO(row: Approval): ApprovalDTO {
  return {
    id: row.id,
    mode: row.mode as ControlMode,
    status: row.status as ApprovalDTO["status"],
    agentId: row.agentId,
    sessionId: row.sessionId,
    missionId: row.missionId,
    tool: row.tool,
    actionJson: row.actionJson as Record<string, unknown>,
    actionHash: row.actionHash,
    safeActionJson: (row.safeActionJson as Record<string, unknown> | null) ?? null,
    safeActionHash: row.safeActionHash,
    safeLabel: row.safeLabel,
    differences: (row.differences as string[]) ?? [],
    preview: (row.preview as unknown as ImpactPreview | null) ?? null,
    reasons: (row.reasons as string[]) ?? [],
    riskScore: row.riskScore,
    decision: row.decision as ControlDecision,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    phoneUrl: `${config.dashboardUrl.replace(/\/$/, "")}/m/${row.id}`,
  };
}
