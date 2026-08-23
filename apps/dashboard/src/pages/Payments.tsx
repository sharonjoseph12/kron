import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PaymentDTO } from "@kron/shared";
import { api } from "../api/client.js";
import {
  decisionTone,
  fmtAlgo,
  fmtTs,
  paymentStatusTone,
  shortId,
} from "../lib/format.js";
import {
  Badge,
  btnDanger,
  btnGhost,
  btnPrimary,
  Card,
  CardHeader,
  GlassCard,
  Mono,
  Spinner,
  ExplorerLink,
  OnChainBadge,
  AtomicGroupBadge,
} from "../components/ui.js";

export default function Payments() {
  const queryClient = useQueryClient();
  const payments = useQuery({
    queryKey: ["payments"],
    queryFn: () => api.listPayments({ limit: "100" }),
  });
  const agents = useQuery({ queryKey: ["agents"], queryFn: api.listAgents });

  const [escMap, setEscMap] = useState<Record<string, string>>({});
  const [selectedPayment, setSelectedPayment] = useState<PaymentDTO | null>(null);

  const list = payments.data?.payments ?? [];
  const nameOf = (agentId: string) =>
    agents.data?.agents.find((a) => a.id === agentId)?.name ?? shortId(agentId, 6);
  const escalated = list.filter((p) => p.status === "escalated");

  // Escalation ids aren't on the list DTO — hydrate them per escalated payment.
  const escalatedKey = escalated.map((p) => p.id).join(",");
  useEffect(() => {
    if (!escalatedKey) {
      setEscMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        escalated.map(async (p): Promise<[string, string | null]> => {
          try {
            const d = await api.getPayment(p.id);
            return [p.id, d.escalation?.id ?? null];
          } catch {
            return [p.id, null];
          }
        }),
      );
      if (!cancelled) {
        const m: Record<string, string> = {};
        for (const [pid, escId] of entries) if (escId) m[pid] = escId;
        setEscMap(m);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [escalatedKey]);

  const decide = useMutation({
    mutationFn: ({ escId, approve }: { escId: string; approve: boolean }) =>
      api.decideEscalation(escId, approve),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  return (
    <div className="space-y-6 stagger-children">
      <div className="anim-fade-up">
        <h1 className="display-serif text-2xl font-semibold tracking-tight text-[var(--color-ink)]">Payments & Escalations</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-3)]">
          Traceable payment lifecycle — from agent MCP tool requests to Algorand atomic transaction settlement.
        </p>
      </div>

      {/* Escalation queue */}
      <Card className="border-[#d9c48f]">
        <CardHeader
          title="Escalation Queue"
          subtitle="Autonomous payments awaiting human operator authorization"
          right={<Badge tone="warn">{escalated.length} pending</Badge>}
        />
        {escalated.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-[var(--color-ink-3)]">
            No escalations pending — all autonomous transactions evaluated within configured limits.
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-line)]">
            {escalated.map((p) => {
              const escId = escMap[p.id];
              const busy = decide.isPending && decide.variables?.escId === escId;
              return (
                <div key={p.id} className="spotlight flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[var(--color-ink)]">{p.resourceName}</span>
                      <Badge tone="warn">escalated</Badge>
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--color-ink-3)]">
                      <span className="font-mono">{nameOf(p.agentId)}</span> · {p.service} ·{" "}
                      <Mono>{shortId(p.recipient, 8)}</Mono>
                    </div>
                    {p.decisionReasons.length > 0 ? (
                      <div className="mt-0.5 text-[11px] text-[var(--color-warning)]">{p.decisionReasons[0]}</div>
                    ) : null}
                  </div>
                  <div className="font-mono text-sm font-semibold text-[var(--color-warning)]">{fmtAlgo(p.amountAlgo)} Ɖ</div>
                  <div className="flex items-center gap-2">
                    {escId ? (
                      <>
                        <button
                          onClick={() => decide.mutate({ escId, approve: true })}
                          disabled={busy}
                          className={btnPrimary}
                        >
                          Approve & Settle
                        </button>
                        <button
                          onClick={() => decide.mutate({ escId, approve: false })}
                          disabled={busy}
                          className={btnDanger}
                        >
                          Block
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] text-[var(--color-ink-3)]">loading…</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Payments table */}
      <Card>
        <CardHeader
          title="All Payments & Settlements"
          subtitle={`${list.length} payment requests (click any row for full on-chain atomic verification)`}
        />
        {payments.isPending ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] text-[11px] uppercase tracking-wider text-[var(--color-ink-3)]">
                  <th className="px-4 py-2.5 font-medium">Agent</th>
                  <th className="px-4 py-2.5 font-medium">Resource</th>
                  <th className="px-4 py-2.5 font-medium">Recipient</th>
                  <th className="px-4 py-2.5 font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Decision</th>
                  <th className="px-4 py-2.5 font-medium">On-Chain Proof</th>
                  <th className="px-4 py-2.5 font-medium">At</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <PaymentRow
                    key={p.id}
                    payment={p}
                    agentName={nameOf(p.agentId)}
                    onSelect={() => setSelectedPayment(p)}
                  />
                ))}
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-[var(--color-ink-3)]">
                      No payments recorded yet. Run the demo agent to generate live transactions.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Slide-In Payment Detail & Atomic Group Inspector */}
      {selectedPayment && (
        <PaymentDetailDrawer
          payment={selectedPayment}
          agentName={nameOf(selectedPayment.agentId)}
          onClose={() => setSelectedPayment(null)}
        />
      )}
    </div>
  );
}

function PaymentRow({
  payment: p,
  agentName,
  onSelect,
}: {
  payment: PaymentDTO;
  agentName: string;
  onSelect: () => void;
}) {
  return (
    <tr
      onClick={onSelect}
      className="spotlight trow-in border-b border-[var(--color-line)]/60 last:border-0 hover:bg-[var(--color-surface-2)]/60 cursor-pointer transition-colors"
    >
      <td className="px-4 py-2.5">
        <div className="text-[var(--color-ink)] font-medium">{agentName}</div>
        <div className="font-mono text-[10px] text-[var(--color-ink-3)]">{shortId(p.agentId, 6)}</div>
      </td>
      <td className="px-4 py-2.5">
        <div className="text-[var(--color-ink)]">{p.resourceName}</div>
        <div className="text-[11px] text-[var(--color-ink-3)]">{p.service}</div>
      </td>
      <td className="px-4 py-2.5">
        <Mono>{shortId(p.recipient, 10)}</Mono>
      </td>
      <td className="px-4 py-2.5 font-mono text-[var(--color-ink)] font-semibold">{fmtAlgo(p.amountAlgo)} Ɖ</td>
      <td className="px-4 py-2.5">
        <Badge tone={paymentStatusTone(p.status)}>{p.status}</Badge>
      </td>
      <td className="px-4 py-2.5">
        <Badge tone={decisionTone(p.decision)}>{p.decision ?? "—"}</Badge>
        {p.policyVersion != null ? (
          <div className="mt-0.5 font-mono text-[10px] text-[var(--color-ink-3)]">v{p.policyVersion}</div>
        ) : null}
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
          {p.appId && <AtomicGroupBadge appId={p.appId} />}
        </div>
      </td>
      <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--color-ink-3)]">{fmtTs(p.createdAt)}</td>
    </tr>
  );
}

function PaymentDetailDrawer({
  payment: p,
  agentName,
  onClose,
}: {
  payment: PaymentDTO;
  agentName: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(51,51,51,0.4)] backdrop-blur-sm" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl overflow-y-auto border-l border-[var(--color-line)] bg-[var(--color-surface)] p-6 space-y-6 shadow-2xl anim-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-line)] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="display-serif text-base font-semibold text-[var(--color-ink)]">Payment Traceability & Audit</h2>
              <Badge tone={paymentStatusTone(p.status)}>{p.status}</Badge>
            </div>
            <p className="font-mono text-xs text-[var(--color-ink-3)] mt-0.5">ID: {p.id}</p>
          </div>
          <button onClick={onClose} className={btnGhost}>
            Close
          </button>
        </div>

        {/* Amount & Resource */}
        <GlassCard accent className="p-4 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs uppercase tracking-wider text-[var(--color-ink-3)]">Settlement Amount</span>
            <span className="font-mono text-2xl font-bold text-[var(--color-success)]">{fmtAlgo(p.amountAlgo)} Ɖ ALGO</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs border-t border-[var(--color-line)] pt-3">
            <div>
              <span className="text-[var(--color-ink-3)] block">Resource:</span>
              <span className="font-medium text-[var(--color-ink)]">{p.resourceName}</span>
            </div>
            <div>
              <span className="text-[var(--color-ink-3)] block">Service:</span>
              <span className="font-medium text-[var(--color-ink)]">{p.service}</span>
            </div>
            <div>
              <span className="text-[var(--color-ink-3)] block">Agent:</span>
              <span className="font-medium text-[var(--color-ink)]">{agentName}</span>
            </div>
            <div>
              <span className="text-[var(--color-ink-3)] block">Network:</span>
              <span className="font-medium text-[var(--color-accent)] uppercase font-mono">{p.network}</span>
            </div>
          </div>
        </GlassCard>

        {/* Policy Decision Evaluation */}
        <Card className="p-4 space-y-3">
          <CardHeader
            title="Policy Decision Engine"
            subtitle={`Evaluated under Policy Version v${p.policyVersion ?? 1}`}
            right={<Badge tone={decisionTone(p.decision)}>{p.decision ?? "EVALUATED"}</Badge>}
          />
          <div className="space-y-1.5 pt-2">
            <span className="text-xs font-semibold text-[var(--color-ink-3)] uppercase tracking-wider">Evaluation Reasons:</span>
            {p.decisionReasons.length > 0 ? (
              p.decisionReasons.map((reason, idx) => (
                <div key={idx} className="text-xs text-[var(--color-ink-2)] bg-[var(--color-surface-2)] p-2 rounded border border-[var(--color-line)]">
                  • {reason}
                </div>
              ))
            ) : (
              <p className="text-xs text-[var(--color-ink-3)]">Autonomous criteria satisfied without exceptions.</p>
            )}
          </div>
        </Card>

        {/* On-Chain Atomic Transaction Group Inspector */}
        <GlassCard accent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--color-ink)]">Algorand On-Chain Proof</h3>
              <OnChainBadge txId={p.txId} explorerUrl={p.explorerUrl} />
            </div>
            {p.appId && <AtomicGroupBadge appId={p.appId} />}
          </div>

          <div className="space-y-3 text-xs pt-2">
            {p.txId && (
              <div>
                <span className="text-[var(--color-ink-3)] block mb-0.5">Payment Transaction ID:</span>
                <ExplorerLink url={p.explorerUrl ?? `https://testnet.explorer.perawallet.app/tx/${p.txId}`} className="font-mono text-xs break-all">
                  {p.txId}
                </ExplorerLink>
              </div>
            )}

            {p.appCallTxId && (
              <div>
                <span className="text-[var(--color-ink-3)] block mb-0.5">Policy Anchor App Call Tx ID:</span>
                <a
                  href={`https://testnet.explorer.perawallet.app/tx/${p.appCallTxId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View policy anchor app call transaction ${p.appCallTxId} on Pera Explorer`}
                  className="font-mono text-xs text-[var(--color-accent)] underline-offset-2 hover:underline break-all"
                >
                  {p.appCallTxId}
                  <span aria-hidden="true"> ↗</span>
                </a>
              </div>
            )}

            {p.policyHash && (
              <div>
                <span className="text-[var(--color-ink-3)] block mb-0.5">Anchored Policy Decision Hash (SHA-256):</span>
                <div className="font-mono text-[11px] text-[var(--color-success)] bg-[var(--color-surface-2)] p-2 rounded border border-[var(--color-line)] break-all">
                  {p.policyHash}
                </div>
              </div>
            )}

            <div>
              <span className="text-[var(--color-ink-3)] block mb-0.5">Recipient Address:</span>
              <Mono>{p.recipient}</Mono>
            </div>
          </div>

          {p.txId && (
            <div className="pt-2">
              <a
                href={p.explorerUrl ?? `https://testnet.explorer.perawallet.app/tx/${p.txId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-[var(--color-success-soft)] border border-[#a8cfb8] px-3 py-2 text-xs font-semibold text-[var(--color-success)] hover:bg-[#d3ead9] transition"
              >
                View Confirmed Block on Pera Explorer
              </a>
            </div>
          )}
        </GlassCard>

        {/* Idempotency & Trace Keys */}
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 space-y-1 font-mono text-[11px] text-[var(--color-ink-3)]">
          <div>Client Request ID: {p.clientRequestId}</div>
          <div>Session ID: {p.sessionId}</div>
          <div>Tool Call ID: {p.toolCallId}</div>
          <div>Timestamp: {fmtTs(p.createdAt)}</div>
        </div>
      </div>
    </div>
  );
}
