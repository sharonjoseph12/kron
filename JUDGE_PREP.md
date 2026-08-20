# KRON — Judge Preparation & Q&A Sheet

> Goal: win the demo, the Q&A, and the "would you deploy this?" conversation.
> Frame for every answer: **"No human in the loop. Policy in the loop."**

---

## 30-Second Elevator Pitch

> "KRON is the economic firewall for autonomous AI agents. Give an agent a wallet and it will spend — KRON gives operators deterministic, machine-readable policy boundaries, a what-if simulator to tune them, and a cryptographic anchor on Algorand so every payment can be independently verified. No human watches every transaction; the policy does. When the policy can't decide, it escalates to a human. When you say stop, it stops everywhere, on-chain, in seconds."

---

## The 5 Tough Questions (and the honest answers)

### 1. "It's TestNet only — is this production-ready?"
**Say:**
- "The protocol, contracts, and settlement path are identical on MainNet — same TEAL, same atomic groups, same signing. We chose TestNet so judges can click a live link, pull funds from the faucet, and watch real settlements in 3.3 seconds with zero cost and zero risk."
- "The production deployment path is documented (`docs/DEPLOYMENT.md`): swap one env var (`ALGORAND_NETWORK=mainnet`), fund a MainNet account, and the exact same stack runs. The database is the only swap — SQLite → managed Postgres."
- "TestNet is actually the *correct* demo surface: a judge can verify every claim on-chain without spending money."

### 2. "You're using SQLite — isn't that a toy?"
**Say:**
- "SQLite is the zero-ops default so `pnpm dev` boots in seconds with no Docker. The data layer is Prisma — one line in `prisma/schema.prisma` switches to Postgres, and `docker-compose.prod.yml` already documents the Postgres option."
- "The ledger is the source of truth for auditability; the DB is just the operational cache. Even if the DB vanished, every payment is recoverable from Algorand via the ARC-2 notes."

### 3. "x402 is a new/unknown standard — why bet on it?"
**Say:**
- "x402 is the 402 Payment Required extension for the agent economy, backed by the x402.org community, and it's the closest thing to a standard for 'pay-as-you-go AI'. It fits us perfectly: HTTP-first, wallet-to-wallet, sub-second."
- "We implemented the flow natively on Algorand (deterministic fees, atomic groups, 3.3s finality) instead of on top of a legacy chain. That's a feature: it's the fastest, cheapest path to a working agent-payment loop today."
- "And we're not dependent on x402 the protocol for the *auditability* story — that's our own ARC-4 contract + ARC-2 note scheme."

### 4. "The smart contract is small — is that enough?"
**Say:**
- "Deliberately. Our contract does exactly three auditable things and nothing else: (1) it anchors a SHA-256 hash of every policy decision, (2) it records per-agent policy hashes in box storage, and (3) it can freeze the whole system on-chain. Minimal surface area = minimal attack surface. The *intelligence* lives in the off-chain policy engine, which is fully simulated and unit-tested (21 tests)."
- "v3 adds an emergency-stop switch (creator-only), per-agent box storage, and an inner-transaction flush — all compiled and verified against the TestNet algod in CI."
- "Small, audited, upgradeable later — not a kitchen sink."

### 5. "You store wallet mnemonics — that's a liability"
**Say:**
- "The demo uses a dedicated funding account and per-agent wallets encrypted at rest with AES-256 (`ENCRYPTION_KEY`, 64 hex chars, auto-generated or operator-set). Real deployments would use a custodian, HSM, or agent-key custody (e.g. DKIM-style signer service) — the key vault is an isolated module (`services/key-vault`) precisely so it can be swapped."
- "The model is 'least privilege': agents can only spend within their policy limits, and the operator can freeze the fleet on-chain in seconds."

---

## The Differentiators — Ranked for Impact

1. **Atomic Group + On-Chain Policy Anchoring** — payment and policy-hash land together or not at all. Verifiable in one click on AlgoExplorer.
2. **Policy What-If Simulator** — tune limits against real history *before* deploying a policy that breaks production. This is the "wow" tool for operators.
3. **On-Chain Verify Portal (`/verify`)** — paste any tx ID, prove a payment was authorized under policy vX, independently of the app.
4. **Fleet-Wide Emergency Kill Switch** — plus the new on-chain `set_emergency_stop` for hard-stopping the contract.
5. **5-Minute SDK** — real developer integration story for the agent ecosystem.

---

## Why Algorand (one-pager talking points)

| Criterion | Algorand | Ethereum/Solana |
|---|---|---|
| Finality | **3.3s, deterministic, no forks** | 12s+ (ETH) / 400ms (Sol, fork risk) |
| Fees | **0.001 ALGO (fractions of a cent)** | $0.10–$10+ under load |
| Atomicity | **Native atomic groups (up to 16 txns)** | Contract-level workarounds / bundlers |
| Consensus | Pure Proof-of-Stake, no MEV races | High MEV / front-running surface |
| On-chain data | **Global state + boxes + ARC-2 notes, cheap** | Expensive storage (ETH) |
| Alignment | **x402-native, purpose-built for micro-settlement** | General-purpose, fee-heavy |

**The one-liner:** *Algorand is the only chain where a $0.018 autonomous agent payment is economically viable AND cryptographically auditable in one atomic transaction.*

---

## Rogue-Agent Demo (the money shot)

> Scenario: `researcher-01`'s key is compromised (or the model is jailbroken). It tries to spend 10× its per-call limit on an unknown recipient.

1. **x402 intercepts** the request (HTTP 402 → wallet challenge).
2. **Policy engine evaluates** in <5ms: over limit + unknown recipient → **BLOCKED**. Zero ALGO moves.
3. Show the **"What happened?"** panel on the dashboard: the exact rule that fired, the hash anchored on-chain, and the attempted amount.
4. Hit **Fleet Emergency Stop** → the on-chain `emergency_stop` flips; *even a valid policy request is rejected at the contract level*. Show the contract card flip from "armed" to "ENGAGED".
5. **Reset** and show recovery.

**What to say:** *"The model is not the trust boundary. The policy is. When the model goes rogue, the policy stops it in milliseconds — and if the operator is asleep, the contract itself refuses on-chain."*

---

## Claims We Make (and the proof behind each)

| Claim | Proof |
|---|---|
| "3.3s settlement" | Algorand TestNet finality; every demo payment shows round + tx ID |
| "Atomic group lands or nothing does" | Tx group in AlgoExplorer; app call + payment share a group ID |
| "Every payment is verifiable" | `/verify` portal + ARC-2 note on-chain |
| "Policy enforced before money moves" | BLOCKED cases never produce a payment txn |
| "Contract can freeze the fleet" | `set_emergency_stop` is creator-only; state visible on the dashboard |

**Bold closing claim:** *"In the agent economy, the question isn't whether agents will spend money — it's whether you can trust how they spend it. KRON is the answer: policy in the loop, money on chain, humans in command."*

---

## Demo Flow (90 seconds, live)

1. **Login** to the dashboard (admin creds) — 5s
2. **Show the fleet health card + contract card** (payments anchored, emergency stop armed) — 10s
3. **Run one payment** through the demo agent → watch the live timeline animate with per-step durations → settlement chip (~3.3s) — 30s
4. **Click the AlgoExplorer deep link** → show the atomic group (app call + payment) — 15s
5. **Rogue-agent block** (over-limit attempt) → "What happened?" panel — 15s
6. **Fleet emergency stop** → contract flips to ENGAGED — 10s
7. **Verify a past tx** in `/verify` — 5s

Total: ~90 seconds. Every step is on-chain, clickable, undeniable.

---

## Housekeeping Before Submitting

- [ ] Push the latest main (contract v3, dashboard features) to GitHub and confirm CI is green.
- [ ] Set stable `SESSION_SECRET` / `ENCRYPTION_KEY` on the deployed host.
- [ ] Fund the merchant + funding TestNet accounts and record the merchant address for the demo.
- [ ] Record a 90-second demo video (OBS/QuickTime) and a screenshot of the dashboard.
- [ ] Pre-fill the demo DB with a handful of payments so the dashboard looks alive on first load.