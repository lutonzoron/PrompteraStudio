# Take validation (optional gate)

Python-only. **ComfyUI does not send webhooks.** The runner polls `/history/{prompt_id}`, then (if enabled) opens a local browser UI.

## Agent rule (mandatory)

Before starting H3 generation, establish the review mode if it is not already known from the user's instructions for the current production or continuing series:

> Quer validação take a take (alarme + tela com vídeo para aprovar/reprovar), ou rodar direto sem pausa?

| Resposta | Ação |
|---|---|
| Com validação / confirmação / aprovar cada take | Run runner with `--validate` (or `VALIDATE=True`) |
| Direto / sem pausa / overnight / unattended | Run **without** `--validate`. Do **not** open the UI |

If the user already answered (“roda com validação” / “pode ir direto” / “geração automática”), keep that explicit choice across subsequent batches of the same production until changed. Do not re-ask for every enqueue. A new Promptera batch still needs its own dimensions confirmation unless already supplied; review mode and format are separate choices.

Do **not** default to MessageBox-only OK/Cancel when they asked for validation — use the video UI below.

## UI behavior

After each successful take, when validation is on:

1. Beep / alarm
2. Copy cumulative Full MP4 to `deliverables/<slug>/review_tNN.mp4` (never `deliverables/` root — see [deliverables.md](deliverables.md))
3. Extract **current take** ≈ last **N** s (`ffmpeg -sseof`, N = that take’s `duration`, default 5) → `deliverables/<slug>/current_tNN.mp4`
4. Open local page (`127.0.0.1:random`) with:
   - **Video** on top (plays)
   - Button 1 — toggle **take atual** ↔ **tudo junto** (Full cumulative)
   - Button 2 — **Aprovar take** → continue to next
   - Button 3 — **Reprovar take** → redo **only this take** (not the whole film)

### Reject the current take before generating descendants

1. **Quarantine** the newest Continuity clip (move to `session/_rejected/…`) — do **not** only set `status=broken` (Comfy cache can reuse the ticket → `Invalid checkpoint status`)
2. Bump the take **seed** so the graph is not served from execution cache
3. Remove that take number from runner `state.completed`
4. Re-queue the **same** take with the **same prompt** (NEW if n=1, else CONTINUE from previous ready)

Earlier approved takes stay.

This applies to the live validation gate when no later dependent takes have been accepted/generated. If the user regenerates an earlier take after downstream CONTINUEs exist, those depend on the old checkpoint and must be invalidated/regenerated in the affected session. Inspect the actual cascade and preserve independent sessions; see [promptera-inbox.md](promptera-inbox.md). Do not promise that only take 5 changes when take 6 continues from it.

**Feedback on reject:** the UI does not collect text notes. Same prompt is retried. If the user wants a different result (fixa, ação, framing), they tell the agent and the agent edits that take’s prompt in `takes.json` before/while redo.

## Implementation reference

Project modules (copy into new jobs as needed):

- `vila_lele_take_validate.py` — HTTP UI + `extract_current_take` + `break_latest_ready`
- Runner flag: `--validate`

Skill template copy: [scripts/take_validate.py](scripts/take_validate.py)

Wire into any Continuity runner:

```python
REVIEW_DIR = ROOT / "deliverables" / SLUG  # one folder per video
# only if user asked for validation
decision = run_validation_ui(
    n=n, total=TOTAL,
    full_mp4=REVIEW_DIR / f"review_t{n:02d}.mp4",
    current_mp4=REVIEW_DIR / f"current_t{n:02d}.mp4",
    title="project",
    alarm_fn=alarm,
)
if decision == "reject":
    quarantine_latest_ready(CKPT_ROOT / session)
    # clear n from completed; bump seed; loop same take
```

Without `--validate`: after each take, advance immediately (unattended).

## Not a Comfy feature

No ComfyUI webhook, no custom node required. All gating lives in the Python runner + local HTTP page.
