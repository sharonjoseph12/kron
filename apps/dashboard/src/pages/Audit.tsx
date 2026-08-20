import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { fmtTs, shortId } from "../lib/format.js";
import { Badge, Card, CardHeader, Mono, Spinner } from "../components/ui.js";

const actionTone: Record<string, "ok" | "warn" | "err" | "info" | "muted"> = {
  "auth.login": "info",
  "auth.logout": "muted",
  "agent.created": "info",
  "wallet.created": "info",
  "wallet.funded": "ok",
  "session.started": "info",
  "policy.created": "info",
  "policy.updated": "info",
  "policy.version_activated": "info",
  "policy.emergency_stop": "err",
  "payment.decision": "warn",
  "payment.settled": "ok",
  "payment.blocked": "err",
  "mcp.server.created": "info",
  "mcp.server.health": "info",
  "security.event": "err",
};

export default function Audit() {
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => api.listAudit({ limit: "200" }) });
  const entries = audit.data?.entries ?? [];

  return (
    <div className="space-y-6">
      <div className="anim-fade-up">
        <h1 className="text-xl font-semibold text-[var(--color-ink)]">Audit Log</h1>
        <p className="mt-0.5 text-sm text-[var(--color-ink-3)]">Immutable, traceable record of every economic action.</p>
      </div>

      <Card className="anim-fade-up">
        <CardHeader
          title="Events"
          subtitle={`${entries.length} most recent audit entries`}
        />
        {audit.isPending ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-2)] text-[11px] uppercase tracking-wider text-[var(--color-ink-2)]">
                  <th className="px-4 py-2.5 font-medium">Time</th>
                  <th className="px-4 py-2.5 font-medium">Actor</th>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Target</th>
                  <th className="px-4 py-2.5 font-medium">Summary</th>
                  <th className="px-4 py-2.5 font-medium">Policy</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="trow-in spotlight border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-surface-2)] transition-colors">
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-[11px] text-[var(--color-ink-3)]">{fmtTs(e.ts)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Badge tone="muted">
                          <span className="font-mono uppercase">{e.actorType}</span>
                        </Badge>
                        <span className="font-mono text-[11px] text-[var(--color-ink-2)]">{shortId(e.actorId ?? "", 6)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={actionTone[e.action] ?? "muted"}>{e.action}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-[var(--color-ink)]">{e.targetType}</div>
                      <div className="font-mono text-[10px] text-[var(--color-ink-3)]">{shortId(e.targetId ?? "", 6)}</div>
                    </td>
                    <td className="max-w-md px-4 py-2.5 text-[var(--color-ink)]">{e.summary}</td>
                    <td className="px-4 py-2.5">
                      {e.policyVersion != null ? (
                        <Mono>v{e.policyVersion}</Mono>
                      ) : (
                        <span className="text-[var(--color-ink-3)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--color-ink-3)]">
                      No audit events recorded.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}