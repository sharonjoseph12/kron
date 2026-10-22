import type { ActionSessionStateDTO } from "@kron/shared";

export interface SessionFacts {
  tainted: boolean;
  sensitiveRead: boolean;
  taintSource?: string | null;
  sensitiveSource?: string | null;
}

export function emptySession(agentId: string, sessionId: string): ActionSessionStateDTO {
  return {
    sessionId,
    agentId,
    tainted: false,
    sensitiveRead: false,
    taintSource: null,
    sensitiveSource: null,
    updatedAt: new Date(0).toISOString(),
  };
}

export function markTainted(session: SessionFacts, source: string): SessionFacts {
  return { ...session, tainted: true, taintSource: source };
}

export function markSensitiveRead(session: SessionFacts, source: string): SessionFacts {
  return { ...session, sensitiveRead: true, sensitiveSource: source };
}

/**
 * Lethal trifecta: untrusted content entered the session, private data was
 * read, and the agent is now sending to a recipient outside the known list.
 * Deliberately session-level and conservative.
 */
export function trifectaTriggered(input: {
  session: SessionFacts;
  kind: string;
  recipientKnown: boolean | undefined;
}): boolean {
  return input.kind === "send" && input.session.tainted && input.session.sensitiveRead && input.recipientKnown === false;
}
