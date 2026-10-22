/**
 * Generic action gateway (FR-1). This is the single path every non-payment
 * tool call goes through:
 *
 *   classify → hard rules → real impact preview → risk score → safe rewrite
 *   → revalidate safe version → ALLOW/FLAG execute, HOLD create approval,
 *     BLOCK never executes.
 *
 * Every actual tool invocation goes through the capability adapter: a
 * one-shot grant bound to the canonical action hash must be consumed first.
 * Every decision produces a hash-chained enforcement receipt.
 *
 * Everything is deterministic and in-process. No model or network is used.
 */
import type {
  ActionDecisionResult,
  ActionRequest,
  ActionRuleHit,
  ActionSessionStateDTO,
  ApprovalDTO,
  ControlDecision,
  ControlMode,
  DriftInfo,
  ImpactPreview,
  ProofSnapshot,
  SafeVersion,
} from "@kron/shared";
import { classifyAction, evaluateRisk, type MissionRules, type SessionFacts } from "@kron/action-risk";
import { actionHash, proposeSafeVersion } from "@kron/safe-rewrite";
import {
  fileRow,
  openSandbox,
  previewFingerprint,
  previewSandboxAction,
  proofPane,
  proofSnapshot,
  saveSandbox,
  INTERNAL_OWNER,
  type ExecuteResult,
} from "@kron/business-tools";
import type { Approval, Mission } from "@prisma/client";
import { prisma } from "../db.js";
import { hub } from "../events/hub.js";
import { appendControlAudit } from "./control-audit.js";
import { appendReceipt } from "./control-receipts.js";
import { getSessionState, markSessionTainted, markSensitiveRead } from "./control-session.js";
import {
  approvalExpired,
  approvalTarget,
  createApproval,
  getApprovalRow,
  safeRevalidationDecision,
  toApprovalDTO,
} from "./control-approvals.js";
import type { CapabilityGrantDTO } from "@kron/shared";
import { runToolWithGrant, ToolInvocationError } from "./tool-adapter.js";

export interface EvaluateOptions {
  mode?: ControlMode;
  /** Do not create approval rows (used for safe-version revalidation). */
  approval?: boolean;
}

export class ApprovalError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown> | null;

  constructor(
    message: string,
    statusCode = 409,
    code = "approval_conflict",
    details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const READ_TOOLS = new Set(["email.read", "files.read", "orders.read", "files.list"]);

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
  grantId?: string | null;
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
      grantId: input.grantId ?? null,
      mode: input.mode,
      execution: input.execution ? (input.execution as object) : undefined,
      executedAt: input.execution ? new Date() : null,
    },
  });
  return row.id;
}

async function attachReceipt(input: {
  recordId: string;
  action: ActionRequest;
  actionHash: string;
  sessionId: string;
  decision: ControlDecision;
  status: "executed" | "blocked" | "held";
  toolInvoked: boolean;
  summary: string;
  before: ProofSnapshot;
  after: ProofSnapshot;
  approvalId?: string | null;
  approval?: ApprovalDTO | null;
  grant?: CapabilityGrantDTO | null;
  drift?: DriftInfo | null;
  executedAt?: Date | null;
}): Promise<string> {
  const receipt = await appendReceipt({
    actionRecordId: input.recordId,
    approvalId: input.approvalId ?? null,
    grantId: input.grant?.id ?? null,
    actionHash: input.actionHash,
    tool: input.action.tool,
    agentId: input.action.agentId,
    sessionId: input.sessionId,
    decision: input.decision,
    status: input.status,
    toolInvoked: input.toolInvoked,
    summary: input.summary,
    actionJson: input.action as unknown as Record<string, unknown>,
    before: input.before,
    after: input.after,
    approval: input.approval
      ? {
          id: input.approval.id,
          status: input.approval.status,
          target: null,
          actionHash: input.approval.actionHash,
          decidedBy: null,
        }
      : null,
    grant: input.grant
      ? {
          id: input.grant.id,
          status: input.grant.status,
          actionHash: input.grant.actionHash,
          consumedAt: input.grant.consumedAt,
        }
      : null,
    drift: input.drift ?? null,
    executedAt: input.executedAt ?? null,
  });

  await prisma.actionRecord.update({
    where: { id: input.recordId },
    data: { receiptId: receipt.id, grantId: input.grant?.id ?? null },
  });
  return receipt.id;
}

async function readSideEffects(
  db: Awaited<ReturnType<typeof openSandbox>>,
  action: ActionRequest,
  hash: string,
): Promise<{ result: ExecuteResult; grant: CapabilityGrantDTO } | null> {
  if (!READ_TOOLS.has(action.tool)) return null;

  const { result, grant } = await runToolWithGrant({
    db,
    tool: action.tool,
    args: action.args,
    agentId: action.agentId,
    sessionId: action.sessionId ?? null,
    kind: "read",
    actionHash: hash,
    expectedRows: null,
    verified: false,
    reason: "read",
  });

  if (action.tool === "email.read") {
    const body = String(result.detail.body ?? "");
    if (SUSPICIOUS_CONTENT.test(body)) {
      await markSessionTainted(
        action.agentId,
        action.sessionId ?? `adhoc-${action.agentId}`,
        `email.read:${String(result.detail.id ?? action.args.id ?? "unknown")}`,
      );
    }
  }
  if (action.tool === "files.read") {
    const path = String(action.args.path ?? "");
    const file = fileRow(db, path);
    if (file && file.sensitivity !== "public") {
      await markSensitiveRead(action.agentId, action.sessionId ?? `adhoc-${action.agentId}`, `files.read:${file.path}`);
    }
  }
  return { result, grant };
}

function driftFor(input: {
  storedPreview: ImpactPreview | null;
  freshPreview: ImpactPreview | null;
  storedFingerprint: string | null;
  freshFingerprint: string | null;
}): DriftInfo | null {
  const storedRows = input.storedPreview?.rowsAffected ?? null;
  const freshRows = input.freshPreview?.rowsAffected ?? null;
  const rowsChanged = storedRows != null && freshRows != null && storedRows !== freshRows;
  const fingerprintChanged =
    input.storedFingerprint != null &&
    input.freshFingerprint != null &&
    input.storedFingerprint !== input.freshFingerprint;

  if (!rowsChanged && !fingerprintChanged) return null;

  const message = rowsChanged
    ? `The sandbox changed after this card was previewed: the card said ${storedRows} row(s), the live data now has ${freshRows}. The dataset fingerprint also changed. Nothing executed.`
    : `The live rows changed after this card was previewed even though the row count stayed at ${freshRows ?? "the same"}. The dataset fingerprint changed. Nothing executed.`;

  return {
    kind: "impact_drift",
    message,
    expectedRows: storedRows,
    actualRows: freshRows,
    expectedFingerprint: input.storedFingerprint,
    actualFingerprint: input.freshFingerprint,
  };
}

export async function evaluateAction(input: ActionRequest, opts: EvaluateOptions = {}): Promise<ActionDecisionResult> {
  const mode: ControlMode = opts.mode ?? "kron";
  const action: ActionRequest = {
    ...input,
    nonce: input.nonce ?? `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  };
  const sessionId = action.sessionId ?? `adhoc-${action.agentId}`;
  action.sessionId = sessionId;
  const hash = actionHash(action);

  const db = await openSandbox();
  const state = await getSessionState(action.agentId, sessionId);
  const kind = classifyAction(action.tool);

  // Reads execute immediately, but through the same capability adapter, and
  // can leave session facts behind.
  if (kind === "read") {
    const before = proofSnapshot(db);
    const read = await readSideEffects(db, action, hash);
    const after = read ? proofSnapshot(db) : before;
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
      grantId: read?.grant.id ?? null,
      execution: read?.result ?? null,
    });
    const receiptId = read
      ? await attachReceipt({
          recordId,
          action,
          actionHash: hash,
          sessionId,
          decision: "ALLOW",
          status: "executed",
          toolInvoked: true,
          summary: read.result.summary,
          before,
          after,
          grant: read.grant,
          executedAt: new Date(),
        })
      : null;
    await appendControlAudit({
      actorType: "agent",
      action: "action.read",
      summary: `Agent read via ${action.tool}`,
      detail: { tool: action.tool, sessionId, recordId, grantId: read?.grant.id ?? null, receiptId },
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
      actionHash: hash,
      mode,
      recordId,
      grantId: read?.grant.id ?? null,
      receiptId,
      execution: read
        ? { ok: true, summary: read.result.summary, affectedRows: read.result.affectedRows, detail: read.result.detail }
        : null,
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
    const before = proofSnapshot(db);
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
      actionHash: hash,
      mode,
      recordId: null,
      grantId: null,
      receiptId: null,
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
    result.receiptId = await attachReceipt({
      recordId,
      action,
      actionHash: hash,
      sessionId,
      decision: "HOLD",
      status: "held",
      toolInvoked: false,
      summary: "Baseline held the raw action for approval.",
      before,
      after: before,
      approvalId: approval?.id ?? null,
      approval,
    });
    await appendControlAudit({
      actorType: "agent",
      action: "action.held",
      summary: `Baseline held ${action.tool} for approval`,
      detail: { tool: action.tool, sessionId, approvalId: result.approvalId, recordId, receiptId: result.receiptId },
    });
    publishAction(result, action, sessionId);
    return result;
  }

  let preview: ImpactPreview | null = null;
  try {
    preview = previewSandboxAction(db, action.tool, action.args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const before = proofSnapshot(db);
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
      actionHash: hash,
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
    result.receiptId = await attachReceipt({
      recordId: result.recordId,
      action,
      actionHash: hash,
      sessionId,
      decision: "BLOCK",
      status: "blocked",
      toolInvoked: false,
      summary: result.reasons[0] ?? "Preview failed.",
      before,
      after: before,
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
  let safePreview: ImpactPreview | null = null;
  if (risk.decision === "HOLD") {
    const proposed = proposeSafeVersion({
      action,
      kind,
      preview,
      internalOwner: INTERNAL_OWNER,
      perCallLimitAlgo: 0.1,
    });
    if (proposed) {
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
        preview: safePreview,
        revalidation: {
          decision: safeRisk.decision,
          riskScore: safeRisk.score,
          reasons: safeRisk.reasons,
        },
      };
    }
  }

  let approvalId: string | null = null;
  let approvalDto: ApprovalDTO | null = null;
  if (risk.decision === "HOLD" && opts.approval !== false) {
    approvalDto = await createApproval({
      mode,
      action,
      safe,
      preview,
      previewFingerprint: preview?.fingerprint ?? null,
      safePreview,
      safePreviewFingerprint: safePreview?.fingerprint ?? null,
      reasons: risk.reasons,
      riskScore: risk.score,
      decision: risk.decision,
    });
    approvalId = approvalDto.id;
  }

  const before = proofSnapshot(db);
  let execution: ExecuteResult | null = null;
  let grant: CapabilityGrantDTO | null = null;
  let finalDecision = risk.decision;
  const reasons = [...risk.reasons];
  const ruleHits = [...ruleHitsFromPreview(preview)];

  // Low-risk actions execute only after the same verified preview check used
  // by the approval path. A mismatch aborts instead of mutating.
  if (finalDecision === "ALLOW" || finalDecision === "FLAG") {
    try {
      const invoked = await runToolWithGrant({
        db,
        tool: action.tool,
        args: action.args,
        agentId: action.agentId,
        sessionId,
        kind,
        actionHash: hash,
        expectedRows: expectedRows(action.tool, preview),
        verified: true,
        reason: `auto:${finalDecision.toLowerCase()}`,
      });
      execution = invoked.result;
      grant = invoked.grant;
      saveSandbox();
    } catch (err) {
      if (err instanceof ToolInvocationError) {
        finalDecision = "BLOCK";
        reasons.unshift(err.message);
        ruleHits.push({ rule: "preview_mismatch", description: err.message, severity: "block" });
      } else {
        throw err;
      }
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
    actionHash: hash,
    mode,
    recordId: null,
    grantId: grant?.id ?? null,
    receiptId: null,
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
    grantId: grant?.id ?? null,
    execution,
  });

  const receiptStatus = execution ? "executed" : finalDecision === "HOLD" ? "held" : "blocked";
  result.receiptId = await attachReceipt({
    recordId: result.recordId,
    action,
    actionHash: hash,
    sessionId,
    decision: result.decision,
    status: receiptStatus,
    toolInvoked: Boolean(execution),
    summary: execution?.summary ?? result.reasons[0] ?? `Action ${result.decision}`,
    before,
    after: execution ? proofSnapshot(db) : before,
    approvalId,
    approval: approvalDto,
    grant,
    executedAt: execution ? new Date() : null,
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
      receiptId: result.receiptId,
      grantId: result.grantId,
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
  grantId?: string | null;
  receiptId?: string | null;
}

/**
 * A human decision re-checks the bound hash, revalidates the action through
 * the full pipeline, and only then executes. Any drift aborts with 409 and
 * produces a receipt that proves the tool was never invoked.
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
    throw new ApprovalError("Approval expired. Start the action again.", 409, "approval_expired");
  }

  const target = input.target ?? (row.safeActionJson ? "safe" : "original");
  const chosen = approvalTarget(row, target);
  if (!chosen) throw new ApprovalError("The selected action is not available on this approval", 409);
  if (chosen.hash !== storedHash(row, target)) {
    throw new ApprovalError("Action hash does not match this approval", 409, "hash_mismatch");
  }
  if (input.presentedHash && input.presentedHash !== chosen.hash) {
    throw new ApprovalError(
      "The action changed since the card was shown. Request a fresh approval.",
      409,
      "hash_mismatch",
    );
  }
  if (chosen.isSafe && safeRevalidationDecision(row) === "BLOCK") {
    throw new ApprovalError("The safe version revalidated as BLOCKED and cannot be approved.", 409, "safe_blocked");
  }

  const db = await openSandbox();

  if (input.decision === "reject") {
    const before = proofSnapshot(db);
    const rejected = await prisma.approval.update({
      where: { id: row.id },
      data: { status: "rejected", decidedBy: input.userId, decidedAt: new Date() },
    });
    const receipt = await appendReceipt({
      approvalId: row.id,
      actionHash: chosen.hash,
      tool: row.tool,
      agentId: row.agentId,
      sessionId: row.sessionId,
      decision: row.decision as ControlDecision,
      status: "rejected",
      toolInvoked: false,
      summary: `Human rejected ${row.tool}. Nothing executed.`,
      actionJson: chosen.action as unknown as Record<string, unknown>,
      before,
      after: before,
      approval: {
        id: row.id,
        status: "rejected",
        target,
        actionHash: chosen.hash,
        decidedBy: input.userId,
      },
    });
    await appendControlAudit({
      actorType: "user",
      action: "approval.rejected",
      summary: `Human rejected ${row.tool}`,
      detail: { approvalId: row.id, target, actionHash: chosen.hash, userId: input.userId, receiptId: receipt.id },
    });
    hub.publish({ type: "approval.updated", approval: toApprovalDTO(rejected) });
    return {
      approval: toApprovalDTO(rejected),
      action: chosen.action,
      target,
      execution: null,
      receiptId: receipt.id,
    };
  }

  // Baseline deliberately skips the preview/pipeline. It exists to show the
  // difference, and still executes inside the sandbox only.
  if (row.mode === "baseline") {
    const before = proofSnapshot(db);
    const invoked = await runToolWithGrant({
      db,
      tool: chosen.action.tool,
      args: chosen.action.args,
      agentId: chosen.action.agentId,
      sessionId: chosen.action.sessionId ?? `adhoc-${chosen.action.agentId}`,
      kind: classifyAction(chosen.action.tool),
      actionHash: chosen.hash,
      approvalId: row.id,
      expectedRows: null,
      verified: false,
      reason: "approval:baseline",
    });
    saveSandbox();
    const updated = await prisma.approval.update({
      where: { id: row.id },
      data: {
        status: "approved",
        decidedBy: input.userId,
        decidedAt: new Date(),
        execution: invoked.result as object,
      },
    });
    await prisma.actionRecord.updateMany({
      where: { approvalId: row.id },
      data: { execution: invoked.result as object, executedAt: new Date(), grantId: invoked.grant.id },
    });
    const receipt = await appendReceipt({
      approvalId: row.id,
      grantId: invoked.grant.id,
      actionHash: chosen.hash,
      tool: row.tool,
      agentId: row.agentId,
      sessionId: row.sessionId,
      decision: row.decision as ControlDecision,
      status: "executed",
      toolInvoked: true,
      summary: invoked.result.summary,
      actionJson: chosen.action as unknown as Record<string, unknown>,
      before,
      after: proofSnapshot(db),
      approval: {
        id: row.id,
        status: "approved",
        target,
        actionHash: chosen.hash,
        decidedBy: input.userId,
      },
      grant: {
        id: invoked.grant.id,
        status: invoked.grant.status,
        actionHash: invoked.grant.actionHash,
        consumedAt: invoked.grant.consumedAt,
      },
      executedAt: new Date(),
    });
    await appendControlAudit({
      actorType: "user",
      action: "approval.approved",
      summary: `Baseline human approved ${row.tool}`,
      detail: {
        approvalId: row.id,
        target,
        actionHash: chosen.hash,
        userId: input.userId,
        receiptId: receipt.id,
        grantId: invoked.grant.id,
      },
    });
    hub.publish({ type: "approval.updated", approval: toApprovalDTO(updated) });
    hub.publish({ type: "proof.updated", asOf: new Date().toISOString() });
    return {
      approval: toApprovalDTO(updated),
      action: chosen.action,
      target,
      execution: invoked.result,
      grantId: invoked.grant.id,
      receiptId: receipt.id,
    };
  }

  const state = await getSessionState(chosen.action.agentId, chosen.action.sessionId ?? `adhoc-${chosen.action.agentId}`);
  const contract = await missionRules(chosen.action.missionId);
  const freshPreview = previewSandboxAction(db, chosen.action.tool, chosen.action.args);
  const freshFingerprint =
    previewFingerprint(db, chosen.action.tool, chosen.action.args) ?? freshPreview?.fingerprint ?? null;
  const revalidation = evaluateRisk({
    tool: chosen.action.tool,
    args: chosen.action.args,
    kind: classifyAction(chosen.action.tool),
    session: sessionFacts(state),
    preview: freshPreview,
    contract,
  });
  if (revalidation.decision === "BLOCK") {
    throw new ApprovalError(
      `Revalidation blocked execution: ${revalidation.reasons.join(" ")}`,
      409,
      "revalidation_blocked",
    );
  }

  const storedPreview =
    target === "safe"
      ? ((row.safePreview as unknown as ImpactPreview | null) ?? null)
      : ((row.preview as unknown as ImpactPreview | null) ?? null);
  const storedFingerprint = target === "safe" ? row.safePreviewFingerprint : row.previewFingerprint;
  const drift = driftFor({ storedPreview, freshPreview, storedFingerprint, freshFingerprint });

  if (drift) {
    const before = proofSnapshot(db);
    const expired = await prisma.approval.update({
      where: { id: row.id },
      data: {
        status: "expired",
        decidedBy: input.userId,
        decidedAt: new Date(),
        execution: { status: "blocked", drift } as object,
      },
    });
    const receipt = await appendReceipt({
      approvalId: row.id,
      actionHash: chosen.hash,
      tool: row.tool,
      agentId: row.agentId,
      sessionId: row.sessionId,
      decision: row.decision as ControlDecision,
      status: "blocked",
      toolInvoked: false,
      summary: drift.message,
      actionJson: chosen.action as unknown as Record<string, unknown>,
      before,
      after: before,
      approval: {
        id: row.id,
        status: "expired",
        target,
        actionHash: chosen.hash,
        decidedBy: input.userId,
      },
      drift,
    });
    await appendControlAudit({
      actorType: "system",
      action: "approval.drifted",
      summary: `Stale approval rejected for ${row.tool}; nothing executed`,
      detail: {
        approvalId: row.id,
        target,
        actionHash: chosen.hash,
        expectedRows: drift.expectedRows,
        actualRows: drift.actualRows,
        expectedFingerprint: drift.expectedFingerprint,
        actualFingerprint: drift.actualFingerprint,
        userId: input.userId,
        receiptId: receipt.id,
      },
    });
    hub.publish({ type: "approval.updated", approval: toApprovalDTO(expired) });
    hub.publish({ type: "proof.updated", asOf: new Date().toISOString() });
    throw new ApprovalError(drift.message, 409, "impact_drift", {
      kind: "impact_drift",
      expectedRows: drift.expectedRows,
      actualRows: drift.actualRows,
      expectedFingerprint: drift.expectedFingerprint,
      actualFingerprint: drift.actualFingerprint,
      receiptId: receipt.id,
    });
  }

  const before = proofSnapshot(db);
  const freshRows = expectedRows(chosen.action.tool, freshPreview);
  let invoked: Awaited<ReturnType<typeof runToolWithGrant>>;
  try {
    invoked = await runToolWithGrant({
      db,
      tool: chosen.action.tool,
      args: chosen.action.args,
      agentId: chosen.action.agentId,
      sessionId: chosen.action.sessionId ?? `adhoc-${chosen.action.agentId}`,
      kind: classifyAction(chosen.action.tool),
      actionHash: chosen.hash,
      approvalId: row.id,
      expectedRows: freshRows,
      verified: true,
      reason: "approval:approved",
    });
  } catch (err) {
    if (err instanceof ToolInvocationError) {
      const blocked = proofSnapshot(db);
      const receipt = await appendReceipt({
        approvalId: row.id,
        actionHash: chosen.hash,
        tool: row.tool,
        agentId: row.agentId,
        sessionId: row.sessionId,
        decision: row.decision as ControlDecision,
        status: "blocked",
        toolInvoked: false,
        summary: err.message,
        actionJson: chosen.action as unknown as Record<string, unknown>,
        before,
        after: blocked,
        approval: {
          id: row.id,
          status: "pending",
          target,
          actionHash: chosen.hash,
          decidedBy: input.userId,
        },
      });
      throw new ApprovalError(err.message, 409, err.code, { receiptId: receipt.id });
    }
    throw err;
  }

  saveSandbox();
  const updated = await prisma.approval.update({
    where: { id: row.id },
    data: {
      status: "approved",
      decidedBy: input.userId,
      decidedAt: new Date(),
      execution: invoked.result as object,
    },
  });
  await prisma.actionRecord.updateMany({
    where: { approvalId: row.id },
    data: { execution: invoked.result as object, executedAt: new Date(), grantId: invoked.grant.id },
  });
  const receipt = await appendReceipt({
    approvalId: row.id,
    grantId: invoked.grant.id,
    actionHash: chosen.hash,
    tool: row.tool,
    agentId: row.agentId,
    sessionId: row.sessionId,
    decision: row.decision as ControlDecision,
    status: "executed",
    toolInvoked: true,
    summary: invoked.result.summary,
    actionJson: chosen.action as unknown as Record<string, unknown>,
    before,
    after: proofSnapshot(db),
    approval: {
      id: row.id,
      status: "approved",
      target,
      actionHash: chosen.hash,
      decidedBy: input.userId,
    },
    grant: {
      id: invoked.grant.id,
      status: invoked.grant.status,
      actionHash: invoked.grant.actionHash,
      consumedAt: invoked.grant.consumedAt,
    },
    executedAt: new Date(),
  });
  await appendControlAudit({
    actorType: "user",
    action: "approval.approved",
    summary: `Human approved ${chosen.isSafe ? "safe version of " : ""}${row.tool}`,
    detail: {
      approvalId: row.id,
      target,
      actionHash: chosen.hash,
      affectedRows: invoked.result.affectedRows,
      userId: input.userId,
      receiptId: receipt.id,
      grantId: invoked.grant.id,
    },
  });
  hub.publish({ type: "approval.updated", approval: toApprovalDTO(updated) });
  hub.publish({ type: "proof.updated", asOf: new Date().toISOString() });
  return {
    approval: toApprovalDTO(updated),
    action: chosen.action,
    target,
    execution: invoked.result,
    grantId: invoked.grant.id,
    receiptId: receipt.id,
  };
}

// The stored hash is the source of truth, not a caller-supplied hash.
function storedHash(row: Approval, target: "safe" | "original"): string | null {
  return target === "safe" ? row.safeActionHash : row.actionHash;
}

export { storedHash, proofPane };
