/**
 * The only path from the gateway to a tool invocation.
 *
 * Every call must present a canonical action hash. The adapter mints a
 * one-shot capability grant, atomically consumes it, and only then calls the
 * sandbox. If the grant is missing, expired, scoped to another tool, or
 * already used, the tool is never invoked.
 */
import type { CapabilityGrantDTO } from "@kron/shared";
import {
  executeSandboxTool,
  executeVerified,
  type ExecuteResult,
  type openSandbox,
} from "@kron/business-tools";
import { consumeGrant, issueGrant } from "./capability-grants.js";

type SandboxDatabase = Awaited<ReturnType<typeof openSandbox>>;

export class ToolInvocationError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode = 409) {
    super(message);
    this.name = "ToolInvocationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface InvokeInput {
  db: SandboxDatabase;
  tool: string;
  args: Record<string, unknown>;
  agentId: string;
  sessionId: string | null;
  kind: string;
  actionHash: string;
  approvalId?: string | null;
  expectedRows: number | null;
  /** true = check affected rows against the preview and roll back on drift. */
  verified: boolean;
  reason: string;
  ttlSeconds?: number;
}

export async function runToolWithGrant(
  input: InvokeInput,
): Promise<{ result: ExecuteResult; grant: CapabilityGrantDTO }> {
  const grant = await issueGrant({
    agentId: input.agentId,
    sessionId: input.sessionId,
    approvalId: input.approvalId ?? null,
    tool: input.tool,
    kind: input.kind,
    actionHash: input.actionHash,
    reason: input.reason,
    rows: input.expectedRows,
    ttlSeconds: input.ttlSeconds,
  });

  // Atomic one-shot claim. Throws CapabilityError before any tool code runs.
  const consumed = await consumeGrant({
    id: grant.id,
    agentId: input.agentId,
    tool: input.tool,
    actionHash: input.actionHash,
  });

  if (!input.verified) {
    const result = executeSandboxTool(input.db, input.tool, input.args);
    return { result, grant: consumed };
  }

  const verified = executeVerified(input.db, input.tool, input.args, input.expectedRows);
  if (!verified.ok || !verified.result) {
    throw new ToolInvocationError(
      verified.reason ?? "Execution aborted after preview mismatch",
      "preview_mismatch",
      409,
    );
  }
  return { result: verified.result, grant: consumed };
}
