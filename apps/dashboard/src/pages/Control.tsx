import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApprovalDTO, ControlDecision, DriftProofDTO, EnforcementReceiptDTO } from "@kron/shared";
import { api } from "../api/client.js";
import { badgeDot, fmtInt, fmtTs, shortId, type BadgeTone } from "../lib/format.js";
import {
  Card,
  CardHeader,
  ErrorBox,
  GlassCard,
  Mono,
  Spinner,
  btnAccent,
  btnDanger,
  btnGhost,
  btnQuiet,
} from "../components/ui.js";
import LiveFeed from "../components/LiveFeed.js";

type Mode = "kron" | "baseline";

const toneText: Record<BadgeTone, string> = {
  ok: "text-[var(--color-success)]",
  warn: "text-[var(--color-warning)]",
  err: "text-[var(--color-danger)]",
  info: "text-[var(--color-info)]",
  muted: "text-[var(--color-ink-3)]",
  accent: "text-[var(--color-accent)]",
};

function receiptTone(status: EnforcementReceiptDTO["status"]): BadgeTone {
  if (status === "executed") return "ok";
  if (status === "held") return "warn";
  if (status === "blocked") return "err";
  return "muted";
}

function decisionTone(decision: ControlDecision | string | null | undefined): BadgeTone {
  if (decision === "ALLOW") return "ok";
  if (decision === "FLAG") return "info";
  if (decision === "HOLD") return "warn";
  if (decision === "BLOCK") return "err";
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

function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`eyebrow ${className}`}>{children}</div>;
}

function Status({
  tone = "muted",
  children,
  pulse = false,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${toneText[tone]} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${badgeDot[tone]} ${pulse ? "anim-soft-pulse" : ""}`} />
      {children}
    </span>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1 truncate text-[11px] leading-5 text-[var(--color-ink-2)]">{children}</div>
    </div>
  );
}

function LedgerCell({
  label,
  value,
  sub,
  tone = "text-[var(--color-ink)]",
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 bg-[var(--color-surface)] px-4 py-3.5">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">{label}</div>
      <div className={`mt-1.5 font-mono text-[22px] font-medium leading-none tabular-nums ${tone}`}>{value}</div>
      {sub ? <div className="mt-1.5 truncate text-[10px] text-[var(--color-ink-3)]">{sub}</div> : null}
    </div>
  );
}

function Ledger({ children, columns = 4 }: { children: ReactNode; columns?: 2 | 4 }) {
  return (
    <div
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-md bg-[var(--color-line)] ${
        columns === 4 ? "sm:grid-cols-4" : ""
      }`}
    >
      {children}
    </div>
  );
}

function DriftStat({
  label,
  value,
  sub,
  tone = "text-[var(--color-ink)]",
}: {
  label: string;
  value: ReactNode;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 bg-[#fdf2ee] px-4 py-3.5">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-danger)]/80">{label}</div>
      <div className={`mt-1.5 font-mono text-[24px] font-medium leading-none tabular-nums ${tone}`}>{value}</div>
      <div className="mt-1.5 text-[10px] text-[var(--color-ink-3)]">{sub}</div>
    </div>
  );
}

function DriftPanel({ drift, onClose }: { drift: DriftProofDTO; onClose: () => void }) {
  return (
    <section className="overflow-hidden border-y border-[#e5b0a6] bg-[var(--color-danger-soft)]/35 anim-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5">
        <div className="max-w-3xl">
          <Eyebrow className="text-[var(--color-danger)]">Shadow-mode drift</Eyebrow>
          <h2 className="display-serif mt-1.5 text-[22px] font-semibold leading-tight text-[var(--color-ink)]">
            The approval expired the moment the data moved.
          </h2>
          <p className="mt-2 max-w-2xl text-[12px] leading-6 text-[var(--color-ink-2)]">
            The action hash was still valid, but the dataset fingerprint changed underneath it. The stale card was
            rejected at execution, and the tool adapter was never called.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Status tone="ok">Nothing executed</Status>
          <button className={btnQuiet} onClick={onClose}>
            Dismiss
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-y border-[#e5b0a6] bg-[#e5b0a6] sm:grid-cols-4">
        <DriftStat label="Card preview" value={fmtInt(drift.previewRows)} sub="rows when the human approved" />
        <DriftStat
          label="Concurrent change"
          value={fmtInt(drift.changedRows)}
          tone="text-[var(--color-warning)]"
          sub="rows moved by another job"
        />
        <DriftStat
          label="Live data"
          value={fmtInt(drift.freshRows)}
          tone="text-[var(--color-danger)]"
          sub="fresh preview after drift"
        />
        <DriftStat
          label="Executed by stale card"
          value={fmtInt(drift.archivedAfterStale)}
          tone="text-[var(--color-success)]"
          sub="proven by receipt"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 px-5 py-5 md:grid-cols-2">
        <div>
          <Eyebrow>Binding check</Eyebrow>
          <div className="mt-2 font-mono text-[10px] leading-5 text-[var(--color-ink-2)]">
            action hash unchanged · fingerprint {shortId(drift.fingerprintBefore ?? "", 8)} →{" "}
            {shortId(drift.fingerprintAfter ?? "", 8)}
          </div>
          <div className="mt-1 text-[11px] leading-5 text-[var(--color-danger)]">
            {drift.staleStatus}: {drift.staleError}
          </div>
          {drift.staleReceiptId ? (
            <div className="mt-1 font-mono text-[10px] text-[var(--color-ink-3)]">
              receipt {shortId(drift.staleReceiptId, 12)}
            </div>
          ) : null}
        </div>
        <div>
          <Eyebrow>Recovery path</Eyebrow>
          <p className="mt-2 text-[11px] leading-5 text-[var(--color-ink-2)]">
            A fresh preview showed {fmtInt(drift.freshRows)} rows. The human approved the new hash and exactly{" "}
            <strong className="font-semibold text-[var(--color-ink)]">{fmtInt(drift.freshExecutedRows)}</strong> rows
            were archived.
          </p>
          <div className="mt-1 font-mono text-[10px] text-[var(--color-ink-3)]">
            archived {fmtInt(drift.archivedAfterFresh)} · active {fmtInt(drift.activeAfterFresh)}
          </div>
        </div>
      </div>

      <ol className="grid grid-cols-1 gap-4 border-t border-[#e5b0a6] px-5 py-4 md:grid-cols-3">
        {drift.steps.map((step, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="pt-0.5 font-mono text-[9px] tabular-nums text-[var(--color-danger)]">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-2)]">
                {step.label}
              </div>
              <div className="mt-1 text-[11px] leading-5 text-[var(--color-ink-2)]">{step.detail}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div className="inline-flex items-center rounded-md border border-[var(--color-line)] bg-[var(--color-surface-3)] p-0.5">
      {(["kron", "baseline"] as const).map((value) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={`rounded px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors ${
            mode === value
              ? value === "kron"
                ? "bg-[var(--color-ink)] text-[#fffcf6]"
                : "bg-[var(--color-danger)] text-[#fffcf6]"
              : "text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
          }`}
        >
          {value === "kron" ? "KRON guard" : "Baseline"}
        </button>
      ))}
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
      className={`relative block w-full px-5 py-4 text-left transition-colors ${
        selected ? "bg-[var(--color-surface-2)]" : "hover:bg-[var(--color-surface-3)]/70"
      }`}
    >
      {selected ? <span className="absolute inset-y-0 left-0 w-[2px] bg-[var(--color-accent)]" /> : null}
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate font-mono text-[12px] font-medium text-[var(--color-ink)]">{approval.tool}</span>
        <Status tone={decisionTone(approval.decision)}>{approval.decision}</Status>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--color-ink-3)]">
        <span className="tabular-nums">risk {approval.riskScore}/100</span>
        <span className="text-[#c9bfa8]">/</span>
        <span>{approval.mode}</span>
        <span className="text-[#c9bfa8]">/</span>
        <span className="tabular-nums">{fmtTs(approval.createdAt)}</span>
      </div>
      {approval.safeActionHash ? (
        <div className="mt-2 text-[10px] font-medium text-[var(--color-success)]">Safe alternative prepared</div>
      ) : null}
    </button>
  );
}

function ImpactCard({ approval }: { approval: ApprovalDTO }) {
  const p = approval.preview;
  if (!p) {
    return (
      <div className="border-l-2 border-[var(--color-danger)] bg-[var(--color-danger-soft)]/40 px-4 py-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-danger)]">
          No impact preview
        </div>
        <p className="mt-1.5 text-[12px] leading-6 text-[var(--color-ink-2)]">
          Baseline mode shows only the tool name and arguments. The operator cannot see rows affected, sensitive data,
          recoverability or recipient novelty before approving.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-[13px] leading-6 text-[var(--color-ink-2)]">{p.summary}</p>

      <Ledger>
        <LedgerCell
          label="Rows affected"
          value={p.rowsAffected == null ? "—" : fmtInt(p.rowsAffected)}
          tone={(p.rowsAffected ?? 0) > 100 ? "text-[var(--color-danger)]" : "text-[var(--color-ink)]"}
        />
        <LedgerCell
          label="Sensitive rows"
          value={fmtInt(p.sensitiveRows ?? 0)}
          tone={(p.sensitiveRows ?? 0) > 0 ? "text-[var(--color-warning)]" : "text-[var(--color-ink)]"}
        />
        <LedgerCell
          label="Recoverable"
          value={p.recoverable == null ? "—" : p.recoverable ? "Yes" : "No"}
          tone={p.recoverable ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}
        />
        <LedgerCell
          label="Recipient"
          value={p.recipientKnown == null ? "—" : p.recipientKnown ? "Known" : "New"}
          tone={p.recipientKnown === false ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}
          sub={p.recipient ?? undefined}
        />
      </Ledger>

      {p.filePath ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-line)] pb-3 text-[11px]">
          <span className="font-semibold text-[var(--color-ink-2)]">Attachment</span>
          <Mono>{p.filePath}</Mono>
          <span
            className={`text-[10px] font-semibold uppercase tracking-[0.08em] ${
              p.fileSensitivity === "customer-confidential"
                ? "text-[var(--color-danger)]"
                : "text-[var(--color-warning)]"
            }`}
          >
            {p.fileSensitivity}
          </span>
        </div>
      ) : null}

      <details className="group border-b border-[var(--color-line)] pb-3">
        <summary className="flex cursor-pointer items-center justify-between py-1 text-[11px] font-medium text-[var(--color-ink-2)]">
          Preview fields
          <span className="font-mono text-[9px] text-[var(--color-ink-3)] group-open:hidden">open</span>
          <span className="hidden font-mono text-[9px] text-[var(--color-ink-3)] group-open:inline">close</span>
        </summary>
        <pre className="mt-2 max-h-44 overflow-auto border-l border-[var(--color-line)] pl-3 font-mono text-[10px] leading-relaxed text-[var(--color-ink-3)]">
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
    refetchInterval: 3_000,
  });
  const proofQuery = useQuery({ queryKey: ["proof"], queryFn: api.getProof, refetchInterval: 3_000 });
  const auditQuery = useQuery({ queryKey: ["control-audit"], queryFn: () => api.controlAudit(80), refetchInterval: 3_000 });
  const verifyQuery = useQuery({ queryKey: ["control-verify"], queryFn: api.verifyControlAudit, refetchInterval: 6_000 });
  const receiptsQuery = useQuery({ queryKey: ["receipts"], queryFn: () => api.listReceipts(8), refetchInterval: 3_000 });
  const receiptVerify = useQuery({ queryKey: ["receipt-verify"], queryFn: api.verifyReceipts, refetchInterval: 6_000 });
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
    <div className="mx-auto max-w-[1480px] space-y-6">
      <header className="pb-5">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Eyebrow className="text-[var(--color-accent)]">PS 2.1 · Agent control</Eyebrow>
            <h1 className="display-serif mt-2 text-[32px] font-semibold leading-none tracking-[-0.03em] text-[var(--color-ink)]">
              Approval desk
            </h1>
            <p className="mt-3 max-w-[660px] text-[13px] leading-6 text-[var(--color-ink-2)]">
              Every tool call is classified, previewed against the real sandbox database, scored, and bound to a human
              decision by hash.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-4">
          <div className="flex items-center gap-3">
            <ModeSwitch mode={mode} onChange={setMode} />
            <span className="hidden text-[10px] text-[var(--color-ink-3)] sm:inline">
              {mode === "kron" ? "Preview, bind, revalidate, enforce." : "Raw action only. No preview or rewrite."}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={btnAccent}
              disabled={scenario.isPending}
              onClick={() => scenario.mutate(mode === "baseline" ? "baseline" : "hero")}
            >
              {scenario.isPending ? "Running…" : mode === "baseline" ? "Run baseline attack" : "Run hero attack"}
            </button>
            <button className={btnGhost} disabled={scenario.isPending} onClick={() => scenario.mutate("delete")}>
              Bulk delete
            </button>
            <button className={btnGhost} disabled={driftScenario.isPending} onClick={() => driftScenario.mutate()}>
              {driftScenario.isPending ? "Simulating…" : "Shadow drift"}
            </button>
          </div>
        </div>
      </header>

      {notice ? (
        <div className="flex items-start gap-3 border-l-2 border-[var(--color-accent)] pl-3 text-[11px] leading-5 text-[var(--color-ink-2)]">
          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]" />
          <span className="flex-1">{notice}</span>
          <button className={btnQuiet} onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {mode === "baseline" ? (
        <div className="border-l-2 border-[var(--color-danger)] bg-[var(--color-danger-soft)]/35 px-4 py-3 text-[11px] leading-5 text-[var(--color-danger)]">
          <strong className="font-semibold">Baseline toggle on.</strong> The approval desk receives only the tool name
          and arguments. No impact preview, risk score, safe rewrite or revalidation.
        </div>
      ) : null}

      {drift ? <DriftPanel drift={drift} onClose={() => setDrift(null)} /> : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card className="overflow-hidden xl:col-span-4">
          <CardHeader
            title="Queue"
            subtitle={`${approvals.length} action${approvals.length === 1 ? "" : "s"} waiting for a human`}
            right={
              approvals.length > 0 ? (
                <Status tone="warn" pulse>
                  Action needed
                </Status>
              ) : (
                <Status tone="ok">Clear</Status>
              )
            }
          />
          <div className="max-h-[620px] divide-y divide-[var(--color-line)] overflow-y-auto">
            {approvalsQuery.isPending ? (
              <Spinner label="Loading cards…" />
            ) : approvals.length === 0 ? (
              <div className="px-5 py-12 text-center text-[11px] leading-5 text-[var(--color-ink-3)]">
                No pending actions.
                <br />
                Run a scenario to create one.
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

        <Card className="overflow-hidden xl:col-span-8">
          <CardHeader
            title="Impact card"
            subtitle={selected ? `${selected.tool} · ${shortId(selected.id, 10)}` : "Select a pending approval"}
            right={
              selected ? (
                <div className="text-right">
                  <Eyebrow>Risk</Eyebrow>
                  <div className="mt-1 font-mono text-[24px] font-medium leading-none tabular-nums text-[var(--color-ink)]">
                    {selected.riskScore}
                    <span className="ml-1 text-[11px] font-normal text-[var(--color-ink-3)]">/100</span>
                  </div>
                </div>
              ) : null
            }
          />
          {!selected ? (
            <div className="px-5 py-16 text-center text-[12px] text-[var(--color-ink-3)]">
              Run the hero scenario or the bulk delete scenario to populate the desk.
            </div>
          ) : (
            <div className="space-y-5 p-5">
              <div className="grid grid-cols-1 gap-4 border-b border-[var(--color-line)] pb-4 sm:grid-cols-3">
                <Meta label="Decision">
                  <Status tone={decisionTone(selected.decision)}>{selected.decision}</Status>
                </Meta>
                <Meta label="Bound action hash">
                  <span className="font-mono text-[10px]">{shortId(selected.actionHash, 14)}</span>
                </Meta>
                <Meta label="Expires">
                  <span className="tabular-nums">
                    {fmtTs(selected.expiresAt)} · {selected.mode}
                  </span>
                </Meta>
              </div>

              <div className="text-[10px] leading-5 text-[var(--color-ink-3)]">
                Any argument change requires a fresh approval. The hash above is the consent boundary.
              </div>

              <ImpactCard approval={selected} />

              <div className="grid grid-cols-1 gap-5 border-t border-[var(--color-line)] pt-5 md:grid-cols-2 md:divide-x md:divide-[var(--color-line)]">
                <div className="md:pr-5">
                  <Eyebrow>Why held</Eyebrow>
                  <ul className="mt-2 space-y-2 text-[11px] leading-5 text-[var(--color-ink-2)]">
                    {selected.reasons.slice(0, 6).map((reason, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="md:pl-5">
                  <Eyebrow>Raw action</Eyebrow>
                  <pre className="mt-2 max-h-40 overflow-auto border-l border-[var(--color-line)] pl-3 font-mono text-[10px] leading-relaxed text-[var(--color-ink-2)]">
                    {JSON.stringify(selected.actionJson, null, 2)}
                  </pre>
                </div>
              </div>

              {selected.safeActionJson ? (
                <div className="-mx-5 border-y border-[#a8cfb8] bg-[var(--color-success-soft)]/35 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Status tone="ok">Safe alternative</Status>
                      <div className="mt-1.5 text-[13px] font-semibold text-[var(--color-ink)]">{selected.safeLabel}</div>
                      <div className="mt-1 text-[10px] text-[var(--color-ink-3)]">
                        Alternative, not equivalent. It is revalidated through the full pipeline before execution and
                        can still be blocked.
                      </div>
                    </div>
                    {selected.safeActionHash ? (
                      <span className="font-mono text-[9px] text-[var(--color-ink-3)]">
                        {shortId(selected.safeActionHash, 8)}
                      </span>
                    ) : null}
                  </div>
                  <ul className="mt-3 grid grid-cols-1 gap-x-5 gap-y-1.5 text-[11px] leading-5 text-[var(--color-ink-2)] md:grid-cols-2">
                    {selected.differences.map((difference, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--color-success)]" />
                        <span>{difference}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      className={btnAccent}
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ target: "safe" })}
                    >
                      {decide.isPending ? "Executing…" : "Approve safe version"}
                    </button>
                    <span className="text-[10px] text-[var(--color-ink-3)]">Consent binds to the rewritten hash.</span>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-4">
                <button className={btnGhost} disabled={decide.isPending} onClick={() => decide.mutate({ target: "original" })}>
                  Approve original
                </button>
                <button className={btnDanger} disabled={reject.isPending} onClick={() => reject.mutate()}>
                  Reject
                </button>
                <span className="ml-auto text-[10px] tabular-nums text-[var(--color-ink-3)]">
                  preview expires {fmtTs(selected.expiresAt)}
                </span>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <GlassCard className="overflow-hidden xl:col-span-4">
          <CardHeader
            title="Evidence"
            subtitle="Real sandbox SQLite · attacker inbox · order table"
            right={
              <Status tone={(proof?.mail.attackerMessages ?? 0) === 0 ? "ok" : "err"}>
                {(proof?.mail.attackerMessages ?? 0) === 0 ? "No leak" : "Leak detected"}
              </Status>
            }
          />
          <div className="space-y-4 p-4">
            <Ledger columns={2}>
              <LedgerCell
                label="Attacker inbox"
                value={fmtInt(proof?.mail.attackerMessages ?? 0)}
                tone={
                  (proof?.mail.attackerMessages ?? 0) === 0
                    ? "text-[var(--color-success)]"
                    : "text-[var(--color-danger)]"
                }
                sub={proof?.mail.attackerAddress}
              />
              <LedgerCell label="Outbound mail" value={fmtInt(proof?.mail.outbound ?? 0)} sub="sandbox sink" />
              <LedgerCell label="Orders total" value={fmtInt(proof?.orders.total ?? 0)} sub="one shared table" />
              <LedgerCell
                label="Active orders"
                value={fmtInt(proof?.orders.active ?? 0)}
                tone={
                  (proof?.orders.active ?? 0) === (proof?.orders.total ?? 0)
                    ? "text-[var(--color-ink)]"
                    : "text-[var(--color-warning)]"
                }
                sub={(proof?.orders.archived ?? 0) > 0 ? `${fmtInt(proof?.orders.archived)} archived` : "no archive"}
              />
            </Ledger>

            <div>
              <div className="flex items-baseline justify-between">
                <Eyebrow>Sandbox mail</Eyebrow>
                <span className="font-mono text-[9px] text-[var(--color-ink-3)]">
                  {proof?.mail.messages.length ?? 0} messages
                </span>
              </div>
              <div className="mt-2 max-h-44 divide-y divide-[var(--color-line)] overflow-y-auto">
                {(proof?.mail.messages ?? []).slice(0, 6).map((m) => (
                  <div key={m.id} className="flex items-start gap-2.5 py-2">
                    <span
                      className={`mt-0.5 w-6 shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] ${
                        m.direction === "outbound" ? "text-[var(--color-accent)]" : "text-[var(--color-ink-3)]"
                      }`}
                    >
                      {m.direction === "outbound" ? "OUT" : "IN"}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[10px] font-medium text-[var(--color-ink-2)]">{m.subject}</div>
                      <div className="truncate font-mono text-[9px] text-[var(--color-ink-3)]">{m.to}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="overflow-hidden xl:col-span-8">
          <CardHeader
            title="Live timeline"
            subtitle="Hash-chained control events · SSE + poll"
            right={
              <div className="flex items-center gap-3">
                <Status tone={verification?.ok ? "ok" : "err"}>
                  {verification?.ok ? `Chain intact · ${verification.checked}` : "Tamper detected"}
                </Status>
                {isAdmin ? (
                  <button className={btnQuiet} disabled={tamper.isPending} onClick={() => tamper.mutate()}>
                    Tamper
                  </button>
                ) : null}
              </div>
            }
          />
          <div className="grid grid-cols-1 lg:grid-cols-2">
            <div className="max-h-[420px] divide-y divide-[var(--color-line)] overflow-y-auto border-b border-[var(--color-line)] lg:border-b-0 lg:border-r">
              {(auditQuery.data?.entries ?? []).map((entry) => (
                <div key={entry.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[11px] leading-5 text-[var(--color-ink-2)]">{entry.summary}</span>
                    <span className="shrink-0 font-mono text-[9px] tabular-nums text-[var(--color-ink-3)]">
                      #{entry.seq}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[9px] text-[var(--color-ink-3)]">
                    <span>{entry.action}</span>
                    <span className="text-[#c9bfa8]">/</span>
                    <span>{shortId(entry.hash, 6)}</span>
                    <span className="text-[#c9bfa8]">/</span>
                    <span className="tabular-nums">{fmtTs(entry.ts)}</span>
                  </div>
                </div>
              ))}
              {(auditQuery.data?.entries ?? []).length === 0 ? (
                <div className="px-4 py-12 text-center text-[11px] text-[var(--color-ink-3)]">
                  No control events yet.
                </div>
              ) : null}
            </div>
            <div className="overflow-hidden">
              <LiveFeed limit={80} plain />
            </div>
          </div>
        </GlassCard>
      </div>

      <GlassCard className="overflow-hidden">
        <CardHeader
          title="Enforcement receipts"
          subtitle="Hash-chained proof of what ran, what was blocked, and which one-shot grant authorised it"
          right={
            <Status
              tone={
                receiptVerify.data?.verification.ok === true
                  ? "ok"
                  : receiptVerify.data?.verification.ok === false
                    ? "err"
                    : "muted"
              }
            >
              {receiptVerify.data?.verification.ok === true
                ? `Chain intact · ${receiptVerify.data.verification.checked}`
                : receiptVerify.data?.verification.ok === false
                  ? "Receipt chain broken"
                  : "Checking receipts…"}
            </Status>
          }
        />
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-[44px_82px_150px_minmax(0,1fr)_190px_72px_96px] gap-3 border-b border-[var(--color-line)] px-5 py-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
              <span>Seq</span>
              <span>Status</span>
              <span>Tool</span>
              <span>Event</span>
              <span>Proof</span>
              <span>Grant</span>
              <span className="text-right">Receipt</span>
            </div>
            {(receiptsQuery.data?.receipts ?? []).map((receipt) => (
              <div
                key={receipt.id}
                className="grid grid-cols-[44px_82px_150px_minmax(0,1fr)_190px_72px_96px] items-center gap-3 border-b border-[var(--color-line)]/60 px-5 py-3 last:border-0 hover:bg-[var(--color-surface-3)]/40"
              >
                <span className="font-mono text-[9px] tabular-nums text-[var(--color-ink-3)]">#{receipt.seq}</span>
                <Status tone={receiptTone(receipt.status)}>{receipt.status}</Status>
                <span className="truncate font-mono text-[11px] font-medium text-[var(--color-ink)]">{receipt.tool}</span>
                <span className="truncate text-[11px] text-[var(--color-ink-2)]">{receipt.summary}</span>
                <span className="font-mono text-[9px] tabular-nums text-[var(--color-ink-3)]">
                  attacker {receipt.before.attackerMessages}→{receipt.after.attackerMessages} · archived{" "}
                  {receipt.before.ordersArchived}→{receipt.after.ordersArchived}
                </span>
                <span className="font-mono text-[9px] uppercase text-[var(--color-ink-3)]">
                  {receipt.grant ? receipt.grant.status : "—"}
                </span>
                <div className="flex items-center justify-end gap-2">
                  <span className="whitespace-nowrap font-mono text-[9px] text-[var(--color-ink-3)]">
                    {shortId(receipt.hash, 6)}
                  </span>
                  <button
                    className={btnQuiet}
                    onClick={() => downloadReceipt(receipt)}
                    title="Download the signed receipt JSON"
                  >
                    JSON
                  </button>
                </div>
              </div>
            ))}
            {(receiptsQuery.data?.receipts ?? []).length === 0 ? (
              <div className="px-5 py-12 text-center text-[11px] text-[var(--color-ink-3)]">
                No receipts yet. Every decision will produce one.
              </div>
            ) : null}
          </div>
        </div>
      </GlassCard>

      {scenario.isError ? (
        <ErrorBox message={scenario.error instanceof Error ? scenario.error.message : "Scenario failed"} />
      ) : null}
    </div>
  );
}
