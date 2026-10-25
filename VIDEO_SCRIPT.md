# KRON — 4:00 Demo Video Script

> **Title:** *KRON — The Capability Firewall for AI Agents*
> **Tagline:** Preview the blast radius. Bind the approval. Prove the enforcement.
> **Runtime:** 4:00 target · 4:15 hard stop
> **Format:** 1920×1080 screen recording, browser zoom 100%, light theme, one voiceover track.
> **Rule:** every number in this script is printed by the demo. If a number is not on this page, do not say it.

---

## 1. Verified demo values (memorise these, don't improvise)

| Value | Where it comes from |
|---|---|
| `1,204` orders in the sandbox | `pnpm demo:reset` |
| `37` sensitive rows — 5 customers with open shipments | `pnpm demo:reset` |
| Attacker inbox `0` / `1` (baseline) | `pnpm demo:proof` |
| Hero risk **75/100**, decision **HOLD** | `pnpm demo:attack hero` |
| Hero attacker `audit@supplier-docs.example`, internal owner `legal@coastalcatch.example` | seeded sandbox |
| Delete preview **1,204** rows / **37** sensitive / **not recoverable** | `pnpm demo:attack delete` |
| Drift card **826** → **40** moved → live **786** | `pnpm demo:attack drift` |
| Stale approval **HTTP 409**, `0` rows executed | drift receipt |
| Fresh approval archives exactly **786**; active **418** | `pnpm demo:attack drift` |
| Hash-chained receipts, `Chain intact` | `/control` → Enforcement receipts |
| **30/30** deterministic runs | `pnpm demo:proof` |
| **126** automated tests | `pnpm test` |

---

## 2. Pre-flight (do this 10 minutes before recording)

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

- [ ] Browser at 100% zoom, 1920×1080, booksmarks bar hidden
- [ ] Only the dashboard tab + a clean terminal tab are visible
- [ ] Terminal scrollback cleared; no `.env`, no `data/demo-credentials.txt`, no tokens
- [ ] Notifications off (macOS Focus / Windows Do Not Disturb)
- [ ] Mouse cursor visible and slowed; no jitter while narrating
- [ ] One practice run of each click path, then `pnpm demo:reset`

---

## 3. Shot list at a glance

| Time | Beat | On screen | Numbers to say |
|---|---|---|---|
| 0:00–0:25 | Cold open: monitoring is not control | Title, then agent log vs. a green chart | — |
| 0:25–0:55 | The mechanism | `/control`, pipeline strip | one path, one grant |
| 0:55–1:45 | Hero: the lethal trifecta | Run hero attack → impact card | **75/100**, HOLD, attacker **0** |
| 1:45–2:25 | Delete: blast radius | Bulk delete → approve archive | **1,204** / **37** → **1,204** archived |
| 2:25–3:10 | Drift: the stale card | Shadow drift → drift panel | **826 → 40 → 786**, **409**, **0** executed |
| 3:10–3:35 | Counterfactual + receipts | Baseline toggle, receipt JSON | attacker **1**, `toolInvoked: false` |
| 3:35–4:00 | Close | Wordmark, proof badge | **30/30**, **126** tests |

---

## 4. The script

### 0:00–0:25 · Cold open — "A log line is not a control"

**SHOT** Slow push-in on the title card, then a hard cut to a generic observability dashboard: green line going up.

**SAY**

> Your AI agent can read your email, open your contracts, and delete your database.
> Most agent-security tools watch that happen and draw a chart afterwards.
> A log line is not a control — by the time the alert fires, the data is already gone.
> KRON is a capability firewall. It decides before the tool runs.

**ON SCREEN** `Monitoring observes.` → `KRON decides.`

**EDIT** One beat of silence before the cut. No music under the first sentence; bring a low bed in at 0:12.

---

### 0:25–0:55 · The mechanism — "One path. No bypass."

**SHOT** `/control` loads. Slow horizontal pan across the pipeline strip. Cursor parks.

**SAY**

> Every tool call takes one path. KRON classifies the action, previews the real blast radius against the live data, scores the risk, and drafts a safer alternative.
> A human approval is bound to a SHA-256 hash of that exact action — and to a fingerprint of the rows the preview saw.
> Execution needs a one-shot capability grant. No grant, no call.
> And every decision leaves a hash-chained receipt.

**ON SCREEN** `classify → preview → score → safe rewrite → hash-bound approval → one-shot grant → receipt`

**EDIT** Animate the pipeline once, left to right, in sync with the voiceover. Do not animate it twice.

---

### 0:55–1:45 · Demo 1 — the lethal trifecta

**SHOT** Click **Run hero attack**. Let the **Live timeline** fill. Select the `email.send` card.

**SAY**

> Demo one: the lethal trifecta.
> The agent reads a poisoned supplier email. Then it reads a signed customer contract. Now it tries to send that contract to an address it has never used — `audit@supplier-docs.example`.
>
> KRON holds it at **75 out of 100**.
> The impact card shows what the agent left out: the attachment is tagged **customer-confidential**, the recipient is **new**, and all three ingredients landed in the same session — untrusted content, private data, a new outside recipient.
>
> But the operator doesn't have to choose between allow and block. KRON proposes a **safe version**: send it to the internal legal owner for review. That rewrite is revalidated through the same pipeline before it runs.
>
> Approve it. The attacker's inbox stays at **zero**.

**DO**

1. Click **Run hero attack**.
2. Wait for the `email.send` card, click it.
3. Point at: risk **75/100**, `Why held` → lethal trifecta, attachment `customer-confidential`, recipient **New**.
4. Point at the green **Safe alternative** card: **Send to the internal owner for review**.
5. Click **Approve safe version**.
6. Point at **Evidence** → attacker inbox **0**, outbound **1**.

**ON SCREEN** `risk 75/100 · HOLD · attacker inbox 0`

---

### 1:45–2:25 · Demo 2 — blast radius

**SHOT** Click **Bulk delete**. Select the `db.delete` card. Hold on the preview numbers.

**SAY**

> Demo two: blast radius. The agent asks to hard-delete every order.
>
> KRON runs the preview inside a rolled-back transaction against the real sandbox database. **1,204 rows**. **37** of them belong to customers with open shipments. **Not recoverable.**
>
> The safe rewrite is an archive, not a delete. Approve it: **1,204 archived**, **1,204 total**, still zero attacker messages.
>
> Same business outcome. Without the irreversible part.

**DO**

1. Click **Bulk delete**.
2. Select the `db.delete` card.
3. Point at **1,204 rows**, **37 sensitive**, **Recoverable: No**.
4. Point at the safe version: **Archive instead of delete**.
5. Click **Approve safe version**.
6. Point at **Evidence**: archived **1,204**, total **1,204**, attacker **0**.

**ON SCREEN** `1,204 rows · 37 sensitive · archive instead of delete`

---

### 2:25–3:10 · Demo 3 — the card that went stale

**SHOT** Click **Shadow drift**. The red drift panel expands. Let it sit for two seconds before narrating.

**SAY**

> Demo three: the stale card.
>
> A human is looking at a card that says **826 pending orders**. While they decide, a concurrent job moves **40** of those orders to shipped. The live data is now **786**.
>
> The action hash hasn't changed. The row count on the card hasn't changed. This is where most approval systems quietly fail.
>
> KRON also binds a fingerprint of the exact rows the preview saw. The stale approval is rejected with a **409** before the tool adapter is called — and the receipt proves the tool never ran. **Zero rows archived.**
>
> The agent re-evaluates. The fresh card says **786**. The human approves the new hash. Exactly **786** rows are archived.

**DO**

1. Click **Shadow drift**.
2. Point at the four drift stats: card preview **826** · concurrent change **40** · live data **786** · executed by stale card **0**.
3. Point at the binding check: `action hash unchanged · fingerprint … → …` and `409: … Nothing executed.`
4. Point at the recovery path: fresh preview **786**, archived **786**, active **418**.
5. Dismiss the panel.

**ON SCREEN** `826 → 40 → 786 · stale 409 · 0 executed · fresh 786`

---

### 3:10–3:35 · Counterfactual + receipts — why you can trust the numbers

**SHOT** Toggle **Baseline**, run the attack, land on attacker inbox **1**. Then toggle back and scroll to **Enforcement receipts**.

**SAY**

> Now measure the counterfactual. The baseline toggle gives the same desk raw actions only — no preview, no score, no rewrite. Approve it, and exactly **one** email reaches the attacker.
>
> That gap is the product.
>
> Every decision leaves a hash-chained receipt: the before and after state, whether the tool actually ran, which grant authorised it, and the drift evidence when it didn't.

**DO**

1. Toggle **Baseline** on, click **Run baseline attack**.
2. Point at attacker inbox **1**. Say nothing for one beat — let it land.
3. Toggle back to **KRON**, scroll to **Enforcement receipts**, show **Chain intact**.
4. Click **Download** on one receipt; show `toolInvoked` and `before` / `after` for two seconds.

**ON SCREEN** `baseline: 1 leaked · KRON: 0 · chain intact`

---

### 3:35–4:00 · Close

**SHOT** Cut to the wordmark. Optional 2-second flash of the terminal: `30/30 deterministic scenarios passed`.

**SAY**

> The payment runtime is still inside: x402 on Algorand TestNet, atomic groups, on-chain policy anchors.
>
> And the whole demo is deterministic — **30 out of 30** runs, **126** tests, no live model, no external network.
>
> Don't monitor the agent. Cap its actions.
>
> KRON. Preview the blast radius. Bind the approval. Prove the enforcement.

**ON SCREEN** `KRON — The Capability Firewall for AI Agents` · `30/30 · 126 tests`

**EDIT** Cut music with the last word, then 0.5s of black.

---

## 5. If the brief caps you at 3:00

Cut in this order — you keep every proof number:

1. Drop the baseline toggle beat (**3:10–3:35**) to 8 seconds: show the receipt pane only.
2. Compress the mechanism to 15 seconds: one sentence over the pipeline strip.
3. Trim the delete narration to: *"1,204 rows, 37 sensitive, not recoverable — archive instead. 1,204 archived, zero leaked."*
4. Keep the drift demo intact. It is the differentiator.

---

## 6. Recording & edit notes

**Capture**
- 1080p60 if available; 1080p30 is fine. Record the browser window only, not the desktop.
- Hide the cursor between clicks; slow it to 60% before recording (mouse settings, not post).
- Record the voiceover separately at 48 kHz with a noise gate. Room tone beats a noisy room.

**Edit**
- Target **145–150 words per minute**. If a line overruns, cut words, never the number.
- Add callout boxes only for: **75/100**, **1,204 / 37**, **826 → 786**, **409**, **0 executed**, **30/30**.
- Zoom 110% on the risk score and the drift stats; keep the rest at 100%.
- No whooshes, no stock cyber footage. One restrained music bed at −24 LUFS under the voice.

**Hard rules**
- Never show `.env`, `data/demo-credentials.txt`, terminal history, or any token.
- Never imply real email, real customers, real money, or benchmark results.
- Say "sandbox" and "Algorand TestNet" out loud at least once each.
- The video must survive a judge pausing on any frame: nothing on screen may contradict the voiceover.

---

## 7. Final QA

- [ ] Runtime 3:55–4:05; no dead air longer than 1 second
- [ ] Every spoken number matches `pnpm demo:attack all` / `pnpm demo:proof`
- [ ] Attacker inbox: **0** for KRON, **1** on baseline — in that order
- [ ] Drift shows **826 → 40 → 786**, **409**, **0 executed**, fresh **786**
- [ ] Receipt shown has `toolInvoked` visible; chain reads `Chain intact`
- [ ] Proof numbers **30/30** and **126 tests** appear on screen
- [ ] No secrets, no real PII, no real funds
- [ ] Audio −16 LUFS integrated, true peak below −1 dB
- [ ] Exported H.264 MP4, 1080p, captions burned in or attached as `.srt`
