import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApprovalDTO, ControlDecision, DriftProofDTO, EnforcementReceiptDTO } from "@kron/shared";
import { api } from "../api/client.js";
import { type BadgeTone, fmtInt, fmtTs, shortId } from "../lib/format.js";
import { Badge, Card, CardHeader, ErrorBox, GlassCard, Mono, Spinner, btnAccent, btnDanger, btnGhost } from "../components/ui.js";
import LiveFeed from "../components/LiveFeed.js";

type Mode = "kron" | "baseline";

function receiptTone(status: EnforcementReceiptDTO["status"]): BadgeTone {
  if (status === "executed") return "ok";
  if (status === "held") return "warn";
  if (status === "blocked") return "err";
  return "muted";
}

function downloadReceipt(receipt: EnforcementReceiptDTO): void {
  const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `kron-enforcement-receipt-${String(receipt.seq).padStart(4, "0")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function DriftPanel({ drift, onClose }: { drift: DriftProofDTO; onClose: () => void }) {
  return (
    <div className="rounded-xl border border-[#e5b0a6] bg-[var(--color-danger-soft)]/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-danger)]">
            Shadow-mode drift detected
          </div>
          <h2 className="mt-1 text-sm font-semibold text-[var(--color-ink)]">
            The card was stale. The tool adapter was never called.
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="err">nothing executed</Badge>
          <button className="text-[var(--color-ink-3)] hover:text-[var(--color-ink)]" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <DetailStat label="Card preview" value={fmtInt(drift.previewRows)} sub="rows at preview time" />
        <DetailStat label="Concurrent change" value={fmtInt(drift.changedRows)} tone="text-[var(--color-warning)]" sub="rows moved by another job" />
        <DetailStat label="Live data" value={fmtInt(drift.freshRows)} tone="text-[var(--color-danger)]" sub="fresh preview after drift" />
        <DetailStat label="Executed by stale card" value={fmtInt(drift.archivedAfterStale)} tone="text-[var(--color-success)]" sub="proven by receipt" />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] md:grid-cols-2">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-3)] p-3">
          <div className="font-semibold text-[var(--color-ink-2)]">Binding check</div>
          <div className="mt-1 font-mono text-[10px] text-[var(--color-ink-3)]">
            action hash unchanged · fingerprint {shortId(drift.fingerprintBefore ?? "", 8)} →{" "}
            {shortId(drift.fingerprintAfter ?? "", 8)}
          </div>
          <div className="mt-1 text-[var(--color-danger)]">
            {drift.staleStatus}: {drift.staleError}
          </div>
          {drift.staleReceiptId ? (
            <div className="mt-1 font-mono text-[10px] text-[var(--color-ink-3)]">
              receipt {shortId(drift.staleReceiptId, 12)}
            </div>
          ) : null}
        </div>
        <div className="rounded-lg border border-[#a8cfb8] bg-[var(--color-success-soft)]/50 p-3">
          <div className="font-semibold text-[var(--color-ink-2)]">Recovery path</div>
          <div className="mt-1 text-[var(--color-ink-2)]">
            A fresh preview showed {fmtInt(drift.freshRows)} rows. The human approved the new hash and exactly{" "}
            <strong>{fmtInt(drift.freshExecutedRows)}</strong> rows were archived.
          </div>
          <div className="mt-1 font-mono text-[10px] text-[var(--color-ink-3)]">
            archived {fmtInt(drift.archivedAfterFresh)} · active {fmtInt(drift.activeAfterFresh)}
          </div>
        </div>
      </div>
      <ol className="mt-3 space-y-1 text-[11px] leading-relaxed text-[var(--color-ink-2)]">
        {drift.steps.map((step, i) => (
          <li key={i} className="flex gap-2">
            <span className="font-mono text-[10px] text-[var(--color-ink-3)]">{i + 1}.</span>
            <span>
              <strong>{step.label}.</strong> {step.detail}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function decisionTone(decision: ControlDecision | string | null | undefined): BadgeTone {
  if (decision === "ALLOW") return "ok";
  if (decision === "FLAG") return "info";
  if (decision === "HOLD") return "warn";
  if (decision === "BLOCK") return "err";
  return "muted";
}

function titleCase(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] p-1">
      {(["kron", "baseline"] as const).map((value) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold tracking-wide transition ${
            mode === value
              ? value === "kron"
                ? "bg-[#1a1a1a] text-[#fffcf6] shadow-sm"
                : "bg-[var(--color-danger-soft)] text-[var(--color-danger)] shadow-sm"
              : "text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
          }`}
        >
          {value === "kron" ? "KRON Guard" : "Baseline"}
        </button>
      ))}
    </div>
  );
}

function DetailStat({
  label,
  value,
  tone = "text-[var(--color-ink)]",
  sub,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-3)] px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-[10px] text-[var(--color-ink-3)]">{sub}</div> : null}
    </div>
  );
}

function ApprovalCard({
  approval,
  selected,
  onSelect,
}: {
  approval: ApprovalDTO;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-xl border p-3 text-left transition ${
        selected
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]/50 shadow-sm"
          : "border-[var(--color-line)] bg-[var(--color-surface-3)] hover:border-[var(--color-line-strong)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs font-semibold text-[var(--color-ink)]">{approval.tool}</div>
          <div className="mt-0.5 text-[10px] text-[var(--color-ink-3)]">{fmtTs(approval.createdAt)}</div>
        </div>
        <Badge tone={decisionTone(approval.decision)}>{approval.decision}</Badge>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--color-ink-3)]">
        <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono">risk {approval.riskScore}/100</span>
        <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono">{approval.mode}</span>
        {approval.safeActionHash ? <span className="text-[var(--color-success)]">safe version ready</span> : null}
      </div>
    </button>
  );
}

function ImpactCard({ approval }: { approval: ApprovalDTO }) {
  const p = approval.preview;
  if (!p) {
    return (
      <div className="rounded-xl border border-[#e5b0a6] bg-[var(--color-danger-soft)] px-4 py-4">
        <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-danger)]">No impact preview</div>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-2)]">
          Baseline mode shows only the tool name and arguments. The operator cannot see rows affected, sensitive data,
          recoverability or recipient novelty before approving.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-[var(--color-surface-3)] px-3 py-2 text-xs leading-relaxed text-[var(--color-ink-2)]">
        {p.summary}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <DetailStat
          label="Rows affected"
          value={p.rowsAffected == null ? "—" : fmtInt(p.rowsAffected)}
          tone={(p.rowsAffected ?? 0) > 100 ? "text-[var(--color-danger)]" : "text-[var(--color-ink)]"}
        />
        <DetailStat
          label="Sensitive rows"
          value={fmtInt(p.sensitiveRows ?? 0)}
          tone={(p.sensitiveRows ?? 0) > 0 ? "text-[var(--color-warning)]" : "text-[var(--color-ink)]"}
        />
        <DetailStat
          label="Recoverable"
          value={p.recoverable == null ? "—" : p.recoverable ? "Yes" : "No"}
          tone={p.recoverable ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}
        />
        <DetailStat
          label="Recipient"
          value={p.recipientKnown == null ? "—" : p.recipientKnown ? "Known" : "New"}
          tone={p.recipientKnown === false ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}
          sub={p.recipient ?? undefined}
        />
      </div>
      {p.filePath ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2 text-[11px]">
          <span className="font-semibold text-[var(--color-ink-2)]">Attachment</span>
          <Mono>{p.filePath}</Mono>
          <Badge tone={p.fileSensitivity === "customer-confidential" ? "err" : "warn"}>{p.fileSensitivity}</Badge>
        </div>
      ) : null}
      <details className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-3)]">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-[var(--color-ink-2)]">
          Preview fields
        </summary>
        <pre className="max-h-44 overflow-auto border-t border-[var(--color-line)] px-3 py-2 font-mono text-[10px] leading-relaxed text-[var(--color-ink-3)]">
          {JSON.stringify(p.details, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export default function Control() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("kron");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drift, setDrift] = useState<DriftProofDTO | null>(null);

  const approvalsQuery = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => api.listApprovals("pending"),
    refetchInterval: 2_000,
  });
  const proofQuery = useQuery({ queryKey: ["proof"], queryFn: api.getProof, refetchInterval: 2_000 });
  const auditQuery = useQuery({ queryKey: ["control-audit"], queryFn: () => api.controlAudit(80), refetchInterval: 2_000 });
  const verifyQuery = useQuery({ queryKey: ["control-verify"], queryFn: api.verifyControlAudit, refetchInterval: 4_000 });
  const receiptsQuery = useQuery({ queryKey: ["receipts"], queryFn: () => api.listReceipts(8), refetchInterval: 2_000 });
  const receiptVerify = useQuery({ queryKey: ["receipt-verify"], queryFn: api.verifyReceipts, refetchInterval: 4_000 });
  const meQuery = useQuery({ queryKey: ["me"], queryFn: api.me });

  const approvals = approvalsQuery.data?.approvals ?? [];
  const selected = useMemo(
    () => approvals.find((a) => a.id === selectedId) ?? approvals[0] ?? null,
    [approvals, selectedId],
  );
  const proof = proofQuery.data?.proof;
  const verification = verifyQuery.data?.verification;
  const isAdmin = meQuery.data?.user.role === "admin";

  useEffect(() => {
    if (!selectedId && approvals[0]) setSelectedId(approvals[0].id);
  }, [approvals, selectedId]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["approvals"] });
    queryClient.invalidateQueries({ queryKey: ["proof"] });
    queryClient.invalidateQueries({ queryKey: ["control-audit"] });
    queryClient.invalidateQueries({ queryKey: ["control-verify"] });
    queryClient.invalidateQueries({ queryKey: ["receipts"] });
    queryClient.invalidateQueries({ queryKey: ["receipt-verify"] });
  };

  const scenario = useMutation({
    mutationFn: (name: "hero" | "delete" | "baseline") => api.runScenario(name, { reset: true }),
    onSuccess: (_data, name) => {
      setSelectedId(null);
      setNotice(
        name === "delete"
          ? "Bulk delete evaluated. The raw action is held; the archive alternative is ready."
          : name === "baseline"
            ? "Baseline card created with no preview. Approve the original to show the leak."
            : "Hero scenario loaded: poisoned email → private contract → outside recipient.",
      );
      refresh();
    },
    onError: (err) => setNotice(err instanceof Error ? err.message : String(err)),
  });

  const driftScenario = useMutation({
    mutationFn: api.runDrift,
    onSuccess: (data) => {
      setDrift(data.drift);
      setSelectedId(null);
      setNotice("Stale approval rejected. The live dataset changed, so a fresh preview and a fresh hash were required.");
      refresh();
    },
    onError: (err) => setNotice(err instanceof Error ? err.message : String(err)),
  });

  const decide = useMutation({
    mutationFn: ({ target }: { target: "safe" | "original" }) => {
      if (!selected) throw new Error("No approval selected");
      return api.decideApproval(selected.id, {
        decision: "approve",
        target,
        actionHash: target === "safe" ? selected.safeActionHash ?? undefined : selected.actionHash,
      });
    },
    onSuccess: (data) => {
      setNotice(data.execution?.summary ?? "Decision recorded.");
      refresh();
    },
    onError: (err) => setNotice(err instanceof Error ? err.message : String(err)),
  });

  const reject = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("No approval selected");
      return api.decideApproval(selected.id, { decision: "reject" });
    },
    onSuccess: () => {
      setNotice("Action rejected. Nothing executed.");
      refresh();
    },
    onError: (err) => setNotice(err instanceof Error ? err.message : String(err)),
  });

  const tamper = useMutation({
    mutationFn: api.tamperControlAudit,
    onSuccess: () => refresh(),
  });

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--color-accent)]">PS 2.1 · Control plane</div>
          <h1 className="display-serif mt-1 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">Approval Desk</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-3)]">
            Every tool call is classified, previewed against the real sandbox database, scored, and bound to a human
            decision by hash.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModeSwitch mode={mode} onChange={setMode} />
          <button
            className={btnAccent}
            disabled={scenario.isPending}
            onClick={() => scenario.mutate(mode === "baseline" ? "baseline" : "hero")}
          >
            {scenario.isPending ? "Running…" : mode === "baseline" ? "▶ Run baseline attack" : "▶ Run hero attack"}
          </button>
          <button className={btnGhost} disabled={scenario.isPending} onClick={() => scenario.mutate("delete")}>
            Bulk delete
          </button>
          <button className={btnGhost} disabled={driftScenario.isPending} onClick={() => driftScenario.mutate()}>
            {driftScenario.isPending ? "Simulating…" : "Shadow drift"}
          </button>
        </div>
      </header>

      {notice ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-3)] px-4 py-2.5 text-xs text-[var(--color-ink-2)]">
          <span>{notice}</span>
          <button className="text-[var(--color-ink-3)] hover:text-[var(--color-ink)]" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      ) : null}

      {mode === "baseline" ? (
        <div className="rounded-xl border border-[#e5b0a6] bg-[var(--color-danger-soft)] px-4 py-3 text-xs text-[var(--color-danger)]">
          <strong>Baseline toggle on.</strong> The approval desk receives only the tool name and arguments. No impact
          preview, risk score, safe rewrite or revalidation. Use this for the before/after comparison.
        </div>
      ) : null}

      {drift ? <DriftPanel drift={drift} onClose={() => setDrift(null)} /> : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card className="xl:col-span-4">
          <CardHeader
            title="Pending approvals"
            subtitle={`${approvals.length} action${approvals.length === 1 ? "" : "s"} waiting for a human`}
            right={<Badge tone={approvals.length > 0 ? "warn" : "ok"}>{approvals.length > 0 ? "Action needed" : "Clear"}</Badge>}
          />
          <div className="max-h-[560px] space-y-2 overflow-y-auto p-3">
            {approvalsQuery.isPending ? (
              <Spinner label="Loading cards…" />
            ) : approvals.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--color-line-strong)] px-3 py-8 text-center text-xs text-[var(--color-ink-3)]">
                No pending actions. Run a scenario to create one.
              </div>
            ) : (
              approvals.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  selected={selected?.id === approval.id}
                  onSelect={() => setSelectedId(approval.id)}
                />
              ))
            )}
          </div>
        </Card>

        <Card className="xl:col-span-8">
          <CardHeader
            title="Impact card"
            subtitle={selected ? `${selected.tool} · ${shortId(selected.id, 10)}` : "Select a pending approval"}
            right={
              selected ? (
                <div className="flex items-center gap-2">
                  <Badge tone={decisionTone(selected.decision)}>{selected.decision}</Badge>
                  <Badge tone={selected.riskScore >= 80 ? "err" : selected.riskScore >= 60 ? "warn" : "ok"}>
                    risk {selected.riskScore}/100
                  </Badge>
                </div>
              ) : null
            }
          />
          {!selected ? (
            <div className="px-5 py-14 text-center text-sm text-[var(--color-ink-3)]">
              Run the hero scenario or the bulk delete scenario to populate the desk.
            </div>
          ) : (
            <div className="space-y-4 p-4">
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-3)] px-3 py-2 text-[11px]">
                <span className="font-semibold text-[var(--color-ink-2)]">Bound hash</span>
                <Mono>{shortId(selected.actionHash, 14)}</Mono>
                <span className="ml-auto text-[var(--color-ink-3)]">Any argument change requires a fresh approval.</span>
              </div>

              <ImpactCard approval={selected} />

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-3)] p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">Why held</div>
                    <Badge tone={decisionTone(selected.decision)}>{selected.decision}</Badge>
                  </div>
                  <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-[var(--color-ink-2)]">
                    {selected.reasons.slice(0, 6).map((reason, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-3)] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">Raw action</div>
                  <pre className="mt-2 max-h-40 overflow-auto font-mono text-[10px] leading-relaxed text-[var(--color-ink-2)]">
                    {JSON.stringify(selected.actionJson, null, 2)}
                  </pre>
                </div>
              </div>

              {selected.safeActionJson ? (
                <div className="rounded-xl border border-[#a8cfb8] bg-[var(--color-success-soft)]/45 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-success)]">
                        Safe version · alternative, not equivalent
                      </div>
                      <div className="mt-0.5 text-sm font-semibold text-[var(--color-ink)]">{selected.safeLabel}</div>
                    </div>
                    <Badge tone={selected.safeActionHash ? "ok" : "muted"}>
                      {selected.safeActionHash ? shortId(selected.safeActionHash, 8) : "none"}
                    </Badge>
                  </div>
                  <ul className="mt-2 grid grid-cols-1 gap-1 text-[11px] leading-relaxed text-[var(--color-ink-2)] md:grid-cols-2">
                    {selected.differences.map((difference, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--color-success)]" />
                        <span>{difference}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      className={btnAccent}
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ target: "safe" })}
                    >
                      {decide.isPending ? "Executing…" : "Approve safe version"}
                    </button>
                    <span className="text-[10px] text-[var(--color-ink-3)]">
                      Revalidated through the full pipeline before execution; can still be BLOCKED.
                    </span>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-3">
                <button className={btnGhost} disabled={decide.isPending} onClick={() => decide.mutate({ target: "original" })}>
                  Approve original
                </button>
                <button className={btnDanger} disabled={reject.isPending} onClick={() => reject.mutate()}>
                  Reject
                </button>
                <span className="ml-auto text-[10px] text-[var(--color-ink-3)]">
                  expires {fmtTs(selected.expiresAt)} · {selected.mode}
                </span>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <GlassCard className="xl:col-span-4">
          <CardHeader
            title="Proof pane"
            subtitle="Real sandbox SQLite · attacker inbox · order table"
            right={
              <Badge tone={(proof?.mail.attackerMessages ?? 0) === 0 ? "ok" : "err"}>
                {(proof?.mail.attackerMessages ?? 0) === 0 ? "No leak" : "Leak detected"}
              </Badge>
            }
          />
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-2">
              <DetailStat
                label="Attacker inbox"
                value={fmtInt(proof?.mail.attackerMessages ?? 0)}
                tone={(proof?.mail.attackerMessages ?? 0) === 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}
                sub={proof?.mail.attackerAddress}
              />
              <DetailStat label="Outbound mail" value={fmtInt(proof?.mail.outbound ?? 0)} sub="sandbox sink" />
              <DetailStat label="Orders total" value={fmtInt(proof?.orders.total ?? 0)} sub="1 shared table" />
              <DetailStat
                label="Active orders"
                value={fmtInt(proof?.orders.active ?? 0)}
                tone={(proof?.orders.active ?? 0) === (proof?.orders.total ?? 0) ? "text-[var(--color-ink)]" : "text-[var(--color-warning)]"}
                sub={(proof?.orders.archived ?? 0) > 0 ? `${fmtInt(proof?.orders.archived)} archived` : "no archive"}
              />
            </div>
            <div className="max-h-44 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-3)] p-2">
              {(proof?.mail.messages ?? []).slice(0, 6).map((m) => (
                <div key={m.id} className="flex items-start gap-2 border-b border-[var(--color-line)] py-1.5 last:border-0">
                  <span className={`mt-0.5 rounded px-1 py-0.5 font-mono text-[9px] font-bold uppercase ${m.direction === "outbound" ? "bg-[var(--color-accent-soft)] text-[#b8451f]" : "bg-[var(--color-surface-2)] text-[var(--color-ink-3)]"}`}>
                    {m.direction === "outbound" ? "out" : "in"}
                  </span>
                  <div className="min-w-0 text-[10px]">
                    <div className="truncate font-medium text-[var(--color-ink-2)]">{m.subject}</div>
                    <div className="truncate font-mono text-[var(--color-ink-3)]">{m.to}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>

        <GlassCard className="xl:col-span-8">
          <CardHeader
            title="Live timeline"
            subtitle="Hash-chained control events · SSE + poll"
            right={
              <div className="flex items-center gap-2">
                <Badge tone={verification?.ok ? "ok" : "err"}>
                  {verification?.ok ? `Chain verified · ${verification.checked}` : "Tamper detected"}
                </Badge>
                {isAdmin ? (
                  <button className={btnGhost + " !px-2 !py-1 !text-[10px]"} disabled={tamper.isPending} onClick={() => tamper.mutate()}>
                    Tamper
                  </button>
                ) : null}
              </div>
            }
          />
          <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
            <div className="max-h-[420px] space-y-1.5 overflow-y-auto">
              {(auditQuery.data?.entries ?? []).map((entry) => (
                <div key={entry.id} className="flex items-start gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-3)] px-2.5 py-2">
                  <span className="font-mono text-[9px] text-[var(--color-ink-3)]">#{entry.seq}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] leading-relaxed text-[var(--color-ink-2)]">{entry.summary}</div>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[9px] text-[var(--color-ink-3)]">
                      <span>{entry.action}</span>
                      <span>{shortId(entry.hash, 6)}</span>
                      <span>{fmtTs(entry.ts)}</span>
                    </div>
                  </div>
                </div>
              ))}
              {(auditQuery.data?.entries ?? []).length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--color-ink-3)]">No control events yet.</div>
              ) : null}
            </div>
            <LiveFeed limit={80} />
          </div>
        </GlassCard>
      </div>

      <GlassCard>
        <CardHeader
          title="Enforcement receipts"
          subtitle="Hash-chained proof of what ran, what was blocked, and which one-shot grant authorised it"
          right={
            <div className="flex items-center gap-2">
              <Badge
                tone={
                  receiptVerify.data?.verification.ok === true
                    ? "ok"
                    : receiptVerify.data?.verification.ok === false
                      ? "err"
                      : "muted"
                }
              >
                {receiptVerify.data?.verification.ok === true
                  ? `Chain verified · ${receiptVerify.data.verification.checked}`
                  : receiptVerify.data?.verification.ok === false
                    ? "Receipt chain broken"
                    : "Checking receipts…"}
              </Badge>
              <Badge tone="info">{receiptsQuery.data?.receipts.length ?? 0} latest</Badge>
            </div>
          }
        />
        <div className="max-h-[340px] space-y-2 overflow-y-auto p-4">
          {(receiptsQuery.data?.receipts ?? []).map((receipt) => (
            <div
              key={receipt.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-3)] px-3 py-2"
            >
              <span className="font-mono text-[9px] text-[var(--color-ink-3)]">#{receipt.seq}</span>
              <Badge tone={receiptTone(receipt.status)}>{receipt.status}</Badge>
              <span className="font-mono text-[11px] font-semibold text-[var(--color-ink)]">{receipt.tool}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-ink-2)]">{receipt.summary}</span>
              <span className="font-mono text-[9px] text-[var(--color-ink-3)]">
                attacker {receipt.before.attackerMessages}→{receipt.after.attackerMessages} · archived{" "}
                {receipt.before.ordersArchived}→{receipt.after.ordersArchived}
              </span>
              {receipt.grant ? (
                <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--color-ink-3)]">
                  grant {receipt.grant.status}
                </span>
              ) : null}
              {receipt.drift ? <Badge tone="err">drift</Badge> : null}
              <span className="font-mono text-[9px] text-[var(--color-ink-3)]">{shortId(receipt.hash, 8)}</span>
              <button
                className={btnGhost + " !px-2 !py-1 !text-[10px]"}
                onClick={() => downloadReceipt(receipt)}
                title="Download the signed receipt JSON"
              >
                Download
              </button>
            </div>
          ))}
          {(receiptsQuery.data?.receipts ?? []).length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--color-ink-3)]">
              No receipts yet. Run a scenario and every decision will produce one.
            </div>
          ) : null}
        </div>
      </GlassCard>

      {scenario.isError ? <ErrorBox message={scenario.error instanceof Error ? scenario.error.message : "Scenario failed"} /> : null}
    </div>
  );
}
