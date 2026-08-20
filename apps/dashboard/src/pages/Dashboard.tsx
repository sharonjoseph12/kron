import { useQuery } from "@tanstack/react-query";
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
import { Badge, Card, GlassCard, CardHeader, Mono, Spinner, Stat, ExplorerLink, OnChainBadge, AtomicGroupBadge } from "../components/ui.js";
import LiveFeed from "../components/LiveFeed.js";

const tooltipStyle = {
  background: "#ffffff",
  border: "1px solid #e8e6e1",
  borderRadius: 10,
  fontSize: 12,
  color: "#1c1917",
  boxShadow: "0 8px 30px -12px rgba(28,25,23,0.15)",
};
const axisTick = { fontSize: 11, fill: "#a8a29e" };

export default function Dashboard() {
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

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div className="anim-fade-up">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">Economic Dashboard</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-3)]">
            Policy evaluation, x402 micropayments, and Algorand atomic settlement in real time.
          </p>
        </div>
        <div className="flex items-center gap-2 anim-fade-up" style={{ animationDelay: "80ms" }}>
          <span className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500 anim-soft-pulse" />
            Live Algorand
          </span>
        </div>
      </header>

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
                  <OnChainBadge txId={payments[0].txId} explorerUrl={payments[0].explorerUrl} />
                  <AtomicGroupBadge appId={payments[0].appId} />
                </div>
                <div className="mt-1 text-sm text-[var(--color-ink-2)]">
                  <span className="font-semibold text-[var(--color-ink)]">{payments[0].resourceName}</span> ({payments[0].service}) ·{" "}
                  <span className="font-mono font-semibold text-[var(--color-success)]">{fmtAlgo(payments[0].amountAlgo)} Ɖ</span> settled
                </div>
              </div>
            </div>
            {payments[0].txId && (
              <ExplorerLink
                url={payments[0].explorerUrl}
                className="rounded-lg border border-[var(--color-line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              >
                Verify on AlgoExplorer
              </ExplorerLink>
            )}
          </div>
        </GlassCard>
      )}

      {/* Stat cards */}
      {overview.isPending ? (
        <Spinner label="Loading overview…" />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 stagger-children">
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

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Spend — last 14 days" subtitle="Confirmed + authorized payments (ALGO)" />
          <div className="p-4">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={points} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="spend-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#4f46e5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ecebe6" vertical={false} />
                <XAxis dataKey="ts" tick={axisTick} minTickGap={28} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} width={52} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#57534e", fontWeight: 600 }} />
                <Line type="monotone" dataKey="algo" name="ALGO" stroke="#4f46e5" strokeWidth={2.5} dot={false} fill="url(#spend-fill)" />
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
                    <stop offset="0%" stopColor="#059669" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#059669" stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ecebe6" vertical={false} />
                <XAxis dataKey="agentName" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} width={52} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f5f4f0" }} />
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
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-[width] duration-700 ease-out"
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
                <span className="flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-medium text-indigo-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 anim-soft-pulse" /> App #{contract.data.appId}
                </span>
                {contract.data.createdAtRound > 0 && (
                  <span className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1 font-mono text-[11px] text-[var(--color-ink-2)]">
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
            value={fmtInt(contract.data?.globalState.totalPayments ?? 0)}
            sub="total_payments (uint64)"
            accent="text-[var(--color-accent)]"
          />
          <Stat
            label="Last amount"
            value={contract.data?.globalState.lastAmountMicro ? `${fmtAlgo(contract.data.globalState.lastAmountMicro)} Ɖ` : "—"}
            sub="last_amount_micro (uint64)"
            accent="text-[var(--color-success)]"
          />
          <Stat
            label="Last agent"
            value={contract.data?.globalState.lastAgentId ?? "—"}
            sub="last_agent_id (bytes)"
          />
          <Stat
            label="Last policy hash"
            value={contract.data?.globalState.lastPolicyHash ? shortId(contract.data.globalState.lastPolicyHash, 24) : "—"}
            sub="last_policy_hash (byte[32])"
            accent="text-[var(--color-warning)]"
          />
        </div>
        {contract.isError && (
          <div className="px-4 pb-4 text-xs text-red-600">
            Could not reach the contract endpoint — start the API with LocalNet or a funded TestNet mnemonic.
          </div>
        )}
      </Card>

      {/* Recent payments + live feed */}
      <div className="grid gap-4 xl:grid-cols-5">
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
                  <tr key={p.id} className="border-b border-[var(--color-line)]/60 last:border-0 hover:bg-[var(--color-surface-2)]/60 transition-colors">
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
                        {p.txId ? (
                          <ExplorerLink url={p.explorerUrl}>
                            <Mono>{shortId(p.txId, 10)}</Mono>
                          </ExplorerLink>
                        ) : (
                          <span className="text-[var(--color-ink-3)]">—</span>
                        )}
                        <OnChainBadge txId={p.txId} explorerUrl={p.explorerUrl} />
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