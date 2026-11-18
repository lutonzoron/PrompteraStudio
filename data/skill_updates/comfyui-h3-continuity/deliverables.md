# Deliverables layout — one folder per video

Never dump masters/reviews/partials flat into `deliverables/`. Each film (or short) gets its **own project folder**.

## Project tree

```text
<project>/
  roteiro_….md
  …_takes.json
  …_runner.py
  download_logs/                 # runner state + logs (shared OK)
  deliverables/
    <slug>/                      # ONE folder per video
      master.mp4                 # final concat / last Full session join
      review_t01.mp4             # cumulative Full at take N (validate UI)
      review_t02.mp4
      current_t02.mp4            # last N seconds of that take (toggle “take atual”; N = take duration)
      partial_….mp4              # optional mid-run previews
      concat_list.txt            # optional ffmpeg list
      frame_check/               # optional stills
  Comfyui/output/video/<slug>/   # raw Comfy exports (prefix video/<slug>/…)
```

`<slug>` = short kebab/snake id matching the Comfy prefix, e.g. `vila_lele_fazdeconta`, `anime6_lanterna`, `faith_2h`.

## Rules for the agent

1. When creating a new Continuity job, set:
   - Comfy `filename_prefix` → `video/<slug>/…`
   - Review/master copies → `deliverables/<slug>/…`
2. Do **not** write validation MP4s to `deliverables/` root.
3. Skill zip / tooling may sit at `deliverables/_tools/` (not mixed with film folders).
4. If legacy flat files need relocation for this task, check their consumers before moving; do not reorganize unrelated deliverables during content-only work.

## Cumulative Full and many-take previews

Each Full output includes all ready takes in **that session**, not all scenes in the film. Build the master from the latest valid Full of each session, in narrative order. Do not concatenate every intermediate Full (duplicates earlier footage), and do not use only the globally newest take (loses other sessions). A long scene still uses its latest Full once even if it has more than three takes.

When some takes are regenerated, exclude stale downstream Fulls and invalid checkpoints. Preserve unaffected sessions and approved takes. Build the new export to a temporary/versioned path and expose it after successful assembly; invalidate stale player/thumbnail metadata as the app requires. A browser showing an older 10-second export does not prove that the other 53 takes are missing.

Verify the actual master with a media probe: duration should agree with the sum of the intended new take durations across sessions within encoding/overlap tolerance; inspect A/V streams, session ordering and representative frames at boundaries and the end. Test the player against the fresh export, including a seek near the end. For a recurrent multi-take preview bug, include both one long session and multiple sessions, and a middle-take regeneration, rather than trusting a short one-take preview.

Keep the original source master when adding/removing a manual timestamp or producing an edited version. Removing our overlay must not destroy a timestamp already baked into generated source. The player's selected export should reflect the requested edited/source version. Footage clock rules: [footage-direction.md](footage-direction.md).

## Validate UI paths

```python
REVIEW_DIR = ROOT / "deliverables" / SLUG
REVIEW_DIR.mkdir(parents=True, exist_ok=True)
# review_t{n:02d}.mp4  ·  current_t{n:02d}.mp4  ·  master.mp4
```

See [take-validation.md](take-validation.md).
