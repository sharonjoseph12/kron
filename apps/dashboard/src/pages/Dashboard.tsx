import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OverviewStats, PaymentDTO } from "@kron/shared";
import { api } from "../api/client.js";
import {
  decisionColor,
  decisionTone,
  fmtAlgo,
  fmtInt,
  fmtTs,
  paymentStatusTone,
  shortId,
} from "../lib/format.js";
import { Badge, Card, GlassCard, CardHeader, Mono, Spinner, Stat, ExplorerLink, OnChainBadge, AtomicGroupBadge, btnAccent } from "../components/ui.js";
import LiveFeed from "../components/LiveFeed.js";

const tooltipStyle = {
  background: "#fbf8f0",
  border: "1px solid #ddd3ba",
  borderRadius: 8,
  fontSize: 12,
  color: "#333333",
  boxShadow: "0 10px 30px -18px rgba(51,51,51,0.35)",
};
const axisTick = { fontSize: 11, fill: "#968b75" };

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function computeFleetHealth(ov: OverviewStats): number {
  const approval = clamp01(ov.approvalRatePct / 100);
  const success = clamp01(ov.paymentSuccessRatePct / 100);
  const runwayTerm =
    ov.estimatedWalletDays == null
      ? ov.burnRateAlgoPerDay > 0
        ? 0.4
        : 1
      : clamp01(ov.estimatedWalletDays / 30);
  const agentTerm = clamp01(ov.activeAgents / 5);
  const consistency = (runwayTerm + agentTerm) / 2;
  return Math.round(approval * 50 + success * 30 + consistency * 20);
}

function buildNarrative(
  ov: OverviewStats | undefined,
  recent: PaymentDTO[],
  policyHash: string | null | undefined,
): string[] {
  const s: string[] = [];
  if (recent.length > 0) {
    const auto = recent.filter((p) => p.decision === "AUTO_APPROVED").length;
    const blocked = recent.filter((p) => p.decision === "BLOCKED").length;
    const escalated = recent.filter((p) => p.decision === "ESCALATED").length;
    const confirmed = recent.filter((p) => p.status === "confirmed").length;
    const spend = recent.reduce((sum, p) => sum + (p.amountAlgo || 0), 0);
    const settled = confirmed === recent.length ? "all settled on-chain" : `${confirmed} settled on-chain`;
    s.push(
      `${recent.length} recent payment request${recent.length === 1 ? "" : "s"} — ${auto} auto-approved, ${blocked} blocked by policy, ${escalated} escalated; ${settled}.`,
    );
    if (spend > 0) s.push(`Total spend ${fmtAlgo(spend)} Ɖ across the latest batch.`);
  } else if (ov && ov.totalPayments > 0) {
    s.push(`${ov.totalPayments} payments processed so far — ${ov.autoApproved} auto-approved, ${ov.blocked} blocked, ${ov.escalated} escalated.`);
  } else {
    s.push("No payment activity yet.");
  }
  if (ov && ov.activeAgents > 0) {
    const lat = ov.avgPaymentLatencyMs != null ? `${Math.round(ov.avgPaymentLatencyMs)}ms` : "steady";
    s.push(`${ov.activeAgents} agent${ov.activeAgents === 1 ? "" : "s"} active with ${lat} settlement latency.`);
  }
  if (policyHash) {
    s.push(`The on-chain anchor recorded the last policy hash ${shortId(policyHash, 16)}.`);
  }
  return s;
}

const GOLDEN_STORAGE_KEY = "kron.golden.lastRun";

/** Restore the last Golden Path run so a route change (or reload) doesn't wipe it. */
function loadGoldenRun(): { steps: string[]; result: unknown } | null {
  try {
    const raw = localStorage.getItem(GOLDEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { steps?: unknown; result?: unknown };
    if (!Array.isArray(parsed.steps)) return null;
    return {
      steps: parsed.steps.filter((s): s is string => typeof s === "string"),
      result: parsed.result ?? null,
    };
  } catch {
    return null;
  }
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: api.getOverview,
    refetchInterval: 5_000,
  });
  const spend = useQuery({ queryKey: ["spend"], queryFn: api.getSpend });
  const decisions = useQuery({ queryKey: ["decisions"], queryFn: api.getDecisions });
  const agentsSpend = useQuery({ queryKey: ["agents-spend"], queryFn: api.getAgentsSpend });
  const burnRate = useQuery({ queryKey: ["burn-rate"], queryFn: api.getBurnRate });
  const contract = useQuery({ queryKey: ["contract"], queryFn: api.getContract, refetchInterval: 10_000 });
  const recent = useQuery({ queryKey: ["payments", "recent"], queryFn: () => api.listPayments({ limit: "8" }) });

  const ov = overview.data?.overview;
  const burn = burnRate.data?.burnRate;
  const slices = decisions.data?.slices ?? [];
  const rows = agentsSpend.data?.rows ?? [];
  const points = spend.data?.points ?? [];
  const payments = recent.data?.payments ?? [];

  const health = ov ? computeFleetHealth(ov) : null;
  const healthTone = health == null ? "muted" : health >= 75 ? "ok" : health >= 50 ? "warn" : "err";
  const narrative = buildNarrative(ov, payments, contract.data?.globalState?.lastPolicyHash);
  const narrativeLoading = overview.isPending || recent.isPending || agentsSpend.isPending;

  // ---- Golden Path Demo ----
  // Kept tiny on purpose: the demo sends to the agent's own wallet, so the only
  // real cost is the 0.001 ALGO network fee per run.
  const GOLDEN_AMOUNT_ALGO = Number(import.meta.env.VITE_GOLDEN_AMOUNT_ALGO ?? "0.001") || 0.001;
  const [goldenSteps, setGoldenSteps] = useState<string[]>(() => loadGoldenRun()?.steps ?? []);
  const [goldenResult, setGoldenResult] = useState<any>(() => loadGoldenRun()?.result ?? null);

  // Persist the run across dashboard route changes. It is a UI record only —
  // the settlement truth lives in the payment row and on TestNet.
  useEffect(() => {
    try {
      localStorage.setItem(
        GOLDEN_STORAGE_KEY,
        JSON.stringify({ steps: goldenSteps.slice(-40), result: goldenResult }),
      );
    } catch {
      /* private mode or quota — the run still works, it just won't be restored */
    }
  }, [goldenSteps, goldenResult]);

  const goldenPath = useMutation({
    mutationFn: async () => {
      setGoldenSteps([]);
      setGoldenResult(null);
      const log = (s: string) => setGoldenSteps((prev) => [...prev, s]);

      // Step 1: Get agents
      log("① Discovering agents…");
      const { agents } = await api.listAgents();
      if (agents.length === 0) throw new Error("No agents found — create one first on the Agents page.");
      const agent = agents[0]!;
      log(`   Found agent "${agent.name}" (${agent.id.slice(0, 8)}…)`);

      // Step 2: Fund wallet (no-op unless FUNDING_MNEMONIC is configured)
      log("② Preparing agent wallet on Algorand TestNet…");
      let balanceAlgo = 0;
      try {
        const funded = await api.fundWallet(agent.id);
        balanceAlgo = funded.balanceAlgo;
        log(`   Wallet ${funded.address.slice(0, 10)}… → ${balanceAlgo.toFixed(4)} ALGO`);
      } catch {
        log("   Could not read wallet balance (continuing).");
      }

      if (balanceAlgo < 0.12) {
        log("   ✗ Not enough TestNet ALGO to settle a payment (needs ≥ 0.12 ALGO).");
        log(`     Address: ${agent.walletAddress}`);
        log("     Fund it at https://bank.testnet.algorand.network (TestNet dispenser)");
        log("     or set FUNDING_MNEMONIC in .env so KRON funds agents automatically.");
        throw new Error("Agent wallet is unfunded — no transaction was attempted.");
      }

      // Step 3: Start session
      log("③ Starting autonomous task session…");
      const { session } = await api.startSession(agent.id, "Golden Path Demo — live hackathon");
      log(`   Session ${session.id.slice(0, 8)}… active.`);

      // Step 4: Execute paid tool call (real x402 → policy → Algorand settlement)
      log(`④ Calling paid tool 'market/report' (${GOLDEN_AMOUNT_ALGO} ALGO demo amount)…`);
      log("   → x402 challenge intercepted");
      log("   → Policy engine evaluating…");
      const result = await api.executePayment({
        agentId: agent.id,
        sessionId: session.id,
        toolCallId: `golden_${Date.now()}`,
        mcpServerId: "playground_server",
        toolName: "market/report",
        service: "market",
        resourceId: "market/report",
        resourceName: "Real-Time Market Intel Report",
        recipient: agent.walletAddress ?? "RECIPIENT_ADDRESS",
        amountAlgo: GOLDEN_AMOUNT_ALGO,
        network: "testnet",
        clientRequestId: `golden_${Date.now()}`,
      });

      const settlementBlocked = result.status === "BLOCKED" || result.decision === "BLOCKED" || !result.txId;
      if (settlementBlocked) {
        const reason = (result.reasons as string[] | undefined)?.[0] ?? "settlement produced no transaction";
        log(`   → Decision: ${result.decision ?? result.status}`);
        log(`   ✗ ${reason}`);
        log("⑤ Golden Path stopped — nothing settled on-chain.");
        return result;
      }

      log(`   → Decision: ${result.decision ?? result.status}`);
      log(`   → Algorand Tx: ${result.txId}`);
      if (result.appId) {
        log(`   → Policy hash anchored via atomic group (App Call + Payment, app ${result.appId})`);
      } else {
        log("   → Standalone payment (anchor contract not deployed — no atomic group)");
      }
      log("⑤ Golden Path complete ✓");
      return result;
    },
    onSuccess: (data) => {
      setGoldenResult(data);
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["contract"] });
    },
    onError: (err) => {
      setGoldenSteps((prev) => [...prev, `❌ Error: ${err instanceof Error ? err.message : String(err)}`]);
    },
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-4">
        <div>
          <div className="eyebrow text-[var(--color-accent)]">PS 2.1 · Payment runtime</div>
          <h1 className="display-serif mt-2 text-[30px] font-semibold leading-none tracking-[-0.03em] text-[var(--color-ink)]">
            Economic dashboard
          </h1>
          <p className="mt-3 max-w-2xl text-[13px] leading-6 text-[var(--color-ink-2)]">
            Policy evaluation, x402 micropayments, and Algorand atomic settlement in real time.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-success)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)] anim-soft-pulse" />
            Live Algorand
          </span>
          <button
            onClick={() => goldenPath.mutate()}
            disabled={goldenPath.isPending}
            className={btnAccent}
          >
            {goldenPath.isPending ? "Running golden path…" : "Run golden path"}
          </button>
        </div>
      </header>

      {/* Golden Path Live Console */}
      {goldenSteps.length > 0 && (
        <GlassCard accent className="p-4 space-y-2 anim-fade-up">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-2)]">
              Golden Path — 402 → Policy → Algorand Settlement
            </span>
            {goldenResult?.txId && (
              <ExplorerLink url={goldenResult.payment?.explorerUrl} className="text-xs font-semibold text-[var(--color-accent)]">
                View on Explorer →
              </ExplorerLink>
            )}
          </div>
          <div className="terminal rounded-lg p-3 font-mono text-[11px] text-[var(--color-ink)] max-h-40 overflow-y-auto">
            <div className="terminal-scanline" />
            <div className="relative z-20 space-y-0.5">
              {goldenSteps.map((step, i) => (
                <div key={i} className={step.startsWith("❌") ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}>
                  {step}
                </div>
              ))}
              {goldenPath.isPending && (
                <div className="text-[var(--color-warning)] anim-soft-pulse">⏳ Settling on Algorand…</div>
              )}
            </div>
          </div>
          {goldenResult && !goldenPath.isPending && (
            <div className="flex items-center gap-3 text-xs">
              <Badge tone={goldenResult.decision === "BLOCKED" ? "err" : "ok"}>
                {goldenResult.decision ?? goldenResult.status ?? "SETTLED"}
              </Badge>
              {goldenResult.txId && (
                <span className="font-mono text-[var(--color-ink-2)]">Tx: {shortId(goldenResult.txId, 16)}</span>
              )}
              <button
                onClick={() => { setGoldenSteps([]); setGoldenResult(null); }}
                className="ml-auto text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
              >
                Dismiss
              </button>
            </div>
          )}
        </GlassCard>
      )}

      {/* Hero Card: Latest On-Chain Settlement */}
      {payments.length > 0 && payments[0]?.status === "confirmed" && (
        <GlassCard accent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-accent)] text-white shadow-sm">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-2)]">Latest Autonomous Settlement</span>
                  <OnChainBadge txId={payments[0].txId} explorerUrl={payments[0].explorerUrl} verified={payments[0].settlementVerified} />
                  <AtomicGroupBadge appId={payments[0].appId} />
                </div>
                <div className="mt-1 text-sm text-[var(--color-ink-2)]">
                  <span className="font-semibold text-[var(--color-ink)]">{payments[0].resourceName}</span> ({payments[0].service}) ·{" "}
                  <span className="font-mono font-semibold text-[var(--color-success)]">{fmtAlgo(payments[0].amountAlgo)} Ɖ</span> settled
                </div>
              </div>
            </div>
            {payments[0].txId && payments[0].settlementVerified !== false && (
              <ExplorerLink
                url={payments[0].explorerUrl}
                className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-3)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              >
                Verify on Pera Explorer
              </ExplorerLink>
            )}
          </div>
        </GlassCard>
      )}

      {/* Stat cards — responsive at 1366x768 (6 cols = 2 rows, no horizontal scroll) */}
      {overview.isPending ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)]" />
          ))}
        </div>
      ) : overview.isError ? (
        <div className="rounded-xl border border-[#e5b0a6] bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">
          Could not load overview — check that the API is running at {import.meta.env.VITE_KRON_API_URL ?? "http://localhost:8787"}.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 stagger-children">
          <Stat label="Total Spend" value={`${fmtAlgo(ov?.totalSpendAlgo)} Ɖ`} sub="All-time ALGO" accent="text-[var(--color-ink)]" />
          <Stat label="Today" value={`${fmtAlgo(ov?.todaySpendAlgo)} Ɖ`} sub="Since midnight" accent="text-[var(--color-accent)]" />
          <Stat label="Wallet Balance" value={`${fmtAlgo(ov?.walletBalanceAlgo)} Ɖ`} sub="Across wallets" />
          <Stat label="Payments" value={fmtInt(ov?.totalPayments)} sub={`${fmtAlgo(ov?.paymentSuccessRatePct)}% success`} />
          <Stat label="Auto-approved" value={fmtInt(ov?.autoApproved)} sub={`${fmtAlgo(ov?.approvalRatePct)}% rate`} accent="text-[var(--color-success)]" />
          <Stat label="Escalated" value={fmtInt(ov?.escalated)} accent="text-[var(--color-warning)]" />
          <Stat label="Blocked" value={fmtInt(ov?.blocked)} accent="text-[var(--color-danger)]" />
          <Stat label="Burn Rate" value={`${fmtAlgo(ov?.burnRateAlgoPerDay)} Ɖ`} sub="ALGO / day" accent="text-[var(--color-warning)]" />
          <Stat label="Runway" value={ov?.estimatedWalletDays != null ? `${ov.estimatedWalletDays.toFixed(1)}d` : "∞"} sub="At current burn" accent="text-[var(--color-success)]" />
          <Stat label="Healthy MCP" value={fmtInt(ov?.healthyMcpServers)} sub="servers online" />
          <Stat label="Active Agents" value={fmtInt(ov?.activeAgents)} />
          <Stat label="Avg Latency" value={ov?.avgPaymentLatencyMs != null ? `${Math.round(ov.avgPaymentLatencyMs)}ms` : "—"} sub="to settle" />
        </div>
      )}

      {/* Fleet health + narrative */}
      <div className="grid gap-4 lg:grid-cols-2 stagger-children">
        <Card className="overflow-hidden">
          <CardHeader title="Agent fleet health" subtitle="Approvals, settlement success, and spend consistency" />
          {overview.isPending ? (
            <div className="px-5 py-5">
              <Spinner label="Loading fleet health…" />
            </div>
          ) : health == null ? (
            <div className="px-5 py-5 text-sm text-[var(--color-ink-3)]">No telemetry yet.</div>
          ) : (
            <div className="flex flex-col gap-4 p-5">
              <div className="flex items-center gap-3">
                <span className="font-mono text-4xl font-semibold tabular-nums text-[var(--color-ink)]">
                  {health}
                  <span className="text-base font-medium text-[var(--color-ink-3)]"> / 100</span>
                </span>
                <Badge tone={healthTone}>
                  {healthTone === "ok" ? "Healthy" : healthTone === "warn" ? "Watching" : "At risk"}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5">
                  <div className="text-[11px] uppercase tracking-wider text-[var(--color-ink-3)]">Approval rate</div>
                  <div className="mt-0.5 font-mono text-lg font-semibold text-[var(--color-ink)]">
                    {fmtAlgo(ov?.approvalRatePct)}%
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5">
                  <div className="text-[11px] uppercase tracking-wider text-[var(--color-ink-3)]">Payment success</div>
                  <div className="mt-0.5 font-mono text-lg font-semibold text-[var(--color-ink)]">
                    {fmtAlgo(ov?.paymentSuccessRatePct)}%
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5">
                  <div className="text-[11px] uppercase tracking-wider text-[var(--color-ink-3)]">Active agents</div>
                  <div className="mt-0.5 font-mono text-lg font-semibold text-[var(--color-ink)]">
                    {fmtInt(ov?.activeAgents)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="What happened?" subtitle="Latest activity in plain English" />
          {narrativeLoading ? (
            <p className="px-5 py-5 text-sm text-[var(--color-ink-3)]">Waiting for telemetry…</p>
          ) : (
            <div className="px-5 py-4">
              <p className="text-sm leading-relaxed text-[var(--color-ink-2)]">
                <span className="font-medium text-[var(--color-ink)]">{narrative[0]}</span>
                {narrative.slice(1).map((sentence, i) => (
                  <span key={i}> {sentence}</span>
                ))}
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2 stagger-children">
        <Card className="overflow-hidden">
          <CardHeader title="Spend — last 14 days" subtitle="Confirmed + authorized payments (ALGO)" />
          <div className="p-4">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={points} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="spend-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c9522f" stopOpacity={0.16} />
                    <stop offset="100%" stopColor="#c9522f" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8e1d2" vertical={false} />
                <XAxis dataKey="ts" tick={axisTick} minTickGap={28} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} width={52} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#6a6152", fontWeight: 600 }} />
                <Line type="monotone" dataKey="algo" name="ALGO" stroke="#c9522f" strokeWidth={2.5} dot={false} fill="url(#spend-fill)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Decision split" subtitle="Policy engine outcomes on all payment requests" />
          <div className="p-4">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="count"
                  nameKey="decision"
                  innerRadius={58}
                  outerRadius={88}
                  paddingAngle={2}
                  stroke="#ffffff"
                  strokeWidth={2}
                >
                  {slices.map((s) => (
                    <Cell key={s.decision} fill={decisionColor(s.decision)} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend formatter={(v: string) => <span className="text-xs text-[var(--color-ink-2)]">{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Spend by agent" subtitle="Confirmed + authorized payments" />
          <div className="p-4">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={rows} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="bar-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2f7d5e" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#2f7d5e" stopOpacity={0.35} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8e1d2" vertical={false} />
                <XAxis dataKey="agentName" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} width={52} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f1eadc" }} />
                <Bar dataKey="spendAlgo" name="ALGO" fill="url(#bar-fill)" radius={[5, 5, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title="Burn rate & wallet runway"
            subtitle="Aggregate burn across confirmed payments"
            right={
              <div className="text-right font-mono text-sm font-semibold text-[var(--color-warning)]">
                {fmtAlgo(burn?.burnRateAlgoPerDay)} Ɖ/day
              </div>
            }
          />
          <div className="flex flex-col gap-4 p-5">
            <div>
              <div className="mb-1.5 flex items-baseline justify-between text-xs">
                <span className="text-[var(--color-ink-3)]">Estimated runway</span>
                <span className="font-mono font-semibold text-[var(--color-ink)]">
                  {burn?.estimatedDays != null ? `${burn.estimatedDays.toFixed(1)} days` : "∞ (no spend yet)"}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[var(--color-chart-1)] to-[var(--color-chart-2)] transition-[width] duration-700 ease-out"
                  style={{
                    width: `${Math.min(100, Math.max(4, ((burn?.estimatedDays ?? 30) / 30) * 100))}%`,
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wider text-[var(--color-ink-3)]">Wallet balance</div>
                <div className="mt-0.5 font-mono text-lg font-semibold text-[var(--color-ink)]">
                  {fmtAlgo(burn?.walletBalanceAlgo)} Ɖ
                </div>
              </div>
              <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wider text-[var(--color-ink-3)]">Avg payment latency</div>
                <div className="mt-0.5 font-mono text-lg font-semibold text-[var(--color-ink)]">
                  {ov?.avgPaymentLatencyMs != null ? `${Math.round(ov.avgPaymentLatencyMs)}ms` : "—"}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Contract State Card */}
      <Card className="overflow-hidden">
        <CardHeader
          title="Policy Anchor Contract"
          subtitle={`Live global state read from the ${contract.data?.network ?? "—"} indexer (ARC-4)`}
          right={
            contract.data?.deployed ? (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-full border border-[#a9c6da] bg-[#e3eef6] px-3 py-1 text-[11px] font-medium text-[var(--color-info)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-info)] anim-soft-pulse" /> App #{contract.data.appId}
                </span>
                {contract.data.createdAtRound > 0 && (
                  <span className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface-3)] px-3 py-1 font-mono text-[11px] text-[var(--color-ink-2)]">
                    round {contract.data.createdAtRound}
                  </span>
                )}
              </div>
            ) : (
              <Badge tone="warn">not deployed</Badge>
            )
          }
        />
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
          <Stat
            label="Payments anchored"
            value={fmtInt(contract.data?.globalState?.totalPayments ?? 0)}
            sub="total_payments (uint64)"
            accent="text-[var(--color-accent)]"
          />
          <Stat
            label="Last amount"
            value={contract.data?.globalState?.lastAmountMicro ? `${fmtAlgo(contract.data.globalState.lastAmountMicro)} Ɖ` : "—"}
            sub="last_amount_micro (uint64)"
            accent="text-[var(--color-success)]"
          />
          <Stat
            label="Last agent"
            value={contract.data?.globalState?.lastAgentId ?? "—"}
            sub="last_agent_id (bytes)"
          />
          <Stat
            label="Last policy hash"
            value={contract.data?.globalState?.lastPolicyHash ? shortId(contract.data.globalState.lastPolicyHash, 24) : "—"}
            sub="last_policy_hash (byte[32])"
            accent="text-[var(--color-warning)]"
          />
          <Stat
            label="Emergency stop"
            value={contract.data?.globalState?.emergencyStop ? "ENGAGED" : "armed"}
            sub="set_emergency_stop (creator-only)"
            accent={contract.data?.globalState?.emergencyStop ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}
          />
        </div>
        {contract.isError && (
          <div className="px-4 pb-4 text-xs text-[var(--color-danger)]">
            Could not reach the contract endpoint — start the API with LocalNet or a funded TestNet mnemonic.
          </div>
        )}
      </Card>

      {/* Recent payments + live feed */}
      <div className="grid gap-4 xl:grid-cols-5 stagger-children">
        <Card className="overflow-hidden xl:col-span-3">
          <CardHeader title="Recent payments" subtitle="Latest payment requests across all agents" />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] text-[11px] uppercase tracking-wider text-[var(--color-ink-3)]">
                  <th className="px-4 py-2.5 font-medium">Resource</th>
                  <th className="px-4 py-2.5 font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Decision</th>
                  <th className="px-4 py-2.5 font-medium">Tx</th>
                  <th className="px-4 py-2.5 font-medium">At</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="trow-in spotlight border-b border-[var(--color-line)]/60 last:border-0 hover:bg-[var(--color-surface-2)]/60 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="text-[var(--color-ink)]">{p.resourceName}</div>
                      <div className="text-[11px] text-[var(--color-ink-3)]">{p.service}</div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[var(--color-ink)]">{fmtAlgo(p.amountAlgo)} Ɖ</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={paymentStatusTone(p.status)}>{p.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={decisionTone(p.decision)}>{p.decision ?? "—"}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {p.txId && p.settlementVerified !== false ? (
                          <ExplorerLink url={p.explorerUrl}>
                            <Mono>{shortId(p.txId, 10)}</Mono>
                          </ExplorerLink>
                        ) : p.txId ? (
                          <Mono>{shortId(p.txId, 10)}</Mono>
                        ) : (
                          <span className="text-[var(--color-ink-3)]">—</span>
                        )}
                        <OnChainBadge txId={p.txId} explorerUrl={p.explorerUrl} verified={p.settlementVerified} />
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--color-ink-3)]">{fmtTs(p.createdAt)}</td>
                  </tr>
                ))}
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--color-ink-3)]">
                      No payments yet — payments from agent activity appear here.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader
            title="Live event feed"
            subtitle="SSE stream from /api/events"
            right={
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-accent)]">
                <span className="h-2 w-2 rounded-full bg-[var(--color-accent)] anim-soft-pulse" /> LIVE
              </span>
            }
          />
          <div className="p-3">
            <LiveFeed />
          </div>
        </Card>
      </div>
    </div>
  );
}