/**
 * Hash-chained control-plane audit log (FR-9).
 *
 * Unlike the legacy AuditEvent table (a useful activity log, but not a chain),
 * every entry here commits to the previous entry's hash. Changing any older
 * row breaks verification at that entry.
 */
import crypto from "node:crypto";
import type { AuditChainEntryDTO, AuditVerifyResult } from "@kron/shared";
import { canonicalJson } from "@kron/safe-rewrite";
import { prisma } from "../db.js";

const GENESIS = "GENESIS";

type AuditActor = "user" | "system" | "agent";

export interface ControlAuditInput {
  actorType?: AuditActor;
  action: string;
  summary: string;
  detail?: Record<string, unknown> | null;
}

function entryHash(input: {
  seq: number;
  ts: string;
  actorType: string;
  action: string;
  summary: string;
  detail: unknown;
  prevHash: string;
}): string {
  return crypto.createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export async function appendControlAudit(input: ControlAuditInput): Promise<AuditChainEntryDTO> {
  const previous = await prisma.controlAuditEntry.findFirst({ orderBy: { seq: "desc" } });
  const seq = (previous?.seq ?? 0) + 1;
  const prevHash = previous?.hash ?? GENESIS;
  const ts = new Date();
  const detail = input.detail ?? null;
  const hash = entryHash({
    seq,
    ts: ts.toISOString(),
    actorType: input.actorType ?? "system",
    action: input.action,
    summary: input.summary,
    detail,
    prevHash,
  });
  const row = await prisma.controlAuditEntry.create({
    data: {
      seq,
      ts,
      actorType: input.actorType ?? "system",
      action: input.action,
      summary: input.summary,
      detail: detail as object | undefined,
      prevHash,
      hash,
    },
  });
  return toDTO(row);
}

export async function listControlAudit(limit = 200): Promise<AuditChainEntryDTO[]> {
  const rows = await prisma.controlAuditEntry.findMany({ orderBy: { seq: "desc" }, take: limit });
  return rows.map(toDTO);
}

/** Walk the chain in order and recompute every hash and link. */
export async function verifyControlAudit(): Promise<AuditVerifyResult> {
  const rows = await prisma.controlAuditEntry.findMany({ orderBy: { seq: "asc" } });
  let prevHash = GENESIS;
  let firstBroken: AuditVerifyResult["firstBroken"] = null;

  for (const row of rows) {
    const expected = entryHash({
      seq: row.seq,
      ts: row.ts.toISOString(),
      actorType: row.actorType,
      action: row.action,
      summary: row.summary,
      detail: row.detail,
      prevHash,
    });
    if (row.prevHash !== prevHash) {
      firstBroken = { id: row.id, seq: row.seq, reason: "Previous-hash link does not match the preceding entry." };
      break;
    }
    if (row.hash !== expected) {
      firstBroken = { id: row.id, seq: row.seq, reason: "Entry hash does not match its contents." };
      break;
    }
    prevHash = row.hash;
  }

  return {
    ok: firstBroken == null,
    checked: rows.length,
    headHash: rows.at(-1)?.hash ?? null,
    firstBroken,
    entries: rows.map(toDTO),
  };
}

/**
 * Demo/test-only mutation. It changes a row without re-hashing so Verify can
 * show detection. Never exposed on an unauthenticated path.
 */
export async function tamperLatestControlAudit(): Promise<AuditChainEntryDTO | null> {
  const row = await prisma.controlAuditEntry.findFirst({ orderBy: { seq: "desc" } });
  if (!row) return null;
  const updated = await prisma.controlAuditEntry.update({
    where: { id: row.id },
    data: { summary: `${row.summary} [tampered]` },
  });
  return toDTO(updated);
}

function toDTO(row: {
  id: string;
  seq: number;
  ts: Date;
  actorType: string;
  action: string;
  summary: string;
  detail: unknown;
  prevHash: string;
  hash: string;
}): AuditChainEntryDTO {
  return {
    id: row.id,
    seq: row.seq,
    ts: row.ts.toISOString(),
    actorType: row.actorType as AuditActor,
    action: row.action,
    summary: row.summary,
    detail: (row.detail as Record<string, unknown>) ?? null,
    prevHash: row.prevHash,
    hash: row.hash,
  };
}
