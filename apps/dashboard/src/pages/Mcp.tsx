import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MCPServerDTO } from "@kron/shared";
import { api } from "../api/client.js";
import { fmtTs, mcpStatusTone, shortId } from "../lib/format.js";
import {
  Badge,
  btnGhost,
  btnPrimary,
  Card,
  CardHeader,
  ErrorBox,
  inputClass,
  labelClass,
  Mono,
  Spinner,
} from "../components/ui.js";

function ToolsList({ server, expanded }: { server: MCPServerDTO; expanded: boolean }) {
  if (!expanded) return null;
  if (server.tools.length === 0) {
    return (
      <div className="border-t border-[var(--color-line)] px-4 py-3 text-xs text-[var(--color-ink-3)]">
        No tools discovered yet — run a test to refresh.
      </div>
    );
  }
  return (
    <div className="border-t border-[var(--color-line)] px-4 py-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
        {server.tools.length} tool{server.tools.length === 1 ? "" : "s"}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {server.tools.map((t) => (
          <div key={t.id} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2">
            <div className="font-mono text-xs font-semibold text-[var(--color-ink)]">{t.name}</div>
            {t.description ? <div className="mt-0.5 text-[11px] text-[var(--color-ink-3)]">{t.description}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Mcp() {
  const queryClient = useQueryClient();
  const servers = useQuery({ queryKey: ["mcp-servers"], queryFn: api.listServers });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showRegister, setShowRegister] = useState(false);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<"streamable-http" | "sse">("streamable-http");
  const [authToken, setAuthToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const register = useMutation({
    mutationFn: () =>
      api.createServer({
        name: name.trim(),
        url: url.trim(),
        transport,
        authToken: authToken.trim() || undefined,
      }),
    onSuccess: () => {
      setName("");
      setUrl("");
      setAuthToken("");
      setShowRegister(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Register failed"),
  });

  const onRegister = (e: FormEvent) => {
    e.preventDefault();
    register.mutate();
  };

  const list = servers.data?.servers ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="anim-fade-up">
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">MCP Servers</h1>
          <p className="mt-0.5 text-sm text-[var(--color-ink-3)]">
            Resource servers that agents reach via MCP, billed through KRON.
          </p>
        </div>
        <button onClick={() => setShowRegister((s) => !s)} className={btnPrimary}>
          {showRegister ? "Cancel" : "Register server"}
        </button>
      </div>

      {showRegister ? (
        <form onSubmit={onRegister} className="rounded-xl border border-[var(--color-line)] bg-white p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <label>
              <span className={labelClass}>Name</span>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="compute-engine" required />
            </label>
            <label className="md:col-span-2">
              <span className={labelClass}>URL</span>
              <input
                type="url"
                className={inputClass}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://resources.kron.dev/mcp"
                required
              />
            </label>
            <label>
              <span className={labelClass}>Transport</span>
              <select className={inputClass} value={transport} onChange={(e) => setTransport(e.target.value as "streamable-http" | "sse")}>
                <option value="streamable-http">streamable-http</option>
                <option value="sse">sse</option>
              </select>
            </label>
          </div>
          <label className="mt-3 block">
            <span className={labelClass}>Auth token (optional)</span>
            <input className={inputClass} value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder="Bearer token for this server" />
          </label>
          {error ? (
            <div className="mt-3">
              <ErrorBox message={error} />
            </div>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setShowRegister(false)} className={btnGhost}>
              Cancel
            </button>
            <button type="submit" disabled={register.isPending} className={btnPrimary}>
              {register.isPending ? "Registering…" : "Register"}
            </button>
          </div>
        </form>
      ) : null}

      {servers.isPending ? (
        <Spinner label="Loading servers…" />
      ) : (
        <div className="space-y-3 stagger-children">
          {list.map((s) => (
            <ServerCard
              key={s.id}
              server={s}
              expanded={expanded[s.id] ?? false}
              onToggle={() => setExpanded((m) => ({ ...m, [s.id]: !(m[s.id] ?? false) }))}
            />
          ))}
          {list.length === 0 ? (
            <Card className="p-10 text-center text-sm text-[var(--color-ink-3)]">
              No resource servers registered yet.
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ServerCard({
  server,
  expanded,
  onToggle,
}: {
  server: MCPServerDTO;
  expanded: boolean;
  onToggle: () => void;
}) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const test = useMutation({
    mutationFn: () => api.testServer(server.id),
    onSuccess: (d) => {
      setResult(d.ok ? `OK — ${d.latencyMs ?? "?"}ms · ${d.tools?.length ?? 0} tools` : `Failed — ${d.error ?? "unknown error"}`);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Test failed"),
  });

  const health = useMutation({
    mutationFn: () => api.serverHealth(server.id),
    onSuccess: (d) => {
      setResult(`${d.status} — ${d.latencyMs ?? "?"}ms · ${d.tools?.length ?? 0} tools`);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Health check failed"),
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[var(--color-ink)]">{server.name}</span>
            <Badge tone={mcpStatusTone(server.status)}>{server.status}</Badge>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--color-ink-3)]">
            <Mono>{shortId(server.url, 30)}</Mono>
            <span>·</span>
            <span>{server.transport}</span>
            {server.latencyMs != null ? <span>· {server.latencyMs}ms</span> : null}
          </div>
          {server.error ? <div className="mt-0.5 text-[11px] text-[var(--color-danger)]">{server.error}</div> : null}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => test.mutate()} disabled={test.isPending} className={btnGhost}>
            {test.isPending ? "Testing…" : "Test"}
          </button>
          <button onClick={() => health.mutate()} disabled={health.isPending} className={btnGhost}>
            {health.isPending ? "Checking…" : "Health"}
          </button>
          <button onClick={onToggle} className={btnGhost}>
            {expanded ? "Hide tools" : `Tools (${server.tools.length})`}
          </button>
        </div>
      </div>

      {result ? (
        <div className="border-t border-[var(--color-line)] px-4 py-2 font-mono text-[11px] text-[var(--color-success)]">{result}</div>
      ) : null}
      {error ? (
        <div className="border-t border-[var(--color-line)] px-4 py-2">
          <ErrorBox message={error} />
        </div>
      ) : null}
      <ToolsList server={server} expanded={expanded} />

      <div className="flex items-center gap-2 border-t border-[var(--color-line)] px-4 py-1.5 text-[10px] text-[var(--color-ink-3)]">
        <span>registered {fmtTs(server.createdAt)}</span>
        {server.lastCheckedAt ? <span>· last checked {fmtTs(server.lastCheckedAt)}</span> : null}
      </div>
    </Card>
  );
}