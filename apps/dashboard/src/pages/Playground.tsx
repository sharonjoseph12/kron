import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { fmtAlgo, shortId } from "../lib/format.js";
import {
  Badge,
  Card,
  CardHeader,
  GlassCard,
  Mono,
  Spinner,
  ExplorerLink,
  btnPrimary,
  btnGhost,
  inputClass,
} from "../components/ui.js";

interface Snippet {
  id: string;
  title: string;
  description: string;
  category: "sdk" | "a2a" | "policy";
  code: string;
  execute: () => Promise<any>;
}

export default function Playground() {
  const queryClient = useQueryClient();
  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: api.listAgents });
  const [selectedSnippetId, setSelectedSnippetId] = useState("call_tool");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const agents = agentsQuery.data?.agents ?? [];
  const activeAgent = agents.find((a) => a.id === selectedAgentId) ?? agents[0];

  const log = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const snippets: Snippet[] = [
    {
      id: "call_tool",
      title: "1. Autonomous Paid MCP Tool Call (x402)",
      description: "Agent invokes a paid resource tool. KRON intercepts 402, evaluates policy, and settles on Algorand.",
      category: "sdk",
      code: `import { KronClient } from "@kron/sdk";

const kron = new KronClient({ apiUrl: "${window.location.origin}" });

// Agent calls paid resource tool: "market/report" (0.018 ALGO)
const result = await kron.callPaidTool({
  agentId: "${activeAgent?.id ?? "agent-id"}",
  sessionId: "session-${Date.now().toString(36)}",
  tool: "market/report",
});

console.log("Status:", result.payment?.status);
console.log("Tx ID:", result.payment?.txId);
console.log("Content:", result.content);`,
      execute: async () => {
        if (!activeAgent) throw new Error("No agent selected");
        log(`Initiating paid tool call for agent ${activeAgent.name}...`);
        const session = await api.startSession(activeAgent.id, "Playground Paid Call");
        log(`Session started: ${session.session.id}`);
        // Trigger payment execution
        const res = await api.executePayment({
          agentId: activeAgent.id,
          sessionId: session.session.id,
          toolCallId: `play_${Date.now()}`,
          mcpServerId: "playground_server",
          toolName: "market/report",
          service: "market",
          resourceId: "market/report",
          resourceName: "Real-Time Market Intel Report",
          recipient: activeAgent.walletAddress ?? "RECIPIENT_ALGORAND_ADDRESS",
          amountAlgo: 0.018,
        });
        log(`Policy evaluated: ${res.status}`);
        if (res.txId) log(`Settled on Algorand: ${res.txId}`);
        return res;
      },
    },
    {
      id: "a2a_hire",
      title: "2. Agent-to-Agent (A2A) Autonomous Hiring",
      description: "Agent A hires Agent B for a subtask with autonomous on-chain compensation under policy constraints.",
      category: "a2a",
      code: `import { KronClient } from "@kron/sdk";

const kron = new KronClient({ apiUrl: "${window.location.origin}" });

// Researcher hires Trader for sentiment subtask (0.035 ALGO)
const hireResult = await kron.hireAgent({
  agentId: "${activeAgent?.id ?? "researcher-id"}",
  targetAgentId: "${agents.find((a) => a.id !== activeAgent?.id)?.id ?? "trader-id"}",
  task: "Calculate 24h Orderbook Volatility & Liquidity Delta",
  amountAlgo: 0.035,
});

console.log("Hired:", hireResult.hiredAgent?.name);
console.log("Outcome:", hireResult.taskResult);`,
      execute: async () => {
        if (!activeAgent) throw new Error("No agent selected");
        const target = agents.find((a) => a.id !== activeAgent.id) ?? activeAgent;
        log(`Hiring Agent: ${activeAgent.name} -> Contractor: ${target.name} for 0.035 ALGO...`);
        const res = await fetch(`/api/agents/${encodeURIComponent(activeAgent.id)}/hire`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            targetAgentId: target.id,
            task: "Calculate 24h Orderbook Volatility & Liquidity Delta",
            amountAlgo: 0.035,
          }),
        });
        const json = await res.json();
        log(`A2A Status: ${json.status}`);
        return json;
      },
    },
    {
      id: "dry_run",
      title: "3. Dry-Run Policy Evaluation (What-If)",
      description: "Evaluate a payment against the active spending policy in <5ms without moving any funds on-chain.",
      category: "policy",
      code: `import { KronClient } from "@kron/sdk";

const kron = new KronClient({ apiUrl: "${window.location.origin}" });

// Dry-run evaluate 0.450 ALGO against agent policy
const evaluation = await kron.evaluatePayment("${activeAgent?.id ?? "agent-id"}", {
  amountAlgo: 0.450,
  recipient: "${activeAgent?.walletAddress ?? "RECEIVER_ADDRESS"}",
  service: "market",
});

console.log("Decision:", evaluation.evaluation.decision);
console.log("Reasons:", evaluation.evaluation.reasons);`,
      execute: async () => {
        if (!activeAgent) throw new Error("No agent selected");
        log(`Evaluating 0.450 ALGO against policy for agent ${activeAgent.name}...`);
        const res = await api.evaluate(activeAgent.id, {
          amountAlgo: 0.450,
          recipient: activeAgent.walletAddress ?? "UNKNOWN_ADDR",
          service: "market",
        });
        log(`Dry-run decision: ${res.evaluation.decision}`);
        for (const r of res.evaluation.reasons) log(`  • ${r}`);
        return res;
      },
    },
  ];

  const currentSnippet = (snippets.find((s) => s.id === selectedSnippetId) ?? snippets[0])!;

  const runCode = useMutation({
    mutationFn: async () => {
      setLogs([]);
      return await currentSnippet.execute();
    },
    onSuccess: (data) => {
      setExecutionResult(data);
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
    },
    onError: (err) => {
      log(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setExecutionResult({ error: err instanceof Error ? err.message : String(err) });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="anim-fade-up">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-[var(--color-ink)]">Interactive SDK Playground</h1>
            <Badge tone="ok">Live TestNet Sandbox</Badge>
          </div>
          <p className="mt-0.5 text-sm text-[var(--color-ink-3)]">
            Experiment with `@kron/sdk` calls live in your browser against Algorand TestNet nodes.
          </p>
        </div>

        {/* Agent Selector */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-[var(--color-ink-3)] uppercase tracking-wider">Active Agent:</span>
          <select
            className={`${inputClass} text-xs font-mono`}
            value={activeAgent?.id ?? ""}
            onChange={(e) => setSelectedAgentId(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.walletAddress ? shortId(a.walletAddress, 8) : "no wallet"})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Snippet Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-[var(--color-line)] pb-3">
        {snippets.map((snip) => (
          <button
            key={snip.id}
            onClick={() => {
              setSelectedSnippetId(snip.id);
              setExecutionResult(null);
              setLogs([]);
            }}
            className={`rounded-lg px-3.5 py-2 text-xs font-medium transition ${
              selectedSnippetId === snip.id
                ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                : "bg-transparent text-[var(--color-ink-3)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
            }`}
          >
            {snip.title}
          </button>
        ))}
      </div>

      {/* Main Sandbox Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Code Editor & Runner */}
        <Card className="flex flex-col">
          <CardHeader
            title={currentSnippet.title}
            subtitle={currentSnippet.description}
            right={
              <button
                onClick={() => runCode.mutate()}
                disabled={runCode.isPending}
                className={btnPrimary}
              >
                {runCode.isPending ? "Executing on Chain…" : "Run in Sandbox"}
              </button>
            }
          />
          <div className="p-4 flex-1 flex flex-col">
            <div className="relative rounded-lg border border-[var(--color-line)] bg-[#fbfaf8] p-4 font-mono text-xs text-[var(--color-ink)] overflow-x-auto">
              <div className="absolute right-3 top-3 text-[10px] uppercase font-bold tracking-wider text-[var(--color-ink-2)] bg-[var(--color-surface-2)] px-2 py-0.5 rounded border border-[var(--color-line)]">
                TypeScript SDK
              </div>
              <pre className="text-[var(--color-ink)] leading-relaxed font-mono whitespace-pre-wrap">
                {currentSnippet.code}
              </pre>
            </div>

            <div className="mt-4 flex items-center justify-between text-xs text-[var(--color-ink-3)]">
              <span>SDK: <Mono>@kron/sdk v0.1.0</Mono></span>
              <span>Network: <span className="text-[var(--color-accent)] font-mono">Algorand TestNet</span></span>
            </div>
          </div>
        </Card>

        {/* Right: Real-Time Execution Console */}
        <Card className="flex flex-col">
          <CardHeader
            title="Execution Console & On-Chain Audit"
            subtitle="Live logs, policy decisions, and Algorand transaction confirmation"
            right={
              logs.length > 0 && (
                <button onClick={() => { setLogs([]); setExecutionResult(null); }} className={btnGhost}>
                  Clear
                </button>
              )
            }
          />
          <div className="p-4 flex-1 flex flex-col space-y-4">
            {/* Terminal output box */}
            <div className="h-44 w-full overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[#fbfaf8] p-3 font-mono text-xs text-[var(--color-ink)] space-y-1">
              {logs.length === 0 ? (
                <span className="text-[var(--color-ink-3)]">Console ready. Click "Run in Sandbox" to execute.</span>
              ) : (
                logs.map((l, i) => (
                  <div key={i} className="text-[var(--color-success)]">
                    {l}
                  </div>
                ))
              )}
            </div>

            {/* Structured Result Display */}
            {runCode.isPending ? (
              <Spinner label="Evaluating policy & signing Algorand transaction…" />
            ) : executionResult ? (
              <GlassCard accent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider font-semibold text-[var(--color-ink-3)]">Result Payload</span>
                  <Badge tone={executionResult.ok !== false && executionResult.status !== "BLOCKED" ? "ok" : "err"}>
                    {executionResult.status ?? (executionResult.ok ? "SUCCESS" : "ERROR")}
                  </Badge>
                </div>

                {executionResult.txId && (
                  <div>
                    <span className="text-[11px] text-[var(--color-ink-3)] block">Algorand Transaction ID:</span>
                    <ExplorerLink url={executionResult.payment?.explorerUrl} className="font-mono text-xs text-[var(--color-accent)] break-all font-semibold">
                      {executionResult.txId}
                    </ExplorerLink>
                  </div>
                )}

                {executionResult.taskResult && (
                  <div className="p-2.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-line)] text-xs text-[var(--color-ink)]">
                    {executionResult.taskResult}
                  </div>
                )}

                <details className="text-[11px] text-[var(--color-ink-3)] cursor-pointer">
                  <summary className="hover:text-[var(--color-ink)]">View Raw JSON</summary>
                  <pre className="mt-2 p-2 rounded bg-[var(--color-surface-2)] text-[var(--color-ink)] overflow-x-auto">
                    {JSON.stringify(executionResult, null, 2)}
                  </pre>
                </details>
              </GlassCard>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
