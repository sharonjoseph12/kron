# KRON — 4:00 Demo Script

> **Track:** PS 2.1 — AI Agent Safety and Control
> **Title:** *KRON — The Capability Firewall for AI Agents*
> **Tagline:** Preview the blast radius. Bind the approval. Prove the enforcement.
> **Runtime:** 4:00 target · 4:15 hard stop
> **Format:** 1920×1080 screen recording, browser zoom 100%, one voiceover track.
> **Rule:** every number in this script is printed by the demo. If a number is not on this page, do not say it.

**The sentence a judge should remember after 4 minutes:**

> *Monitoring tells you what the agent did. KRON decides what it can do — and proves it.*

**The one-line analogy, if you need it in Q&A:** *Most agent-safety tools are CCTV. KRON is the customs checkpoint — nothing crosses without a declaration and a stamp.*

---

## 0. The four wow moments (build the edit around these)

| # | Moment | Why it lands |
|---|---|---|
| **1** | **The preview really runs the delete — then rolls it back.** 1,204 rows are actually deleted inside a transaction, counted, and restored. | It is not an estimate or a policy guess. The agent sees the truth; the database keeps its data. |
| **2** | **A valid approval is rejected because the data moved.** The action hash is unchanged, the click is legitimate, and it still dies with a **409**. | This is TOCTOU on human consent — the failure mode almost every approval dashboard has and nobody demos. |
| **3** | **The control experiment.** Same desk, same agent, raw actions: **1** email leaks. With KRON: **0**. | Judges don't have to take the claim on faith. The baseline is the counterfactual. |
| **4** | **The audit proof.** One-shot grants, `toolInvoked`, before/after state, hash-chained receipts. | Every intervention is reconstructable after the fact — the third PS 2.1 deliverable, shown, not asserted. |

**Optional fifth wow (10 seconds, see §6):** tamper with the audit log on camera → *Tamper detected*.

---

## 1. Why this wins PS 2.1

The brief asks for three things. The video proves all three on screen, in this order:

| PS 2.1 deliverable | Where the video proves it | Evidence on screen |
|---|---|---|
| **Monitor and control agent actions** | Live timeline + one gateway + one-shot grant | every `read / write / delete / send / pay` call is classified before it runs; **no grant, no call** |
| **Detect or block harmful / unauthorised actions** | Hero attack, bulk delete, stale approval | risk **75/100** → **HOLD**; **1,204 rows / 37 sensitive** → archive; stale approval **409**, **0 executed** |
| **Audit / monitoring interface with actions, alerts, interventions** | Approval desk, drift panel, enforcement receipts, baseline diff | attacker inbox **0 vs 1**, `toolInvoked`, before/after state, hash chain **intact** |

**Three differentiators — say them, don't assume the judge infers them:**

1. **Inline, not after the fact.** It is the enforcement point, not an observability layer. Nothing reaches a tool without a grant.
2. **It allows safely, not just blocks.** Every held action gets a deterministic safe rewrite — archive instead of delete, internal review instead of exfiltration — revalidated through the same pipeline. Blocking is easy; completing the task without the damage is the product.
3. **Consent is bound to the data it was granted for.** Approval = action hash + a SHA-256 fingerprint of the exact rows the human saw. If the data moves, the approval dies.

**Tone:** calm, specific, evidence-first. Do not sell. Let the numbers do the selling. Never say "100% secure", "prevents all attacks", "benchmark", or "real customers".

---

## 2. Verified demo values (memorise these, don't improvise)

| Value | Where it comes from |
|---|---|
| `1,204` orders in the sandbox | `pnpm demo:reset` |
| `37` sensitive rows — 5 customers with open shipments | `pnpm demo:reset` |
| Attacker inbox `0` / `1` (baseline) | `pnpm demo:proof` |
| Hero risk **75/100**, decision **HOLD** | `pnpm demo:attack hero` |
| Hero safe send → `legal@coastalcatch.example`, attacker `audit@supplier-docs.example` | seeded sandbox |
| Delete preview **1,204** rows / **37** sensitive / **not recoverable** | `pnpm demo:attack delete` |
| Drift card **826** → **40** moved → live **786** | `pnpm demo:attack drift` |
| Stale approval **HTTP 409**, **0** rows executed | drift receipt |
| Fresh approval archives exactly **786**; active **418** | `pnpm demo:attack drift` |
| Hash-chained receipts, `Chain intact` | `/control` → Enforcement receipts |
| **30/30** deterministic runs | `pnpm demo:proof` |
| **126** automated tests | `pnpm test` |

---

## 3. Pre-flight (10 minutes before recording)

```bash
pnpm install
pnpm demo:reset     # seeds 1,204 orders · 37 sensitive · empty attacker inbox
pnpm dev            # API + dashboard
```

1. Open `http://localhost:5173/control` and log in with `data/demo-credentials.txt`.
2. Confirm the **Evidence** pane reads **1,204 orders · 37 sensitive · attacker inbox 0**.
3. In a second terminal at the repo root, run the backup proof once, then reset again:

```bash
pnpm demo:attack all
pnpm demo:proof
pnpm demo:reset
```

Expected:

```
PASS  hero      HOLD → safe internal send · attacker 0
PASS  delete    HOLD → archive 1,204 · attacker 0
PASS  baseline  raw approval → attacker inbox 1
PASS  drift     stale 826 → live 786 · rejected 409 · 786 archived

30/30 deterministic scenarios passed
```

**Checklist before you hit record**

- [ ] Browser at 100% zoom, 1920×1080, bookmarks bar hidden
- [ ] Only the dashboard tab + a clean terminal tab are visible
- [ ] Terminal scrollback cleared; no `.env`, no `data/demo-credentials.txt`, no tokens
- [ ] Notifications off (macOS Focus / Windows Do Not Disturb)
- [ ] Mouse cursor visible and slowed; no jitter while narrating
- [ ] One practice run of each click path, then `pnpm demo:reset`

---

## 4. Shot list at a glance

| Time | Beat | On screen | Numbers to say |
|---|---|---|---|
| 0:00–0:29 | The gap: watching is not controlling | Title, then a log scrolling into a flat green chart | — |
| 0:29–1:00 | The mechanism: one path, no bypass | `/control`, pipeline strip | one path, one grant |
| 1:00–1:46 | Detect + block: the lethal trifecta | Run hero attack → impact card → safe rewrite | **75/100**, HOLD, attacker **0** |
| 1:46–2:22 | Control scope: blast radius | Bulk delete → archive instead | **1,204** / **37**, not recoverable → archived |
| 2:22–3:12 | Trust the consent: stale approval | Shadow drift → **409** → fresh card | **826 → 40 → 786**, **0 executed**, fresh **786** |
| 3:12–3:36 | Audit + counterfactual | Baseline toggle, receipts | attacker **1**, `toolInvoked`, chain intact |
| 3:36–4:00 | Close: the claim | Wordmark, proof badge | **30/30**, **126** tests |

---

## 5. The complete script

### 0:00–0:29 · Cold open — "Watching is not controlling"

**SHOT** Title card: KRON wordmark + `PS 2.1 · AI Agent Safety and Control`. Hard cut to a plain agent log scrolling fast — `read inbox`, `read contract`, `email.send → external` — then a green observability chart that flatlines. The chart is the punchline: it is already too late.

**SAY**

> Give an AI agent your inbox, your contracts, your production database — then let it act unsupervised.
> An agent doesn't have to be malicious to be dangerous. It only needs one bad instruction.
> Most safety tools watch that happen and draw a chart. A log line is not a control. A kill switch is not judgement.
> KRON sits between the agent and every tool it can touch, and decides before anything runs.
> Monitor. Block. Prove.

**ON SCREEN** `Monitoring observes.` → `KRON decides.` · `① Monitor & control · ② Detect & block · ③ Audit & intervene`

**DELIVERY** Flat and quiet. One beat of silence after "unsupervised". No music under the first sentence; bring a low bed in at 0:12. Cut hard on "Prove."

---

### 0:29–1:00 · The mechanism — "One path. No bypass."

**SHOT** `/control` loads. Slow horizontal pan across the pipeline strip. Cursor parked, no clicking. The page itself is the diagram.

**SAY**

> Every action — read, write, delete, send, pay — takes one path. No bypass.
> KRON classifies it, previews the real blast radius, scores the risk, and drafts a safer action.
> A human approval is bound to a SHA-256 of that exact action, and to a fingerprint of the exact rows the preview saw.
> Execution needs a one-shot grant, claimed atomically. No grant, no call. Two callers? One wins.
> Every decision ends in a hash-chained receipt.
> This is not observability. It's an enforcement point.

**ON SCREEN** `classify → preview → score → safe rewrite → hash-bound approval → one-shot grant → receipt`

**WOW #1 — say this slowly:** *"claimed atomically. Two callers? One wins."* The grant is consumed by a conditional database update **before** the adapter is called; a replay gets a 403 and the tool never runs.

**DELIVERY** Animate the pipeline once, left to right, in sync. Slow down on "No grant, no call." — it is the whole architecture. Land hard on "enforcement point."

---

### 1:00–1:46 · Demo 1 — the lethal trifecta

**SHOT** Click **Run hero attack**. Let the **Live timeline** fill, then select the `email.send` card. Hold on the impact card before speaking.

**SAY**

> Demo one: the lethal trifecta.
> The agent reads a poisoned supplier email. Then a signed customer contract. Then it tries to send that contract to an address it has never used.
> KRON holds it at 75 out of 100.
> The impact card shows why: untrusted content, a customer-confidential attachment, a new outside recipient — all in one session.
> The operator gets the blast radius in business terms, not a JSON blob and a yes-or-no button.
> But blocking would fail the task. KRON rewrites it: send to the internal legal owner for review — revalidated through the same pipeline.
> Approve. Attacker inbox: zero. Task complete.

**DO**

1. Click **Run hero attack**.
2. Wait for the `email.send` card, click it.
3. Point at: risk **75/100**, `Why held` → lethal trifecta, attachment `customer-confidential`, recipient **New**.
4. Point at the green **Safe alternative** card: **Send to the internal owner for review**.
5. Click **Approve safe version**.
6. Point at **Evidence** → attacker inbox **0**, outbound **1**.

**ON SCREEN** `risk 75/100 · HOLD · attacker inbox 0 · safe send to legal@coastalcatch.example`

**DELIVERY** Say the three ingredients slowly — untrusted content, private data, new recipient — and let the judge connect them. Pause on **75** for a full second.

---

### 1:46–2:22 · Demo 2 — blast radius

**SHOT** Click **Bulk delete**. Select the `db.delete` card. Let the preview numbers sit unchanged for two seconds before narrating.

**SAY**

> Demo two: blast radius.
> The agent asks to hard-delete every order.
> This is not a simulation of a delete. KRON actually runs it inside a transaction, counts what would die, then rolls the database back. 1,204 rows. Thirty-seven belong to customers with open shipments. Not recoverable.
> A dashboard shows you that after the delete. KRON shows it before.
> The safe rewrite is an archive. Same business outcome, without the irreversible part.
> Approve: 1,204 archived, zero lost.

**DO**

1. Click **Bulk delete**.
2. Select the `db.delete` card.
3. Point at **1,204 rows**, **37 sensitive**, **Recoverable: No**.
4. Point at the **Evidence** pane: all **1,204 orders are still there** — the preview rolled back.
5. Point at the safe version: **Archive instead of delete**.
6. Click **Approve safe version**.
7. Point at **Evidence**: archived **1,204**, total **1,204**, attacker **0**.

**ON SCREEN** `1,204 rows · 37 sensitive · not recoverable → archive · 1,204 archived`

**WOW #2 — the technical flex:** the preview is a real `DELETE`, then a `ROLLBACK`. The counter is not a model estimate. Step 4 is the proof: the data is still there.

**DELIVERY** "A dashboard shows you that after the delete" is the differentiation line — say it plainly, no sarcasm. Pause after "Not recoverable."

---

### 2:22–3:12 · Demo 3 — the card that went stale

**SHOT** Click **Shadow drift**. The red drift panel expands. Let it sit for two full seconds before narrating; the silence makes the judge read the numbers.

**SAY**

> Demo three — the failure nobody demos: stale consent.
> A human sees a card: 826 pending orders. While they decide, a concurrent job moves 40 of them to shipped. Live data is 786.
> The action hash is unchanged — the agent is asking for the same tool with the same arguments. Most approval systems would execute that stale click.
> KRON fingerprints the exact rows the human saw — a SHA-256 over the dataset, not just a count. The approval is rejected with a 409 before the adapter is called. The receipt proves the tool never ran. Zero rows archived.
> The agent re-evaluates. Fresh card: 786. The human approves the new hash. Exactly 786 archived.
> Consent has to be bound to the data it was granted for.

**DO**

1. Click **Shadow drift**.
2. Point at the four drift stats: card preview **826** · concurrent change **40** · live data **786** · executed by stale card **0**.
3. Point at the binding check: `action hash unchanged · fingerprint … → …` and `409: … Nothing executed.`
4. Point at the recovery path: fresh preview **786**, archived **786**, active **418**.
5. Dismiss the panel.

**ON SCREEN** `826 → 40 → 786 · stale 409 · 0 executed · fresh 786 archived · active 418`

**WOW #3 — the differentiator:** the approval did not fail because the agent changed. It failed because the **world** changed. This is time-of-check to time-of-use, applied to human consent. Say "Consent has to be bound to the data it was granted for" once, slowly, then stop.

**DELIVERY** Do not rush. The silence after the 409 is the moment.

---

### 3:12–3:36 · Audit + counterfactual — why you can trust the numbers

**SHOT** Toggle **Baseline** on, run the attack, land on attacker inbox **1**. Hold. Then toggle back to **KRON**, scroll to **Enforcement receipts**, show **Chain intact**.

**SAY**

> Now the audit trail.
> Toggle baseline: same desk, raw actions, no preview, no rewrite. Approve — exactly one email reaches the attacker.
> KRON: zero.
> Every decision leaves a receipt: before and after state, whether the tool actually ran, the grant that authorised it, the drift evidence when it didn't. The hash chain verifies end to end.

**DO**

1. Toggle **Baseline** on, click **Run baseline attack**.
2. Point at attacker inbox **1**. Say nothing for one beat — let it land.
3. Toggle back to **KRON**, scroll to **Enforcement receipts**, show **Chain intact**.
4. Click **Download** on one receipt; show `toolInvoked`, `before` / `after`, and the grant id for two seconds.

**ON SCREEN** `baseline: 1 leaked · KRON: 0 · chain intact · toolInvoked`

**WOW #4 — the control experiment:** one variable changes — the guard. Everything else is identical. That is why the number is believable.

**DELIVERY** The pause after "KRON: zero" does more than any adjective. Do not fill it.

---

### 3:36–4:00 · Close — the claim

**SHOT** Cut to the wordmark. Optional two-second flash of the terminal: `30/30 deterministic scenarios passed`.

**SAY**

> Under the hood: 30 out of 30 deterministic scenarios, 126 automated tests, no live model, no external network on the control path. Reproducible.
> Settlement proofs can anchor to Algorand TestNet. The control plane is chain-agnostic.
> Monitoring tells you what the agent did. KRON decides what it can do — and proves it.
> KRON. Preview the blast radius. Bind the approval. Prove the enforcement.

**ON SCREEN** `KRON — The Capability Firewall for AI Agents` · `30/30 deterministic · 126 tests` · `① Monitor & control ✓ ② Detect & block ✓ ③ Audit & intervene ✓`

**DELIVERY** Deliver the Algorand line as a footnote, not a pitch — one breath, no emphasis. The last four words are the product: **Preview. Bind. Prove.** Cut music on "enforcement", then 0.5s of black.

---

## 6. Wow bank — optional 8–12 second inserts

Use these only if your cap is **4:10–4:15** or you are pitching live. Each replaces the last few seconds of the close, not the proof beats.

### A. Tamper with the audit log on camera (10s, highest impact)

1. After showing **Chain intact**, click **Tamper** in the Live timeline header.
2. The status flips to **Tamper detected**.
3. Say: *"I just edited the audit log — the database owner is the strongest attacker in the room. The verifier recomputes every hash and link. Tamper detected. That's what proof means."*
4. Cut to the wordmark.

> This breaks the local control-audit chain until the next `pnpm demo:reset`. Do it **last**, after every other proof beat. It does **not** affect the enforcement-receipt chain.

### B. The hard block that can never be approved (8s)

In the terminal:

```bash
curl -s -X POST localhost:8787/api/actions/evaluate \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"agentId":"<id>","sessionId":"demo","tool":"db.drop_table","args":{"table":"orders"}}'
```

Say: *"Eighty and above is a hard block. There is no approval button. Some actions a human is not allowed to authorise."* The response returns `BLOCK`, score `100`, and no `approvalId`.

### C. The grant race (8s, technically hardcore)

Show the grant row from the receipt, then say: *"The grant is consumed by one conditional update: status active, not expired, bound to this exact action hash. Two processes race — exactly one update wins. The loser gets a 403 before the tool adapter is ever called."*

This is the strongest line for a security judge; it needs no UI, just confidence and the receipt on screen.

---

## 7. Under the hood (for Q&A and the deck)

**What actually happens in one action:**

1. **Classify** — `read | write | delete | send | pay`.
2. **Preview** — `BEGIN` → run the real mutation → count rows, sensitive rows, recoverability → `ROLLBACK`. For deletes/updates, hash the exact row set. For email, resolve the attachment's sensitivity and content hash.
3. **Score** — deterministic rules. `<30 ALLOW`, `30–59 FLAG`, `60–79 HOLD`, `≥80 BLOCK`. Hard-block rules (schema destruction, denied tools, blocklisted recipients) return `BLOCK` at 100 and can never be approved.
4. **Safe rewrite** — archive instead of delete; internal owner instead of external recipient; scope an unscoped update. The rewrite is re-previewed and re-scored through the same pipeline.
5. **Approval binding** — `sha256(canonical action JSON)` + `previewFingerprint` + expiry. The fingerprint covers the **rows**, not the count, so a same-count value change still invalidates consent.
6. **Grant** — issued only after an ALLOW/HOLD decision; scoped to one agent, one tool, one action hash; expires in 60s; consumed by one conditional update before the adapter runs.
7. **Receipt** — action, decision, before/after state, `toolInvoked`, approval, grant, drift evidence, `prevHash` → `hash`. Chain verifiable; downloadable JSON.

**Threat model the demo covers**

| Threat | Control shown |
|---|---|
| Prompt injection → data exfiltration | lethal-trifecta detection, HOLD, safe internal rewrite |
| Over-broad or irreversible action | real blast-radius preview, archive rewrite |
| Replay / double execution | one-shot grant, atomic consumption |
| Stale consent / TOCTOU | dataset fingerprint, 409 before adapter |
| Silent history edits | hash-chained receipts, tamper detection |
| Agent bypass | single gateway; typed adapters; no grant, no call |

**What is real vs simulated (say this if asked):** the sandbox data shape is fixed for repeatability; the SQL, previews, rollbacks, hashes, grants, API calls and receipts are real. No live model, no external network on the control path. Algorand TestNet is used for the optional payment rail.

---

## 8. The 30-second pitch (if a judge asks before the video)

> Autonomous agents now have real tools: email, files, customer data, databases, payments. The risk isn't the model — it's the tool call it decides to make.
> Most safety products observe those calls after they happen. KRON is the enforcement point before them. Every action is previewed against real data, risk-scored, and either allowed, rewritten to a safer form, or held for a human whose approval is cryptographically bound to the exact rows they saw.
> If the data changes, the approval dies. Execution needs a one-shot grant, and every decision leaves a tamper-evident receipt.
> It's not a dashboard. It's the control plane.

---

## 9. Judge Q&A (rehearse these six)

| Question | Answer |
|---|---|
| **"Isn't this just an approval dashboard?"** | No. The dashboard is the interface; the product is the gateway. No grant, no tool call. The approval is bound to the action hash *and* the dataset fingerprint, and the receipt proves whether the tool ran. The baseline toggle is the control experiment: same desk, one email leaks. |
| **"Why not just block dangerous tools?"** | Blocking fails the task. KRON's safe rewrite keeps the business outcome — archive instead of delete, internal review instead of external send — and revalidates it through the same pipeline. The hard problem is allowing safely. |
| **"What about prompt injection?"** | We don't try to win a prompt-filtering arms race. We contain the consequence: an injection only matters when it becomes a tool call, and that call has to pass the gateway. |
| **"How do you stop replay or a stale click?"** | Grants are scoped to one agent, one tool, one action hash, expire in 60 seconds, and are consumed atomically *before* the adapter runs. Approvals expire and are revalidated against a fresh preview; a moved dataset returns 409 and the receipt records `toolInvoked: false`. |
| **"What if the data changes but the row count stays the same?"** | That is exactly why the fingerprint hashes every row, not the count. Same count, different values → different SHA-256 → 409. |
| **"Does this work outside the sandbox?"** | The decision, grant and receipt contracts are adapter-agnostic. The sandbox is the demo target; replace the adapter and the same controls apply to email, files, databases or a payment rail. The Algorand payment path is preserved as one adapter. |

**One honest boundary to state if asked:** this is a hackathon prototype. The sandbox data shape is fixed for repeatability; the queries, previews, mutations and proofs are real.

---

## 10. If the brief caps you at 3:00

Cut in this order — you keep every proof number:

1. Drop the baseline toggle beat (**3:12–3:36**) to 8 seconds: show the receipt pane and say "baseline leaks one email; KRON leaks zero."
2. Compress the mechanism to 15 seconds: one sentence over the pipeline strip.
3. Trim the delete narration to: *"1,204 rows, 37 sensitive, not recoverable — archive instead. 1,204 archived, zero lost."*
4. Keep the drift demo intact. It is the differentiator.

---

## 11. Recording & edit notes

**Capture**
- 1080p60 if available; 1080p30 is fine. Record the browser window only, not the desktop.
- Hide the cursor between clicks; slow it to 60% before recording (mouse settings, not post).
- Record the voiceover separately at 48 kHz with a noise gate. Room tone beats a noisy room.

**Edit**
- Target **145–150 words per minute**. If a line overruns, cut words, never the number.
- Add callout boxes only for: **75/100**, **1,204 / 37**, **826 → 786**, **409**, **0 executed**, **30/30**.
- Zoom 110% on the risk score and the drift stats; keep the rest at 100%.
- No whooshes, no stock cyber footage. One restrained music bed at −24 LUFS under the voice.
- On-screen deliverable labels are allowed — `DETECT & BLOCK`, `AUDIT & INTERVENE` — but never cover the numbers.

**Hard rules**
- Never show `.env`, `data/demo-credentials.txt`, terminal history, or any token.
- Never imply real email, real customers, real money, or benchmark results.
- Say "sandbox" once and "Algorand TestNet" once — the Algorand line is a footnote, not the pitch.
- Do not lead with blockchain. This is a safety and control product.
- The video must survive a judge pausing on any frame: nothing on screen may contradict the voiceover.

---

## 12. Final QA

- [ ] Runtime 3:55–4:05; no dead air longer than 1 second
- [ ] Every spoken number matches `pnpm demo:attack all` / `pnpm demo:proof`
- [ ] Attacker inbox: **0** for KRON, **1** on baseline — in that order
- [ ] Drift shows **826 → 40 → 786**, **409**, **0 executed**, fresh **786**
- [ ] Receipt shown has `toolInvoked` visible; chain reads `Chain intact`
- [ ] Proof numbers **30/30** and **126 tests** appear on screen
- [ ] All three PS 2.1 deliverables are named or shown on screen: monitor/control, detect/block, audit/intervene
- [ ] Algorand is mentioned exactly once, in the close
- [ ] No secrets, no real PII, no real funds
- [ ] Audio −16 LUFS integrated, true peak below −1 dB
- [ ] Exported H.264 MP4, 1080p, captions burned in or attached as `.srt`
