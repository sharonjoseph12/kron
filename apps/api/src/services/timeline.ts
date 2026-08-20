/**
 * Timeline service — the persisted real-time economic timeline (PRD §6.5).
 * Every step (REQUEST → 402 → PRICE DISCOVERED → POLICY EVALUATED → ... )
 * is recorded with a monotonically increasing sequence per session and
 * broadcast to live dashboard clients over SSE.
 */
import type { TimelineEventStatus, TimelineStep } from "@kron/shared";
import { prisma } from "../db.js";
import { hub } from "../events/hub.js";

const seqCache = new Map<string, number>();

async function nextSeq(sessionId: string): Promise<number> {
  const cached = seqCache.get(sessionId);
  if (cached != null) return cached + 1;
  const last = await prisma.timelineEvent.findFirst({
    where: { sessionId },
    orderBy: { seq: "desc" },
  });
  const next = (last?.seq ?? 0) + 1;
  seqCache.set(sessionId, next);
  return next;
}

export async function appendTimeline(args: {
  sessionId: string;
  agentId: string;
  step: TimelineStep;
  status: TimelineEventStatus;
  message: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const seq = await nextSeq(args.sessionId);
  const row = await prisma.timelineEvent.create({
    data: {
      sessionId: args.sessionId,
      agentId: args.agentId,
      seq,
      step: args.step,
      status: args.status,
      message: args.message,
      detail: (args.detail as object) ?? undefined,
    },
  });
  hub.publish({
    type: "timeline",
    event: {
      id: row.id,
      sessionId: row.sessionId,
      agentId: row.agentId,
      seq: row.seq,
      step: row.step as TimelineStep,
      status: row.status as TimelineEventStatus,
      message: row.message,
      detail: (row.detail as Record<string, unknown>) ?? undefined,
      ts: row.ts.toISOString(),
    },
  });
}

export async function getSessionTimeline(sessionId: string) {
  return prisma.timelineEvent.findMany({
    where: { sessionId },
    orderBy: { seq: "asc" },
  });
}
