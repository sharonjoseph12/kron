# KRON — Policy-Controlled Economic Runtime for AI Agents

[![CI](https://github.com/sharonjoseph12/kron/actions/workflows/ci.yml/badge.svg)](https://github.com/sharonjoseph12/kron/actions/workflows/ci.yml)
[![Algorand TestNet](https://img.shields.io/badge/Algorand-TestNet-00d2ff?style=flat&logo=algorand)](https://testnet.explorer.perawallet.app)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.0-8b5cf6?style=flat)](https://modelcontextprotocol.io)
[![x402 Micropayments](https://img.shields.io/badge/x402-Enabled-10b981?style=flat)](https://x402.org)
[![TypeScript SDK](https://img.shields.io/badge/@kron/sdk-v0.1.0-blue?style=flat)](./packages/sdk)
[![Tests Passing](https://img.shields.io/badge/Tests-74%20Passing-emerald?style=flat)](./packages)

**One line:** KRON is the economic firewall and policy-governed payment runtime for autonomous AI agents on Algorand.

**The Vision:** Give AI agents dedicated Algorand wallets and spending autonomy, while giving operators mathematically enforceable boundaries, what-if policy simulations, and on-chain cryptographic auditability.

---

## ⚡ 5-Minute Developer Integration (`@kron/sdk`)

External developers can integrate KRON into any AI agent framework (LangChain, LlamaIndex, MCP clients) in 5 lines of code:

```typescript
import { KronClient } from "@kron/sdk";

// 1. Connect to runtime
const kron = new KronClient({ apiUrl: "http://localhost:8787" });
await kron.login("admin@kron.dev", "admin1234");

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

## 🌟 Key Differentiators

### 1. Atomic Transaction Groups & On-Chain Policy Anchoring
Every auto-approved payment is bundled into an **Algorand Atomic Group** containing:
1. **App Call**: Interacts with the KRON smart contract to anchor a SHA-256 hash of the policy decision on-chain.
2. **Payment Tx**: Transfers microAlgos with an ARC-2 structured note (`kron:j{...}`).

Both land atomically in 3.3 seconds or neither does.

### 2. Policy What-If Simulation Engine (`/simulation`)
Backtest candidate spending policies against 25–500 historical transactions. Operators can see projected percentage spend reductions and simulated block/approval counts before deploying to production.

### 3. On-Chain Verification Engine (`/verify`)
Paste any transaction ID or payment ID into the `/verify` portal to independently prove on the ledger that an autonomous payment was mathematically authorized under policy version vX.

### 4. Fleet-Wide Emergency Kill Switch
One-click global freeze halts all autonomous agent spending across the runtime in real-time.

### 5. Interactive SDK Playground & Sandbox (`/playground`)
In-browser sandbox for judges and developers to test live `@kron/sdk` calls (paid tools, A2A hiring, dry-run evaluations) against Algorand TestNet.

---

## 🚀 Quick Start (Zero Docker Required)

KRON runs out-of-the-box on Algorand TestNet with zero external Docker dependencies:

```bash
# 1. Install & Bootstrap Database & Multi-Agents
pnpm bootstrap

# 2. Run Entire Stack (Dashboard + API + Resource Server)
pnpm dev
```

Open **http://localhost:5173** to view the live dashboard (Login: `admin@kron.dev` / `admin1234`).

---

## 🌐 Live / Deployed Instance

Prefer a clickable link over local Docker? Full production deployment instructions — VPS / Railway / Render, env vars, and TestNet funding — are in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

---

## 🤖 Live Agent Demos

```bash
# Multi-Agent Governance & Boundary Enforcement
pnpm demo:multi

# Agent-to-Agent (A2A) Autonomous Subcontracting & Settlement
pnpm demo:a2a

# Rogue-Agent Daily Budget Cap & Human Intervention
pnpm demo:budget
```

1. **`researcher-01`** (0.05 limit) calls `market/report` (0.018 ALGO) -> **AUTO_APPROVED**
2. **`trader-01`** (0.50 limit) calls `market/sentiment` (0.450 ALGO) -> **AUTO_APPROVED**
3. **Boundary Test:** `researcher-01` tries to buy `market/sentiment` (0.450 ALGO) -> **BLOCKED by Policy Engine** (0 ALGO moved on chain).
4. **A2A Delegation:** `researcher-01` hires `trader-01` for volatility subtask (0.035 ALGO) -> settled autonomously on Algorand.

---

## 📦 Workspace Packages

| Package | Description | Tests |
|---|---|---|
| [`@kron/sdk`](./packages/sdk) | Official TypeScript SDK for 5-minute agent integration | 7 passing |
| [`@kron/policy-engine`](./packages/policy-engine) | Pure deterministic policy rule engine (in-memory <5ms) + Velocity Anomaly Guard | 21 passing |
| [`@kron/x402`](./packages/x402) | Algorand x402 protocol, atomic groups & proof verification | 18 passing |
| [`@kron/shared`](./packages/shared) | Shared types, DTOs, schemas, constants | 4 passing |
| [`apps/api`](./apps/api) | Fastify REST API, MCP Gateway, and SSE event hub | 11 passing |
| [`apps/dashboard`](./apps/dashboard) | React + Tailwind + Recharts Operator Dashboard | — |
| [`apps/resource-server`](./apps/resource-server) | Paid MCP tools gated by x402 on Algorand | 6 passing |
| [`apps/demo-agent`](./apps/demo-agent) | Autonomous agent driving multi-agent & A2A demos | — |

---

## 🧪 Testing & Verification

```bash
# Run all unit test suites (74 passing: 57 packages + 11 API + 6 resource-server)
pnpm test

# Build all workspace packages
pnpm build
```

---

## 🏆 Hackathon Documents

- [`PITCH.md`](./PITCH.md) — 3-Minute Winning Pitch Script & Judge Q&A Cheat Sheet
- [`SUBMISSION.md`](./SUBMISSION.md) — Full Hackathon Project Submission Document
- [`HACKATHON.md`](./HACKATHON.md) — One-Page Judge Summary
- [`OFFLINE.md`](./OFFLINE.md) — 24-Hour Offline Runbook
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — Architecture Diagrams & Data Flow