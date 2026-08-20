# KRON — Project Submission

## Project Overview

- **Project Name**: KRON
- **Track**: AI & Agentic Finance / Infrastructure
- **Network**: Algorand TestNet
- **Demo Dashboard**: React + TypeScript + TailwindCSS + Recharts
- **SDK**: `@kron/sdk` (TypeScript npm package)

---

## Inspiration

Autonomous AI agents powered by LLMs (Claude, GPT-4, local models) can reason, code, and execute multi-step workflows via protocols like Anthropic's Model Context Protocol (MCP). However, when agents encounter paid APIs, premium datasets, or specialized compute resources, their autonomy halts.

Developers are currently forced to either:
1. Hardcode sensitive credit cards or raw API keys directly into agent runtimes.
2. Require manual human approvals for every small transaction.

**KRON solves this by establishing a policy-governed economic safety layer.** Agents receive autonomous spending boundaries (per-call limits, session budgets, daily hard ceilings, recipient allowlists) while Algorand provides instant, sub-cent settlement with on-chain cryptographic auditability.

---

## What It Does

KRON operates as a middleware runtime and governance firewall:

1. **Autonomous 402 Micropayments**: Intercepts HTTP 402 / x402 payment challenges returned by MCP resource servers and automatically negotiates settlement on Algorand.
2. **Deterministic Policy Engine**: Evaluates 9+ spending constraints in <5ms before any funds move.
3. **Atomic Transaction Anchoring**: Couples the payment transaction with a smart contract application call containing a SHA-256 hash of the policy decision in a single atomic group.
4. **Policy What-If Simulation (`/simulation`)**: Allows operators to backtest proposed policy changes against historical transaction data before publishing.
5. **On-Chain Cryptographic Verification (`/verify`)**: Enables anyone to verify that an autonomous payment was mathematically authorized by a specific policy version on the Algorand ledger.
6. **Fleet-Wide Emergency Stop**: Instant kill switch to freeze autonomous agent activity across the entire runtime.
7. **Developer SDK (`@kron/sdk`)**: Clean TypeScript SDK enabling 5-minute integration for any agent framework.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Autonomous AI Agent                      │
│                  (LangChain / MCP Client)                   │
└──────────────────────────────┬──────────────────────────────┘
                               │ MCP Tool Request
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      KRON MCP Gateway                       │
│  - Intercepts 402 Payment Required                          │
│  - Evaluates Policy Engine in <5ms                          │
│  - Signs Algorand Payment from Isolated Vault               │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
     Policy Decision               Atomic Transaction Group
               │                              │
               ▼                              ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│      Operator Dashboard      │ │      Algorand Ledger       │
│  - Real-Time SSE Feed        │ │  - App Call (Policy Hash)  │
│  - What-If Simulation UI     │ │  - Payment (microAlgos)    │
│  - On-Chain Verifier (/verify)││  - 3.3s Instant Finality   │
└──────────────────────────────┘ └────────────────────────────┘
```

---

## Why Algorand?

- **Deterministic Instant Finality (3.3s)**: AI agents operate in rapid tool execution loops and cannot stall waiting for probabilistic consensus.
- **Sub-Cent Fees (<$0.0002)**: Agentic micro-transactions require near-zero overhead.
- **Atomic Transaction Groups**: Guarantees that the policy anchor contract execution and the ALGO payment succeed together or fail together.
- **ARC-2 Structured Transaction Notes**: Embeds standardized metadata (`kron:j{...}`) directly onto the ledger.

---

## How to Run & Verify

### 1. Install & Build
```bash
pnpm install
pnpm build
```

### 2. Run Tests (40+ unit tests across packages)
```bash
pnpm test
```

### 3. Start KRON Stack
```bash
# Terminal 1: API & MCP Gateway
pnpm --filter @kron/api dev

# Terminal 2: Resource Server (Paid Tools)
pnpm --filter @kron/resource-server dev

# Terminal 3: Operator Dashboard
pnpm --filter @kron/dashboard dev
```

### 4. Run Multi-Agent Governance Demo
```bash
# Executes Researcher (0.05 limit) & Trader (0.50 limit) and demonstrates boundary block
pnpm --filter @kron/demo-agent dev -- --multi
```
