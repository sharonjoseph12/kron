# KRON — One-Page Judge Summary (PS 2.1)

## One-Liner
**The capability firewall for AI agents.** Preview the blast radius. Bind the approval. Prove the enforcement.

## Problem
Autonomous agents now hold real tools: mail, files, customer data, databases and payment rails. A prompt injection is only dangerous when it becomes a **tool invocation**. Observability dashboards show the damage after it happens; approval popups show a tool name and record a click that can be replayed. Neither answers: *what exactly will change, did the human approve the action that actually ran, and can anyone prove whether the tool was invoked?*

## Solution
One gateway for every dangerous action:

```
classify → real impact preview → risk score → safe rewrite
        → hash-bound approval → one-shot capability grant → hash-chained receipt
```

- **Impact preview** runs in a rolled-back transaction against the real sandbox: rows, sensitive rows, recoverability, recipient novelty, attachment sensitivity.
- **Risk engine** is deterministic and rules-only. It names the lethal trifecta (untrusted content + private data + new outside recipient), bulk mutation, irreversible deletes and mission drift. Hard blocks cannot be approved.
- **Safe alternatives** (archive instead of delete, internal owner instead of outside address, scoped update) are revalidated through the same pipeline and can still be `BLOCK`.
- **Approvals** bind `sha256(canonical action JSON)` **and** a fingerprint of the exact rows the preview observed. If the data moves, the card returns `409` and is marked expired.
- **Capability grants** are one-shot, scoped to one agent/tool/action hash, expire in 60 seconds, and are consumed atomically before the tool adapter runs.
- **Enforcement receipts** are hash-chained and record before/after state, `toolInvoked`, the linked approval and grant, and drift evidence.

## Demo Numbers (all produced by the runner)

| Scenario | Result |
|---|---|
| Poisoned email → private contract → outside send | held at **75/100**; safe internal send; attacker inbox **0** |
| Bulk hard delete | preview **1,204 rows**, **37 sensitive**; safe archive executes **1,204** |
| Baseline (raw approval) | attacker inbox **1** |
| Shadow drift | **826 pending → 40 changed → 786 live**; stale card **409**, archived **0**; fresh approval archives **786** |
| Repeatability | **30/30** deterministic runs |
| Automated suite | **126 tests**, typecheck/build clean across 12 workspaces |

## Key Differentiators

1. **Drift-bound consent** — approval expires when the live dataset changes, not only when the JSON changes.
2. **Decision ≠ invocation** — one-shot grants make replay a 403 before any tool code runs.
3. **Proof, not logs** — hash-chained receipts show whether the tool actually ran and exactly what changed.
4. **Real blast radius** — rolled-back previews over real data, not a model guess.
5. **Measured counterfactual** — the product ships the losing baseline so the difference is empirical.
6. **Preserved payment rail** — the original x402 runtime still governs Algorand TestNet payments: isolated wallets, atomic policy-anchor groups, on-chain verification and fleet emergency stop. Payments are one action kind in the same control plane.

## Tech Stack

| Layer | Technology |
|---|---|
| Control plane | Node.js 20, Fastify, TypeScript, Prisma + SQLite |
| Sandbox | `sql.js` SQLite with deterministic seed (1,204 orders, 37 sensitive rows) |
| Risk / rewrite | Rules-only packages (`@kron/action-risk`, `@kron/safe-rewrite`) |
| Dashboard | React 18, Vite, Tailwind v4, TanStack Query, SSE |
| Payments | x402, Algorand TestNet, TEAL v10 atomic groups |
| Agent protocol | Model Context Protocol (MCP) |
| SDK | `@kron/sdk` |

## How to Run

```bash
pnpm install
pnpm demo:reset        # seeds sandbox, generates operator credentials in data/demo-credentials.txt
pnpm dev               # API + dashboard

# http://localhost:5173/control
# login with data/demo-credentials.txt (gitignored; never a default)
```

Verify every claim:

```bash
pnpm demo:attack all   # hero | delete | baseline | drift
pnpm demo:proof        # 30/30 deterministic runs
pnpm test
pnpm typecheck
pnpm build
```

## Honest Boundaries

- Demo data is seeded; queries, previews, mutations and proofs are real.
- Email is an in-app sink; no real mail leaves the machine.
- Algorand stays on TestNet; no real funds move.
- No production red-team or benchmark is claimed.
- Next: live tool adapters, mission contracts, recovery/undo, optional PS 2.2 context privacy.

## Links

- `KRON_PS21_Deck.pptx` / `KRON_PS21_Deck.pdf` — final 14-slide deck
- `VIDEO_SCRIPT.md` — 2:45 video script
- `PITCH.md` — 3-minute pitch + Q&A
- `SUBMISSION.md` — full write-up
- `JUDGE_PREP.md` — judge Q&A
- `DEMO_REHEARSAL.md` — setup and fallbacks
- `TOP3_CHECKLIST.md` — verified metrics and submission checklist

**Don’t monitor the agent. Cap its actions.**
