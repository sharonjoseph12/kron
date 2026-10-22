/**
 * Per-session taint and sensitive-read state for the lethal-trifecta check.
 * State is deliberately session-level: a clean later call cannot un-read data
 * that the same agent already saw in this session.
 */
import type { ActionSessionStateDTO } from "@kron/shared";
import { prisma } from "../db.js";

export async function getSessionState(agentId: string, sessionId: string): Promise<ActionSessionStateDTO> {
  const row = await prisma.actionSessionState.upsert({
    where: { sessionId },
    create: { sessionId, agentId },
    update: {},
  });
  return toDTO(row);
}

export async function markSessionTainted(agentId: string, sessionId: string, source: string): Promise<void> {
  await prisma.actionSessionState.upsert({
    where: { sessionId },
    create: { sessionId, agentId, tainted: true, taintSource: source },
    update: { tainted: true, taintSource: source },
  });
}

export async function markSensitiveRead(agentId: string, sessionId: string, source: string): Promise<void> {
  await prisma.actionSessionState.upsert({
    where: { sessionId },
    create: { sessionId, agentId, sensitiveRead: true, sensitiveSource: source },
    update: { sensitiveRead: true, sensitiveSource: source },
  });
}

export async function resetSessionStates(): Promise<void> {
  await prisma.actionSessionState.deleteMany({});
}

function toDTO(row: {
  sessionId: string;
  agentId: string;
  tainted: boolean;
  sensitiveRead: boolean;
  taintSource: string | null;
  sensitiveSource: string | null;
  updatedAt: Date;
}): ActionSessionStateDTO {
  return {
    sessionId: row.sessionId,
    agentId: row.agentId,
    tainted: row.tainted,
    sensitiveRead: row.sensitiveRead,
    taintSource: row.taintSource,
    sensitiveSource: row.sensitiveSource,
    updatedAt: row.updatedAt.toISOString(),
  };
}
