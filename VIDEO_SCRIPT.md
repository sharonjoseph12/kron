# KRON — 2:45 Demo Video Script

> **Working title:** *KRON — The Capability Firewall for AI Agents*
> **Tagline:** Preview the blast radius. Bind the approval. Prove the enforcement.
> **Format:** screen recording + voiceover. No live LLM, no external network. Every number below comes from the deterministic sandbox runner.

---

## Before recording

```bash
pnpm install
pnpm demo:reset          # seeds 1,204 orders · 37 sensitive rows · empty attacker inbox
pnpm dev                 # API + dashboard
# open http://localhost:5173/control and log in with data/demo-credentials.txt
```

Backup proof commands (run in a second terminal if the UI is unavailable):

```bash
pnpm demo:attack all     # hero / delete / baseline / drift
pnpm demo:proof          # 30/30 deterministic runs
```

---

## 0:00–0:20 — The gap

**Visual:** split screen. Left: an agent tool log. Right: a generic “AI observability” dashboard with green charts.

**Voiceover:**

> “AI agents can now read your email, open your contracts, and delete your database. Most ‘agent safety’ products watch this happen and draw a nice chart afterwards.
>
> A log line is not a control. By the time you see the alert, the data is already gone.”

**On-screen text:** `Monitoring observes. KRON decides.`

---

## 0:20–0:45 — The mechanism

**Visual:** the `/control` Approval Desk. Zoom into the pipeline strip (can be a simple animated overlay): classify → preview → score → safe rewrite → hash-bound approval → one-shot grant → receipt.

**Voiceover:**

> “KRON is a capability firewall. Every tool call goes through one path.
>
> We classify it, preview the real blast radius against the actual data, score it, and generate a safer alternative. A human approval is bound to a SHA-256 hash of the exact action — not a button that says ‘approve agent.’
>
> And when the action finally runs, it needs a one-shot capability grant. No grant, no tool call.”

**On-screen text:** `One path. No bypass.`

---

## 0:45–1:25 — Demo 1: the lethal trifecta

**Visual:** click **Run hero attack**. Let the timeline fill. Select the `email.send` card.

**Voiceover:**

> “Here is the classic exfiltration chain. The agent reads a poisoned supplier email. It reads a signed customer contract. Then it tries to send that contract to a new outside address.
>
> KRON holds it at **75 out of 100**. The impact card shows what the agent omitted: the attachment is customer-confidential, and the recipient has never been seen before.
>
> The reason is the lethal trifecta: untrusted content, private data, and a new outside recipient in the same session. Any one is manageable. All three together is how data leaves the building.”

**Visual:** point at the green **Safe version** card, then click **Approve safe version**.

**Voiceover:**

> “The operator does not have to choose between ‘allow’ and ‘block.’ KRON proposes a safe alternative: send the contract to the internal legal owner for review. That alternative is revalidated through the same pipeline before it runs.
>
> The proof pane stays at **zero messages** in the attacker’s inbox.”

**On-screen text:** `risk 75/100 · HOLD · attacker inbox 0`

---

## 1:25–1:55 — Demo 2: blast radius

**Visual:** click **Bulk delete**.

**Voiceover:**

> “Now the agent asks to delete every order. The raw action is a hard delete. KRON’s preview runs inside a rolled-back transaction against the real sandbox database.
>
> It reports **1,204 rows** and **37 sensitive rows** — customers with open shipments. It also says the action is not recoverable.
>
> The safe rewrite is an archive, not a delete. The operator approves the archive. The proof pane shows **1,204 archived**, the same **1,204** total, and still zero attacker messages. Nothing left the building, and nothing became unrecoverable.”

**On-screen text:** `1,204 rows · 37 sensitive · archive instead of delete`

---

## 1:55–2:25 — Demo 3: the card that went stale

**Visual:** click **Shadow drift**.

**Voiceover:**

> “This is the failure mode most approval systems miss. A human is looking at a card that says **826 pending orders**. While they decide, another job moves **40** of those orders to shipped.
>
> The action hash has not changed. Even the row count check is not enough on its own. KRON also binds a fingerprint of the exact rows the preview saw.
>
> The stale approval is rejected with **409** before the tool adapter is called. The receipt proves the tool was never invoked. Zero rows archived.
>
> The agent re-evaluates. The fresh card says **786**. The human approves the new hash. Exactly **786** rows are archived. That is shadow mode with teeth: drift invalidates consent, and recovery is explicit.”

**On-screen text:** `826 → 40 changed → 786 live · stale 409 · 0 executed · fresh 786`

---

## 2:25–2:40 — Why judges can trust it

**Visual:** scroll to **Enforcement receipts**. Show a receipt, click **Download**. Then show the terminal: `30/30 deterministic scenarios passed`.

**Voiceover:**

> “Every decision leaves a hash-chained enforcement receipt: what the sandbox looked like before and after, whether the tool actually ran, which approval and which one-shot grant authorised it, and the drift evidence if it was rejected.
>
> The baseline is deliberately worse: approve the raw card and exactly **one** email reaches the attacker. That is the counterfactual, measured, not asserted.
>
> The whole demo is deterministic and offline: **30 out of 30** runs pass, and the test suite is green.”

**On-screen text:** `hash-chained receipts · one-shot grants · 30/30`

---

## 2:40–2:45 — Close

**Visual:** KRON wordmark. Small line: “x402 payments on Algorand still run inside the same runtime.”

**Voiceover:**

> “Don’t monitor the agent. Cap its actions.
>
> KRON. Preview the blast radius. Bind the approval. Prove the enforcement.”

**On-screen text:** `KRON — The Capability Firewall for AI Agents`

---

## Recording notes

- Record at 1920×1080, browser zoom 100%, light theme.
- Keep the mouse still while speaking; cut dead time between scenarios.
- The **Download** button produces the real receipt JSON; show it for two seconds.
- If a scenario is slow, cut the wait, not the proof number.
- Do not claim benchmark or red-team numbers that are not in `pnpm demo:attack all` / `pnpm demo:proof`.
- The video must not show `.env`, `data/demo-credentials.txt`, or any terminal containing secrets.
