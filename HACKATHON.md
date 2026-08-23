# KRON — International Hackathon Submission

## One-Liner
The policy-controlled economic runtime for autonomous AI agents on Algorand.

## Problem
Autonomous AI agents can reason and execute complex workflows, but the moment they need to pay for an API, dataset, or compute resource, autonomy breaks. Developers are forced to either hardcode raw credit cards/API keys into agent runtimes or require manual human approval for every micropayment.

## Solution
KRON gives every AI agent a dedicated Algorand wallet and mathematically enforceable spending policy, while operators get real-time visibility, what-if simulations, and on-chain cryptographic auditability.

## Key Differentiators

1. **ARC-4 On-Chain Policy Anchor**: Every payment is bundled with a smart contract app call that anchors a SHA-256 policy decision hash + agent + amount in global state. The contract exposes a real ARC-4 ABI (`get_payment_count()`, `get_last_policy_hash()`) callable from any ARC-4 toolchain, and the dashboard reads its live global state via `/api/contract`.
2. **Policy What-If Simulation**: Backtest candidate spending policies against 25–500 historical transactions before deploying.
3. **On-Chain Verification**: Paste any transaction ID into `/verify` to prove on the ledger that a payment was authorized under a specific policy version.
4. **Interactive Playground**: In-browser sandbox for judges to test live SDK calls against Algorand TestNet.
5. **Fleet-Wide Kill Switch**: One-click global freeze halts all agent spending in real-time.

## Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Algorand TestNet / LocalNet (3.3s finality) |
| Smart Contracts | TEAL v10, atomic transaction groups, ARC-2 notes |
| Runtime | Node.js 20, Fastify, TypeScript |
| Agent Protocol | Model Context Protocol (MCP) |
| Payments | x402 micropayment protocol |
| Database | SQLite (Prisma ORM) |
| Dashboard | React 18, Tailwind CSS v4, Recharts |
| SDK | `@kron/sdk` (TypeScript npm package) |

## Demo Flow (3 Minutes)

1. **Live Dashboard**: Show multi-agent governance with Researcher (0.05 ALGO limit) and Trader (0.50 ALGO limit)
2. **Boundary Enforcement**: Researcher attempts to buy `market/sentiment` (0.450 ALGO) → **BLOCKED** by policy engine
3. **A2A Hiring**: Researcher hires Trader for 0.035 ALGO → settled autonomously on Algorand
4. **What-If Simulation**: Adjust policy limits and see projected spend reductions in real-time
5. **On-Chain Verify**: Paste a transaction ID and show the cryptographic proof anchored on Algorand

## How to Run

```bash
# Zero Docker required (TestNet)
pnpm bootstrap
pnpm dev

# With Docker (LocalNet)
docker compose --profile localnet up -d
pnpm --filter @kron/api bootstrap:chain
pnpm dev
```

Open **http://localhost:5173** → Login: `admin@kron.dev` / `admin1234`

## Links

- **Dashboard**: http://localhost:5173
- **API Docs**: http://localhost:8787
- **Playground**: http://localhost:5173/playground
- **Verify Portal**: http://localhost:5173/verify
- **Simulation**: http://localhost:5173/simulation

## Tests

```bash
pnpm test                          # 60 package tests (shared 4 + policy-engine 21 + x402 21 + sdk 7 + llm-agent 7)
pnpm --filter @kron/api test       # 11 API integration tests
pnpm --filter @kron/resource-server test  # 6 resource-server tests
# Total: 77 passing, typecheck 10/10 workspaces, build 9/9
```

## Verify It Yourself (Judge Walkthrough)

Every payment is a **real** Algorand transaction with an on-chain policy anchor. You don't need to trust us — verify it directly:

```bash
# 1. Run the stack (zero Docker required, TestNet)
pnpm bootstrap
pnpm dev

# 2. Login and run a live multi-agent demo (real on-chain settlement)
pnpm --filter @kron/demo-agent dev -- --multi

# 3. Grab any transaction ID from the dashboard Payments feed, then
#    independently re-check it on the public ledger:
curl -s https://testnet-idx.algonode.cloud/v2/transactions/<TXID> | jq '.transaction.confirmed-round'

# 4. Or paste the tx ID into the KRON Verify portal
#    http://localhost:5173/verify  -> shows round, policy version, and
#    whether the atomic-group app call carrying the policy hash confirmed.

# 5. Check the contract's live on-chain state (total anchored payments + last
#    policy hash) — read straight from the indexer:
curl -s http://localhost:8787/api/contract  (or open the dashboard's
"Policy Anchor Contract" card) -> totalPayments, lastPolicyHash, lastAgentId

# 6. Try a stablecoin-priced resource — the resource server also sells
#    premium data in USDC (ASA), settled as an atomic group app call + axfer:
curl -s http://localhost:9100/resources  -> premium-defi-yield (assetName: USDC)
```

What the judge sees: `Agent -> Session -> ToolCall -> PaymentRequest -> PaymentDecision -> Settlement`, with the settlement's `txId` resolvable on Pera Explorer / Lora and its policy-decision hash anchored in an **atomic transaction group** (app call + payment). Both confirm together in ~3.3s or neither does.

## Team

Built for the International Algorand Hackathon.
