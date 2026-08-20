# KRON Demo Rehearsal Script

## Setup Before Demo (5 minutes)

1. Open 3 terminals in the project root
2. Terminal 1: `pnpm --filter @kron/api dev`
3. Terminal 2: `pnpm --filter @kron/resource-server dev`
4. Terminal 3: `pnpm --filter @kron/dashboard dev`
5. Browser: Open http://localhost:5173
6. Login: `admin@kron.dev` / `admin1234`

## Slide 1: Title (0:00 - 0:25)

**Speaking points:**
> "Autonomous AI agents can write code, analyze data, and invoke complex tools. But the moment an agent needs to pay for an API, compute, or dataset — everything breaks. Either a human must manually authorize every micropayment, or developers give agents naked API keys and credit cards with zero spending boundaries. Putting humans in the payment loop kills autonomy. Giving agents raw wallets invites bankruptcy."

**Action:** Click to Dashboard. Show the 2 agents already seeded.

## Slide 2: Live Multi-Agent Demo (0:25 - 1:30)

**Speaking points:**
> "Meet KRON — the economic firewall and policy-controlled payment runtime for AI agents, built on Algorand. Every agent gets an isolated Algorand wallet, a mathematically enforceable spending policy, and an immutable audit trail on the ledger."

**Action:**
1. Click "Playground" in sidebar
2. Select snippet "2. Agent-to-Agent (A2A) Autonomous Hiring"
3. Click "Run in Sandbox"
4. Watch the console show A2A hire of 0.035 ALGO
5. Copy the Tx ID and show the "On-Chain Proof" section

**Backup:** If Playground fails, run `pnpm demo:multi` in Terminal 4.

## Slide 3: Boundary Enforcement (1:30 - 2:00)

**Speaking points:**
> "Watch what happens when an agent tries to exceed its policy. Researcher-01 has a 0.05 ALGO per-call limit. It tries to buy market/sentiment for 0.450 ALGO. KRON blocks it instantly — zero ALGO moves on-chain."

**Action:**
1. In Playground, select snippet "3. Dry-Run Policy Evaluation (What-If)"
2. Run with 0.450 ALGO against researcher-01
3. Show the result: `BLOCKED` with reasons

## Slide 4: What-If Simulation (2:00 - 2:20)

**Speaking points:**
> "Before operators deploy a policy, they can backtest candidate limits against historical transactions. Here I'll tighten the per-call limit from 0.05 to 0.02 and see that it would block 40% of past transactions — all without risking a single microAlgo."

**Action:**
1. Click "Simulation" in sidebar
2. Change "Per-Call Autonomous Limit" to `0.02`
3. Click "Run What-If Simulation"
4. Show the bar chart and "Projected Spend Reduction"

## Slide 5: On-Chain Verification (2:20 - 2:40)

**Speaking points:**
> "Finally, anyone can verify that an autonomous payment was mathematically authorized. Paste a transaction ID into KRON's verification portal and it proves on the ledger that the payment was authorized under policy vX with a SHA-256 decision hash anchored in an atomic group."

**Action:**
1. Click "Verify Proof" in sidebar
2. Paste the Tx ID from Slide 2
3. Show the "Cryptographically Verified" banner and the policy hash

## Slide 6: Why Algorand + SDK (2:40 - 3:00)

**Speaking points:**
> "Why Algorand? 3.3-second instant finality. Sub-cent fees. Atomic transaction groups guarantee the policy anchor and the payment succeed together or fail together. And with the @kron/sdk, any agent developer can integrate this in 5 lines of code."

**Action:**
1. Show the SDK code snippet in Playground
2. Close with: "Don't put a human in the payment loop. Put a policy in the loop. KRON gives AI agents money, and gives humans control."

## Fallback Plan

| Failure | Fallback |
|---|---|
| Dashboard won't load | Run `pnpm demo:multi` in terminal and narrate the console output |
| Algorand localnet slow | Use TestNet mode (update `.env` to use `testnet-api.algonode.cloud`) |
| Playground crashes | Use the Dashboard "Payments" tab to show historical transactions |
| Docker not available | Use TestNet with pre-funded wallets from algonode faucet |

## Timing Checklist

- [ ] 0:00 - Problem statement (25s)
- [ ] 0:25 - Live demo: multi-agent + A2A (65s)
- [ ] 1:30 - Boundary enforcement (30s)
- [ ] 2:00 - What-if simulation (20s)
- [ ] 2:20 - On-chain verification (20s)
- [ ] 2:40 - Why Algorand + SDK (20s)
- [ ] 3:00 - Done
