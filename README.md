# KRON — The Capability Firewall for AI Agents

[![CI](https://github.com/sharonjoseph12/kron/actions/workflows/ci.yml/badge.svg)](https://github.com/sharonjoseph12/kron/actions/workflows/ci.yml)
[![Live Sandbox](https://img.shields.io/badge/Live-Sandbox%20Demo-000000?style=flat&logo=vercel&logoColor=white)](https://kron-ps21.vercel.app)
[![Algorand TestNet](https://img.shields.io/badge/Algorand-TestNet-00d2ff?style=flat&logo=algorand)](https://testnet.explorer.perawallet.app)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.0-8b5cf6?style=flat)](https://modelcontextprotocol.io)
[![x402 Micropayments](https://img.shields.io/badge/x402-Enabled-10b981?style=flat)](https://x402.org)
[![TypeScript SDK](https://img.shields.io/badge/@kron/sdk-v0.1.0-blue?style=flat)](./packages/sdk)
[![Tests Passing](https://img.shields.io/badge/Tests-126%20Passing-emerald?style=flat)](#testing)

**One line:** KRON is the capability firewall for AI agents — preview the blast radius, bind the approval, prove the enforcement.

**PS 2.1 mechanism:** every dangerous tool call goes through one path: classify → real impact preview → risk score → safe rewrite → hash-bound approval → one-shot capability grant → hash-chained enforcement receipt. A human approval is bound to the exact action **and** a fingerprint of the live data; if the dataset drifts, consent expires.

**Also preserved:** the original policy-controlled x402 payment runtime on Algorand TestNet — isolated agent wallets, atomic policy-anchor groups, what-if simulation, on-chain verification and a fleet emergency stop. Payments are now one action kind (`pay`) inside the same control plane.

**Jump to:** [Quick Start](#quick-start) ·
[Live Demo](https://kron-ps21.vercel.app) ·
[Control Plane](#control-plane) ·
[SDK](#sdk) ·
[Architecture](#architecture) ·
[Packages](#packages) ·
[Testing](#testing) ·
[Docs](#docs)

---

<a id="sdk"></a>

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

<a id="architecture"></a>

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

<a id="control-plane"></a>

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

### 🎥 The 4-minute demo (verified values)

The full shot-by-shot script — with timings, exact clicks, voiceover and on-screen text — is [`VIDEO_SCRIPT.md`](./VIDEO_SCRIPT.md). Every number below is asserted by `pnpm demo:attack all` and `pnpm demo:proof`.

**What the video proves, in brief order:** monitor and control every action (one gateway, one-shot grant) → detect and block harmful or unauthorised actions (lethal trifecta **75/100**, **1,204**-row delete, stale approval **409**) → audit every action, alert and intervention (approval desk, baseline diff, hash-chained receipts). Algorand is a settlement footnote, not the pitch.

| Beat | What happens | Verified number |
|---|---|---|
| **Hero — lethal trifecta** | poisoned email + private contract → send to a new outside address | risk **75/100** → **HOLD** → safe internal send → attacker inbox **0** |
| **Bulk delete — blast radius** | hard delete of the order table previewed in a rolled-back transaction | **1,204 rows** · **37 sensitive** · not recoverable → **1,204 archived** |
| **Shadow drift — stale consent** | 40 rows move after the human card was drawn | **826 → 40 changed → 786 live** · stale **409** · **0 executed** · fresh **786** archived |
| **Baseline counterfactual** | same desk with raw actions, no preview or rewrite | exactly **1** email reaches the attacker |
| **Receipts** | hash-chained evidence for every decision | `toolInvoked`, before/after snapshot, grant id, drift evidence |
| **Determinism** | repeated full-run proof | **30/30** scenarios · **126** tests |

Rehearse with [`DEMO_REHEARSAL.md`](./DEMO_REHEARSAL.md); the click timings there match the 4:00 cut.

<a id="quick-start"></a>

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

**Sandbox demo:** <https://kron-ps21.vercel.app> — click **Enter demo control room** on the login screen. The deployment ships with two seeded approvals and receipt history; no credentials are needed. Data resets when the serverless function cold-starts.

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

<a id="packages"></a>

## 📦 Workspace Packages

| Package | Description | Tests |
|---|---|---|
| [`@kron/sdk`](./packages/sdk) | Official TypeScript SDK for 5-minute agent integration | 7 passing |
| [`@kron/policy-engine`](./packages/policy-engine) | Pure deterministic policy rule engine (<5ms) + Velocity Guard + Behavioral Anomaly Scoring | 32 passing |
| [`@kron/x402`](./packages/x402) | Algorand x402 protocol, atomic groups, **on-chain policy enforcement** & anchor-proof verification | 26 passing |
| [`@kron/action-risk`](./packages/action-risk) | Deterministic 0–100 action classification and risk scoring for the control plane | 5 passing |
| [`@kron/safe-rewrite`](./packages/safe-rewrite) | Revalidated safe alternatives for dangerous actions (delete → archive, etc.) | 5 passing |
| [`@kron/business-tools`](./packages/business-tools) | Sandboxed file / mail / contract tools used by the demo and the control plane | 5 passing |
| [`@kron/llm-agent`](./packages/llm-agent) | Zero-dependency LLM provider adapters (Gemini / OpenAI / Anthropic) | 7 passing |
| [`@kron/shared`](./packages/shared) | Shared types, DTOs, schemas, constants | 4 passing |
| [`apps/api`](./apps/api) | Fastify REST API, MCP Gateway, SSE event hub, RBAC + governed escalations | 25 passing |
| [`apps/dashboard`](./apps/dashboard) | React + Tailwind + Recharts Operator Dashboard | — |
| [`apps/resource-server`](./apps/resource-server) | Paid MCP tools gated by x402; rejects unanchored settlements | 10 passing |
| [`apps/demo-agent`](./apps/demo-agent) | Autonomous agent driving multi-agent & A2A demos | — |

---

<a id="testing"></a>

## 🧪 Testing & Verification

```bash
# 126 tests across 18 files in the workspace: shared, policy, x402, SDK,
# business tools, safe rewrite, action risk, LLM agent, API integration, resource server
pnpm test
pnpm typecheck
pnpm build

# Deterministic control-plane proof (no network, no live model)
pnpm demo:attack all              # hero | delete | baseline | drift
pnpm demo:proof                   # 30/30 repeated runs
```

---

<a id="docs"></a>

## 📚 Docs & Submission Package

- [`VIDEO_SCRIPT.md`](./VIDEO_SCRIPT.md) — 4:00 shot-by-shot recording script, voiceover and verified values
- [`KRON_PS21_Deck.pptx`](./KRON_PS21_Deck.pptx) — final 14-slide deck (editable)
- [`KRON_PS21_Deck.pdf`](./KRON_PS21_Deck.pdf) — submission PDF export
- [`PPT_OUTLINE.md`](./PPT_OUTLINE.md) — slide copy + speaker notes
- [`PITCH.md`](./PITCH.md) — 3-Minute Pitch Script & Judge Q&A Cheat Sheet
- [`SUBMISSION.md`](./SUBMISSION.md) — Full Hackathon Project Submission Document
- [`TOP3_CHECKLIST.md`](./TOP3_CHECKLIST.md) — submission checklist and verified metrics
- [`DEMO_REHEARSAL.md`](./DEMO_REHEARSAL.md) — 4:00 rehearsal timeline, exact clicks and fallback plan
- [`JUDGE_PREP.md`](./JUDGE_PREP.md) — Tough Q&A + Rogue-Agent Demo
- [`HACKATHON.md`](./HACKATHON.md) — One-Page Judge Summary
- [`OFFLINE.md`](./OFFLINE.md) — 24-Hour Offline Runbook
- [`SECURITY.md`](./SECURITY.md) — vulnerability disclosure policy
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — Architecture Diagrams & Data Flow
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — VPS / Render / Railway Deploy (TestNet)
- [`docs/SCREENSHOTS.md`](./docs/SCREENSHOTS.md) — 5 Required Screenshots
- [`docs/archive/`](./docs/archive/) — superseded PRDs, kept for provenance