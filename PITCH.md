# KRON — Top-3 Pitch (PS 2.1, 3 Minutes)

> **Tagline:** The capability firewall for AI agents.
> **Mechanism:** Preview the blast radius. Bind the approval. Prove the enforcement.
> **Rule:** every number below comes from `pnpm demo:attack all` or `pnpm demo:proof`.

---

## [0:00–0:20] The gap

> “AI agents can read email, open contracts and delete databases. Most agent-safety products watch that happen and draw a chart afterwards.
>
> A log line is not a control. By the time the alert fires, the data is gone.”

**Slide:** `Monitoring observes. KRON decides.`

---

## [0:20–0:45] The mechanism

> “KRON is a capability firewall. Every tool call goes through one path: classify, preview the real impact, score the risk, generate a safe alternative, bind any human approval to a SHA-256 hash of the exact action, then require a one-shot capability grant before the tool runs.
>
> No grant, no tool call. Every decision leaves a hash-chained receipt.”

**Slide:** `classify → preview → score → safe rewrite → hash-bound approval → one-shot grant → receipt`

---

## [0:45–1:25] Demo 1 — lethal trifecta

**Action:** `Run hero attack`

> “The agent reads a poisoned supplier email, reads a signed customer contract, then tries to send it to a new outside address. KRON holds it at **75/100**.
>
> The impact card shows what the agent omitted: the attachment is customer-confidential and the recipient is new. The reason is the lethal trifecta: untrusted content, private data and a new outside recipient in one session.
>
> The operator approves the **safe version** — an internal review copy to legal. The safe version is revalidated through the same pipeline. Attacker inbox: **0**.”

**Slide:** `risk 75/100 · HOLD · safe internal send · attacker 0`

---

## [1:25–1:55] Demo 2 — blast radius

**Action:** `Bulk delete`

> “The agent asks to delete every order. The preview runs in a rolled-back transaction against the real sandbox: **1,204 rows, 37 sensitive, not recoverable**.
>
> The safe rewrite is an archive. The human approves it. The proof pane shows **1,204 archived**, same **1,204** total, zero attacker messages. Nothing became unrecoverable.”

**Slide:** `1,204 rows · 37 sensitive · archive instead of delete`

---

## [1:55–2:25] Demo 3 — the card that went stale

**Action:** `Shadow drift`

> “A human card says **826 pending orders**. While they decide, another job moves **40** orders to shipped.
>
> The action hash is unchanged. KRON also binds a fingerprint of the exact rows the preview saw, so the stale card is rejected with **409** before the tool adapter is called. The receipt proves `toolInvoked: false`; zero rows archived.
>
> The agent re-evaluates. The fresh card says **786**. The human approves the new hash. Exactly **786** rows are archived. Drift invalidates consent; recovery is explicit.”

**Slide:** `826 → 40 changed → 786 live · stale 409 · 0 executed · fresh 786`

---

## [2:25–2:40] Why it is trustworthy

**Action:** show receipts, download one, run `pnpm demo:proof`

> “Every decision emits a receipt: before/after state, whether the tool ran, the linked approval and grant, and drift evidence. The baseline is deliberately worse — approve the raw card and exactly **one** email reaches the attacker.
>
> The whole demo is deterministic and offline: **30/30** runs pass, **126 tests** are green, and no live model or external network is involved.”

**Slide:** `hash-chained receipts · one-shot grants · 30/30 · 126 tests`

---

## [2:40–3:00] Close

> “The product is not ten features. It is one mechanism applied to every dangerous action.
>
> Don’t monitor the agent. Cap its actions.
>
> KRON: preview the blast radius, bind the approval, prove the enforcement.”

**Slide:** `KRON — Preview. Bind. Prove.`

---

## Judge Q&A

### 1. “How is this different from an approval dashboard?”
A dashboard shows a tool name and asks a human to click. KRON shows a **real impact preview**, names the attack pattern, proposes a revalidated safe alternative, binds consent to the exact action hash **and** a live dataset fingerprint, and requires a **one-shot grant** before the tool runs. The receipt proves whether the tool was actually invoked. The difference is enforcement, not visibility.

### 2. “Why a dataset fingerprint? Isn’t a row count enough?”
No. The drift demo is the proof: the row count is useful, but a concurrent update can change the values a human approved while leaving the count identical. KRON hashes the exact rows the preview observed. If the fingerprint changes, the approval is stale and returns **409**. The stale decision produces a receipt with `toolInvoked: false`.

### 3. “Can an agent replay an approval or a grant?”
No. Approvals are bound to `sha256(canonical action JSON)`; changing any argument produces a different hash. Grants are scoped to one agent, one tool and one action hash, expire in 60 seconds, and are consumed with an atomic conditional update. A second use is rejected before the tool adapter is called.

### 4. “What if the safe alternative is still dangerous?”
The safe version is revalidated through the full pipeline — preview, risk and hard rules — and can still be **BLOCK**. The human sees the differences explicitly. It is an alternative, not an equivalent.

### 5. “Does this only work in a sandbox?”
The demo is sandbox-only on purpose: `.example` domains, an in-app mail sink, a seeded SQLite database, and Algorand TestNet for payments. The control plane is adapter-shaped: the gateway talks to tools only through the capability adapter. A production deployment swaps in live adapters while keeping the same decision, grant and receipt contracts.

### 6. “How do you know the numbers are real?”
Run `pnpm demo:attack all` and `pnpm demo:proof`. The preview executes inside a rolled-back transaction; the proof pane queries the sandbox database after execution. The scenario runner asserts exact end states. No benchmark or red-team number is hardcoded.

### 7. “Where does Algorand / x402 fit?”
KRON already ships policy-controlled x402 payments on Algorand: isolated agent wallets, atomic policy-anchor groups, on-chain verification and an emergency stop. PS 2.1 extends the same runtime from money to **every dangerous tool call**. The payment rail is preserved; it is no longer the only thing being governed.

### 8. “What is still missing?”
Live tool adapters, mission-scoped contracts, recovery/undo for destructive actions, and stronger context privacy (an optional PS 2.2 bridge). Those are the next layer. The mechanism — preview, bind, prove — is already end-to-end.
