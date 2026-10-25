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
    <div className="space-y-6 stagger-children">
      <div className="anim-fade-up">
        <div className="flex items-center gap-2">
          <h1 className="display-serif text-xl font-semibold text-[var(--color-ink)]">On-Chain Policy Verification</h1>
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
                  className="rounded bg-[var(--color-surface-2)] border border-[var(--color-line)] px-2 py-1 font-mono text-[11px] text-[var(--color-ink-2)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-accent)] transition"
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
        <Card className="p-8 text-center border-[#e5b0a6] bg-[var(--color-danger-soft)]">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[#f5cdc4] text-[var(--color-danger)]">
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
          <div
            className={`rounded-xl border p-5 spotlight ${
              proof.verified
                ? "border-[#a8cfb8] bg-[var(--color-success-soft)]"
                : "border-[#d9c48f] bg-[var(--color-warning-soft)]"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-xl border ${
                    proof.verified
                      ? "bg-[#d3ead9] text-[var(--color-success)] border-[#a8cfb8]"
                      : "bg-[#f6e7bd] text-[var(--color-warning)] border-[#d9c48f]"
                  }`}
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {proof.verified ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v4m0 4h.01M10.3 3.9L2.4 17a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
                    )}
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs uppercase font-bold tracking-widest ${
                        proof.verified ? "text-[var(--color-success)]" : "text-[var(--color-warning)]"
                      }`}
                    >
                      {proof.verified ? "CRYPTOGRAPHICALLY VERIFIED" : "SANDBOX RECORD — NOT ON LEDGER"}
                    </span>
                    <OnChainBadge
                      txId={proof.onChainProof.txId}
                      explorerUrl={proof.payment.explorerUrl}
                      verified={proof.verified}
                    />
                    {proof.onChainProof.appId && <AtomicGroupBadge appId={proof.onChainProof.appId} />}
                  </div>
                  <div className="text-base font-medium text-[var(--color-ink)] mt-0.5">
                    {proof.onChainProof.statement}
                  </div>
                </div>
              </div>

              {proof.onChainProof.txId && proof.verified && (
                <ExplorerLink
                  url={proof.payment.explorerUrl}
                  className="rounded-lg border border-[#a8cfb8] bg-[var(--color-success-soft)] px-4 py-2 text-xs font-semibold text-[var(--color-success)] hover:bg-[#d3ead9] transition"
                >
                  View on Pera Explorer
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
                  {proof.onChainProof.txId && proof.verified ? (
                    <ExplorerLink
                      url={proof.payment.explorerUrl ?? `https://testnet.explorer.perawallet.app/tx/${proof.onChainProof.txId}`}
                      className="font-mono text-xs font-semibold"
                    >
                      {proof.onChainProof.txId}
                    </ExplorerLink>
                  ) : proof.onChainProof.txId ? (
                    <Mono>{proof.onChainProof.txId}</Mono>
                  ) : (
                    <span className="font-mono text-[var(--color-ink-3)]">—</span>
                  )}
                </div>

                {proof.onChainProof.appCallTxId && (
                  <div>
                    <span className="text-xs text-[var(--color-ink-3)] block">Policy Anchor App Call (Tx 1 of Group)</span>
                    <a
                      href={`https://testnet.explorer.perawallet.app/tx/${proof.onChainProof.appCallTxId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`View policy anchor app call transaction ${proof.onChainProof.appCallTxId} on Pera Explorer`}
                      className="font-mono text-xs text-[var(--color-accent)] underline-offset-2 hover:underline break-all"
                    >
                      {proof.onChainProof.appCallTxId}
                      <span aria-hidden="true"> ↗</span>
                    </a>
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
                  {proof.onChainProof.policyHash ? (
                    <div className="font-mono text-xs text-[var(--color-success)] bg-[var(--color-surface-2)] p-2.5 rounded-lg border border-[var(--color-line)] break-all">
                      {proof.onChainProof.policyHash}
                    </div>
                  ) : (
                    <div className="font-mono text-xs text-[var(--color-ink-3)] bg-[var(--color-surface-2)] p-2.5 rounded-lg border border-dashed border-[var(--color-line)] break-all">
                      Not anchored — standalone payment (no contract app call; pre-deployment or fallback)
                    </div>
                  )}
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

          {/* Independent Verification — "Don't trust us, verify" */}
          {proof.verified && proof.onChainProof.txId && (
            <Card className="p-5 space-y-3">
              <CardHeader
                title="Independent Verification"
                subtitle="Don't trust KRON — verify it yourself on the public Algorand ledger"
                right={<Badge tone="ok">Trustless</Badge>}
              />
              <div className="space-y-3 px-1">
                <p className="text-xs text-[var(--color-ink-2)]">
                  Run this command against the <strong className="text-[var(--color-ink)]">public Algorand indexer</strong> (no KRON dependency) to independently confirm the transaction settled on-chain:
                </p>
                <div className="relative group">
                  <pre className="font-mono text-[11px] text-[var(--color-accent)] bg-[#1a1a1a] text-[#e8dcc8] p-4 rounded-lg overflow-x-auto border border-[var(--color-line-strong)]">
                    <span className="text-[var(--color-ink-3)] select-none">$ </span>
                    {`curl -s https://testnet-idx.algonode.cloud/v2/transactions/${proof.onChainProof.txId} | jq '{confirmed_round: .transaction["confirmed-round"], sender: .transaction.sender, amount: .transaction["payment-transaction"].amount}'`}
                  </pre>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `curl -s https://testnet-idx.algonode.cloud/v2/transactions/${proof.onChainProof.txId} | jq '{confirmed_round: .transaction["confirmed-round"], sender: .transaction.sender, amount: .transaction["payment-transaction"].amount}'`
                      );
                    }}
                    className="absolute top-2 right-2 rounded bg-[var(--color-surface-2)] border border-[var(--color-line)] px-2 py-1 text-[10px] font-semibold text-[var(--color-ink-2)] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--color-surface-3)]"
                  >
                    Copy
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3 pt-1">
                  <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-3)]">What KRON says</div>
                    <div className="mt-0.5 font-mono text-xs font-semibold text-[var(--color-ink)]">Round #{proof.onChainProof.confirmedRound}</div>
                  </div>
                  <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-3)]">Amount</div>
                    <div className="mt-0.5 font-mono text-xs font-semibold text-[var(--color-success)]">{fmtAlgo(proof.payment.amountAlgo)} ALGO</div>
                  </div>
                  <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-3)]">Source</div>
                    <div className="mt-0.5 font-mono text-xs font-semibold text-[var(--color-info)]">Public Indexer</div>
                  </div>
                </div>
                <p className="text-[11px] text-[var(--color-ink-3)] italic">
                  The public Algorand indexer (algonode.cloud) is independent of KRON. If the round number and amount match, the payment is cryptographically proven.
                </p>
              </div>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}
