/**
 * PS 2.1 control-plane types. These are deliberately framework-agnostic:
 * the generic gateway, the dashboard, the phone card and the scenario runner
 * all speak the same action vocabulary.
 */

export type ActionKind = "read" | "write" | "delete" | "send" | "pay";

/** LLM-style decision bands. Rules may raise these, never lower them. */
export type ControlDecision = "ALLOW" | "FLAG" | "HOLD" | "BLOCK";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type ControlMode = "kron" | "baseline";

export interface ActionRequest {
  agentId: string;
  sessionId?: string;
  missionId?: string;
  tool: string;
  args: Record<string, unknown>;
  /** Added by the gateway before hashing/approval. */
  nonce?: string;
}

export interface RiskFactor {
  code: string;
  label: string;
  points: number;
  detail?: string;
}

export interface ActionRuleHit {
  rule: string;
  description: string;
  severity: "info" | "warn" | "block";
}

export interface ImpactPreview {
  kind: ActionKind;
  summary: string;
  /** Human-readable, stable fields rendered by the approval card. */
  details: Record<string, string | number | boolean | null>;
  rowsAffected?: number;
  sensitiveRows?: number;
  /** Rows that are currently live (not archived) for delete/update previews. */
  matchedActiveRows?: number;
  recoverable?: boolean;
  recipient?: string;
  recipientKnown?: boolean;
  filePath?: string;
  fileSensitivity?: string;
  amountAlgo?: number;
  limitAlgo?: number;
  /**
   * SHA-256 over the exact rows/recipient/file the preview observed. The
   * approval binds this, so a concurrent data change with the same row count
   * is still detected as stale.
   */
  fingerprint?: string;
  asOf: string;
}

export interface SafeVersion {
  action: ActionRequest;
  label: string;
  /** Explicit "alternative, not an equivalent" differences. */
  differences: string[];
  /** Real preview of the safe action, computed before it is shown. */
  preview?: ImpactPreview | null;
  revalidation: {
    decision: ControlDecision;
    riskScore: number;
    reasons: string[];
  };
}

export interface ActionDecisionResult {
  decision: ControlDecision;
  kind: ActionKind;
  riskScore: number;
  reasons: string[];
  ruleHits: ActionRuleHit[];
  factors: RiskFactor[];
  preview: ImpactPreview | null;
  safeVersion: SafeVersion | null;
  approvalId: string | null;
  actionHash: string | null;
  mode: ControlMode;
  recordId: string | null;
  /** Capability grant consumed by the adapter when the tool actually ran. */
  grantId?: string | null;
  /** Durable proof-of-enforcement artifact for this decision. */
  receiptId?: string | null;
  execution?: {
    ok: boolean;
    summary: string;
    affectedRows: number;
    detail: Record<string, unknown>;
  } | null;
}

export interface ActionSessionStateDTO {
  sessionId: string;
  agentId: string;
  tainted: boolean;
  sensitiveRead: boolean;
  taintSource: string | null;
  sensitiveSource: string | null;
  updatedAt: string;
}

export interface ApprovalDTO {
  id: string;
  mode: ControlMode;
  status: ApprovalStatus;
  agentId: string;
  sessionId: string | null;
  missionId: string | null;
  tool: string;
  actionJson: Record<string, unknown>;
  actionHash: string;
  safeActionJson: Record<string, unknown> | null;
  safeActionHash: string | null;
  safeLabel: string | null;
  differences: string[];
  preview: ImpactPreview | null;
  previewFingerprint: string | null;
  safePreview: ImpactPreview | null;
  safePreviewFingerprint: string | null;
  reasons: string[];
  riskScore: number;
  decision: ControlDecision;
  createdAt: string;
  expiresAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  phoneUrl: string | null;
}

/** Compact state of the sandbox at one point in time. */
export interface ProofSnapshot {
  capturedAt: string;
  totalMessages: number;
  outbound: number;
  inbound: number;
  attackerMessages: number;
  ordersTotal: number;
  ordersActive: number;
  ordersArchived: number;
  sensitiveActive: number;
  pending: number;
  shipped: number;
  cancelled: number;
  files: number;
}

export type ReceiptStatus = "executed" | "blocked" | "held" | "rejected";

export interface DriftInfo {
  kind: "impact_drift";
  message: string;
  expectedRows: number | null;
  actualRows: number | null;
  expectedFingerprint: string | null;
  actualFingerprint: string | null;
}

export interface CapabilityGrantDTO {
  id: string;
  agentId: string;
  sessionId: string | null;
  approvalId: string | null;
  tool: string;
  kind: string;
  actionHash: string;
  status: "active" | "consumed" | "revoked" | "expired";
  maxUses: number;
  useCount: number;
  scope: Record<string, unknown>;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export interface EnforcementReceiptDTO {
  id: string;
  seq: number;
  actionRecordId: string | null;
  approvalId: string | null;
  grantId: string | null;
  actionHash: string;
  tool: string;
  agentId: string;
  sessionId: string | null;
  decision: ControlDecision;
  status: ReceiptStatus;
  toolInvoked: boolean;
  summary: string;
  actionJson: Record<string, unknown> | null;
  before: ProofSnapshot;
  after: ProofSnapshot;
  approval: {
    id: string;
    status: string;
    target: string | null;
    actionHash: string;
    decidedBy: string | null;
  } | null;
  grant: {
    id: string;
    status: string;
    actionHash: string;
    consumedAt: string | null;
  } | null;
  drift: DriftInfo | null;
  executedAt: string | null;
  prevHash: string;
  hash: string;
  createdAt: string;
}

export interface ReceiptVerifyResult {
  ok: boolean;
  checked: number;
  headHash: string | null;
  firstBroken: { id: string; seq: number; reason: string } | null;
}

export interface DriftProofDTO {
  previewRows: number;
  freshRows: number;
  changedRows: number;
  staleStatus: number;
  staleError: string;
  staleReceiptId: string | null;
  toolInvoked: boolean;
  archivedAfterStale: number;
  pendingAfterStale: number;
  archivedAfterFresh: number;
  pendingAfterFresh: number;
  activeAfterFresh: number;
  freshApprovalId: string | null;
  freshExecutedRows: number;
  fingerprintBefore: string | null;
  fingerprintAfter: string | null;
  steps: Array<{ label: string; detail: string }>;
}

export interface ProofPaneDTO {
  asOf: string;
  mail: {
    total: number;
    outbound: number;
    inbound: number;
    attackerMessages: number;
    attackerAddress: string;
    messages: Array<{
      id: string;
      direction: "inbound" | "outbound";
      from: string;
      to: string;
      subject: string;
      attachment: string | null;
      createdAt: string;
    }>;
  };
  orders: {
    total: number;
    active: number;
    archived: number;
    sensitiveActive: number;
    openShipments: number;
    pending: number;
    shipped: number;
    cancelled: number;
  };
  files: Array<{ path: string; sensitivity: string }>;
}

export interface AuditChainEntryDTO {
  id: string;
  seq: number;
  ts: string;
  actorType: "user" | "system" | "agent";
  action: string;
  summary: string;
  detail: Record<string, unknown> | null;
  prevHash: string;
  hash: string;
}

export interface AuditVerifyResult {
  ok: boolean;
  checked: number;
  headHash: string | null;
  firstBroken: { id: string; seq: number; reason: string } | null;
  entries: AuditChainEntryDTO[];
}
