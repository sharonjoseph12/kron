import { type ReactNode } from "react";
import { badgeClass, badgeDot, type BadgeTone } from "../lib/format.js";

/* ------------------------------------------------------------------ */
/* Card variants (warm paper, hairline edges)                          */
/* ------------------------------------------------------------------ */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card anim-fade-in ${className}`}>{children}</div>;
}

export function GlassCard({
  children,
  className = "",
  accent = false,
}: {
  children: ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return <div className={`${accent ? "accent-card" : "card"} anim-fade-in ${className}`}>{children}</div>;
}

export function CardHeader({
  title,
  subtitle,
  right,
  actions,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
      <div className="min-w-0">
        <h2 className="display-serif text-[15px] font-semibold leading-5 tracking-tight text-[var(--color-ink)]">
          {title}
        </h2>
        {subtitle ? <p className="mt-1 text-[11px] leading-5 text-[var(--color-ink-3)]">{subtitle}</p> : null}
      </div>
      {right}
      {actions}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badges & On-Chain Indicators                                        */
/* ------------------------------------------------------------------ */

export function Badge({
  tone = "muted",
  children,
  pulse = false,
  dot = false,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  pulse?: boolean;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${badgeClass[tone]}`}
    >
      {dot ? (
        <span className={`h-1.5 w-1.5 rounded-full ${badgeDot[tone]} ${pulse ? "anim-soft-pulse" : ""}`} />
      ) : null}
      {children}
    </span>
  );
}

/** On-chain verified badge — quiet checkmark + link to AlgoExplorer. */
export function OnChainBadge({ txId, explorerUrl }: { txId?: string | null; explorerUrl?: string | null }) {
  if (!txId) return null;
  const inner = (
    <span className="badge-onchain cursor-pointer">
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
        <path
          fillRule="evenodd"
          d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
          clipRule="evenodd"
        />
      </svg>
      On-chain
    </span>
  );
  if (explorerUrl) {
    return (
      <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
        {inner}
      </a>
    );
  }
  return inner;
}

/** Atomic transaction group badge showing on-chain policy anchor. */
export function AtomicGroupBadge({ appId }: { appId?: number | null }) {
  if (!appId) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-mono font-semibold text-[#b8451f] ring-1 ring-[#e0a185]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] anim-live-ping" />
      Atomic Group · App #{appId}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Spinner, Error, Mono                                                */
/* ------------------------------------------------------------------ */

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-[var(--color-ink-3)]">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-line)] border-t-[var(--color-accent)]" />
      {label ?? "Loading…"}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="border-l-2 border-[var(--color-danger)] bg-[var(--color-danger-soft)]/50 px-4 py-2.5 text-[12px] text-[var(--color-danger)]">
      {message}
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px] tracking-tight text-[var(--color-ink-2)]">{children}</span>;
}

/* ------------------------------------------------------------------ */
/* Form primitives (warm cream inputs, charcoal edges)                 */
/* ------------------------------------------------------------------ */

export const inputClass =
  "w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-3)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder-[var(--color-ink-3)] outline-none transition focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[rgba(224,95,60,0.14)]";

export const labelClass = "mb-1 block text-[11px] font-semibold tracking-wide text-[var(--color-ink-2)]";

export const btnPrimary =
  "btn-indus px-3.5 py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-50";

export const btnAccent =
  "btn-indus px-3.5 py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-50";

export const btnGhost =
  "btn-cream px-3.5 py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-50";

export const btnQuiet =
  "inline-flex items-center justify-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium text-[var(--color-ink-3)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-50";

export const btnDanger =
  "btn-cream px-3.5 py-2 text-[13px] text-[var(--color-danger)] border-[#e5b0a6] bg-[var(--color-danger-soft)] disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[#f5cdc4] hover:text-[#a03220]";

/* ------------------------------------------------------------------ */
/* Stat                                                                */
/* ------------------------------------------------------------------ */

export function Stat({
  label,
  value,
  sub,
  accent = "text-[var(--color-ink)]",
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
  icon?: ReactNode;
}) {
  return (
    <GlassCard accent className="px-4 py-4">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-2 font-mono text-[24px] font-medium leading-none tabular-nums ${accent}`}>{value}</div>
      {sub ? <div className="mt-1.5 text-[11px] text-[var(--color-ink-3)]">{sub}</div> : null}
    </GlassCard>
  );
}

/* ------------------------------------------------------------------ */
/* Explorer link helper                                                */
/* ------------------------------------------------------------------ */

export function ExplorerLink({
  url,
  children,
  className = "",
}: {
  url: string | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  if (!url) return <>{children}</>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 text-[var(--color-accent)] hover:text-[#b8451f] transition-colors ${className}`}
    >
      {children}
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 opacity-50">
        <path d="M6.22 8.72a.75.75 0 0 0 1.06 1.06l5.22-5.22v1.69a.75.75 0 0 0 1.5 0v-3.5a.75.75 0 0 0-.75-.75h-3.5a.75.75 0 0 0 0 1.5h1.69L6.22 8.72Z" />
        <path d="M3.5 6.75c0-.69.56-1.25 1.25-1.25H7A.75.75 0 0 0 7 4H4.75A2.75 2.75 0 0 0 2 6.75v4.5A2.75 2.75 0 0 0 4.75 14h4.5A2.75 2.75 0 0 0 12 11.25V9a.75.75 0 0 0-1.5 0v2.25c0 .69-.56 1.25-1.25 1.25h-4.5c-.69 0-1.25-.56-1.25-1.25v-4.5Z" />
      </svg>
    </a>
  );
}

/** Network badge (TESTNET, LOCALNET, MAINNET). */
export function NetworkBadge({ network }: { network: string }) {
  const cls = network === "testnet" ? "testnet" : network === "mainnet" ? "mainnet" : "localnet";
  return <span className={`network-badge ${cls}`}>{network.toUpperCase()}</span>;
}

/* ------------------------------------------------------------------ */
/* Modal Component                                                     */
/* ------------------------------------------------------------------ */

export function Modal({
  title,
  isOpen,
  onClose,
  children,
}: {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(36,35,31,0.42)] p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-3)] p-6 shadow-2xl anim-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-[var(--color-line)]">
          <h3 className="display-serif text-base font-semibold tracking-tight text-[var(--color-ink)]">{title}</h3>
          <button onClick={onClose} className="text-[var(--color-ink-3)] hover:text-[var(--color-ink)]">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}