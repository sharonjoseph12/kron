import { useEffect, useRef, useState } from "react";
import type { StreamEvent } from "@kron/shared";
import { API_BASE } from "../api/client.js";
import { fmtTs, badgeClass, type BadgeTone } from "../lib/format.js";

interface FeedEntry {
  id: string;
  ts: string;
  kind: string;
  summary: string;
  badge: BadgeTone;
}

const EVENT_TYPES = [
  "hello",
  "session.updated",
  "agent.updated",
  "timeline",
  "tool.call",
  "payment.created",
  "payment.updated",
  "decision",
  "policy.updated",
  "wallet.updated",
  "mcp.health",
  "audit",
  "ping",
] as const;

function describe(ev: StreamEvent): FeedEntry | null {
  switch (ev.type) {
    case "hello":
      return { id: `hello-${ev.ts}`, ts: ev.ts, kind: "hello", summary: "Connected to live event stream", badge: "info" };
    case "payment.created":
      return {
        id: ev.payment.id,
        ts: ev.payment.createdAt,
        kind: "payment.created",
        summary: `Payment created — ${ev.payment.amountAlgo} ALGO for ${ev.payment.resourceName}`,
        badge: "ok",
      };
    case "payment.updated":
      return {
        id: ev.payment.id,
        ts: ev.payment.updatedAt,
        kind: "payment.updated",
        summary: `Payment ${ev.payment.status} — ${ev.payment.amountAlgo} ALGO · ${ev.payment.resourceName}`,
        badge: ev.payment.status === "confirmed" ? "ok" : ev.payment.status === "blocked" ? "err" : ev.payment.status === "escalated" ? "warn" : "info",
      };
    case "decision": {
      const req = ev.request as { resourceName?: string; resourceId?: string } | undefined;
      const label = req?.resourceName ?? req?.resourceId ?? "payment";
      return {
        id: ev.paymentId,
        ts: new Date().toISOString(),
        kind: "decision",
        summary: `Decision ${ev.decision.decision} — ${ev.decision.requestedAlgo} ALGO for ${label}`,
        badge: ev.decision.decision === "AUTO_APPROVED" ? "ok" : ev.decision.decision === "ESCALATED" ? "warn" : "err",
      };
    }
    case "tool.call":
      return {
        id: `${ev.event.id}`,
        ts: ev.event.ts,
        kind: "tool.call",
        summary: `${ev.event.phase === "failed" ? "Tool failed" : "Tool"} ${ev.event.toolName}${ev.event.paid ? " (paid)" : ""} — ${ev.event.message}`,
        badge: ev.event.phase === "completed" ? "info" : ev.event.phase === "failed" ? "err" : "warn",
      };
    case "policy.updated":
      return {
        id: `${ev.policy.id}-${ev.policy.version}`,
        ts: ev.policy.createdAt,
        kind: "policy.updated",
        summary: `Policy v${ev.policy.version} updated${ev.policy.active ? " (active)" : ""}`,
        badge: "info",
      };
    case "wallet.updated":
      return {
        id: ev.wallet.id,
        ts: ev.wallet.createdAt,
        kind: "wallet.updated",
        summary: `Wallet funded — ${ev.wallet.balanceAlgo} ALGO`,
        badge: "ok",
      };
    case "audit":
      return { id: ev.entry.id, ts: ev.entry.ts, kind: "audit", summary: ev.entry.summary, badge: "info" };
    case "session.updated":
      return {
        id: ev.session.id,
        ts: ev.session.startedAt,
        kind: "session.updated",
        summary: `Session ${ev.session.status}${ev.session.task ? ` — ${ev.session.task}` : ""}`,
        badge: "info",
      };
    case "timeline":
      return {
        id: `${ev.event.sessionId}-${ev.event.seq}`,
        ts: ev.event.ts,
        kind: "timeline",
        summary: `${ev.event.step}: ${ev.event.message}`,
        badge: ev.event.status === "blocked" ? "err" : ev.event.status === "failed" ? "err" : ev.event.status === "confirmed" ? "ok" : "info",
      };
    case "mcp.health":
      return {
        id: ev.server.id,
        ts: ev.server.lastCheckedAt ?? "",
        kind: "mcp.health",
        summary: `MCP ${ev.server.name} — ${ev.server.status}${ev.server.latencyMs != null ? ` (${ev.server.latencyMs}ms)` : ""}`,
        badge: ev.server.status === "healthy" ? "ok" : ev.server.status === "offline" ? "err" : "warn",
      };
    case "agent.updated":
      return {
        id: ev.agent.id,
        ts: ev.agent.createdAt,
        kind: "agent.updated",
        summary: `Agent ${ev.agent.name} — ${ev.agent.status}`,
        badge: "info",
      };
    case "ping":
      return null;
  }
}

export default function LiveFeed({ limit = 200 }: { limit?: number }) {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [connected, setConnected] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/events`);
    const onEvent = (e: MessageEvent) => {
      setConnected(true);
      try {
        const parsed = JSON.parse(e.data) as StreamEvent;
        const entry = describe(parsed);
        if (!entry) return;
        setEntries((prev) => [...prev.slice(-(limit - 1)), entry]);
      } catch {
        /* malformed frame */
      }
    };
    for (const t of EVENT_TYPES) es.addEventListener(t, onEvent);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [limit]);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div ref={boxRef} className="terminal h-[420px] overflow-y-auto overscroll-contain rounded-lg">
      <div className="terminal-scanline" />
      {!connected && (
        <div className="sticky top-0 z-30 flex items-center gap-2 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 border-b border-amber-200">
          <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" /> Reconnecting to live feed…
        </div>
      )}
      {entries.length === 0 ? (
        <div className="flex h-full items-center justify-center font-mono text-xs text-[var(--color-ink-3)]">
          <span className="anim-soft-pulse">&gt; WAITING FOR EVENTS…</span>
        </div>
      ) : (
        <ul className="relative z-20 flex flex-col gap-1.5 p-2">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-[var(--color-surface-2)] transition-colors anim-slide-in-right">
              <span className="mt-0.5 shrink-0 font-mono text-[10px] tabular-nums text-[var(--color-ink-3)]">{fmtTs(e.ts)}</span>
              <span className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest ring-1 ring-inset ${badgeClass[e.badge]}`}>
                {e.kind}
              </span>
              <span className="min-w-0 text-xs leading-relaxed text-[var(--color-ink-2)]">{e.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}