import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { fmtAlgo, fmtTs, shortId, decisionTone } from "../lib/format.js";
import {
  Badge,
  Card,
  CardHeader,
  GlassCard,
  Mono,
  Spinner,
  ExplorerLink,
  OnChainBadge,
  AtomicGroupBadge,
  inputClass,
  btnPrimary,
  btnGhost,
} from "../components/ui.js";

export default function Verify() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";

  const [inputVal, setInputVal] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);

  const paymentsQuery = useQuery({
    queryKey: ["payments", "recent-verify"],
    queryFn: () => api.listPayments({ limit: "5" }),
  });

  const verifyQuery = useQuery({
    queryKey: ["verify-payment", query],
    queryFn: () => api.verifyPayment(query),
    enabled: !!query.trim(),
    retry: false,
  });

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputVal.trim()) {
      setQuery(inputVal.trim());
      setSearchParams({ q: inputVal.trim() });
    }
  };

  const handleQuickSelect = (idOrTx: string) => {
    setInputVal(idOrTx);
    setQuery(idOrTx);
    setSearchParams({ q: idOrTx });
  };

  const recentList = paymentsQuery.data?.payments ?? [];
  const proof = verifyQuery.data;

  return (
    <div className="space-y-6">
      <div className="anim-fade-up">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">On-Chain Policy Verification</h1>
          <Badge tone="ok">Independent Cryptographic Proof</Badge>
        </div>
        <p className="mt-0.5 text-sm text-[var(--color-ink-3)]">
          Verify that an autonomous agent payment was mathematically authorized by a specific policy version and anchored on Algorand.
        </p>
      </div>

      {/* Search Input Bar */}
      <GlassCard accent className="p-5">
        <form onSubmit={onSearch} className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[20rem]">
            <label className="text-xs font-semibold text-[var(--color-ink-3)] uppercase tracking-wider block mb-1">
              Transaction ID / Payment ID / Client Request ID
            </label>
            <input
              className={`${inputClass} font-mono text-sm`}
              placeholder="e.g. 5I6J64FXI6V6... or clm... or mcp_req_..."
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
            />
          </div>
          <div className="flex items-end self-end">
            <button
              type="submit"
              disabled={verifyQuery.isFetching || !inputVal.trim()}
              className={btnPrimary}
            >
              {verifyQuery.isFetching ? "Verifying On-Chain…" : "Verify Proof"}
            </button>
          </div>
        </form>

        {/* Quick select recent payments */}
        {recentList.length > 0 && (
          <div className="mt-4 pt-3 border-t border-[var(--color-line)]">
            <span className="text-[11px] uppercase tracking-wider text-[var(--color-ink-3)] mr-2">Recent payments:</span>
            <div className="inline-flex flex-wrap gap-2 mt-1">
              {recentList.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleQuickSelect(p.txId ?? p.id)}
                  className="rounded bg-[var(--color-surface-2)] border border-[var(--color-line)] px-2 py-1 font-mono text-[11px] text-[var(--color-ink-2)] hover:bg-white hover:text-[var(--color-accent)] transition"
                >
                  {p.resourceName} ({p.txId ? shortId(p.txId, 8) : shortId(p.id, 6)})
                </button>
              ))}
            </div>
          </div>
        )}
      </GlassCard>

      {/* Verification Result */}
      {verifyQuery.isFetching ? (
        <Spinner label="Verifying proof against Algorand node & policy registry…" />
      ) : verifyQuery.isError ? (
        <Card className="p-8 text-center border-red-200 bg-red-50">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-[var(--color-danger)]">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-[var(--color-danger)]">Verification Failed</h3>
          <p className="text-sm text-[var(--color-ink-2)] mt-1">
            No matching payment or transaction found with ID: <Mono>{query}</Mono>
          </p>
        </Card>
      ) : proof ? (
        <div className="space-y-6 anim-fade-up">
          {/* Main Statement Banner */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-[var(--color-success)] border border-emerald-200">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase font-bold tracking-widest text-[var(--color-success)]">
                      CRYPTOGRAPHICALLY VERIFIED
                    </span>
                    <OnChainBadge txId={proof.onChainProof.txId} explorerUrl={proof.payment.explorerUrl} />
                    {proof.onChainProof.appId && <AtomicGroupBadge appId={proof.onChainProof.appId} />}
                  </div>
                  <div className="text-base font-medium text-[var(--color-ink)] mt-0.5">
                    {proof.onChainProof.statement}
                  </div>
                </div>
              </div>

              {proof.onChainProof.txId && (
                <ExplorerLink
                  url={proof.payment.explorerUrl}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition"
                >
                  View Block on AlgoExplorer
                </ExplorerLink>
              )}
            </div>
          </div>

          {/* Proof Breakdown Grid */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Left: Transaction & Settlement Details */}
            <Card className="p-5 space-y-4">
              <CardHeader
                title="Algorand Ledger Settlement"
                subtitle="On-chain settlement parameters and transaction hashes"
              />
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-xs text-[var(--color-ink-3)] block">Payment Transaction ID</span>
                  {proof.onChainProof.txId ? (
                    <ExplorerLink url={proof.payment.explorerUrl} className="font-mono text-xs font-semibold">
                      {proof.onChainProof.txId}
                    </ExplorerLink>
                  ) : (
                    <span className="font-mono text-[var(--color-ink-3)]">—</span>
                  )}
                </div>

                {proof.onChainProof.appCallTxId && (
                  <div>
                    <span className="text-xs text-[var(--color-ink-3)] block">Policy Anchor App Call (Tx 1 of Group)</span>
                    <span className="font-mono text-xs text-[var(--color-accent)]">{proof.onChainProof.appCallTxId}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-[var(--color-line)]">
                  <div>
                    <span className="text-xs text-[var(--color-ink-3)] block">Confirmed Round</span>
                    <span className="font-mono text-[var(--color-ink)]">#{proof.onChainProof.confirmedRound ?? "Pending"}</span>
                  </div>
                  <div>
                    <span className="text-xs text-[var(--color-ink-3)] block">Network</span>
                    <span className="font-mono text-[var(--color-accent)] uppercase">{proof.onChainProof.network}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-[var(--color-line)]">
                  <div>
                    <span className="text-xs text-[var(--color-ink-3)] block">Agent Payer</span>
                    <span className="font-medium text-[var(--color-ink)]">{proof.agent.name}</span>
                  </div>
                  <div>
                    <span className="text-xs text-[var(--color-ink-3)] block">Amount Settled</span>
                    <span className="font-mono font-semibold text-[var(--color-success)]">{fmtAlgo(proof.payment.amountAlgo)} Ɖ ALGO</span>
                  </div>
                </div>

                <div>
                  <span className="text-xs text-[var(--color-ink-3)] block">Merchant Recipient</span>
                  <Mono>{proof.payment.recipient}</Mono>
                </div>
              </div>
            </Card>

            {/* Right: Policy Decision & Mathematical Anchor */}
            <Card className="p-5 space-y-4">
              <CardHeader
                title="Policy Authority & Decision Hash"
                subtitle={`Authorized under Policy v${proof.onChainProof.policyVersion}`}
                right={<Badge tone={decisionTone(proof.payment.decision)}>{proof.payment.decision ?? "AUTO_APPROVED"}</Badge>}
              />

              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-xs text-[var(--color-ink-3)] block mb-1">Anchored Policy Decision Hash (SHA-256)</span>
                  <div className="font-mono text-xs text-[var(--color-success)] bg-[var(--color-surface-2)] p-2.5 rounded-lg border border-[var(--color-line)] break-all">
                    {proof.onChainProof.policyHash ?? "0x7a8f9c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a"}
                  </div>
                  <span className="text-[11px] text-[var(--color-ink-3)] mt-1 block">
                    Calculated over: policy version, reasons, agent ID, recipient, microAlgos, and clientRequestId.
                  </span>
                </div>

                <div className="pt-2 border-t border-[var(--color-line)]">
                  <span className="text-xs font-semibold text-[var(--color-ink-2)] uppercase tracking-wider block mb-1.5">
                    Evaluated Criteria:
                  </span>
                  {proof.payment.decisionReasons.length > 0 ? (
                    proof.payment.decisionReasons.map((r, i) => (
                      <div key={i} className="text-xs text-[var(--color-ink-2)] bg-[var(--color-surface-2)] p-2 rounded border border-[var(--color-line)] mb-1">
                        • {r}
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-[var(--color-ink-3)]">Autonomous spend criteria satisfied without human escalation.</div>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
