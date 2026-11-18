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
4. Reorganize flat leftovers into `<slug>/` when touching an old project.

## Validate UI paths

```python
REVIEW_DIR = ROOT / "deliverables" / SLUG
REVIEW_DIR.mkdir(parents=True, exist_ok=True)
# review_t{n:02d}.mp4  ·  current_t{n:02d}.mp4  ·  master.mp4
```

See [take-validation.md](take-validation.md).
