# KRON — PPT Outline (12 slides)

> **Deck title:** KRON — The Capability Firewall for AI Agents
> **Subtitle:** Preview the blast radius. Bind the approval. Prove the enforcement.
> **Track:** PS 2.1 — AI-agent safety & control
> **Rule:** every number in this deck comes from `pnpm demo:attack all` or `pnpm demo:proof`. No invented benchmarks.

---

## Slide 1 — Title

**Visual:** KRON wordmark on cream. One line of mono text: `sandbox-first · rules-only · deterministic`.

**Copy:**

# KRON
### The capability firewall for AI agents

Preview the blast radius. Bind the approval. Prove the enforcement.

**Speaker note:** “Most agent safety tools are dashboards. KRON is a control point: an action either passes the full pipeline or it never reaches the tool.”

---

## Slide 2 — The problem is the action, not the prompt

**Visual:** four tool-call chips flying toward a database/mailbox: `email.read`, `files.read`, `db.delete`, `email.send`.

**Copy:**

- Agents now hold real tools: mail, files, customer data, databases.
- A prompt injection is only dangerous when it becomes an **action**.
- Observability tells you after the leak. Approval popups show a tool name and call it safety.
- The hard question: **what exactly is the human approving, and can the agent reuse it?**

**Speaker note:** “The unit of safety is not the model output. It is the tool invocation.”

---

## Slide 3 — One path, no bypass

**Visual:** horizontal pipeline with seven gates.

**Copy:**

```
classify → real impact preview → risk score → safe rewrite
        → hash-bound approval → one-shot capability grant → receipt
```

- Reads, writes, deletes, sends and payments all use the same gateway.
- Safe alternatives are **revalidated through the same pipeline**; they can still be blocked.
- The tool adapter refuses to run without a valid grant.

**Speaker note:** “There is no ‘just this once’ path and no separate admin bypass.”

---

## Slide 4 — Blast radius, computed against real data

**Visual:** screenshot of the Impact card from `/control`.

**Copy:**

- Preview runs in a **rolled-back transaction** against the sandbox database.
- Shows: rows affected, sensitive rows, recoverability, recipient novelty, attachment sensitivity.
- Delete demo: **1,204 rows**, **37 sensitive**, **not recoverable**.
- The safe rewrite: **archive**, not delete.

**Speaker note:** “The preview is not a model guess. It is a real query and a real rollback.”

---

## Slide 5 — Risk that names the attack

**Visual:** risk card: `75/100`, three factor chips.

**Copy:**

**Lethal trifecta detected**
- untrusted content in the session
- private data read
- new outside recipient

Score: **75/100 → HOLD**
Decision bands: `ALLOW · FLAG · HOLD · BLOCK`
Hard blocks cannot be approved.

**Speaker note:** “Any one of the three is manageable. All three in one session is the exfiltration chain, and the policy says so explicitly.”

---

## Slide 6 — Approval is bound, not vibes

**Visual:** hash card with `sha256(canonical action JSON)`.

**Copy:**

- The card shows the exact tool, arguments, mission and nonce.
- The approval stores `sha256(canonical action JSON)`.
- Any argument change — recipient, attachment, scope, amount — produces a different hash.
- A stale or replayed hash is rejected with **409**.
- Approvals expire.

**Speaker note:** “A human approves an artifact, not a narrative.”

---

## Slide 7 — Drift invalidates consent

**Visual:** three-number flow: `826 → 786`, with a red `409` stamp.

**Copy:**

- A human card previews **826 pending orders**.
- A concurrent job moves **40** orders to shipped.
- Row count alone can miss it; KRON also binds a **fingerprint of the exact rows** the preview saw.
- The stale approval is rejected with **409**.
- Receipt: `toolInvoked: false`, archived rows: **0**.
- Fresh preview: **786**. Fresh approval archives exactly **786**.

**Speaker note:** “This is shadow mode with teeth. When the world moves, consent expires.”

---

## Slide 8 — One-shot capability grants

**Visual:** grant card `active → consumed`, `maxUses 1`.

**Copy:**

- Issued only after the gateway decides the action may run.
- Scoped to one agent, one tool, one canonical action hash.
- Consumed with an **atomic conditional update** before the adapter touches the tool.
- Expires in 60 seconds.
- Replay is rejected before any tool code runs.

**Speaker note:** “The approval authorises a decision. The grant authorises one invocation. They are different objects for a reason.”

---

## Slide 9 — Proof of enforcement

**Visual:** receipt JSON, with before/after snapshot highlighted.

**Copy:**

Each decision emits a **hash-chained receipt**:

- `before` and `after` sandbox state
- `toolInvoked: true | false`
- linked `approvalId` and `grantId`
- `drift` evidence when a card was invalidated
- `prevHash` + `hash`

Downloadable JSON. Chain verification endpoint.

**Speaker note:** “If the tool did not run, the receipt proves it. If it did run, the receipt proves exactly what changed.”

---

## Slide 10 — Counterfactual, measured

**Visual:** two-column comparison.

**Copy:**

| KRON Guard | Baseline |
|---|---|
| Risk **75/100**, HOLD | Tool name + arguments only |
| Real impact preview | No preview |
| Safe version: internal review | No alternative |
| Attacker inbox **0** | Attacker inbox **1** |
| Drift rejected **409**, 0 executed | Stale card can execute |
| One-shot grant + receipt | No enforcement proof |

**Speaker note:** “We ship the losing baseline in the product so the difference is measurable, not rhetorical.”

---

## Slide 11 — Deterministic and offline

**Visual:** terminal output: `30/30 deterministic scenarios passed`.

**Copy:**

- Rules-only. No live LLM. No external network.
- Sandbox only: `.example` domains, in-app mail sink, Algorand TestNet.
- `pnpm demo:attack all` → hero, delete, baseline, drift.
- `pnpm demo:proof` → **30/30** repeated runs.
- Automated suite: **124 tests**, typecheck and build green across **12 workspaces**.

**Speaker note:** “A judge can reproduce every number in this deck without an API key or a funded wallet.”

---

## Slide 12 — Why this wins / close

**Visual:** KRON wordmark + the three verbs.

**Copy:**

### Preview. Bind. Prove.

- **Preview** the real blast radius before the action.
- **Bind** human consent to the exact action hash and live dataset fingerprint.
- **Prove** enforcement with a one-shot grant and a hash-chained receipt.

KRON already runs x402 payments on Algorand inside the same runtime. PS 2.1 is the control plane that makes autonomous tools safe enough to deploy.

**Don’t monitor the agent. Cap its actions.**

**Speaker note:** “The product is not ten features. It is one mechanism applied to every dangerous action.”

---

## Appendix slides (optional, use only if asked)

### A1 — Architecture

```
Agent / MCP client
      │  action request
      ▼
KRON action gateway
  classify · preview · risk · safe rewrite
      │
      ├─ ALLOW / FLAG ──► capability grant ──► tool adapter ──► sandbox
      ├─ HOLD ─────────► hash-bound approval ──► revalidate ──► grant ──► tool adapter
      └─ BLOCK ────────► no grant, no invocation
      │
      ▼
hash-chained audit + enforcement receipts
```

### A2 — Data model

- `Approval` — action hash, safe hash, preview fingerprint, safe preview fingerprint, expiry
- `CapabilityGrant` — agent, tool, action hash, status, max uses, consumed at
- `EnforcementReceipt` — before/after snapshot, tool invoked, approval, grant, drift, chain hash
- `ActionRecord` — decision, score, reasons, rule hits, links to approval / grant / receipt

### A3 — Honest boundaries

- Demo data is seeded; queries and mutations are real.
- Email is an in-app sink; no real mail is sent.
- Payments remain Algorand TestNet only.
- No claim of production red-team results; the drift and baseline numbers are reproducible sandbox measurements.
- Next: live tool adapters, mission contracts, recovery/undo, privacy-aware context (PS 2.2 optional).
