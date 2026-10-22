/**
 * Proof-of-enforcement receipts (FR-9).
 *
 * Every decision and every decision attempt produces an immutable artifact:
 * what the gateway saw before, what it saw after, whether the tool actually
 * ran, which approval and one-shot grant authorised it, and any drift that
 * invalidated a stale card. Receipts are hash-chained, so a deleted or edited
 * receipt cannot be hidden.
 */
import crypto from "node:crypto";
import type {
  ControlDecision,
  DriftInfo,
  EnforcementReceiptDTO,
  ProofSnapshot,
  ReceiptStatus,
  ReceiptVerifyResult,
} from "@kron/shared";
import { canonicalJson } from "@kron/safe-rewrite";
import type { EnforcementReceipt } from "@prisma/client";
import { prisma } from "../db.js";

const GENESIS = "GENESIS";

export interface AppendReceiptInput {
  actionRecordId?: string | null;
  approvalId?: string | null;
  grantId?: string | null;
  actionHash: string;
  tool: string;
  agentId: string;
  sessionId?: string | null;
  decision: ControlDecision;
  status: ReceiptStatus;
  toolInvoked: boolean;
  summary: string;
  actionJson?: Record<string, unknown> | null;
  before: ProofSnapshot;
  after: ProofSnapshot;
  approval?: EnforcementReceiptDTO["approval"];
  grant?: EnforcementReceiptDTO["grant"];
  drift?: DriftInfo | null;
  executedAt?: Date | null;
}

function receiptHash(input: {
  seq: number;
  createdAt: string;
  actionRecordId: string | null;
  approvalId: string | null;
  grantId: string | null;
  actionHash: string;
  tool: string;
  agentId: string;
  sessionId: string | null;
  decision: string;
  status: string;
  toolInvoked: boolean;
  summary: string;
  actionJson: unknown;
  before: unknown;
  after: unknown;
  approval: unknown;
  grant: unknown;
  drift: unknown;
  executedAt: string | null;
  prevHash: string;
}): string {
  return crypto.createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export async function appendReceipt(input: AppendReceiptInput): Promise<EnforcementReceiptDTO> {
  const previous = await prisma.enforcementReceipt.findFirst({ orderBy: { seq: "desc" } });
  const seq = (previous?.seq ?? 0) + 1;
  const prevHash = previous?.hash ?? GENESIS;
  const createdAt = new Date();
  const actionJson = input.actionJson ?? null;
  const approval = input.approval ?? null;
  const grant = input.grant ?? null;
  const drift = input.drift ?? null;
  const executedAt = input.executedAt ?? null;

  const hash = receiptHash({
    seq,
    createdAt: createdAt.toISOString(),
    actionRecordId: input.actionRecordId ?? null,
    approvalId: input.approvalId ?? null,
    grantId: input.grantId ?? null,
    actionHash: input.actionHash,
    tool: input.tool,
    agentId: input.agentId,
    sessionId: input.sessionId ?? null,
    decision: input.decision,
    status: input.status,
    toolInvoked: input.toolInvoked,
    summary: input.summary,
    actionJson,
    before: input.before,
    after: input.after,
    approval,
    grant,
    drift,
    executedAt: executedAt?.toISOString() ?? null,
    prevHash,
  });

  const row = await prisma.enforcementReceipt.create({
    data: {
      seq,
      createdAt,
      actionRecordId: input.actionRecordId ?? null,
      approvalId: input.approvalId ?? null,
      grantId: input.grantId ?? null,
      actionHash: input.actionHash,
      tool: input.tool,
      agentId: input.agentId,
      sessionId: input.sessionId ?? null,
      decision: input.decision,
      status: input.status,
      toolInvoked: input.toolInvoked,
      summary: input.summary,
      actionJson: actionJson as object | undefined,
      before: input.before as unknown as object,
      after: input.after as unknown as object,
      approval: approval as object | undefined,
      grant: grant as object | undefined,
      drift: drift as object | undefined,
      executedAt,
      prevHash,
      hash,
    },
  });
  return toReceiptDTO(row);
}

export async function listReceipts(limit = 50): Promise<EnforcementReceiptDTO[]> {
  const rows = await prisma.enforcementReceipt.findMany({ orderBy: { seq: "desc" }, take: Math.min(limit, 200) });
  return rows.map(toReceiptDTO);
}

export async function getReceipt(id: string): Promise<EnforcementReceiptDTO | null> {
  const row = await prisma.enforcementReceipt.findUnique({ where: { id } });
  return row ? toReceiptDTO(row) : null;
}

export async function verifyReceipts(): Promise<ReceiptVerifyResult> {
  const rows = await prisma.enforcementReceipt.findMany({ orderBy: { seq: "asc" } });
  let prevHash = GENESIS;
  let firstBroken: ReceiptVerifyResult["firstBroken"] = null;

  for (const row of rows) {
    const expected = receiptHash({
      seq: row.seq,
      createdAt: row.createdAt.toISOString(),
      actionRecordId: row.actionRecordId,
      approvalId: row.approvalId,
      grantId: row.grantId,
      actionHash: row.actionHash,
      tool: row.tool,
      agentId: row.agentId,
      sessionId: row.sessionId,
      decision: row.decision,
      status: row.status,
      toolInvoked: row.toolInvoked,
      summary: row.summary,
      actionJson: row.actionJson,
      before: row.before,
      after: row.after,
      approval: row.approval,
      grant: row.grant,
      drift: row.drift,
      executedAt: row.executedAt?.toISOString() ?? null,
      prevHash,
    });
    if (row.prevHash !== prevHash) {
      firstBroken = { id: row.id, seq: row.seq, reason: "Previous-hash link does not match the preceding receipt." };
      break;
    }
    if (row.hash !== expected) {
      firstBroken = { id: row.id, seq: row.seq, reason: "Receipt hash does not match its contents." };
      break;
    }
    prevHash = row.hash;
  }

  return { ok: firstBroken == null, checked: rows.length, headHash: rows.at(-1)?.hash ?? null, firstBroken };
}

function toReceiptDTO(row: EnforcementReceipt): EnforcementReceiptDTO {
  return {
    id: row.id,
    seq: row.seq,
    actionRecordId: row.actionRecordId,
    approvalId: row.approvalId,
    grantId: row.grantId,
    actionHash: row.actionHash,
    tool: row.tool,
    agentId: row.agentId,
    sessionId: row.sessionId,
    decision: row.decision as ControlDecision,
    status: row.status as ReceiptStatus,
    toolInvoked: row.toolInvoked,
    summary: row.summary,
    actionJson: (row.actionJson as Record<string, unknown> | null) ?? null,
    before: row.before as unknown as ProofSnapshot,
    after: row.after as unknown as ProofSnapshot,
    approval: (row.approval as unknown as EnforcementReceiptDTO["approval"]) ?? null,
    grant: (row.grant as unknown as EnforcementReceiptDTO["grant"]) ?? null,
    drift: (row.drift as unknown as DriftInfo | null) ?? null,
    executedAt: row.executedAt?.toISOString() ?? null,
    prevHash: row.prevHash,
    hash: row.hash,
    createdAt: row.createdAt.toISOString(),
  };
}
