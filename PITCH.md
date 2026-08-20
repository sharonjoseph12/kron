# KRON — International Hackathon Winning Pitch (3 Minutes)

> **Tagline**: The Policy-Controlled Economic Runtime for Autonomous AI Agents on Algorand.

---

## ⏱️ Pitch Timeline & Demo Walkthrough

### [0:00 - 0:25] The Problem
> *"Autonomous AI agents can write code, analyze data, and invoke complex tools. But the moment an agent needs to pay for an API, compute, or dataset — everything breaks. Either a human must manually authorize every micropayment, or developers give agents naked API keys and credit cards with zero spending boundaries.*
>
> *Putting humans in the payment loop kills autonomy. Giving agents raw wallets invites bankruptcy."*

### [0:25 - 0:50] The Solution: KRON
> *"Meet **KRON** — the economic firewall and policy-controlled payment runtime for AI agents, built on Algorand.*
>
> *Every agent gets an isolated Algorand wallet, a mathematically enforceable spending policy, and an immutable audit trail on the ledger."*

### [0:50 - 1:30] Live Demo: Multi-Agent Autonomous Settlement
*(Switch to Live Dashboard)*

1. **Researcher Agent** (0.05 ALGO per-call limit) requests `market/report` (0.018 ALGO):
   - Returns HTTP 402 Payment Required.
   - KRON intercepts the 402, evaluates against the policy engine in <5ms.
   - Signs and anchors on Algorand in an **Atomic Transaction Group** (App Call + Payment).
   - Shows **AUTO_APPROVED** and confirmed on-chain in 3.3 seconds.

2. **Trader Agent** (0.50 ALGO per-call limit) requests `market/sentiment` (0.450 ALGO):
   - Higher limit allows high-frequency sentiment alpha purchase.
   - Both agents operate concurrently on the live dashboard.

3. **The Rogue Boundary Test**:
   - Researcher tries to buy `market/sentiment` (0.450 ALGO).
   - Instantly **BLOCKED** by the policy engine without moving a single microAlgo on the chain.

### [1:30 - 2:05] The Killer Features: Simulation & Verification

1. **Policy What-If Simulation Engine (`/simulation`)**:
   - *"Before operators deploy a policy, they can backtest candidate limits across historical transactions to project savings and simulate block/approval ratios with zero financial risk."*
2. **On-Chain Cryptographic Proof (`/verify`)**:
   - *"Paste any transaction ID into KRON's verification engine. KRON proves on the ledger that the payment was cryptographically authorized under policy vX with an anchored SHA-256 decision hash."*

### [2:05 - 2:35] Why Algorand?

1. **3.3-Second Instant Finality**: AI agents cannot wait minutes for blocks to confirm before continuing their task loop.
2. **Sub-Cent Transaction Fees**: Essential for high-frequency AI tool micropayments ($0.0001).
3. **Atomic Transaction Groups**: KRON anchors policy decision hashes on-chain in the *same atomic group* as the payment itself — both succeed or neither does.

### [2:35 - 3:00] 5-Minute Developer Integration (`@kron/sdk`)
*(Show terminal / SDK code)*

```typescript
import { KronClient } from "@kron/sdk";

const kron = new KronClient({ apiUrl: "https://api.kron.dev" });
const agent = await kron.createAgent("researcher");
await kron.setPolicy(agent.id, { perCallLimitAlgo: 0.05, dailyBudgetAlgo: 2.0 });

// That's it. KRON handles 402 economics, Algorand signing, and on-chain proofs automatically.
const result = await kron.callPaidTool({ agentId: agent.id, tool: "market/report" });
```

> **Closing One-Liner**:
> *"Don't put a human in the payment loop. Put a policy in the loop. KRON gives AI agents money, and gives humans control."*

---

## 💡 Top 5 Judge Q&A Cheat Sheet

1. **Q: How does KRON secure the agent's private keys?**
   - **A**: Agent wallets are isolated and mnemonics are encrypted at rest using AES-256-GCM. The key never leaves the secure vault and is never exposed in any API response or client bundle.

2. **Q: What happens if an agent tries to replay a payment token?**
   - **A**: KRON implements nonce-based replay protection and idempotent client request IDs (`clientRequestId`). Once a payment token is redeemed, subsequent attempts are rejected by the resource server.

3. **Q: Why not just use credit cards or Stripe?**
   - **A**: Traditional payment rails have high minimum fees ($0.30 + 2.9%), require KYC/account setup per merchant, and cannot settle in 3 seconds. Algorand enables frictionless sub-cent agent-to-machine micropayments.

4. **Q: How is this different from existing x402 implementations?**
   - **A**: Standard x402 only defines how to ask for money. KRON provides the **enterprise governance layer** — rate limits, daily budgets, emergency stop switches, what-if simulations, and on-chain atomic policy proofs.

5. **Q: Can this scale to thousands of agents?**
   - **A**: Yes. KRON's policy engine runs in-memory in under 5ms per evaluation. Algorand processes thousands of TPS with immediate finality.
