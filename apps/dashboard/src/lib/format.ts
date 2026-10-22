import type { PolicyDecision } from "@kron/shared";

export function fmtAlgo(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US");
}

export function shortId(id: string | null | undefined, n = 8): string {
  if (!id) return "—";
  if (id.length <= n * 2 + 1) return id;
  return `${id.slice(0, n)}…${id.slice(-n)}`;
}

export function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export type BadgeTone = "ok" | "warn" | "err" | "info" | "muted" | "accent";

export const badgeClass: Record<BadgeTone, string> = {
  ok: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  warn: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  err: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  info: "bg-[#e3eef6] text-[var(--color-info)]",
  muted: "bg-[var(--color-surface-2)] text-[var(--color-ink-3)]",
  accent: "bg-[var(--color-accent-soft)] text-[#a84322]",
};

export const badgeDot: Record<BadgeTone, string> = {
  ok: "bg-[var(--color-success)]",
  warn: "bg-[var(--color-warning)]",
  err: "bg-[var(--color-danger)]",
  info: "bg-[var(--color-info)]",
  muted: "bg-[var(--color-ink-3)]",
  accent: "bg-[var(--color-accent)]",
};

export function decisionTone(d: PolicyDecision | string | null | undefined): BadgeTone {
  if (d === "AUTO_APPROVED") return "ok";
  if (d === "ESCALATED") return "warn";
  if (d === "BLOCKED") return "err";
  return "muted";
}

export function decisionColor(d: PolicyDecision | string | null | undefined): string {
  if (d === "AUTO_APPROVED") return "#2f7d5e";
  if (d === "ESCALATED") return "#9a6b12";
  if (d === "BLOCKED") return "#c0392b";
  return "#968b75";
}

const paymentStatusToneMap: Record<string, BadgeTone> = {
  confirmed: "ok",
  authorized: "ok",
  submitted: "info",
  signing: "info",
  evaluated: "info",
  requested: "info",
  reconciling: "warn",
  escalated: "warn",
  insufficient_balance: "warn",
  blocked: "err",
  timeout: "err",
  failed: "err",
};

export function paymentStatusTone(status: string): BadgeTone {
  return paymentStatusToneMap[status] ?? "muted";
}

const agentStatusToneMap: Record<string, BadgeTone> = {
  idle: "muted",
  running: "ok",
  waiting: "warn",
  payment_processing: "warn",
  completed: "info",
  failed: "err",
};

export function agentStatusTone(status: string): BadgeTone {
  return agentStatusToneMap[status] ?? "muted";
}

const mcpStatusToneMap: Record<string, BadgeTone> = {
  healthy: "ok",
  degraded: "warn",
  offline: "err",
  disabled: "muted",
};

export function mcpStatusTone(status: string): BadgeTone {
  return mcpStatusToneMap[status] ?? "muted";
}