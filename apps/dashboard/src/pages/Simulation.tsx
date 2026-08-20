import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { PolicyConfig, SimulationResult, UnknownRecipientAction } from "@kron/shared";
import { api } from "../api/client.js";
import { fmtAlgo, shortId } from "../lib/format.js";
import {
  Badge,
  btnGhost,
  btnPrimary,
  Card,
  CardHeader,
  GlassCard,
  ErrorBox,
  inputClass,
  labelClass,
  Spinner,
} from "../components/ui.js";

const ACTION_OPTIONS = [
  { value: "allow", label: "Allow" },
  { value: "escalate", label: "Escalate" },
  { value: "block", label: "Block" },
];

export default function Simulation() {
  const queryClient = useQueryClient();
  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: api.listAgents });
  const agents = agentsQuery.data?.agents ?? [];

  const [selectedAgentId, setSelectedAgentId] = useState<string>("");

  useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0]?.id ?? "");
    }
  }, [agents, selectedAgentId]);

  const activeAgent = agents.find((a) => a.id === selectedAgentId);

  const policyQuery = useQuery({
    queryKey: ["policy", selectedAgentId],
    queryFn: () => api.getPolicy(selectedAgentId),
    enabled: !!selectedAgentId,
  });

  const activePolicy = policyQuery.data?.policy;

  // Draft policy state for simulation
  const [draft, setDraft] = useState<Partial<PolicyConfig>>({});
  const [lookback, setLookback] = useState<number>(100);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [appliedMsg, setAppliedMsg] = useState<string | null>(null);

  // Sync draft when active policy loads or agent changes
  useEffect(() => {
    if (activePolicy) {
      setDraft({
        perCallLimitAlgo: activePolicy.perCallLimitAlgo,
        hardCeilingAlgo: activePolicy.hardCeilingAlgo,
        sessionBudgetAlgo: activePolicy.sessionBudgetAlgo,
        dailyBudgetAlgo: activePolicy.dailyBudgetAlgo,
        maxDailyPayments: activePolicy.maxDailyPayments,
        unknownRecipient: activePolicy.unknownRecipient,
        firstTimeService: activePolicy.firstTimeService,
        emergencyStop: activePolicy.emergencyStop,
      });
      setSimResult(null);
      setAppliedMsg(null);
    }
  }, [activePolicy, selectedAgentId]);

  const simulateMutation = useMutation({
    mutationFn: () =>
      api.simulatePolicy(
        selectedAgentId,
        {
          perCallLimitAlgo: draft.perCallLimitAlgo,
          hardCeilingAlgo: draft.hardCeilingAlgo,
          sessionBudgetAlgo: draft.sessionBudgetAlgo,
          dailyBudgetAlgo: draft.dailyBudgetAlgo,
          maxDailyPayments: draft.maxDailyPayments,
          unknownRecipient: draft.unknownRecipient as UnknownRecipientAction,
          firstTimeService: draft.firstTimeService as UnknownRecipientAction,
          emergencyStop: draft.emergencyStop,
        },
        lookback,
      ),
    onSuccess: (data) => {
      setSimResult(data.result);
      setAppliedMsg(null);
    },
  });

  const applyMutation = useMutation({
    mutationFn: () =>
      api.updatePolicy(selectedAgentId, {
        perCallLimitAlgo: draft.perCallLimitAlgo,
        hardCeilingAlgo: draft.hardCeilingAlgo,
        sessionBudgetAlgo: draft.sessionBudgetAlgo,
        dailyBudgetAlgo: draft.dailyBudgetAlgo,
        maxDailyPayments: draft.maxDailyPayments,
        unknownRecipient: draft.unknownRecipient as UnknownRecipientAction,
        firstTimeService: draft.firstTimeService as UnknownRecipientAction,
        emergencyStop: draft.emergencyStop,
      }),
    onSuccess: (data) => {
      setAppliedMsg(`Policy v${data.policy.version} successfully published & activated!`);
      queryClient.invalidateQueries({ queryKey: ["policy", selectedAgentId] });
      queryClient.invalidateQueries({ queryKey: ["policy-history", selectedAgentId] });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  // Prepare chart comparison data
  const comparisonData = simResult
    ? [
        {
          name: "Auto-Approved",
          Current: simResult.current.autoApproved,
          Simulated: simResult.simulated.autoApproved,
        },
        {
          name: "Escalated",
          Current: simResult.current.escalated,
          Simulated: simResult.simulated.escalated,
        },
        {
          name: "Blocked",
          Current: simResult.current.blocked,
          Simulated: simResult.simulated.blocked,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="anim-fade-up">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-[var(--color-ink)]">Policy Simulation & What-If Engine</h1>
            <Badge tone="ok">Governance Differentiator</Badge>
          </div>
          <p className="mt-0.5 text-sm text-[var(--color-ink-3)]">
            Backtest candidate spending policies against historical transactions before deploying them to autonomous agents.
          </p>
        </div>

        {/* Agent Selector */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-[var(--color-ink-3)]">Select Agent:</label>
          <select
            className={`${inputClass} w-52 font-mono text-sm`}
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.walletAddress ? shortId(a.walletAddress, 8) : "no wallet"})
              </option>
            ))}
          </select>
        </div>
      </div>

      {appliedMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {appliedMsg}
        </div>
      )}

      {agentsQuery.isPending || policyQuery.isPending ? (
        <Spinner label="Loading agent policies for simulation…" />
      ) : !activeAgent ? (
        <Card className="p-8 text-center text-sm text-[var(--color-ink-3)]">No agents found. Create an agent first.</Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left Column: Draft Policy Configuration */}
          <div className="space-y-4 lg:col-span-5">
            <GlassCard accent className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--color-ink)]">Candidate Policy Parameters</h2>
                  <p className="text-xs text-[var(--color-ink-3)]">
                    Editing simulation draft for <span className="font-semibold text-[var(--color-accent)]">{activeAgent.name}</span>
                  </p>
                </div>
                {activePolicy && (
                  <span className="font-mono text-xs text-[var(--color-ink-3)]">Current: v{activePolicy.version}</span>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <label className={labelClass}>Per-Call Autonomous Limit (Ɖ ALGO)</label>
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    className={inputClass}
                    value={draft.perCallLimitAlgo ?? 0}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, perCallLimitAlgo: parseFloat(e.target.value) || 0 }))
                    }
                  />
                  <span className="text-[11px] text-[var(--color-ink-3)]">
                    Single payments above this amount will be escalated or blocked.
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Daily Budget (Ɖ ALGO)</label>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      className={inputClass}
                      value={draft.dailyBudgetAlgo ?? 0}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, dailyBudgetAlgo: parseFloat(e.target.value) || 0 }))
                      }
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Session Budget (Ɖ ALGO)</label>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      className={inputClass}
                      value={draft.sessionBudgetAlgo ?? 0}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, sessionBudgetAlgo: parseFloat(e.target.value) || 0 }))
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Unknown Recipient</label>
                    <select
                      className={inputClass}
                      value={draft.unknownRecipient ?? "block"}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, unknownRecipient: e.target.value as UnknownRecipientAction }))
                      }
                    >
                      {ACTION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>First-Time Service</label>
                    <select
                      className={inputClass}
                      value={draft.firstTimeService ?? "escalate"}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, firstTimeService: e.target.value as UnknownRecipientAction }))
                      }
                    >
                      {ACTION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Historical Lookback</label>
                  <select
                    className={inputClass}
                    value={lookback}
                    onChange={(e) => setLookback(parseInt(e.target.value, 10))}
                  >
                    <option value={25}>Last 25 transactions</option>
                    <option value={50}>Last 50 transactions</option>
                    <option value={100}>Last 100 transactions</option>
                    <option value={500}>Last 500 transactions</option>
                  </select>
                </div>

                <div className="pt-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => simulateMutation.mutate()}
                    disabled={simulateMutation.isPending}
                    className={`${btnPrimary} flex-1`}
                  >
                    {simulateMutation.isPending ? "Simulating…" : "Run What-If Simulation"}
                  </button>

                  <button
                    onClick={() =>
                      activePolicy &&
                      setDraft({
                        perCallLimitAlgo: activePolicy.perCallLimitAlgo,
                        hardCeilingAlgo: activePolicy.hardCeilingAlgo,
                        sessionBudgetAlgo: activePolicy.sessionBudgetAlgo,
                        dailyBudgetAlgo: activePolicy.dailyBudgetAlgo,
                        maxDailyPayments: activePolicy.maxDailyPayments,
                        unknownRecipient: activePolicy.unknownRecipient,
                        firstTimeService: activePolicy.firstTimeService,
                        emergencyStop: activePolicy.emergencyStop,
                      })
                    }
                    className={btnGhost}
                  >
                    Reset
                  </button>
                </div>

                {simulateMutation.isError && (
                  <ErrorBox
                    message={
                      simulateMutation.error instanceof Error
                        ? simulateMutation.error.message
                        : "Simulation failed"
                    }
                  />
                )}
              </div>
            </GlassCard>
          </div>

          {/* Right Column: Simulation Results & Impact Analysis */}
          <div className="space-y-4 lg:col-span-7">
            {simResult ? (
              <div className="space-y-4 anim-fade-up">
                {/* Metric Summary Cards */}
                <div className="grid grid-cols-3 gap-3">
                  <GlassCard accent className="p-4 text-center">
                    <div className="text-[11px] uppercase tracking-wider text-[var(--color-ink-3)]">Projected Spend Reduction</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-[var(--color-success)]">
                      {simResult.reductionPct >= 0 ? `-${simResult.reductionPct.toFixed(1)}%` : `+${Math.abs(simResult.reductionPct).toFixed(1)}%`}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--color-ink-3)]">
                      {fmtAlgo(simResult.simulated.spendAlgo)} Ɖ vs {fmtAlgo(simResult.current.spendAlgo)} Ɖ
                    </div>
                  </GlassCard>

                  <GlassCard accent className="p-4 text-center">
                    <div className="text-[11px] uppercase tracking-wider text-[var(--color-ink-3)]">Would Block</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-[var(--color-danger)]">
                      {simResult.simulated.blocked}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--color-ink-3)]">
                      was {simResult.current.blocked} under v{activePolicy?.version}
                    </div>
                  </GlassCard>

                  <GlassCard accent className="p-4 text-center">
                    <div className="text-[11px] uppercase tracking-wider text-[var(--color-ink-3)]">Auto-Approved</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-[var(--color-accent)]">
                      {simResult.simulated.autoApproved}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--color-ink-3)]">
                      of {simResult.transactionsAnalyzed} analyzed
                    </div>
                  </GlassCard>
                </div>

                {/* Comparison Chart */}
                <Card className="p-4">
                  <CardHeader
                    title="Decision Breakdown: Current vs Simulated"
                    subtitle="How the candidate policy changes decision outcomes across past transactions"
                  />
                  <div className="mt-4 h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={comparisonData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="sim-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.9} />
                            <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.4} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ecebe6" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#a8a29e" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: "#a8a29e" }} axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={{
                            background: "#ffffff",
                            border: "1px solid #e8e6e1",
                            borderRadius: 10,
                            fontSize: 12,
                            color: "#1c1917",
                            boxShadow: "0 8px 30px -12px rgba(28,25,23,0.15)",
                          }}
                        />
                        <Legend formatter={(v: string) => <span className="text-xs text-[var(--color-ink-2)]">{v}</span>} />
                        <Bar dataKey="Current" fill="#d6d3d1" radius={[5, 5, 0, 0]} maxBarSize={48} />
                        <Bar dataKey="Simulated" fill="url(#sim-fill)" radius={[5, 5, 0, 0]} maxBarSize={48} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                {/* Blocked Transaction Details */}
                {simResult.blockedDetails.length > 0 && (
                  <Card className="p-4">
                    <CardHeader
                      title={`Blocked Transaction Audit (${simResult.blockedDetails.length})`}
                      subtitle="Transactions that would have been prevented under this candidate policy"
                    />
                    <div className="mt-3 max-h-48 space-y-1.5 overflow-y-auto pr-1">
                      {simResult.blockedDetails.map((b, idx) => (
                        <div
                          key={b.requestId || idx}
                          className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[var(--color-danger)] font-bold">BLOCKED</span>
                            <span className="font-mono text-[var(--color-ink-3)]">{shortId(b.requestId, 8)}</span>
                            <span className="text-[var(--color-ink-2)]">{b.reason}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Activate Policy Button */}
                <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
                  <div>
                    <div className="font-semibold text-[var(--color-ink)]">Satisfied with the simulation result?</div>
                    <div className="text-xs text-[var(--color-ink-2)]">
                      Deploying will publish a new immutable policy version for {activeAgent.name}.
                    </div>
                  </div>
                  <button
                    onClick={() => applyMutation.mutate()}
                    disabled={applyMutation.isPending}
                    className={btnPrimary}
                  >
                    {applyMutation.isPending ? "Deploying Policy…" : "Activate Candidate Policy"}
                  </button>
                </div>
              </div>
            ) : (
              <GlassCard className="flex h-96 flex-col items-center justify-center p-8 text-center text-[var(--color-ink-3)]">
                <div className="mb-3 rounded-full border border-indigo-200 bg-indigo-50 p-4 text-[var(--color-accent)]">
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h3 className="text-base font-medium text-[var(--color-ink)]">Ready to Simulate</h3>
                <p className="mt-1 max-w-sm text-xs text-[var(--color-ink-3)]">
                  Adjust the candidate policy parameters on the left and click <strong>Run What-If Simulation</strong> to evaluate against historical agent activity.
                </p>
              </GlassCard>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
