/**
 * Generic action gateway (FR-1). This is the single path every non-payment
 * tool call goes through:
 *
 *   classify → hard rules → real impact preview → risk score → safe rewrite
 *   → revalidate safe version → ALLOW/FLAG execute, HOLD create approval,
 *     BLOCK never executes.
 *
 * Everything is deterministic and in-process. No model or network is used.
 */
import type {
  ActionDecisionResult,
  ActionRequest,
  ActionRuleHit,
  ActionSessionStateDTO,
  ControlDecision,
  ControlMode,
  ImpactPreview,
  SafeVersion,
} from "@kron/shared";
import { classifyAction, evaluateRisk, type MissionRules, type SessionFacts } from "@kron/action-risk";
import { actionHash, proposeSafeVersion } from "@kron/safe-rewrite";
import {
  executeSandboxTool,
  executeVerified,
  fileRow,
  openSandbox,
  previewSandboxAction,
  proofPane,
  saveSandbox,
  INTERNAL_OWNER,
  type ExecuteResult,
} from "@kron/business-tools";
import type { Approval, Mission } from "@prisma/client";
import { prisma } from "../db.js";
import { hub } from "../events/hub.js";
import { appendControlAudit } from "./control-audit.js";
import { getSessionState, markSessionTainted, markSensitiveRead } from "./control-session.js";
import {
  approvalExpired,
  approvalTarget,
  createApproval,
  getApprovalRow,
  safeRevalidationDecision,
  toApprovalDTO,
} from "./control-approvals.js";

export interface EvaluateOptions {
  mode?: ControlMode;
  /** Do not create approval rows (used for safe-version revalidation). */
  approval?: boolean;
}

export class ApprovalError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 409) {
    super(message);
    this.statusCode = statusCode;
  }
}

const SUSPICIOUS_CONTENT =
  /ignore (all )?(prior|previous) instructions|system note|<!--|forward .* to |send .* to /i;

function sessionFacts(state: ActionSessionStateDTO): SessionFacts {
  return {
    tainted: state.tainted,
    sensitiveRead: state.sensitiveRead,
    taintSource: state.taintSource,
    sensitiveSource: state.sensitiveSource,
  };
}

async function missionRules(missionId: string | undefined): Promise<MissionRules | null> {
  if (!missionId) return null;
  const mission: Mission | null = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!mission || !mission.active || mission.expiresAt.getTime() < Date.now()) return null;
  return {
    allowedTools: (mission.allowedTools as string[]) ?? [],
    deniedTools: (mission.deniedTools as string[]) ?? [],
    requiresApproval: (mission.requiresApproval as string[]) ?? [],
  };
}

function expectedRows(tool: string, preview: ImpactPreview | null): number | null {
  if (!preview) return null;
  if (tool === "email.send") return 1;
  return preview.rowsAffected ?? null;
}

function ruleHitsFromPreview(preview: ImpactPreview | null): ActionRuleHit[] {
  if (!preview) return [];
  const hits: ActionRuleHit[] = [];
  if ((preview.rowsAffected ?? 0) > 100) {
    hits.push({ rule: "bulk_mutation", description: `Action affects ${preview.rowsAffected} rows.`, severity: "warn" });
  }
  if ((preview.sensitiveRows ?? 0) > 0) {
    hits.push({
      rule: "sensitive_rows",
      description: `${preview.sensitiveRows} affected rows belong to customers with open shipments.`,
      severity: "warn",
    });
  }
  if (preview.recipientKnown === false) {
    hits.push({ rule: "new_recipient", description: `${preview.recipient} is not a known contact.`, severity: "warn" });
  }
  if (preview.fileSensitivity === "customer-confidential") {
    hits.push({ rule: "private_file", description: "Attachment is tagged customer-confidential.", severity: "warn" });
  }
  if (!preview.recoverable && preview.kind === "delete") {
    hits.push({ rule: "irreversible", description: "Destructive action is not recoverable.", severity: "block" });
  }
  return hits;
}

async function persistRecord(input: {
  action: ActionRequest;
  mode: ControlMode;
  kind: string;
  decision: ControlDecision;
  riskScore: number;
  reasons: string[];
  ruleHits: ActionRuleHit[];
  factors: unknown;
  preview: ImpactPreview | null;
  safe: SafeVersion | null;
  approvalId: string | null;
  execution?: ExecuteResult | null;
}): Promise<string> {
  const row = await prisma.actionRecord.create({
    data: {
      agentId: input.action.agentId,
      sessionId: input.action.sessionId ?? null,
      missionId: input.action.missionId ?? null,
      tool: input.action.tool,
      args: input.action.args as object,
      kind: input.kind,
      decision: input.decision,
      riskScore: input.riskScore,
      reasons: input.reasons as object,
      ruleHits: input.ruleHits as object,
      factors: input.factors as object,
      preview: input.preview ? (input.preview as object) : undefined,
      safeAction: input.safe ? (input.safe.action as object) : undefined,
      approvalId: input.approvalId,
      mode: input.mode,
      execution: input.execution ? (input.execution as object) : undefined,
      executedAt: input.execution ? new Date() : null,
    },
  });
  return row.id;
}

async function readSideEffects(tool: string, args: Record<string, unknown>, agentId: string, sessionId: string): Promise<ExecuteResult | null> {
  if (tool !== "email.read" && tool !== "files.read" && tool !== "orders.read" && tool !== "files.list") return null;
  const db = await openSandbox();
  const result = executeSandboxTool(db, tool, args);
  if (tool === "email.read") {
    const body = String(result.detail.body ?? "");
    if (SUSPICIOUS_CONTENT.test(body)) {
      await markSessionTainted(agentId, sessionId, `email.read:${String(result.detail.id ?? args.id ?? "unknown")}`);
    }
  }
  if (tool === "files.read") {
    const path = String(args.path ?? "");
    const file = fileRow(db, path);
    if (file && file.sensitivity !== "public") {
      await markSensitiveRead(agentId, sessionId, `files.read:${file.path}`);
    }
  }
  return result;
}

export async function evaluateAction(input: ActionRequest, opts: EvaluateOptions = {}): Promise<ActionDecisionResult> {
  const mode: ControlMode = opts.mode ?? "kron";
  const action: ActionRequest = {
    ...input,
    nonce: input.nonce ?? `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  };
  const sessionId = action.sessionId ?? `adhoc-${action.agentId}`;
  action.sessionId = sessionId;

  const db = await openSandbox();
  const state = await getSessionState(action.agentId, sessionId);
  const kind = classifyAction(action.tool);

  // Reads are allowed immediately, but they can leave session facts behind.
  if (kind === "read") {
    const execution = await readSideEffects(action.tool, action.args, action.agentId, sessionId);
    const recordId = await persistRecord({
      action,
      mode,
      kind,
      decision: "ALLOW",
      riskScore: 0,
      reasons: ["Read-only action. No mutation, send or payment."],
      ruleHits: [],
      factors: [],
      preview: null,
      safe: null,
      approvalId: null,
      execution,
    });
    await appendControlAudit({
      actorType: "agent",
      action: "action.read",
      summary: `Agent read via ${action.tool}`,
      detail: { tool: action.tool, sessionId, recordId },
    });
    return {
      decision: "ALLOW",
      kind,
      riskScore: 0,
      reasons: ["Read-only action. No mutation, send or payment."],
      ruleHits: [],
      factors: [],
      preview: null,
      safeVersion: null,
      approvalId: null,
      actionHash: null,
      mode,
      recordId,
      execution: execution ? { ok: true, summary: execution.summary, affectedRows: execution.affectedRows, detail: execution.detail } : null,
    };
  }

  const contract = await missionRules(action.missionId);

  // Baseline: no preview, no risk engine, no safe rewrite. The raw action goes
  // straight to a human with only its name and arguments.
  if (mode === "baseline") {
    const reasons = [
      "Baseline approval desk: only the tool name and arguments are shown.",
      "No impact preview, risk score or safe alternative is computed.",
    ];
    const approval = opts.approval === false
      ? null
      : await createApproval({
          mode,
          action,
          safe: null,
          preview: null,
          reasons,
          riskScore: 0,
          decision: "HOLD",
        });
    const result: ActionDecisionResult = {
      decision: "HOLD",
      kind,
      riskScore: 0,
      reasons,
      ruleHits: [],
      factors: [],
      preview: null,
      safeVersion: null,
      approvalId: approval?.id ?? null,
      actionHash: actionHash(action),
      mode,
      recordId: null,
    };
    const recordId = await persistRecord({
      action,
      mode,
      kind,
      decision: "HOLD",
      riskScore: 0,
      reasons,
      ruleHits: [],
      factors: [],
      preview: null,
      safe: null,
      approvalId: result.approvalId,
    });
    result.recordId = recordId;
    await appendControlAudit({
      actorType: "agent",
      action: "action.held",
      summary: `Baseline held ${action.tool} for approval`,
      detail: { tool: action.tool, sessionId, approvalId: result.approvalId, recordId },
    });
    publishAction(result, action, sessionId);
    return result;
  }

  let preview: ImpactPreview | null = null;
  try {
    preview = previewSandboxAction(db, action.tool, action.args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: ActionDecisionResult = {
      decision: "BLOCK",
      kind,
      riskScore: 100,
      reasons: [`Preview could not be computed: ${message}`],
      ruleHits: [{ rule: "preview_failed", description: message, severity: "block" }],
      factors: [],
      preview: null,
      safeVersion: null,
      approvalId: null,
      actionHash: actionHash(action),
      mode,
      recordId: null,
    };
    result.recordId = await persistRecord({
      action,
      mode,
      kind,
      decision: "BLOCK",
      riskScore: 100,
      reasons: result.reasons,
      ruleHits: result.ruleHits,
      factors: [],
      preview: null,
      safe: null,
      approvalId: null,
    });
    return result;
  }

  const risk = evaluateRisk({
    tool: action.tool,
    args: action.args,
    kind,
    session: sessionFacts(state),
    preview,
    contract,
  });

  let safe: SafeVersion | null = null;
  if (risk.decision === "HOLD") {
    const proposed = proposeSafeVersion({
      action,
      kind,
      preview,
      internalOwner: INTERNAL_OWNER,
      perCallLimitAlgo: 0.1,
    });
    if (proposed) {
      let safePreview: ImpactPreview | null = null;
      try {
        safePreview = previewSandboxAction(db, proposed.action.tool, proposed.action.args);
      } catch {
        safePreview = null;
      }
      const safeRisk = evaluateRisk({
        tool: proposed.action.tool,
        args: proposed.action.args,
        kind: classifyAction(proposed.action.tool),
        session: sessionFacts(state),
        preview: safePreview,
        contract,
      });
      safe = {
        action: proposed.action,
        label: proposed.label,
        differences: proposed.differences,
        revalidation: {
          decision: safeRisk.decision,
          riskScore: safeRisk.score,
          reasons: safeRisk.reasons,
        },
      };
    }
  }

  let approvalId: string | null = null;
  if (risk.decision === "HOLD" && opts.approval !== false) {
    const approval = await createApproval({
      mode,
      action,
      safe,
      preview,
      reasons: risk.reasons,
      riskScore: risk.score,
      decision: risk.decision,
    });
    approvalId = approval.id;
  }

  let execution: ExecuteResult | null = null;
  let finalDecision = risk.decision;
  const reasons = [...risk.reasons];
  const ruleHits = [...ruleHitsFromPreview(preview)];

  // Low-risk actions execute only after the same verified preview check used
  // by the approval path. A mismatch aborts instead of mutating.
  if (finalDecision === "ALLOW" || finalDecision === "FLAG") {
    const verified = executeVerified(db, action.tool, action.args, expectedRows(action.tool, preview));
    if (!verified.ok) {
      finalDecision = "BLOCK";
      reasons.unshift(verified.reason ?? "Preview mismatch; execution aborted.");
      ruleHits.push({ rule: "preview_mismatch", description: verified.reason ?? "Preview mismatch", severity: "block" });
    } else {
      execution = verified.result;
      saveSandbox();
    }
  }

  const result: ActionDecisionResult = {
    decision: finalDecision,
    kind,
    riskScore: risk.score,
    reasons,
    ruleHits,
    factors: risk.factors,
    preview,
    safeVersion: safe,
    approvalId,
    actionHash: actionHash(action),
    mode,
    recordId: null,
    execution: execution
      ? { ok: true, summary: execution.summary, affectedRows: execution.affectedRows, detail: execution.detail }
      : null,
  };

  result.recordId = await persistRecord({
    action,
    mode,
    kind,
    decision: result.decision,
    riskScore: result.riskScore,
    reasons: result.reasons,
    ruleHits: result.ruleHits,
    factors: result.factors,
    preview: result.preview,
    safe: result.safeVersion,
    approvalId,
    execution,
  });

  await appendControlAudit({
    actorType: "agent",
    action: result.decision === "HOLD" ? "action.held" : `action.${result.decision.toLowerCase()}`,
    summary:
      result.decision === "HOLD"
        ? `KRON held ${action.tool} for approval`
        : `KRON ${result.decision.toLowerCase()}ed ${action.tool}`,
    detail: {
      tool: action.tool,
      sessionId,
      riskScore: result.riskScore,
      actionHash: result.actionHash,
      approvalId,
      recordId: result.recordId,
    },
  });
  publishAction(result, action, sessionId);
  if (approvalId) {
    const approval = await getApprovalRow(approvalId);
    if (approval) hub.publish({ type: "approval.updated", approval: toApprovalDTO(approval) });
  }
  return result;
}

function publishAction(result: ActionDecisionResult, action: ActionRequest, sessionId: string): void {
  hub.publish({
    type: "action.updated",
    action: {
      ...result,
      id: result.recordId ?? result.approvalId ?? "unknown",
      ts: new Date().toISOString(),
      tool: action.tool,
      sessionId,
      args: action.args,
    },
  });
}

export interface DecideResult {
  approval: ReturnType<typeof toApprovalDTO>;
  action: ActionRequest;
  target: "safe" | "original";
  execution: ExecuteResult | null;
}

/**
 * A human decision re-checks the bound hash, revalidates the action through
 * the full pipeline, and only then executes. Any drift aborts with 409.
 */
export async function decideApproval(input: {
  approvalId: string;
  decision: "approve" | "reject";
  target?: "safe" | "original";
  presentedHash?: string;
  userId: string;
}): Promise<DecideResult> {
  const row = await getApprovalRow(input.approvalId);
  if (!row) throw new ApprovalError("Approval not found", 404);
  if (row.status !== "pending") throw new ApprovalError(`Approval is already ${row.status}`, 409);
  if (approvalExpired(row)) {
    await prisma.approval.update({ where: { id: row.id }, data: { status: "expired" } });
    throw new ApprovalError("Approval expired. Start the action again.", 409);
  }

  const target = input.target ?? (row.safeActionJson ? "safe" : "original");
  const chosen = approvalTarget(row, target);
  if (!chosen) throw new ApprovalError("The selected action is not available on this approval", 409);
  if (chosen.hash !== storedHash(row, target)) {
    throw new ApprovalError("Action hash does not match this approval", 409);
  }
  if (input.presentedHash && input.presentedHash !== chosen.hash) {
    throw new ApprovalError("The action changed since the card was shown. Request a fresh approval.", 409);
  }
  if (chosen.isSafe && safeRevalidationDecision(row) === "BLOCK") {
    throw new ApprovalError("The safe version revalidated as BLOCKED and cannot be approved.", 409);
  }

  if (input.decision === "reject") {
    const rejected = await prisma.approval.update({
      where: { id: row.id },
      data: { status: "rejected", decidedBy: input.userId, decidedAt: new Date() },
    });
    await appendControlAudit({
      actorType: "user",
      action: "approval.rejected",
      summary: `Human rejected ${row.tool}`,
      detail: { approvalId: row.id, target, actionHash: chosen.hash, userId: input.userId },
    });
    hub.publish({ type: "approval.updated", approval: toApprovalDTO(rejected) });
    return { approval: toApprovalDTO(rejected), action: chosen.action, target, execution: null };
  }

  const db = await openSandbox();

  // Baseline deliberately skips the preview/pipeline. It exists to show the
  // difference, and still executes inside the sandbox only.
  if (row.mode !== "baseline") {
    const state = await getSessionState(chosen.action.agentId, chosen.action.sessionId ?? `adhoc-${chosen.action.agentId}`);
    const contract = await missionRules(chosen.action.missionId);
    const freshPreview = previewSandboxAction(db, chosen.action.tool, chosen.action.args);
    const revalidation = evaluateRisk({
      tool: chosen.action.tool,
      args: chosen.action.args,
      kind: classifyAction(chosen.action.tool),
      session: sessionFacts(state),
      preview: freshPreview,
      contract,
    });
    if (revalidation.decision === "BLOCK") {
      throw new ApprovalError(`Revalidation blocked execution: ${revalidation.reasons.join(" ")}`, 409);
    }

    const storedPreview = row.preview as unknown as ImpactPreview | null;
    const freshRows = expectedRows(chosen.action.tool, freshPreview);
    const storedRows = expectedRows(chosen.action.tool, storedPreview);
    if (!chosen.isSafe && storedPreview && storedRows !== freshRows) {
      throw new ApprovalError(
        `Impact changed since approval: card said ${storedRows ?? "unknown"}, sandbox now reports ${freshRows ?? "unknown"}.`,
        409,
      );
    }

    const verified = executeVerified(db, chosen.action.tool, chosen.action.args, freshRows);
    if (!verified.ok) {
      throw new ApprovalError(verified.reason ?? "Execution aborted after preview mismatch", 409);
    }
    saveSandbox();
    const updated = await prisma.approval.update({
      where: { id: row.id },
      data: {
        status: "approved",
        decidedBy: input.userId,
        decidedAt: new Date(),
        execution: verified.result as object,
      },
    });
    await prisma.actionRecord.updateMany({
      where: { approvalId: row.id },
      data: { execution: verified.result as object, executedAt: new Date() },
    });
    await appendControlAudit({
      actorType: "user",
      action: "approval.approved",
      summary: `Human approved ${chosen.isSafe ? "safe version of " : ""}${row.tool}`,
      detail: {
        approvalId: row.id,
        target,
        actionHash: chosen.hash,
        affectedRows: verified.result?.affectedRows ?? 0,
        userId: input.userId,
      },
    });
    hub.publish({ type: "approval.updated", approval: toApprovalDTO(updated) });
    hub.publish({ type: "proof.updated", asOf: new Date().toISOString() });
    return { approval: toApprovalDTO(updated), action: chosen.action, target, execution: verified.result };
  }

  const execution = executeSandboxTool(db, chosen.action.tool, chosen.action.args);
  saveSandbox();
  const updated = await prisma.approval.update({
    where: { id: row.id },
    data: { status: "approved", decidedBy: input.userId, decidedAt: new Date(), execution: execution as object },
  });
  await prisma.actionRecord.updateMany({
    where: { approvalId: row.id },
    data: { execution: execution as object, executedAt: new Date() },
  });
  await appendControlAudit({
    actorType: "user",
    action: "approval.approved",
    summary: `Baseline human approved ${row.tool}`,
    detail: { approvalId: row.id, target, actionHash: chosen.hash, userId: input.userId },
  });
  hub.publish({ type: "approval.updated", approval: toApprovalDTO(updated) });
  hub.publish({ type: "proof.updated", asOf: new Date().toISOString() });
  return { approval: toApprovalDTO(updated), action: chosen.action, target, execution };
}

// The stored hash is the source of truth, not a caller-supplied hash.
function storedHash(row: Approval, target: "safe" | "original"): string | null {
  return target === "safe" ? row.safeActionHash : row.actionHash;
}

export { storedHash, proofPane };
