# KRON Demo Rehearsal (PS 2.1)

> Target: **4:00 video**, 4:15 hard stop. Full shot-by-shot copy lives in
> [`VIDEO_SCRIPT.md`](./VIDEO_SCRIPT.md). Every number below is produced by the
> deterministic runner — rehearse with the same commands.
>
> **One-line pitch to hold in your head:** *Monitoring tells you what the agent
> did. KRON decides what it can do — and proves it.*

---

## Judge framing (say these ideas, not slogans)

1. **Inline enforcement, not observability.** No grant, no tool call. The agent
   cannot route around the gateway.
2. **It allows safely, not just blocks.** Every held action gets a deterministic
   safe rewrite that is revalidated through the same pipeline. The business task
   still completes — without the damage.
3. **Consent is bound to the data it was granted for.** Approval = action hash +
   fingerprint of the exact rows the human saw. If the data moves, the approval
   dies with a **409** and the receipt proves the tool never ran.

Map to the brief while you narrate: **monitor/control** (pipeline + grant),
**detect/block** (hero + delete + drift), **audit/intervene** (approval desk,
baseline diff, receipts).

---

## Setup (5 minutes)

```bash
pnpm install
pnpm demo:reset
pnpm dev
```

1. Open `http://localhost:5173/control`.
2. Log in with the email/password in `data/demo-credentials.txt` (generated locally, gitignored, never a default).
3. Confirm the **Evidence** pane reads: **orders 1,204 · sensitive 37 · attacker inbox 0**.
4. Open a second terminal at the repo root for backup proof commands.

### Pre-flight (30 seconds)

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

Run the final `pnpm demo:reset` immediately before recording so the dashboard opens on a clean slate.

---

## Timeline

| Time | Beat | Action | Number to say |
|---|---|---|---|
| 0:00 | The gap | Title → agent log → flat green chart | “A log line is not a control.” |
| 0:25 | Mechanism | Pan the `/control` pipeline strip | “No grant, no call.” |
| 0:54 | Hero attack | **Run hero attack**; select email card | risk **75/100**, HOLD |
| 1:12 | Lethal trifecta | Point at `Why held` + attachment + recipient | untrusted + private + new recipient |
| 1:28 | Safe version | **Approve safe version** | attacker **0**, outbound **1** |
| 1:40 | Bulk delete | **Bulk delete**; select `db.delete` card | **1,204** rows, **37** sensitive, not recoverable |
| 2:00 | Archive | **Approve safe version** | **1,204** archived, **0** lost |
| 2:20 | Drift | **Shadow drift**; hold on the red panel | **826 → 40 → 786** |
| 2:38 | Stale rejection | Point at binding check | **409**, **0 executed** |
| 2:52 | Fresh approval | Point at recovery path | fresh **786**, active **418** |
| 3:05 | Counterfactual | Toggle **Baseline**, run it | attacker **1**, KRON **0** |
| 3:18 | Audit | Receipts; download one | `toolInvoked`, chain intact |
| 3:32 | Close | Wordmark + proof | **30/30**, **126 tests** |

---

## What to click, exactly

### Hero attack (0:54)
1. `Run hero attack`.
2. The timeline adds: read poisoned email → read contract → send held.
3. Select the `email.send` card.
4. Point at: **risk 75/100**, `Why held` → lethal trifecta, attachment `customer-confidential`, recipient **New**.
5. Point at the safe version: **Send to the internal owner for review**.
6. Click **Approve safe version**.
7. Evidence pane: **attacker inbox 0**, outbound **1**, delivered to `legal@coastalcatch.example`.

### Bulk delete (1:40)
1. `Bulk delete`.
2. Select the `db.delete` card.
3. Point at: **1,204 rows**, **37 sensitive**, **Recoverable: No**.
4. Safe version: **Archive instead of delete**.
5. Click **Approve safe version**.
6. Evidence pane: archived **1,204**, total **1,204**, attacker **0**.

### Shadow drift (2:20)
1. `Shadow drift`.
2. The drift panel appears — pause two seconds before speaking:
   - card preview **826**
   - concurrent change **40**
   - live data **786**
   - executed by stale card **0**
3. Point at the binding check: `action hash unchanged · fingerprint … → …`, then the **409** line ending `Nothing executed.`
4. Point at the recovery path: fresh preview **786**, archived **786**, active **418**.
5. Dismiss the panel.

### Baseline + receipts (3:05)
1. Toggle **Baseline** on.
2. `Run baseline attack`.
3. Point at attacker inbox **1**. Pause one beat.
4. Toggle back to **KRON**, scroll to **Enforcement receipts**, show **Chain intact**.
5. Click **Download** on one receipt; hold on `toolInvoked` and before/after for two seconds.

---

## Fallback Plan

| Failure | Fallback |
|---|---|
| Dashboard won't load | Run `pnpm demo:attack all`; narrate the terminal output. |
| Browser animation stalls | Cut the wait; keep the final proof numbers. |
| Click does not register | Use the API runner directly; the numbers are identical. |
| Receipt panel is empty | Run any scenario; every decision writes a receipt. |
| Drift button fails | Run `pnpm demo:attack drift`; it executes the same service path. |
| Demo database is dirty | `pnpm demo:reset` (≈3s). |
| Overrunning at 3:30 | Drop the baseline demo to 8s; keep the receipt pane. |

---

## Recording Rules

- 1920×1080, browser zoom 100%, bookmarks bar hidden.
- Never show `.env`, `data/demo-credentials.txt`, or terminal history with secrets.
- Do not claim a benchmark or red-team result that is not printed by `demo:attack` / `demo:proof`.
- Do not imply real email, real customers or real money.
- Say “sandbox” once and “Algorand TestNet” once — at the close, as a footnote. Do not lead with blockchain.
- Keep the video under 4:15. The deck carries the detail.

---

## Final Checklist

- [ ] `pnpm demo:reset` run immediately before recording
- [ ] `/control` loads and Evidence shows 1,204 / 37 / 0
- [ ] Hero: risk **75**, HOLD, attacker **0**
- [ ] Delete: **1,204 / 37**, archive **1,204**
- [ ] Drift: **826 / 40 / 786**, stale **409**, **0** executed, fresh **786**, active **418**
- [ ] Baseline: attacker inbox **1** (and only 1)
- [ ] Receipts: chain intact, download works, `toolInvoked` visible
- [ ] Terminal backup: `30/30 deterministic scenarios passed`
- [ ] No secrets on screen
- [ ] Video exported at 1080p, 3:55–4:05
