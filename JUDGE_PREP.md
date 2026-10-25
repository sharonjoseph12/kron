# KRON — Judge Preparation & Q&A

> **Frame:** “Don’t monitor the agent. Cap its actions.”
> **Mechanism:** Preview the blast radius. Bind the approval. Prove the enforcement.
> **Primary track:** PS 2.1 — AI-agent safety and control.

---

## 30-Second Elevator Pitch

> “KRON is a capability firewall for AI agents. Every dangerous tool call — send, write, delete, pay — goes through one path: we preview the real blast radius against the actual data, score the risk, generate a safer alternative, bind any human approval to a SHA-256 hash of the exact action, and require a one-shot capability grant before the tool runs. Every decision leaves a hash-chained receipt that proves whether the tool was invoked and exactly what changed.
>
> The demo is deterministic and offline: the hero attack is held at 75/100 with zero attacker mail, the bulk delete becomes a recoverable archive of 1,204 rows, and a stale approval is rejected with 409 when the dataset moves under it.”

---

## The Five Tough Questions

### 1. “How is this different from an agent observability / approval dashboard?”

**Say:**
- “Observability tells you what happened. KRON decides what is allowed to happen, and then proves it.”
- “Our approval card is not a tool name and a JSON blob. It shows the real rows affected, sensitive rows, recoverability, recipient novelty and attachment sensitivity.”
- “The click is bound to `sha256(canonical action JSON)` plus a fingerprint of the exact rows the preview saw. A changed argument or a changed dataset invalidates consent.”
- “Execution requires a one-shot capability grant consumed by the tool adapter. The receipt records `toolInvoked` and before/after state.”

**Proof to show:** the hero card, the drift 409, the downloaded receipt.

---

### 2. “Why a dataset fingerprint? Isn’t a row count enough?”

**Say:**
- “No. A concurrent job can change the values a human approved while leaving the row count identical.”
- “In the drift demo the card says 826 pending orders. Another job moves 40 to shipped. The live count is 786, but more importantly the fingerprint of the exact rows changed.”
- “The stale approval is rejected with 409 before the adapter is called. The receipt proves `toolInvoked: false` and zero rows archived.”
- “The agent re-evaluates, the fresh card shows 786, and the human approves the new hash. Exactly 786 rows are archived.”

**Proof to show:** `pnpm demo:attack drift`.

---

### 3. “Can an agent replay an approval or a capability grant?”

**Say:**
- “No. Approvals are bound to the canonical action hash; changing any field produces a different hash.”
- “Grants are scoped to one agent, one tool and one action hash, expire in 60 seconds, and are consumed with an atomic conditional update before the tool runs.”
- “A second consume attempt is rejected. Tests cover replay, hash mismatch and expiry.”

**Proof to show:** `capability.integration` tests, grant card `active → consumed`, `maxUses 1`.

---

### 4. “What if the safe alternative is still dangerous?”

**Say:**
- “The safe version is not a bypass. It is re-previewed and re-scored through the full pipeline, and it can still be BLOCK.”
- “The differences are explicit: archive instead of delete, internal owner instead of outside recipient, scoped update instead of table-wide.”
- “A human approves the alternative, not a silent rewrite.”

**Proof to show:** hero safe-version card; `safeRevalidation.decision` in the API response.

---

### 5. “Is this only a sandbox demo?”

**Say:**
- “The demo is sandbox-only on purpose: `.example` domains, an in-app mail sink, seeded data, no real money or email.”
- “The control plane is adapter-shaped. The gateway reaches tools only through the capability adapter. A production deployment swaps in live adapters while keeping the same decision, grant and receipt contracts.”
- “The payment rail is already real on Algorand TestNet: isolated wallets, atomic policy-anchor groups and on-chain verification. PS 2.1 extends that same runtime from money to every dangerous tool call.”

---

## The Differentiators, Ranked

1. **Drift-bound approvals** — consent expires when the live dataset moves, not just when the JSON changes.
2. **One-shot capability grants** — the approval authorises a decision; the grant authorises exactly one invocation.
3. **Proof of enforcement** — hash-chained receipts with before/after state, `toolInvoked`, approval, grant and drift evidence.
4. **Real blast-radius preview** — rolled-back transaction against the actual sandbox; sensitive rows and recoverability, not a model guess.
5. **Revalidated safe alternatives** — deterministic rewrites that can still be blocked.
6. **Measured baseline** — the product ships the losing mode; approve the raw card and exactly one email reaches the attacker.

---

## Claims and Proof

| Claim | Proof |
|---|---|
| “Risk 75/100, HOLD, attacker inbox 0” | `pnpm demo:attack hero`; integration test asserts risk 75 and attacker 0 |
| “1,204 rows, 37 sensitive, archive instead of delete” | `pnpm demo:attack delete`; preview and proof pane both query the sandbox |
| “826 → 40 changed → 786 live; stale 409; 0 executed; fresh 786 archived” | `pnpm demo:attack drift`; stale receipt has `toolInvoked: false` |
| “Baseline leaks exactly one email” | `pnpm demo:attack baseline`; proof pane attacker messages = 1 |
| “One-shot grants” | atomic consume + replay/expiry tests |
| “Hash-chained receipts” | `GET /api/receipts/verify`; receipt JSON has `prevHash` + `hash` |
| “30/30 deterministic runs” | `pnpm demo:proof` |
| “126 automated tests, typecheck + build clean” | `pnpm test`, `pnpm typecheck`, `pnpm build` |

---

## Rogue-Agent Demo (the money shot)

> The agent reads a poisoned supplier email, reads a signed customer contract, then tries to send it to a new outside address.

1. **Reads are allowed**, but they mark the session: untrusted content and private data.
2. **The send is held at 75/100** because of the lethal trifecta.
3. The impact card reveals the customer-confidential attachment and the new recipient.
4. The safe version sends an internal review copy to legal; the operator approves that hash.
5. The proof pane stays at **0 attacker messages**.
6. The receipt records the before/after state and the consumed grant.

**What to say:** “The model is not the trust boundary. The action pipeline is. When the model is convinced to exfiltrate, the pipeline makes exfiltration a reviewed, bounded, provable event.”

---

## Algorand / x402 Questions

### “Why Algorand?”
- Deterministic 3.3-second finality suits agent loops.
- Sub-cent fees make small tool payments viable.
- Native atomic groups let the policy anchor and the payment succeed or fail together.

### “Did PS 2.1 replace the payment product?”
- No. The x402 rail is preserved: isolated wallets, policy engine, atomic policy-anchor groups, ARC-2 notes, on-chain verification, simulation and emergency stop.
- PS 2.1 extends the control plane from money to all dangerous actions. Payments are one action kind (`pay`) in the same gateway vocabulary.

### “Where are the real on-chain proofs?”
- The payment demo remains under `pnpm --filter @kron/api demo:attack:x402` and the `/verify` dashboard route.
- The PS 2.1 submission does not require a live chain link; its proof is the deterministic sandbox runner and enforcement receipts.

---

## Honest Boundaries (say this before a judge asks)

- The PS 2.1 data is seeded; the queries, previews, mutations and proofs are real.
- No production red-team was run. The baseline and drift numbers are sandbox measurements.
- Email is an in-app sink; no real mail leaves the machine.
- Algorand stays on TestNet.
- Next: live tool adapters, mission contracts, recovery/undo, optional PS 2.2 context privacy.

---

## Closing Line

> “The agent economy does not need another dashboard. It needs a control point.
>
> Preview the blast radius. Bind the approval. Prove the enforcement.
>
> Don’t monitor the agent. Cap its actions.”
