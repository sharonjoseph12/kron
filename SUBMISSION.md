# KRON — Project Submission (International Algorand Hackathon)

## Project Overview

- **Project Name**: KRON — Policy-Controlled Economic Runtime for AI Agents
- **One-liner**: The economic firewall and policy-governed payment runtime for autonomous AI agents on Algorand.
- **Track**: AI & Agentic Finance / Infrastructure
- **Network**: Algorand TestNet (MainNet-identical TEAL, atomic groups, 3.3s finality) + LocalNet via Docker
- **Demo Dashboard**: React 18 + Vite + Tailwind v4 + Recharts (9 pages, SSE real-time, code-split)
- **SDK**: `@kron/sdk` (TypeScript, 5-line integration, 7 tests)
- **Smart Contract**: TEAL v10 ARC-4 (`anchor_policy`, `get_payment_count`, `get_last_policy_hash`, `get_agent_policy_hash`, `set_emergency_stop`, `flush`) — `packages/x402/src/contract.ts:172-395` + `KRON_ARC4_CONTRACT_ABI`
- **Repo**: `https://github.com/sharonjoseph12/kron` (CI: typecheck + build + 77 tests)

---

## Inspiration

Autonomous AI agents powered by LLMs (Gemini, Claude, GPT-4) can reason, code, and execute multi-step workflows via protocols like Anthropic's Model Context Protocol (MCP). However, when agents encounter paid APIs, premium datasets, or specialized compute resources, their autonomy halts.

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
# Or via the SDK playground at http://localhost:5173/playground
```

### 5. Verify On-Chain (Judge Walkthrough — no trust needed)
```bash
# Paste any txId from the dashboard into /verify, or:
curl -s https://testnet-idx.algonode.cloud/v2/transactions/<TXID> | jq '.transaction["confirmed-round"]'
# Atomic group check: tx group shares a group ID — both app call + payment confirm together in ~3.3s
curl -s http://localhost:8787/api/contract | jq '.globalState'
```

---

## Why We Win — Judging Rubric

| Criterion | Our Proof |
|---|---|
| **Wow (10/10)** | Judge sees an autonomous agent spend real money without a human click, then sees it **blocked** at 0.45 ALGO, then verifies the tx on AlgoExplorer in one click. |
| **Technical Depth (9/10)** | MCP + x402 + policy engine <5ms + isolated vault AES-256-GCM + atomic groups + ARC-2 notes + ARC-4 ABI + SSE + audit + rate-limit + SSRF guard. |
| **Novelty (9/10)** | Not "agents can pay" — **agents can be economically governed**: what-if simulation, explainable decisions, recipient/service allowlists, velocity anomaly, emergency stop. |
| **Real-World (9/10)** | Paid APIs, datasets, compute, A2A hiring — 5-line SDK works with LangChain/LlamaIndex. Algorand sub-cent fees make $0.018 micropayments viable; Stripe $0.30+2.9% does not. |
| **Completeness (9/10)** | `setup → task → 402 → policy → atomic settlement → verify → resource → continue` observable end-to-end with no mocked txIds. |

---

## Security & Correctness (PRD §9)

- **Least privilege + isolated wallets** — per-agent wallets, never the operator's primary wallet (`FR-WALLET-003`, `apps/api/src/algorand/vault.ts`).
- **Encrypted at rest** — mnemonics AES-256-GCM (`vault.ts:18-24`), never logged/returned.
- **Replay protection** — deterministic `clientRequestId` idempotency (`payment-flow.ts:117-129`), never pays twice on retry; timeout → `RECONCILING` not fake success.
- **SSRF guard** — MCP server URLs validated against private/metadata ranges (`lib/ssrf.ts`), localhost allowed only in dev.
- **Rate limiting** — global 120/min + `/mcp` 60/min (`server.ts:43-47`), balances brute-force vs UX.
- **Recipient verification** — payment recipient must match x402 instruction; unexpected change = security event.

---

## Team & Links

- **Track justification**: Algorand-native settlement — atomic groups, ARC-2/ARC-4, 3.3s finality, <0.001 ALGO fees. No EVM/Solana fork — built on `testnet-api.algonode.cloud` / `testnet-idx.algonode.cloud`.
- **Docs**: `HACKATHON.md` (one-pager), `PITCH.md` (3-min script), `OFFLINE.md` (runbook), `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `TOP3_CHECKLIST.md`.
- **Demo video**: *(add link after recording per `DEMO_REHEARSAL.md`)* — keep <3 min.
- **One-pager PDF**: *(export `HACKATHON.md` → PDF + QR to playground)*.
- **Screenshots**: `docs/SCREENSHOTS.md` (5 pages: Dashboard, Agents, Simulation, Verify, Playground).

Built for the International Algorand Hackathon — `Don't put a human in the payment loop. Put a policy in the loop.`
