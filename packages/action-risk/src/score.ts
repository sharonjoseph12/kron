import type { ActionKind, ControlDecision, ImpactPreview, RiskFactor } from "@kron/shared";
import { trifectaTriggered, type SessionFacts } from "./session.js";

export interface MissionRules {
  allowedTools: string[];
  deniedTools: string[];
  requiresApproval: string[];
}

export interface RiskInput {
  tool: string;
  args: Record<string, unknown>;
  kind: ActionKind;
  session: SessionFacts;
  preview: ImpactPreview | null;
  contract?: MissionRules | null;
  knownContacts?: Set<string>;
}

export interface RiskResult {
  decision: ControlDecision;
  score: number;
  factors: RiskFactor[];
  reasons: string[];
  forcedHold: boolean;
  hardBlocked: boolean;
}

function band(score: number): ControlDecision {
  if (score >= 80) return "BLOCK";
  if (score >= 60) return "HOLD";
  if (score >= 30) return "FLAG";
  return "ALLOW";
}

function severityPoints(kind: ActionKind): number {
  switch (kind) {
    case "delete": return 30;
    case "send": return 20;
    case "write": return 15;
    case "pay": return 10;
    case "read": return 0;
    default: return 0;
  }
}

function irreversibilityPoints(kind: ActionKind, preview: ImpactPreview | null, tool: string, args: Record<string, unknown>): number {
  if (tool === "db.drop_table") return 15;
  if (kind === "delete") return preview?.recoverable === true || args.soft === true ? 0 : 15;
  if (kind === "send") return args.attachment ? 15 : 5;
  if (kind === "write") return 5;
  if (kind === "pay") return 5;
  return 0;
}

/** Hard BLOCK rules run before anything can be approved. */
export function hardBlockReason(tool: string, args: Record<string, unknown>, contract?: MissionRules | null): string | null {
  if (tool === "db.drop_table" || tool === "db.truncate") {
    return "DROP/TRUNCATE permanently removes a table. KRON never allows schema destruction.";
  }
  if (contract?.deniedTools?.includes(tool)) {
    return `Tool "${tool}" is denied by this mission contract.`;
  }
  const recipient = typeof args.to === "string" ? args.to.toLowerCase() : "";
  if (recipient.endsWith("@blocked.example")) {
    return `Recipient ${recipient} is on the sandbox blocklist.`;
  }
  return null;
}

export function contractDrift(tool: string, contract?: MissionRules | null): string | null {
  if (!contract) return null;
  if (contract.allowedTools.length === 0) return null;
  const exact = contract.allowedTools.includes(tool);
  const prefix = contract.allowedTools.some((pattern) => pattern.endsWith("*") && tool.startsWith(pattern.slice(0, -1)));
  if (exact || prefix) return null;
  return `Tool "${tool}" is outside the mission contract.`;
}

export function evaluateRisk(input: RiskInput): RiskResult {
  const { tool, args, kind, session, preview, contract } = input;
  const factors: RiskFactor[] = [];
  const reasons: string[] = [];

  const hard = hardBlockReason(tool, args, contract);
  if (hard) {
    return {
      decision: "BLOCK",
      score: 100,
      factors: [{ code: "hard_rule", label: hard, points: 100 }],
      reasons: [hard],
      forcedHold: false,
      hardBlocked: true,
    };
  }

  const severity = severityPoints(kind);
  if (severity > 0) {
    factors.push({ code: "severity", label: `${kind} action severity`, points: severity });
    reasons.push(`${kind.toUpperCase()} actions carry ${severity} severity points.`);
  }

  const sensitivity =
    preview?.fileSensitivity === "customer-confidential" ||
    preview?.fileSensitivity === "internal" ||
    (preview?.sensitiveRows ?? 0) > 0
      ? 20
      : 0;
  if (sensitivity > 0) {
    factors.push({ code: "sensitivity", label: "Private or sensitive data", points: sensitivity });
    reasons.push(
      preview?.fileSensitivity
        ? `The target file is tagged ${preview.fileSensitivity}.`
        : `${preview?.sensitiveRows ?? 0} affected rows belong to customers with open shipments.`,
    );
  }

  const irreversibility = irreversibilityPoints(kind, preview, tool, args);
  if (irreversibility > 0) {
    factors.push({ code: "irreversibility", label: "Not recoverable", points: irreversibility });
    if (kind === "delete" || tool === "db.drop_table") reasons.push("The destructive action is not recoverable.");
    else if (kind === "send") reasons.push(args.attachment ? "The email carries an attachment that cannot be recalled." : "A sent email cannot be recalled.");
  }

  if (session.tainted) {
    factors.push({ code: "untrusted", label: "Untrusted content in session", points: 20, detail: session.taintSource ?? undefined });
    reasons.push(`Untrusted content entered this session${session.taintSource ? ` (${session.taintSource})` : ""}.`);
  }

  const drift = contractDrift(tool, contract);
  if (drift) {
    factors.push({ code: "contract_drift", label: "Mission contract drift", points: 15 });
    reasons.push(drift);
  }

  const score = Math.min(100, factors.reduce((sum, f) => sum + f.points, 0));
  let decision = band(score);

  const trifecta = trifectaTriggered({ session, kind, recipientKnown: preview?.recipientKnown });
  const requiresApproval = Boolean(contract?.requiresApproval?.includes(tool));
  if (trifecta) {
    reasons.unshift("Lethal trifecta: untrusted content + private data + new outside recipient in the same session.");
    if (decision === "ALLOW" || decision === "FLAG") decision = "HOLD";
  }
  if (requiresApproval) {
    reasons.push(`Mission contract requires human approval for "${tool}".`);
    if (decision === "ALLOW" || decision === "FLAG") decision = "HOLD";
  }

  if (decision === "ALLOW") reasons.push("No hard rule or risk threshold was crossed.");
  if (decision === "FLAG") reasons.push("Action is allowed but flagged for the operator.");
  if (decision === "HOLD") reasons.push("Human approval is required before this action can execute.");
  if (decision === "BLOCK") reasons.push("Risk is too high to approve; this action is blocked outright.");

  return {
    decision,
    score,
    factors,
    reasons,
    forcedHold: trifecta || requiresApproval,
    hardBlocked: false,
  };
}

export function reasonsForCard(result: RiskResult): string[] {
  return [...result.reasons];
}
