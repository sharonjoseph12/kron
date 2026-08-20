import { useEffect, useState } from "react";
import type { TimelineEvent } from "@kron/shared";
import { GlassCard, CardHeader, OnChainBadge } from "./ui.js";
import { fmtTs } from "../lib/format.js";

/* ------------------------------------------------------------------ */
/* Step metadata — icons and labels for each timeline step             */
/* ------------------------------------------------------------------ */

const STEP_META: Record<string, { label: string; icon: string }> = {
  REQUEST: { label: "Payment Requested", icon: "M12 6v12M6 12h12" },
  "402_DETECTED": { label: "402 Detected", icon: "M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" },
  PRICE_DISCOVERED: { label: "Price Discovered", icon: "M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" },
  POLICY_EVAL: { label: "Policy Evaluated", icon: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" },
  SIGNED: { label: "Transaction Signed", icon: "M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" },
  SUBMITTED: { label: "Submitted to Chain", icon: "M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" },
  CONFIRMED: { label: "Confirmed On-Chain", icon: "M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" },
  PROOF_VERIFIED: { label: "Proof Verified", icon: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" },
  RESOURCE_DELIVERED: { label: "Resource Delivered", icon: "M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" },
  AGENT_CONTINUES: { label: "Agent Continues", icon: "M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" },
  BLOCKED: { label: "Blocked", icon: "M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" },
  ESCALATED: { label: "Escalated", icon: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" },
};

function stepStatus(status: string): "confirmed" | "pending" | "failed" | "blocked" {
  if (status === "confirmed") return "confirmed";
  if (status === "blocked") return "blocked";
  if (status === "failed" || status === "error") return "failed";
  return "pending";
}

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 100) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StepIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline component                                                  */
/* ------------------------------------------------------------------ */

export function PaymentTimeline({ events }: { events: TimelineEvent[] }) {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (events.length === 0) return;
    setVisibleCount(0);
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setVisibleCount(i);
      if (i >= events.length) clearInterval(interval);
    }, 120);
    return () => clearInterval(interval);
  }, [events.length]);

  if (events.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-[var(--color-ink-3)]">
        No timeline events yet — start a payment flow to see the lifecycle.
      </div>
    );
  }

  const times = events.map((e) => {
    const t = new Date(e.ts).getTime();
    return Number.isNaN(t) ? null : t;
  });
  let settlementIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.status === "confirmed") {
      settlementIdx = i;
      break;
    }
  }
  const totalMs =
    times[0] != null &&
    settlementIdx > 0 &&
    times[settlementIdx] != null &&
    times[settlementIdx]! >= times[0]!
      ? times[settlementIdx]! - times[0]!
      : null;

  return (
    <div className="px-4 py-3">
      <div className="relative">
        {events.map((event, idx) => {
          const visible = idx < visibleCount;
          const meta = STEP_META[event.step] ?? { label: event.step, icon: "M12 6v12M6 12h12" };
          const status = stepStatus(event.status);
          const isLast = idx === events.length - 1;
          const detail = (event.detail ?? {}) as Record<string, string | number | null | undefined>;
          const curMs = times[idx];
          const prevMs = idx > 0 ? times[idx - 1] : null;
          const elapsed = curMs != null && prevMs != null && curMs >= prevMs ? curMs - prevMs : null;
          const isSettlement = idx === settlementIdx && totalMs != null;

          return (
            <div
              key={event.id}
              className={`flex gap-3 transition-all duration-300 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}
              style={{ transitionDelay: `${idx * 60}ms` }}
            >
              {/* Dot + connector */}
              <div className="flex flex-col items-center">
                <div className={`timeline-dot ${status}`} />
                {!isLast && (
                  <div className={`timeline-connector flex-1 min-h-[28px] ${visible ? "active" : ""}`} />
                )}
              </div>

              {/* Content */}
              <div className="pb-4 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`${status === "confirmed" ? "text-[var(--color-success)]" : status === "blocked" ? "text-[var(--color-warning)]" : status === "failed" ? "text-[var(--color-danger)]" : "text-[var(--color-accent)]"}`}>
                    <StepIcon d={meta.icon} />
                  </span>
                  <span className="text-sm font-medium text-[var(--color-ink)]">{meta.label}</span>
                  {detail?.txId && (
                    <OnChainBadge txId={detail.txId as string} />
                  )}
                </div>
                <p className="mt-0.5 text-xs text-[var(--color-ink-3)] leading-relaxed">{event.message}</p>
                {detail?.policyHash && (
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--color-ink-3)]">
                    Policy hash: {(detail.policyHash as string).slice(0, 24)}…
                  </p>
                )}
                {detail?.appId && (
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--color-success)]">
                    App ID: {String(detail.appId)}
                  </p>
                )}
                <time className="text-[10px] text-[var(--color-ink-3)]">{fmtTs(event.ts)}</time>
                {elapsed != null && (
                  <span className="ml-1.5 inline-block rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 py-px font-mono text-[10px] leading-tight text-[var(--color-ink-3)]">
                    +{fmtDuration(elapsed)}
                  </span>
                )}
                {isSettlement && totalMs != null && (
                  <div className="mt-1.5">
                    <span className="inline-flex items-center gap-1 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 py-px font-mono text-[10px] leading-tight text-[var(--color-ink-3)]">
                      <span className="h-1 w-1 rounded-full bg-[var(--color-success)]" />
                      {fmtDuration(totalMs)} settlement
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PaymentTimelineCard({ events }: { events: TimelineEvent[] }) {
  return (
    <GlassCard accent>
      <CardHeader
        title="Payment lifecycle"
        subtitle="Real-time transaction flow with on-chain policy anchoring"
        right={
          events.length > 0 ? (
            <span className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500 anim-soft-pulse" />
              {events.length} steps
            </span>
          ) : null
        }
      />
      <PaymentTimeline events={events} />
    </GlassCard>
  );
}