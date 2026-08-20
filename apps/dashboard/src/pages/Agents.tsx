import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentDTO,
  AgentSessionDTO,
  PolicyConfig,
  PolicyEvaluation,
  SimulationResult,
  TimelineEvent,
  UnknownRecipientAction,
} from "@kron/shared";
import { api } from "../api/client.js";
import {
  agentStatusTone,
  decisionTone,
  fmtAlgo,
  fmtInt,
  fmtTs,
  shortId,
} from "../lib/format.js";
import {
  Badge,
  btnDanger,
  btnGhost,
  btnPrimary,
  Card,
  CardHeader,
  ErrorBox,
  inputClass,
  labelClass,
  Mono,
  Spinner,
  ExplorerLink,
} from "../components/ui.js";
import { PaymentTimeline } from "../components/PaymentTimeline.js";

function NumField({
  label,
  value,
  onChange,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input
        type="number"
        step={step}
        min={0}
        className={inputClass}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const ACTION_OPTIONS = [
  { value: "allow", label: "Allow" },
  { value: "escalate", label: "Escalate" },
  { value: "block", label: "Block" },
];

function draftFrom(p: PolicyConfig) {
  return {
    name: p.name,
    perCallLimitAlgo: p.perCallLimitAlgo,
    hardCeilingAlgo: p.hardCeilingAlgo,
    sessionBudgetAlgo: p.sessionBudgetAlgo,
    dailyBudgetAlgo: p.dailyBudgetAlgo,
    maxDailyPayments: p.maxDailyPayments,
    unknownRecipient: p.unknownRecipient,
    firstTimeService: p.firstTimeService,
    recipientAllowlist: p.recipientAllowlist,
    recipientBlocklist: p.recipientBlocklist,
    serviceAllowlist: p.serviceAllowlist,
    serviceBlocklist: p.serviceBlocklist,
    emergencyStop: p.emergencyStop,
  };
}

function Verdict({ result }: { result: SimulationResult }) {
  return (
    <div className="space-y-3 rounded-lg border border-[#a9c6da] bg-[#e3eef6]/60 p-3 anim-fade-up">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">Simulation result</span>
        <span className="font-mono text-sm font-semibold text-[var(--color-success)]">
          {result.reductionPct.toFixed(1)}% spend reduction
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {(["autoApproved", "escalated", "blocked"] as const).map((k) => (
          <div key={k} className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-3)] px-2 py-2">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-3)]">{k.replace("auto", "auto-")}</div>
            <div className="font-mono text-sm text-[var(--color-ink)]">
              {result.simulated[k]} <span className="text-[10px] text-[var(--color-ink-3)]">(was {result.current[k]})</span>
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs text-[var(--color-ink-2)]">
        {result.transactionsAnalyzed} transactions analyzed · simulated spend{" "}
        <span className="font-mono text-[var(--color-success)]">{fmtAlgo(result.simulated.spendAlgo)} Ɖ</span> vs current{" "}
        <span className="font-mono">{fmtAlgo(result.current.spendAlgo)} Ɖ</span>
      </div>
      {result.blockedDetails.length > 0 ? (
        <div className="max-h-32 overflow-y-auto rounded-md border border-[var(--color-line)] bg-[var(--color-surface-3)] p-2">
          {result.blockedDetails.map((b) => (
            <div key={b.requestId} className="flex items-start gap-2 py-0.5 font-mono text-[11px]">
              <span className="text-[var(--color-danger)]">block</span>
              <span className="text-[var(--color-ink-3)]">{shortId(b.requestId, 6)}</span>
              <span className="text-[var(--color-ink-3)]">— {b.reason}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EvaluateVerdict({ evaluation }: { evaluation: PolicyEvaluation }) {
  return (
    <div className="space-y-2 rounded-lg border border-[#a9c6da] bg-[#e3eef6]/60 p-3 anim-fade-up">
      <div className="flex items-center gap-2">
        <Badge tone={decisionTone(evaluation.decision)}>{evaluation.decision}</Badge>
        <span className="font-mono text-xs text-[var(--color-ink-2)]">
          v{evaluation.policyVersion} · {fmtAlgo(evaluation.requestedAlgo)} Ɖ requested
        </span>
      </div>
      {evaluation.reasons.map((r, i) => (
        <div key={i} className="text-xs text-[var(--color-ink-2)]">
          • {r}
        </div>
      ))}
      {evaluation.rulesTriggered.length > 0 ? (
        <div className="border-t border-[var(--color-line)] pt-2">
          {evaluation.rulesTriggered.map((r, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px]">
              <span className={r.severity === "block" ? "text-[var(--color-danger)]" : r.severity === "warn" ? "text-[var(--color-warning)]" : "text-[var(--color-accent)]"}>
                {r.severity}
              </span>
              <span className="text-[var(--color-ink-2)]">{r.description}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TimelineDrawer({
  session,
  onClose,
}: {
  session: AgentSessionDTO;
  onClose: () => void;
}) {
  const timeline = useQuery({
    queryKey: ["timeline", session.id],
    queryFn: () => api.getTimeline(session.id),
  });
  const events = timeline.data?.events ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(51,51,51,0.4)] backdrop-blur-sm" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto border-l border-[var(--color-line)] bg-[var(--color-surface-3)] p-5 shadow-2xl anim-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="display-serif text-sm font-semibold text-[var(--color-ink)]">Timeline</h3>
            <p className="font-mono text-[11px] text-[var(--color-ink-3)]">session {shortId(session.id, 10)}</p>
          </div>
          <button onClick={onClose} className={btnGhost}>
            Close
          </button>
        </div>
        {timeline.isPending ? (
          <Spinner />
        ) : events.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--color-ink-3)]">No timeline events recorded for this session.</p>
        ) : (
          <PaymentTimeline events={events} />
        )}
      </div>
    </div>
  );
}

type PolicyDiffRow = {
  key: string;
  label: string;
  oldVal: string;
  newVal: string;
};

const fmtArr = (v: unknown) => (Array.isArray(v) && v.length > 0 ? (v as string[]).join(", ") : "—");
const fmtAlgoVal = (v: unknown) => `${fmtAlgo(Number(v))} Ɖ`;
const fmtFlag = (v: unknown) => (v ? "on" : "off");

function policyDiffRows(latest: PolicyConfig, older: PolicyConfig): PolicyDiffRow[] {
  const rows: PolicyDiffRow[] = [];
  const add = (key: string, label: string, oldV: unknown, newV: unknown, fmt: (v: unknown) => string) => {
    const o = fmt(oldV);
    const n = fmt(newV);
    if (o === n) return;
    rows.push({ key, label, oldVal: o, newVal: n });
  };

  add("name", "Name", older.name, latest.name, (v) => String(v));
  add("perCallLimitAlgo", "Per-call limit", older.perCallLimitAlgo, latest.perCallLimitAlgo, fmtAlgoVal);
  add("hardCeilingAlgo", "Hard ceiling", older.hardCeilingAlgo, latest.hardCeilingAlgo, fmtAlgoVal);
  add("sessionBudgetAlgo", "Session budget", older.sessionBudgetAlgo, latest.sessionBudgetAlgo, fmtAlgoVal);
  add("dailyBudgetAlgo", "Daily budget", older.dailyBudgetAlgo, latest.dailyBudgetAlgo, fmtAlgoVal);
  add("maxDailyPayments", "Max daily payments", older.maxDailyPayments, latest.maxDailyPayments, (v) => fmtInt(Number(v)));
  add("unknownRecipient", "Unknown recipient", older.unknownRecipient, latest.unknownRecipient, (v) => String(v));
  add("firstTimeService", "First-time service", older.firstTimeService, latest.firstTimeService, (v) => String(v));
  add("recipientAllowlist", "Recipient allowlist", older.recipientAllowlist, latest.recipientAllowlist, fmtArr);
  add("recipientBlocklist", "Recipient blocklist", older.recipientBlocklist, latest.recipientBlocklist, fmtArr);
  add("serviceAllowlist", "Service allowlist", older.serviceAllowlist, latest.serviceAllowlist, fmtArr);
  add("serviceBlocklist", "Service blocklist", older.serviceBlocklist, latest.serviceBlocklist, fmtArr);
  add("emergencyStop", "Emergency stop", older.emergencyStop, latest.emergencyStop, fmtFlag);

  return rows;
}

function PolicyDiff({ latest, older }: { latest: PolicyConfig; older: PolicyConfig }) {
  const rows = policyDiffRows(latest, older);
  if (rows.length === 0) {
    return <p className="text-xs text-[var(--color-ink-3)]">No differences between these versions.</p>;
  }
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-1 items-baseline gap-1 sm:grid-cols-[10rem_1fr_2rem_1fr]">
          <span className="text-[11px] text-[var(--color-ink-3)]">{r.label}</span>
          <span className="font-mono text-[11px] text-[var(--color-ink-3)] line-through">{r.oldVal}</span>
          <span className="hidden text-center text-[var(--color-ink-3)] sm:block">→</span>
          <span className="inline-flex w-fit items-center rounded-md bg-[var(--color-warning-soft)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-warning)] ring-1 ring-inset ring-[#d9c48f]">
            {r.newVal}
          </span>
        </div>
      ))}
    </div>
  );
}

function PolicyEditor({ agentId, policy }: { agentId: string; policy: PolicyConfig }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PolicyConfig>(policy);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(true);
  const [compareTo, setCompareTo] = useState<number | null>(null);

  const history = useQuery({ queryKey: ["policy-history", agentId], queryFn: () => api.getPolicyHistory(agentId) });

  const versions = [...(history.data?.history ?? [])].sort((a, b) => b.version - a.version);
  const latest = versions[0];
  const older = versions.find((v) => v.version === compareTo) ?? null;

  const save = useMutation({
    mutationFn: () => api.updatePolicy(agentId, draftFrom(draft)),
    onSuccess: (d) => {
      setDraft(d.policy);
      setSimResult(null);
      setSimError(null);
      queryClient.invalidateQueries({ queryKey: ["policy", agentId] });
      queryClient.invalidateQueries({ queryKey: ["policy-history", agentId] });
    },
  });

  const simulate = useMutation({
    mutationFn: () => api.simulatePolicy(agentId, draftFrom(draft)),
    onSuccess: (d) => {
      setSimResult(d.result);
      setSimError(null);
    },
    onError: (e) => setSimError(e instanceof Error ? e.message : "Simulation failed"),
  });

  const activate = useMutation({
    mutationFn: (version: number) => api.activatePolicy(agentId, version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policy", agentId] });
      queryClient.invalidateQueries({ queryKey: ["policy-history", agentId] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  const set = <K extends keyof PolicyConfig>(k: K, v: PolicyConfig[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <NumField label="Per-call limit (Ɖ)" value={draft.perCallLimitAlgo} onChange={(v) => set("perCallLimitAlgo", v)} />
        <NumField label="Hard ceiling (Ɖ)" value={draft.hardCeilingAlgo} onChange={(v) => set("hardCeilingAlgo", v)} />
        <NumField label="Session budget (Ɖ)" value={draft.sessionBudgetAlgo} onChange={(v) => set("sessionBudgetAlgo", v)} />
        <NumField label="Daily budget (Ɖ)" value={draft.dailyBudgetAlgo} onChange={(v) => set("dailyBudgetAlgo", v)} />
        <NumField label="Max daily payments" value={draft.maxDailyPayments} onChange={(v) => set("maxDailyPayments", Math.round(v))} step={1} />
        <label className="flex items-end gap-2">
          <span className={`${labelClass} mb-2 cursor-pointer select-none`}>
            <input
              type="checkbox"
              className="mr-2 accent-[var(--color-danger)]"
              checked={draft.emergencyStop}
              onChange={(e) => set("emergencyStop", e.target.checked)}
            />
            Emergency stop
          </span>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Unknown recipient"
          value={draft.unknownRecipient}
          onChange={(v) => set("unknownRecipient", v as UnknownRecipientAction)}
          options={ACTION_OPTIONS}
        />
        <SelectField
          label="First-time service"
          value={draft.firstTimeService}
          onChange={(v) => set("firstTimeService", v as UnknownRecipientAction)}
          options={ACTION_OPTIONS}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className={btnPrimary}
        >
          {save.isPending ? "Saving…" : `Save & publish v${policy.version + 1}`}
        </button>
        <button onClick={() => simulate.mutate()} disabled={simulate.isPending} className={btnGhost}>
          {simulate.isPending ? "Simulating…" : "Simulate"}
        </button>
        <button onClick={() => setDraft(policy)} className={btnGhost}>
          Reset
        </button>
      </div>

      {save.isError ? <ErrorBox message={save.error instanceof Error ? save.error.message : "Save failed"} /> : null}
      {simError ? <ErrorBox message={simError} /> : null}
      {simResult ? <Verdict result={simResult} /> : null}

      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-3)]">
        <button
          onClick={() => setShowVersions((s) => !s)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={`h-3.5 w-3.5 shrink-0 text-[var(--color-ink-3)] transition-transform ${showVersions ? "rotate-90" : ""}`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 4l4 4-4 4" />
          </svg>
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">Policy versions</span>
          <span className="ml-auto font-mono text-[11px] text-[var(--color-ink-3)]">{versions.length}</span>
        </button>

        {showVersions ? (
          <div className="border-t border-[var(--color-line)] p-3">
            {history.isPending ? (
              <Spinner />
            ) : versions.length === 0 ? (
              <p className="py-2 text-center text-xs text-[var(--color-ink-3)]">No versions recorded yet.</p>
            ) : (
              <>
                <div className="space-y-2">
                  {versions.map((h) => (
                    <div
                      key={h.version}
                      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-1.5 text-xs ${
                        h.active ? "border-[#a8cfb8] bg-[var(--color-success-soft)] text-[var(--color-success)]" : "border-[var(--color-line)] bg-[var(--color-surface-3)] text-[var(--color-ink)]"
                      }`}
                    >
                      <span className="font-mono font-semibold">v{h.version}</span>
                      {h.version === latest?.version ? (
                        <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-ink-3)]">
                          current
                        </span>
                      ) : h.active ? (
                        <Badge tone="ok">active</Badge>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-ink-2)]">{h.name || "—"}</span>
                      <span className="font-mono text-[10px] text-[var(--color-ink-3)]">{fmtTs(h.createdAt)}</span>
                      {!h.active && h.version !== latest?.version ? (
                        <button
                          onClick={() => activate.mutate(h.version)}
                          disabled={activate.isPending}
                          className="font-medium text-[var(--color-accent)] hover:text-[#b8451f]"
                        >
                          activate
                        </button>
                      ) : null}
                      {h.version !== latest?.version ? (
                        <button
                          onClick={() => setCompareTo(compareTo === h.version ? null : h.version)}
                          className={`font-medium hover:text-[#b8451f] ${
                            compareTo === h.version ? "text-[var(--color-ink)]" : "text-[var(--color-accent)]"
                          }`}
                        >
                          {compareTo === h.version ? "hide diff" : "diff"}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>

                {compareTo != null && older && latest && compareTo !== latest.version ? (
                  <div className="mt-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)]/60 p-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
                      Changes from v{older.version} → v{latest.version}
                    </div>
                    <PolicyDiff latest={latest} older={older} />
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AgentDetail({
  agent,
  balance,
  onFunded,
}: {
  agent: AgentDTO;
  balance: number | null;
  onFunded: (agentId: string, balanceAlgo: number) => void;
}) {
  const queryClient = useQueryClient();
  const policy = useQuery({ queryKey: ["policy", agent.id], queryFn: () => api.getPolicy(agent.id) });
  const sessions = useQuery({ queryKey: ["sessions", agent.id], queryFn: () => api.listSessions(agent.id) });
  const [timelineSession, setTimelineSession] = useState<AgentSessionDTO | null>(null);

  // evaluate form
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [service, setService] = useState("research");
  const [evaluation, setEvaluation] = useState<PolicyEvaluation | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);

  const startSession = useMutation({
    mutationFn: (task?: string) => api.startSession(agent.id, task),
    onSuccess: () => {
      setEvalError(null);
      queryClient.invalidateQueries({ queryKey: ["sessions", agent.id] });
    },
    onError: (e) => setEvalError(e instanceof Error ? e.message : "Failed to start session"),
  });

  const evaluate = useMutation({
    mutationFn: () =>
      api.evaluate(agent.id, {
        recipient: recipient.trim(),
        amountAlgo: Number(amount),
        service: service.trim(),
      }),
    onSuccess: (d) => {
      setEvaluation(d.evaluation);
      setEvalError(null);
    },
    onError: (e) => {
      setEvalError(e instanceof Error ? e.message : "Evaluation failed");
      setEvaluation(null);
    },
  });

  const [task, setTask] = useState("");

  const onSubmitEvaluate = (e: FormEvent) => {
    e.preventDefault();
    evaluate.mutate();
  };

  return (
    <div className="space-y-5">
      {/* Wallet */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wider text-[var(--color-ink-3)]">Wallet</div>
          <div className="mt-1 truncate">
            {agent.walletAddress ? (
              <ExplorerLink url={`https://${import.meta.env.VITE_ALGORAND_NETWORK === "mainnet" ? "" : "testnet."}explorer.perawallet.app/address/${agent.walletAddress}`}>
                <Mono>{shortId(agent.walletAddress, 14)}</Mono>
              </ExplorerLink>
            ) : (
              <Mono>none</Mono>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wider text-[var(--color-ink-3)]">Balance</div>
          <div className="mt-1 font-mono text-sm font-semibold text-[var(--color-success)]">
            {balance != null ? `${fmtAlgo(balance)} Ɖ` : "unknown"}
          </div>
        </div>
        <div className="flex items-end justify-end">
          <FundButton agentId={agent.id} onFunded={onFunded} />
        </div>
      </div>

      {/* Policy */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
          Economic policy
          {agent.activePolicyVersion != null ? (
            <span className="ml-2 font-mono text-[var(--color-accent)]">v{agent.activePolicyVersion}</span>
          ) : null}
        </h3>
        {policy.isPending ? (
          <Spinner />
        ) : policy.isError ? (
          <ErrorBox message="No active policy configured." />
        ) : policy.data ? (
          <Card className="p-4">
            <PolicyEditor key={`${agent.id}-${policy.data.policy.version}`} agentId={agent.id} policy={policy.data.policy} />
          </Card>
        ) : null}
      </div>

      {/* Evaluate */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">Evaluate a payment</h3>
        <form onSubmit={onSubmitEvaluate} className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)]/60 p-3">
          <label className="min-w-[14rem] flex-1">
            <span className={labelClass}>Recipient</span>
            <input className={inputClass} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="ALGO address" required />
          </label>
          <label className="w-32">
            <span className={labelClass}>Amount (Ɖ)</span>
            <input type="number" min={0} step={0.1} className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
          <label className="w-40">
            <span className={labelClass}>Service</span>
            <input className={inputClass} value={service} onChange={(e) => setService(e.target.value)} />
          </label>
          <button type="submit" disabled={evaluate.isPending} className={btnGhost}>
            {evaluate.isPending ? "Evaluating…" : "Evaluate"}
          </button>
        </form>
        {evalError ? (
          <div className="mt-2">
            <ErrorBox message={evalError} />
          </div>
        ) : null}
        {evaluation ? (
          <div className="mt-2">
            <EvaluateVerdict evaluation={evaluation} />
          </div>
        ) : null}
      </div>

      {/* Sessions */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">Sessions</h3>
        <div className="flex gap-2">
          <input
            className={inputClass}
            placeholder="Session task (optional)"
            value={task}
            onChange={(e) => setTask(e.target.value)}
          />
          <button
            onClick={() => startSession.mutate(task || undefined)}
            disabled={startSession.isPending}
            className={btnPrimary}
          >
            Start session
          </button>
        </div>
        {sessions.isPending ? (
          <Spinner />
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--color-line)]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] text-[11px] uppercase tracking-wider text-[var(--color-ink-3)]">
                  <th className="px-3 py-2 font-medium">Task</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Started</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {(sessions.data?.sessions ?? []).map((s) => (
                  <tr key={s.id} className="trow-in spotlight border-b border-[var(--color-line)]/60 last:border-0 hover:bg-[var(--color-surface-2)]/60 transition-colors">
                    <td className="max-w-[16rem] truncate px-3 py-2 text-[var(--color-ink)]">{s.task ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={agentStatusTone(s.status)}>{s.status}</Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-[var(--color-ink-3)]">{fmtTs(s.startedAt)}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setTimelineSession(s)} className={btnGhost}>
                        Timeline
                      </button>
                    </td>
                  </tr>
                ))}
                {(sessions.data?.sessions ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-[var(--color-ink-3)]">
                      No sessions yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {timelineSession ? <TimelineDrawer session={timelineSession} onClose={() => setTimelineSession(null)} /> : null}
    </div>
  );
}

function FundButton({ agentId, onFunded }: { agentId: string; onFunded: (agentId: string, balanceAlgo: number) => void }) {
  const fund = useMutation({
    mutationFn: () => api.fundWallet(agentId),
    onSuccess: (d) => onFunded(agentId, d.balanceAlgo),
  });
  return (
    <button onClick={() => fund.mutate()} disabled={fund.isPending} className={btnGhost}>
      {fund.isPending ? "Funding…" : "Fund"}
    </button>
  );
}

export default function Agents() {
  const queryClient = useQueryClient();
  const agents = useQuery({ queryKey: ["agents"], queryFn: api.listAgents });
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createAgent({ name: name.trim(), description: description.trim() || undefined }),
    onSuccess: (d) => {
      setName("");
      setDescription("");
      setShowCreate(false);
      setCreateError(null);
      setSelected(d.agent.id);
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (e) => setCreateError(e instanceof Error ? e.message : "Create failed"),
  });

  const list = agents.data?.agents ?? [];
  const selectedAgent = list.find((a) => a.id === selected) ?? null;

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="anim-fade-up">
          <h1 className="display-serif text-2xl font-semibold tracking-tight text-[var(--color-ink)]">Agents</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-3)]">
            {list.length} agent{list.length === 1 ? "" : "s"} · each has a dedicated Algorand wallet and economic policy.
          </p>
        </div>
        <button onClick={() => setShowCreate((s) => !s)} className={btnPrimary}>
          {showCreate ? "Cancel" : "New agent"}
        </button>
      </div>

      {showCreate ? (
        <form onSubmit={onCreate} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-3)] p-4 anim-fade-up">
          <div className="grid gap-3 md:grid-cols-3">
            <label>
              <span className={labelClass}>Name</span>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="researcher-01" required />
            </label>
            <label className="md:col-span-2">
              <span className={labelClass}>Description</span>
              <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this agent do?" />
            </label>
          </div>
          {createError ? (
            <div className="mt-3">
              <ErrorBox message={createError} />
            </div>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className={btnGhost}>
              Cancel
            </button>
            <button type="submit" disabled={create.isPending} className={btnPrimary}>
              {create.isPending ? "Creating…" : "Create agent"}
            </button>
          </div>
        </form>
      ) : null}

      {agents.isPending ? (
        <Spinner label="Loading agents…" />
      ) : (
        <div className="space-y-3 stagger-children">
          {list.map((a) => (
            <Card key={a.id} className={selected === a.id ? "border-[var(--color-accent)]" : ""}>
              <button
                onClick={() => setSelected(selected === a.id ? null : a.id)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[var(--color-ink)]">{a.name}</span>
                    <Badge tone={agentStatusTone(a.status)}>{a.status}</Badge>
                  </div>
                  {a.description ? <p className="mt-0.5 truncate text-xs text-[var(--color-ink-3)]">{a.description}</p> : null}
                </div>
                <div className="hidden sm:block">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-3)]">Wallet</div>
                  <div className="font-mono text-[11px] text-[var(--color-accent)]">{a.walletAddress ? shortId(a.walletAddress, 10) : "none"}</div>
                </div>
                <div className="hidden text-right md:block">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-3)]">Balance</div>
                  <div className="font-mono text-[11px] text-[var(--color-ink)]">
                    {balances[a.id] != null ? `${fmtAlgo(balances[a.id])} Ɖ` : "—"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-3)]">Policy</div>
                  <div className="font-mono text-[11px] text-[var(--color-ink)]">{a.activePolicyVersion != null ? `v${a.activePolicyVersion}` : "—"}</div>
                </div>
                <span className={`text-xs font-medium ${selected === a.id ? "text-[var(--color-accent)]" : "text-[var(--color-ink-3)]"}`}>
                  {selected === a.id ? "Close" : "Manage"}
                </span>
              </button>

              {selected === a.id && selectedAgent ? (
                <div className="border-t border-[var(--color-line)] p-4">
                  <AgentDetail agent={selectedAgent} balance={balances[a.id] ?? null} onFunded={(id, b) => setBalances((m) => ({ ...m, [id]: b }))} />
                </div>
              ) : null}
            </Card>
          ))}
          {list.length === 0 ? (
            <Card className="p-10 text-center text-sm text-[var(--color-ink-3)]">
              No agents yet — create one to give it a wallet and a policy.
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
