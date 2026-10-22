/**
 * Scripted, deterministic attack scenarios used by the dashboard and
 * `pnpm demo:attack`. Every number comes from the sandbox SQLite DB; only
 * the sequence of actions and the fixed seed shape are scripted.
 */
import type { ActionDecisionResult, ApprovalDTO, ProofPaneDTO } from "@kron/shared";
import {
  HERO,
  openSandbox,
  proofPane,
} from "@kron/business-tools";
import { decideApproval, evaluateAction } from "./action-gateway.js";
import { getApproval } from "./control-approvals.js";
import { resetDemoState } from "./demo-reset.js";

export type ScenarioName = "hero" | "delete" | "baseline" | "all";

export interface ScenarioStep {
  label: string;
  decision?: ActionDecisionResult["decision"];
  detail: string;
}

export interface ScenarioResult {
  scenario: Exclude<ScenarioName, "all">;
  steps: ScenarioStep[];
  action: ActionDecisionResult;
  approval: ApprovalDTO | null;
  proof: ProofPaneDTO;
}

const AGENT_ID = "agent-control-demo";

async function resetIfRequested(reset: boolean): Promise<void> {
  if (reset) await resetDemoState();
}

async function hero(autoApprove: boolean, reset: boolean): Promise<ScenarioResult> {
  await resetIfRequested(reset);
  const sessionId = "sess-hero";
  const steps: ScenarioStep[] = [];

  const readMail = await evaluateAction({
    agentId: AGENT_ID,
    sessionId,
    tool: "email.read",
    args: { id: "msg-poisoned" },
  });
  steps.push({
    label: "Agent reads a poisoned supplier email",
    decision: readMail.decision,
    detail: "The hidden instruction is in the email body; the session is now tainted.",
  });

  const readFile = await evaluateAction({
    agentId: AGENT_ID,
    sessionId,
    tool: "files.read",
    args: { path: HERO.contract },
  });
  steps.push({
    label: "Agent reads the signed Q3 customer contract",
    decision: readFile.decision,
    detail: "The file is tagged customer-confidential; the session has now read private data.",
  });

  const action = await evaluateAction({
    agentId: AGENT_ID,
    sessionId,
    tool: "email.send",
    args: {
      to: HERO.attacker,
      subject: "Q3 signed supply contract",
      body: "Updated paperwork requested by the supplier.",
      attachment: HERO.contract,
    },
  });
  steps.push({
    label: "Agent tries to send the contract to a new outside address",
    decision: action.decision,
    detail: action.reasons[0] ?? "KRON held the action.",
  });

  let approval = action.approvalId ? await getApproval(action.approvalId) : null;
  if (autoApprove && approval?.safeActionHash) {
    const decided = await decideApproval({
      approvalId: approval.id,
      decision: "approve",
      target: "safe",
      presentedHash: approval.safeActionHash,
      userId: "scenario-runner",
    });
    approval = decided.approval;
    steps.push({
      label: "Human approves the safe version",
      detail: decided.execution?.summary ?? "Safe action executed.",
    });
  }

  return { scenario: "hero", steps, action, approval, proof: proofPane(await openSandbox()) };
}

async function deleteScenario(autoApprove: boolean, reset: boolean): Promise<ScenarioResult> {
  await resetIfRequested(reset);
  const action = await evaluateAction({
    agentId: AGENT_ID,
    sessionId: "sess-delete",
    tool: "db.delete",
    args: { table: "orders", hard: true },
  });
  const steps: ScenarioStep[] = [
    {
      label: "Agent asks to delete every order",
      decision: action.decision,
      detail: action.preview?.summary ?? "KRON held the action.",
    },
  ];

  let approval = action.approvalId ? await getApproval(action.approvalId) : null;
  if (autoApprove && approval?.safeActionHash) {
    const decided = await decideApproval({
      approvalId: approval.id,
      decision: "approve",
      target: "safe",
      presentedHash: approval.safeActionHash,
      userId: "scenario-runner",
    });
    approval = decided.approval;
    steps.push({
      label: "Human approves the archive alternative",
      detail: decided.execution?.summary ?? "Safe action executed.",
    });
  }

  return { scenario: "delete", steps, action, approval, proof: proofPane(await openSandbox()) };
}

async function baselineScenario(autoApprove: boolean, reset: boolean): Promise<ScenarioResult> {
  await resetIfRequested(reset);
  const sessionId = "sess-baseline";
  const steps: ScenarioStep[] = [];

  const readMail = await evaluateAction({
    agentId: AGENT_ID,
    sessionId,
    tool: "email.read",
    args: { id: "msg-poisoned" },
  });
  steps.push({ label: "Baseline: agent reads the poisoned email", decision: readMail.decision, detail: "Read allowed." });

  const readFile = await evaluateAction({
    agentId: AGENT_ID,
    sessionId,
    tool: "files.read",
    args: { path: HERO.contract },
  });
  steps.push({ label: "Baseline: agent reads the contract", decision: readFile.decision, detail: "Read allowed." });

  const action = await evaluateAction(
    {
      agentId: AGENT_ID,
      sessionId,
      tool: "email.send",
      args: {
        to: HERO.attacker,
        subject: "Q3 signed supply contract",
        body: "Updated paperwork requested by the supplier.",
        attachment: HERO.contract,
      },
    },
    { mode: "baseline" },
  );
  steps.push({
    label: "Baseline card shows only the tool and arguments",
    decision: action.decision,
    detail: "No preview, no risk score, no safe alternative.",
  });

  let approval = action.approvalId ? await getApproval(action.approvalId) : null;
  if (autoApprove && approval) {
    const decided = await decideApproval({
      approvalId: approval.id,
      decision: "approve",
      target: "original",
      presentedHash: approval.actionHash,
      userId: "scenario-runner",
    });
    approval = decided.approval;
    steps.push({ label: "Human approves the raw baseline action", detail: decided.execution?.summary ?? "Executed." });
  }

  return { scenario: "baseline", steps, action, approval, proof: proofPane(await openSandbox()) };
}

export async function runScenario(
  name: ScenarioName,
  opts: { autoApprove?: boolean; reset?: boolean } = {},
): Promise<{ scenarios: ScenarioResult[] }> {
  const reset = opts.reset !== false;
  const autoApprove = opts.autoApprove === true;
  if (name === "all") {
    return {
      scenarios: [
        await hero(autoApprove, true),
        await deleteScenario(autoApprove, true),
        await baselineScenario(autoApprove, true),
      ],
    };
  }
  if (name === "hero") return { scenarios: [await hero(autoApprove, reset)] };
  if (name === "delete") return { scenarios: [await deleteScenario(autoApprove, reset)] };
  return { scenarios: [await baselineScenario(autoApprove, reset)] };
}
