import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config();
dotenv.config({ path: resolve(process.cwd(), "../../.env") });
dotenv.config({ path: resolve(import.meta.dirname, "../../../.env") });
import {
  AnthropicProvider,
  OpenAIProvider,
  connectKronTools,
  runAgentLoop,
  type AgentStep,
  type LLMProvider,
} from "@kron/llm-agent";
import { KronApi, type PolicyConfig } from "./kron-api.js";

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const KRON_API_URL = env("KRON_API_URL", "http://localhost:8787");
const KRON_ADMIN_EMAIL = env("KRON_ADMIN_EMAIL", "admin@kron.dev");
const KRON_ADMIN_PASSWORD = requiredEnv("KRON_ADMIN_PASSWORD");
const KRON_AGENT_NAME = env("KRON_AGENT_NAME", "llm-agent-01");
const RESOURCE_SERVER_URL = env("KRON_RESOURCE_URL", "http://localhost:9100");
const RESOURCE_SERVER_NAME = env("KRON_RESOURCE_SERVER_NAME", "demo-resource");
const RESOURCE_TRANSPORT = "streamable-http";
const FUND_AMOUNT_ALGO = toNumber(env("KRON_FUND_AMOUNT_ALGO", "0.05"), 0.05);

// LLM provider selection
const LLM_PROVIDER = env("KRON_LLM_PROVIDER", "anthropic").toLowerCase(); // anthropic | openai
const ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY", "");
const ANTHROPIC_MODEL = env("ANTHROPIC_MODEL", "claude-sonnet-4-5-20250929");
const OPENAI_API_KEY = env("OPENAI_API_KEY", "");
const OPENAI_MODEL = env("OPENAI_MODEL", "gpt-4o");
const MAX_ITERATIONS = toNumber(env("KRON_MAX_ITERATIONS", "10"), 10);
const DEFAULT_PROMPT = env(
  "KRON_PROMPT",
  "Discover what paid tools KRON can access, then purchase the premium market report and institutional sentiment feed, and give me a concise investment summary based on the real data you obtained.",
);

const SYSTEM_PROMPT = `You are an autonomous AI research agent that buys premium market data through KRON, an AI-agent payment gateway on the Algorand blockchain.

Your tools:
- kron.list_available_tools — discover which paid/free MCP tools are registered with KRON.
- kron.get_wallet — check your agent's ALGO wallet balance.
- kron.call_tool — invoke a tool from a registered resource server. KRON automatically evaluates your spending policy and settles any required x402 payment in ALGO. Provide only the tool name and its arguments (do not pass agentId/sessionId — they are injected for you).
- kron.evaluate_payment — dry-run whether a payment would be approved before spending.

Working rules:
1. Start by listing available tools, then check your wallet balance.
2. Call the paid tools you actually need via kron.call_tool. KRON settles the payment automatically when your policy allows it.
3. If a tool result says payment is required or was blocked, adapt: check your policy, or pick a cheaper alternative.
4. Be economical — make as few paid calls as necessary to answer the user's request.
5. When you have the data you need, produce a concise, well-structured final report for the user. Do not fabricate figures — only report data you actually received from tool calls.`;

function env(key: string, fallback: string): string {
  const value = process.env[key];
  return value !== undefined && value !== "" ? value : fallback;
}

/** Like env(), but fails loudly — no silent defaults for credentials. */
function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function toNumber(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseFlags(argv: string[]): {
  createAgent: boolean;
  noFund: boolean;
  prompt?: string;
  provider?: string;
} {
  const set = new Set(argv);
  let prompt: string | undefined;
  let provider: string | undefined;
  const promptIdx = argv.indexOf("--prompt");
  if (promptIdx >= 0 && argv[promptIdx + 1]) prompt = argv[promptIdx + 1];
  const providerIdx = argv.indexOf("--provider");
  if (providerIdx >= 0 && argv[providerIdx + 1]) provider = argv[providerIdx + 1];
  return { createAgent: set.has("--create-agent"), noFund: set.has("--no-fund"), prompt, provider };
}

function createProvider(override?: string): LLMProvider {
  const providerName = (override ?? LLM_PROVIDER).toLowerCase();
  if (providerName === "openai") {
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set (KRON_LLM_PROVIDER=openai)");
    return new OpenAIProvider({ apiKey: OPENAI_API_KEY, model: OPENAI_MODEL });
  }
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set (KRON_LLM_PROVIDER=anthropic)");
  return new AnthropicProvider({ apiKey: ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL });
}

/* ------------------------------------------------------------------ */
/* Narration helpers                                                   */
/* ------------------------------------------------------------------ */

function banner(title: string): void {
  console.log("");
  console.log("=".repeat(74));
  console.log(`  ${title}`);
  console.log("=".repeat(74));
}

function step(label: string, title: string): void {
  console.log("");
  console.log(`[${label}] ${title}`);
  console.log("-".repeat(74));
}

function say(message: string): void {
  console.log(`   ${message}`);
}

function kv(key: string, value: unknown): void {
  console.log(`   ${key}: ${String(value)}`);
}

/* ------------------------------------------------------------------ */
/* KRON setup (admin API)                                              */
/* ------------------------------------------------------------------ */

async function findAgent(api: KronApi, name: string): Promise<{ id: string; name: string } | null> {
  const agents = await api.listAgents();
  return agents.find((a) => a.name === name) ?? null;
}

async function ensureResourceServer(api: KronApi): Promise<{ id: string; name: string; status: string }> {
  const servers = await api.listMcpServers();
  const existing = servers.find((s) => s.name === RESOURCE_SERVER_NAME || s.url === RESOURCE_SERVER_URL);
  if (existing) {
    say(`Found existing server "${existing.name}" (id ${existing.id}, status ${existing.status}).`);
    return existing;
  }
  const created = await api.createMcpServer({
    name: RESOURCE_SERVER_NAME,
    url: RESOURCE_SERVER_URL,
    transport: RESOURCE_TRANSPORT,
  });
  say(`Registered "${created.name}" at ${created.url} (id ${created.id}).`);
  return created;
}

/** Permissive-but-capped policy so the LLM can autonomously buy resources. */
async function ensureSpendingPolicy(api: KronApi, agentId: string): Promise<void> {
  let current: PolicyConfig | null = null;
  try {
    current = await api.getPolicy(agentId);
  } catch {
    current = null;
  }
  const needsUpdate =
    current === null ||
    (current.perCallLimitAlgo ?? 0) < 0.01 ||
    current.unknownRecipient !== "allow" ||
    current.firstTimeService !== "allow";
  if (!needsUpdate) {
    say("Policy already allows autonomous spending — no change required.");
    return;
  }
  const updated = await api.updatePolicy(agentId, {
    perCallLimitAlgo: 0.05,
    hardCeilingAlgo: 0.2,
    sessionBudgetAlgo: 0.1,
    dailyBudgetAlgo: 0.2,
    maxDailyPayments: 200,
    unknownRecipient: "allow",
    firstTimeService: "allow",
    recipientAllowlist: [],
    serviceAllowlist: [],
  });
  say(`Policy updated to v${updated.version} — autonomous spend allowed (cap ${updated.perCallLimitAlgo ?? 0.05} ALGO/call).`);
}

/* ------------------------------------------------------------------ */
/* LLM step narration                                                  */
/* ------------------------------------------------------------------ */

function narrateStep(step: AgentStep): void {
  if (step.assistant.content) {
    console.log("");
    console.log("   ── model ──");
    console.log(step.assistant.content.trim().replace(/^/gm, "   "));
  }
  for (const tr of step.toolResults) {
    console.log("");
    console.log(`   ── tool ${tr.name} ──`);
    console.log(tr.content.trim().replace(/^/gm, "   "));
  }
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  banner("KRON LLM AGENT — autonomous paid tool calling");
  kv("KRON API", KRON_API_URL);
  kv("Resource server", RESOURCE_SERVER_URL);
  kv("Agent name", KRON_AGENT_NAME);
  kv("LLM provider", LLM_PROVIDER);
  kv("LLM model", LLM_PROVIDER === "openai" ? OPENAI_MODEL : ANTHROPIC_MODEL);
  kv("Max iterations", MAX_ITERATIONS);
  if (flags.createAgent) say("flag --create-agent: always create a fresh agent");
  if (flags.noFund) say("flag --no-fund: skip wallet funding");
  if (flags.prompt) say("custom prompt supplied via --prompt");

  const provider = createProvider(flags.provider);
  const api = new KronApi({ base: KRON_API_URL, email: KRON_ADMIN_EMAIL, password: KRON_ADMIN_PASSWORD });

  // 1 — login
  step("1", "Authenticate to the KRON admin API");
  await api.login();
  say("Logged in — kron.sid session cookie acquired.");

  // 2 — ensure agent, fund wallet, start session
  step("2", "Ensure the KRON agent exists (wallet + policy + session)");
  let agent = flags.createAgent ? null : await findAgent(api, KRON_AGENT_NAME);
  if (!agent) {
    agent = await api.createAgent(KRON_AGENT_NAME, "KRON LLM agent: autonomous paid market research");
    say(`Created agent "${agent.name}" (id ${agent.id}).`);
  } else {
    say(`Found existing agent "${agent.name}" (id ${agent.id}).`);
  }

  if (flags.noFund) {
    say("Skipping wallet funding (--no-fund).");
  } else {
    const funded = await api.fundWallet(agent.id, FUND_AMOUNT_ALGO);
    say(`Wallet funded — balance ${funded.balanceAlgo.toFixed(6)} ALGO (address ${funded.address}).`);
  }

  const session = await api.startSession(agent.id, "LLM-driven paid market research");
  say(`Session started (id ${session.id}).`);

  // 3 — register the resource server + allow autonomous spend
  step("3", "Register the resource server with KRON");
  const resourceServer = await ensureResourceServer(api);
  const test = await api.testMcpServer(resourceServer.id);
  if (test.ok) {
    say(`Refresh OK (${test.latencyMs ?? "?"} ms) — exposed tools: ${test.tools?.join(", ") ?? ""}`);
  } else {
    say(`WARNING: refresh failed — ${test.error ?? "unknown error"}`);
    say("         Paid calls will fail until the resource server is running.");
  }
  await ensureSpendingPolicy(api, agent.id);

  // 4 — run the LLM agent loop against KRON's MCP tools
  step("4", "Connect to KRON's MCP server and run the LLM agent loop");
  const kron = await connectKronTools({
    kronUrl: KRON_API_URL,
    agentId: agent.id,
    sessionId: session.id,
  });

  try {
    const result = await runAgentLoop({
      provider,
      system: SYSTEM_PROMPT,
      tools: kron.tools,
      prompt: flags.prompt ?? DEFAULT_PROMPT,
      maxIterations: MAX_ITERATIONS,
      onStep: narrateStep,
    });
    banner("FINAL ANSWER");
    console.log(result.finalText);
    console.log("");
    kv("iterations", result.iterations);
    kv("paid tool calls", result.steps.reduce((n, s) => n + s.toolResults.filter((t) => t.name === "kron.call_tool").length, 0));
    banner("LLM AGENT COMPLETE");
  } finally {
    await kron.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`\nFATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});