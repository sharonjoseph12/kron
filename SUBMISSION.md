# KRON — Project Submission

## Project Overview

- **Project:** KRON — the capability firewall for AI agents
- **Primary track:** PS 2.1 — AI-agent safety, control and enforcement
- **One-liner:** Preview the blast radius. Bind the approval. Prove the enforcement.
- **Mechanism:** every tool call goes through one gateway: classify → real impact preview → risk score → safe rewrite → hash-bound approval → one-shot capability grant → hash-chained receipt.
- **Also preserved:** policy-controlled x402 payments on Algorand TestNet, including atomic policy-anchor groups, on-chain verification and a fleet emergency stop.
- **Demo:** React control plane (`/control`) with approval desk, impact card, safe version, drift panel, proof pane, audit chain and enforcement receipts.
- **Network:** Algorand TestNet for the payment rail. The PS 2.1 demo itself is fully offline and deterministic.
- **Repo:** `https://github.com/sharonjoseph12/kron` (branch `ps21-agent-control`)
- **Submission format:** video + PPT. No live hosted link is required.

---

## The Problem

Autonomous agents are now given real tools: mail, files, customer data, databases and payment rails. A prompt injection is only dangerous when it becomes a **tool invocation**. Existing safety products mostly observe those invocations after the fact.

Approval dashboards are not enough either. They typically show a tool name and a JSON blob, then record a click that can be replayed. They do not answer:

1. What exactly will change, and how many sensitive rows are in scope?
2. Is this the lethal combination of untrusted content, private data and a new outside recipient?
3. Is there a safer action that still completes the task?
4. Did the human approve the exact action that will run — or a card that went stale?
5. Was the tool actually invoked, and can anyone prove it later?

KRON answers all five in one path.

---

## What It Does

### 1. One gateway, no bypass

Every non-payment action is classified as `read | write | delete | send | pay` and routed through the same pipeline. Reads still go through the capability adapter, so every invocation is accounted for.

### 2. Real impact preview

For mutations, the preview runs inside a **rolled-back transaction** against the actual sandbox database. It returns rows affected, sensitive rows, recoverability, recipient novelty, attachment sensitivity and a dataset fingerprint. For email, it resolves the real attachment and contact list.

### 3. Deterministic risk and attack naming

A rules-only risk engine scores the action and raises the decision band. It explicitly detects the **lethal trifecta** (untrusted content + private data + new outside recipient in one session), mission-contract drift, bulk mutation, irreversible deletes, private attachments and new recipients. Hard blocks (for example `db.drop_table`) can never be approved.

### 4. Safe alternatives, revalidated

For held actions KRON proposes a deterministic safe version: archive instead of hard delete, send to the internal owner instead of an outside address, scope an unscoped update, or cap a payment. The safe action is re-previewed and re-scored through the same pipeline and can still be `BLOCK`.

### 5. Hash-bound, drift-aware approvals

An approval is bound to `sha256(canonical action JSON)`. Changing the recipient, attachment, scope, mission or nonce produces a different hash. The approval also stores:

- a fingerprint of the exact rows the preview observed;
- the safe action's own preview and fingerprint;
- an expiry.

At decision time KRON revalidates the action, recomputes the preview and compares the fingerprint. If the dataset moved, the approval returns **409** and is marked expired. The receipt records `toolInvoked: false`.

### 6. One-shot capability grants

A grant is issued only after the gateway has decided an action may run. It is scoped to one agent, one tool and one canonical action hash, expires in 60 seconds, and is consumed with an atomic conditional update **before** the tool adapter touches the tool. Replay is rejected before any tool code runs.

### 7. Enforcement receipts

Every decision emits a hash-chained receipt containing:

- the action and decision;
- before/after sandbox state;
- `toolInvoked`;
- the linked approval and grant;
- drift evidence when a card was invalidated;
- `prevHash` and `hash`.

Receipts are downloadable JSON, exposed through the API, and independently chain-verifiable.

### 8. Preserved x402 / Algorand payment rail

The original KRON runtime remains: isolated agent wallets, policy engine, atomic policy-anchor groups, ARC-2 notes, on-chain verification, what-if simulation and fleet emergency stop. PS 2.1 extends the same control philosophy from money to every dangerous tool call.

---

## Architecture

```
Agent / MCP client
        │ action request
        ▼
KRON action gateway
  classify · real preview · risk · safe rewrite
        │
        ├─ ALLOW / FLAG ──► one-shot grant ──► tool adapter ──► sandbox
        ├─ HOLD ─────────► hash-bound approval ──► revalidate + fingerprint ──► grant ──► tool adapter
        └─ BLOCK ────────► no grant, no invocation
        │
        ▼
hash-chained audit + enforcement receipts
        │
        └─ payment rail (x402 / Algorand TestNet) remains available
```

### Data model (control plane)

| Model | Purpose |
|---|---|
| `ActionRecord` | Decision, score, reasons, rule hits, execution, links to approval / grant / receipt |
| `Approval` | Action hash, safe hash, preview fingerprint, safe preview fingerprint, expiry, decision |
| `CapabilityGrant` | Agent, tool, action hash, scope, max uses, consumed at, expiry |
| `EnforcementReceipt` | Before/after snapshot, tool invoked, approval, grant, drift, chain hash |
| `ControlAuditEntry` | Hash-chained operator/system timeline |

---

## Demo Script (2:45)

Full script: `VIDEO_SCRIPT.md`. Deck: `KRON_PS21_Deck.pptx` / `KRON_PS21_Deck.pdf` (outline: `PPT_OUTLINE.md`).

| Time | Beat | Real number |
|---|---|---|
| 0:00 | Monitoring is not control | — |
| 0:20 | One pipeline, one grant | — |
| 0:45 | Hero attack: poisoned email + contract → outside send | risk **75/100**, HOLD, attacker **0** |
| 1:25 | Bulk delete | **1,204** rows, **37** sensitive, archive **1,204** |
| 1:55 | Shadow drift | **826 → 40 changed → 786**, stale **409**, **0** executed, fresh **786** archived |
| 2:25 | Baseline counterfactual + receipts | attacker **1** on baseline, **30/30** deterministic |
| 2:40 | Close | — |

---

## How to Run & Verify

```bash
pnpm install
pnpm demo:reset          # seeds 1,204 orders, 37 sensitive rows, empty attacker inbox
pnpm dev                 # API + dashboard
# open http://localhost:5173/control
# credentials: data/demo-credentials.txt (gitignored, randomly generated)
```

Deterministic proof, no live model or external network:

```bash
pnpm demo:attack all     # hero | delete | baseline | drift, with exact end-state assertions
pnpm demo:proof          # 30/30 repeated runs
pnpm test                # 124 automated tests
pnpm typecheck           # 12 workspaces
pnpm build
```

Expected attack output:

```
PASS  hero      HOLD → safe internal send · attacker 0
PASS  delete    HOLD → archive 1,204 · attacker 0
PASS  baseline  raw approval → attacker inbox 1
PASS  drift     stale 826 → live 786 · rejected 409 · 786 archived
```

---

## Why This Wins — Judging Rubric

| Criterion | Proof |
|---|---|
| **Wow** | A human card goes stale, KRON rejects it with 409, a receipt proves the tool never ran, then a fresh approval archives exactly the remaining 786 rows. |
| **Technical depth** | Rolled-back previews, canonical action hashing, dataset fingerprints, atomic one-shot grants, hash-chained receipts, drift invalidation, safe-rewrite revalidation, audit chain. |
| **Novelty** | Not another monitoring dashboard: a **sandbox-first capability firewall** where consent is bound to the exact action and live dataset, and every decision has enforcement proof. |
| **Real-world** | The same pattern applies to email, files, databases, cloud APIs and payments. Live adapters can replace the sandbox without changing the decision/grant/receipt contracts. |
| **Completeness** | End-to-end: poisoned read → risk → hold → impact card → safe alternative → approval → grant → execution → before/after receipt → downloadable proof. |
| **Honesty** | All numbers are produced by the runner and proof script. No invented benchmark or red-team metrics. Sandbox and TestNet boundaries are stated explicitly. |

---

## Security & Correctness

- **Approval binding:** `sha256(canonical action JSON)`; any argument change requires a fresh approval.
- **Dataset binding:** fingerprint over the exact rows/recipient/file observed by the preview.
- **One-shot grants:** atomic conditional consume; 60-second expiry; scoped by agent, tool and action hash.
- **No transaction held over a human decision:** preview runs and rolls back; execution rechecks at decision time.
- **Preview-vs-execution verification:** execution aborts and rolls back if affected rows differ from the preview.
- **Receipt chain:** each receipt commits to the previous hash; verification walks the chain.
- **Audit chain:** every control event is hash-chained; a tamper demo proves detection.
- **Sandbox only:** `.example` domains, in-app mail sink, no real email or money, Algorand TestNet only.
- **No secrets or default credentials:** credentials are generated by `pnpm demo:reset` and written to a gitignored, mode-`0600` file.

---

## Honest Boundaries

- The PS 2.1 demo uses a seeded sandbox database; the queries, previews, mutations and proofs are real, but the data shape is fixed for repeatability.
- No production red-team was run; the baseline and drift numbers are reproducible sandbox measurements.
- Live tool adapters, mission-scoped contracts, recovery/undo and context-aware privacy (PS 2.2) are the next layer.
- The payment rail remains Algorand TestNet. No real funds move.

---

## Links

- `VIDEO_SCRIPT.md` — 2:45 recording script
- `PPT_OUTLINE.md` — 12-slide deck with speaker notes
- `DEMO_REHEARSAL.md` — setup and fallback plan
- `JUDGE_PREP.md` — Q&A
- `docs/ARCHITECTURE.md` — original runtime architecture
- `KRON_PRD_Final_PS2.1.md` — requirements

**Don’t monitor the agent. Cap its actions.**
