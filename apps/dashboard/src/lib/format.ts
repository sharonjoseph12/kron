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
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warn: "bg-amber-50 text-amber-700 ring-amber-200",
  err: "bg-red-50 text-red-700 ring-red-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  muted: "bg-stone-100 text-stone-500 ring-stone-200",
  accent: "bg-indigo-50 text-indigo-700 ring-indigo-200",
};

export function decisionTone(d: PolicyDecision | string | null | undefined): BadgeTone {
  if (d === "AUTO_APPROVED") return "ok";
  if (d === "ESCALATED") return "warn";
  if (d === "BLOCKED") return "err";
  return "muted";
}

export function decisionColor(d: PolicyDecision | string | null | undefined): string {
  if (d === "AUTO_APPROVED") return "#059669";
  if (d === "ESCALATED") return "#d97706";
  if (d === "BLOCKED") return "#dc2626";
  return "#a8a29e";
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