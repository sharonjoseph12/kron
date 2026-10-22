# KRON — The Capability Firewall for AI Agents

[![CI](https://github.com/sharonjoseph12/kron/actions/workflows/ci.yml/badge.svg)](https://github.com/sharonjoseph12/kron/actions/workflows/ci.yml)
[![Algorand TestNet](https://img.shields.io/badge/Algorand-TestNet-00d2ff?style=flat&logo=algorand)](https://testnet.explorer.perawallet.app)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.0-8b5cf6?style=flat)](https://modelcontextprotocol.io)
[![x402 Micropayments](https://img.shields.io/badge/x402-Enabled-10b981?style=flat)](https://x402.org)
[![TypeScript SDK](https://img.shields.io/badge/@kron/sdk-v0.1.0-blue?style=flat)](./packages/sdk)
[![Tests Passing](https://img.shields.io/badge/Tests-124%20Passing-emerald?style=flat)](#-testing--verification)

**One line:** KRON is the capability firewall for AI agents — preview the blast radius, bind the approval, prove the enforcement.

**PS 2.1 mechanism:** every dangerous tool call goes through one path: classify → real impact preview → risk score → safe rewrite → hash-bound approval → one-shot capability grant → hash-chained enforcement receipt. A human approval is bound to the exact action **and** a fingerprint of the live data; if the dataset drifts, consent expires.

**Also preserved:** the original policy-controlled x402 payment runtime on Algorand TestNet — isolated agent wallets, atomic policy-anchor groups, what-if simulation, on-chain verification and a fleet emergency stop. Payments are now one action kind (`pay`) inside the same control plane.

---

## ⚡ 5-Minute Developer Integration (`@kron/sdk`)

External developers can integrate KRON into any AI agent framework (LangChain, LlamaIndex, MCP clients) in 5 lines of code:

```typescript
import { KronClient } from "@kron/sdk";

// 1. Connect to runtime
const kron = new KronClient({ apiUrl: "http://localhost:8787" });
await kron.login("operator@kron.local", process.env.KRON_ADMIN_PASSWORD!);

// 2. Provision agent with dedicated Algorand wallet & spending limits
const agent = await kron.createAgent("researcher-01", "Market research agent");
await kron.setPolicy(agent.id, {
  perCallLimitAlgo: 0.05,
  dailyBudgetAlgo: 2.0,
  unknownRecipient: "block",
});

// 3. Invoke paid MCP tools autonomously — KRON handles x402 + Algorand settlement
const session = await kron.startSession(agent.id, "Market Analysis");
const result = await kron.callPaidTool({
  agentId: agent.id,
  sessionId: session.id,
  tool: "market/report",
});

console.log("Paid Result:", result.content);
console.log("Settlement Tx ID:", result.payment?.txId);
```

### 🔌 Framework Integrations (Zero Extra Dependencies)

KRON ships adapters for every major AI agent framework — no extra `npm install` needed:

<details>
<summary><strong>LangChain / LangGraph</strong></summary>

```typescript
import { KronClient, asLangChainTools } from "@kron/sdk";

const kron = new KronClient({ apiUrl: "http://localhost:8787" });
await kron.login("operator@kron.local", process.env.KRON_ADMIN_PASSWORD!);

const tools = asLangChainTools(kron, { agentId: "researcher-01", sessionId });
// Pass directly to createReactAgent({ llm, tools }) or AgentExecutor
```
</details>

<details>
<summary><strong>OpenAI Function Calling</strong></summary>

```typescript
import { KronClient, asOpenAIFunctions, executeOpenAIFunction } from "@kron/sdk";

const kron = new KronClient({ apiUrl: "http://localhost:8787" });
const tools = asOpenAIFunctions(kron, { agentId, sessionId });

const response = await openai.chat.completions.create({
  model: "gpt-4o", tools, messages,
});
// Handle tool_calls with executeOpenAIFunction(kron, opts, name, argsJson)
```
</details>

<details>
<summary><strong>Vercel AI SDK</strong></summary>

```typescript
import { KronClient, asVercelAITools } from "@kron/sdk";

const kron = new KronClient({ apiUrl: "http://localhost:8787" });
const kronTools = asVercelAITools(kron, { agentId, sessionId });

const result = await generateText({
  model: openai("gpt-4o"),
  tools: kronTools,
  prompt: "Buy the premium market report",
});
```
</details>

### 🎬 The Golden Path (90-Second Live Demo)

> **402 Detection → Policy Evaluation → Atomic Algorand Settlement → Cryptographic Verification**

Click **▶ Run Golden Path** on the Dashboard to see the entire KRON flow in one click:
1. Agent discovers paid MCP tool → HTTP 402 Payment Required
2. KRON Policy Engine evaluates (per-call limit, daily budget, recipient filter) in <5ms
3. Auto-approved → Atomic Transaction Group signed (App Call + Payment) → 3.3s finality
4. Policy decision SHA-256 hash anchored on-chain → independently verifiable via `/verify`

---

## 🏛️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Autonomous AI Agent                      │
│                (@kron/sdk / MCP Client)                     │
└──────────────────────────────┬──────────────────────────────┘
                               │ 1. MCP Tool Call
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      KRON MCP Gateway                       │
│  ┌─────────────────────────┐   ┌─────────────────────────┐  │
│  │   x402 402 Interceptor  │──▶│  Policy Engine (<5ms)   │  │
│  └─────────────────────────┘   └────────────┬────────────┘  │
│                                             │                │
│                                  AUTO_APPROVED / BLOCKED     │
│                                             │                │
│  ┌─────────────────────────┐                ▼                │
│  │ Isolated Key Vault      │──▶ Sign Atomic Transaction Group│
│  └─────────────────────────┘    [App Call + Payment Tx]     │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
     Real-Time SSE Events             3.3s Finality
               │                              │
               ▼                              ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│      Operator Console        │ │      Algorand Ledger       │
│  - Live Payments Feed        │ │  - Policy Decision Hash    │
│  - Policy What-If Simulator  │ │  - ARC-2 Note (Metadata)   │
│  - On-Chain Verifier (/verify)││  - microAlgo Settlement    │
│  - Fleet Emergency Stop      │ │  - Instant Finality        │
└──────────────────────────────┘ └────────────────────────────┘
```

---

### 🏆 Key Differentiators

### 1. On-Chain Policy Enforcement
Every auto-approved payment is an **atomic group**: `[KRON contract app call, payment]`. TEAL v4 goes beyond audit-anchoring — the contract **enforces**:
1. **Caller allowlist**: only the creator or registered runtime signers can anchor (`set_runtime`).
2. **Group integrity**: `GroupSize == 2`, tx[1] must be a pay/axfer from the same sender whose amount equals the anchored amount.
3. **On-chain spending limits**: `configure_agent` writes per-call + rolling-daily limits that `anchor_policy` enforces in TEAL. An out-of-policy payment cannot confirm with its anchor.
4. **Real ARC-4 ABI**: getters return via `log` with the 0x151f prefix — callable from any ARC-4 toolchain.

And the merchant independently verifies the anchor proof from the indexer before delivering paid content.

### 2. Policy What-If Simulation Engine (`/simulation`)
Backtest candidate policies against historical transactions — session budgets, velocity spikes and behavioral anomalies all fire during simulation, so operators see true projected outcomes before deploying.

### 3. Behavioral Anomaly Scoring
Deterministic 0–100 risk score: burst detection weighted by amount vs per-call limit, first-seen recipients, statistical amount outliers (z-score). Block/escalate thresholds configurable per policy.

### 4. Governed Escalations
Human approvals carry a TTL and re-validate against fresh budgets at decision time — an expired or now-over-budget escalation can never settle.

### 5. On-Chain Verification (`/verify`) & Fleet Kill Switch
Paste any transaction ID for independent ledger proof; one click freezes all autonomous spending.

### 6. Interactive SDK Playground (`/playground`)
Live SDK calls against Algorand TestNet — no canned output.

---

## 🛡️ PS 2.1 Agent Control Plane

The control plane is a **capability firewall**, not a monitoring dashboard. Every read, write, delete, send or payment tool call is classified, previewed against the real sandbox SQLite database inside a rolled-back transaction, risk-scored, and held for a human when needed. Safe alternatives are revalidated through the same pipeline; approvals are bound to `sha256(canonical action JSON)` plus a fingerprint of the exact rows the preview observed. Execution requires a **one-shot capability grant**; every decision emits a **hash-chained enforcement receipt**.

```bash
pnpm demo:reset                 # deterministic sandbox + operator credentials in data/demo-credentials.txt
pnpm demo:attack hero           # poisoned email → private contract → outside recipient (75/100, attacker inbox 0)
pnpm demo:attack delete         # 1,204-row hard delete → archive alternative (1,204 archived)
pnpm demo:attack baseline       # before/after: raw approval leaks exactly one email
pnpm demo:attack drift          # 826 pending → concurrent 40 → live 786; stale card 409, 0 executed, fresh 786 archived
pnpm demo:attack all            # all four, with exact end-state assertions
pnpm demo:proof                 # hero + delete + drift, 10 runs each (30/30 assertions)
```

Open the dashboard and choose **Control Plane** in the sidebar. The page includes the approval desk, real impact card, safe rewrite, drift panel, hash-chain verify/tamper demo, live timeline, proof pane, enforcement receipts and a KRON Guard / Baseline toggle. No live model or external network is used on the demo path.

## 🚀 Quick Start (Zero Docker Required)

KRON runs out-of-the-box on Algorand TestNet with zero external Docker dependencies:

```bash
# One command: boot + full multi-agent demo + explorer links
pnpm judge

# Or manually
pnpm bootstrap
pnpm dev
```

Open **http://localhost:5173** to view the live dashboard (Login: the credentials in `data/demo-credentials.txt`).

---

## 🌐 Live / Deployed Instance

**Sandbox demo:** <https://kron-ps21.vercel.app> — use the operator credentials in `data/demo-credentials.txt` (generated by `pnpm demo:reset`).

Prefer a clickable link over local Docker? Full production deployment instructions — Vercel serverless, VPS / Railway / Render, env vars, and TestNet funding — are in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

---

## 🤖 Live Agent Demos

```bash
# Autonomous agent driving x402 payments through the runtime (Google Gemini — free tier)
pnpm demo:run

# Same demo forcing the OpenAI provider (needs OPENAI_API_KEY)
pnpm demo:openai

# Same demo forcing the Anthropic provider (needs ANTHROPIC_API_KEY)
pnpm demo:claude
```

A scripted run proves the full lifecycle on TestNet:

1. **`researcher-01`** (0.05 ALGO limit) calls `market/report` (0.018 ALGO) -> **AUTO_APPROVED**
2. **`trader-01`** (0.50 ALGO limit) calls `market/sentiment` (0.450 ALGO) -> **AUTO_APPROVED**
3. **Boundary Test:** `researcher-01` tries to buy `market/sentiment` (0.450 ALGO) -> **BLOCKED by Policy Engine** (0 ALGO moved on chain).
4. Every approved payment lands as an **atomic group** (app call + payment) in ~3.3s, with a clickable Pera Explorer deep link from the dashboard.

---

## 📦 Workspace Packages

| Package | Description | Tests |
|---|---|---|
| [`@kron/sdk`](./packages/sdk) | Official TypeScript SDK for 5-minute agent integration | 7 passing |
| [`@kron/policy-engine`](./packages/policy-engine) | Pure deterministic policy rule engine (<5ms) + Velocity Guard + Behavioral Anomaly Scoring | 32 passing |
| [`@kron/x402`](./packages/x402) | Algorand x402 protocol, atomic groups, **on-chain policy enforcement** & anchor-proof verification | 26 passing |
| [`@kron/shared`](./packages/shared) | Shared types, DTOs, schemas, constants | 4 passing |
| [`apps/api`](./apps/api) | Fastify REST API, MCP Gateway, SSE event hub, RBAC + governed escalations | 15 passing |
| [`apps/dashboard`](./apps/dashboard) | React + Tailwind + Recharts Operator Dashboard | — |
| [`apps/resource-server`](./apps/resource-server) | Paid MCP tools gated by x402; rejects unanchored settlements | 10 passing |
| [`apps/demo-agent`](./apps/demo-agent) | Autonomous agent driving multi-agent & A2A demos | — |

---

## 🧪 Testing & Verification

```bash
# 124 tests across 12 workspaces: shared, policy, x402, SDK, business tools,
# safe rewrite, risk, LLM agent, API integration, resource server, dashboard
pnpm test
pnpm typecheck
pnpm build

# Deterministic control-plane proof (no network, no live model)
pnpm demo:attack all              # hero | delete | baseline | drift
pnpm demo:proof                   # 30/30 repeated runs
```

---

## 🏆 Hackathon Documents

- [`VIDEO_SCRIPT.md`](./VIDEO_SCRIPT.md) — 2:45 demo recording script with exact numbers
- [`KRON_PS21_Deck.pptx`](./KRON_PS21_Deck.pptx) — final 14-slide deck (editable)
- [`KRON_PS21_Deck.pdf`](./KRON_PS21_Deck.pdf) — submission PDF export
- [`PPT_OUTLINE.md`](./PPT_OUTLINE.md) — slide copy + speaker notes
- [`PITCH.md`](./PITCH.md) — 3-Minute Pitch Script & Judge Q&A Cheat Sheet
- [`SUBMISSION.md`](./SUBMISSION.md) — Full Hackathon Project Submission Document
- [`TOP3_CHECKLIST.md`](./TOP3_CHECKLIST.md) — submission checklist and verified metrics
- [`DEMO_REHEARSAL.md`](./DEMO_REHEARSAL.md) — setup, clicks and fallback plan
- [`JUDGE_PREP.md`](./JUDGE_PREP.md) — Tough Q&A + Rogue-Agent Demo
- [`HACKATHON.md`](./HACKATHON.md) — One-Page Judge Summary
- [`OFFLINE.md`](./OFFLINE.md) — 24-Hour Offline Runbook
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — Architecture Diagrams & Data Flow
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — VPS / Render / Railway Deploy (TestNet)
- [`docs/SCREENSHOTS.md`](./docs/SCREENSHOTS.md) — 5 Required Screenshots
- [`DEMO_REHEARSAL.md`](./DEMO_REHEARSAL.md) — Timed 3-Minute Rehearsal + Fallback Plan