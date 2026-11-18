# Promptera — packs, queue and regeneration

Read the current repository's `AGENTS.md` and **all** of `AI_STORY_INBOX.md` before authoring/importing stories. The guide is the source of truth for schema and supported fields. Typical local Promptera address is `http://127.0.0.1:8790`, ComfyUI `http://127.0.0.1:8188`; verify configured instances rather than assuming.

## Pack contract

Confirm format and dimensions explicitly **per new batch**, unless already supplied for it. Preserve dimensions when correcting an existing item. Keep the current explicit review/model choices; the user's established series runs SFW/unattended.

Create `data/inbox/<slug>/meta.json`, `takes.json` and preferably `roteiro.md`. Meta uses numeric `width`/`height`, human title/brief, `slug`, `model_pack`, `review_mode`, `max_duration_sec`, `seed_base`, normally `enqueue: false`. Footage fields and clock rules are in [footage-direction.md](footage-direction.md). Keep every timestamp equal between Markdown and metadata.

`takes.json` is an array of sequential `n`, `kind`, stable `session`, integer `seed`, `duration` (2-15s), unique `prefix: video/<slug>/tNN`, optional human `title`, English `prompt`. Same seed/session inside a continuity block unless intentionally regenerated. Optional `first_frame` is an existing scene PNG/JPEG/WebP inside `data/`, relative to `data/` or an allowed absolute path, only on NEW. CONTINUE omits it and uses a ready checkpoint; the importer/runner must actually support it.

Validate with the application's current validator and Inbox preview. Verify that normalization preserves prompts, durations, dimensions and `first_frame`; do not silently drop unsupported fields. One independent Footage normally has one NEW and its own unique seed/session/prefix. Check existing projects and Inbox to avoid number/slug collisions. Prepare multi-item batches under ignored staging names and expose complete packs after validation so scanning never sees half-written files.

## Approve and enqueue only the intended items

When the user requested **Inbox only**, leave packs pending and tell them to open Inbox -> Aprovar -> enqueue. When they requested approval/queueing, perform it and verify; do not send them back to do the already authorized work. Do not approve unrelated pending items using "all".

Current API examples, to check against current routes before use:

```text
POST /api/inbox/approve                 {"name": "<slug>"}
POST /api/projects/<id>/enqueue         {}
PATCH /api/projects/<id>                {"takes": [...], "roteiro_md": "..."}
POST /api/projects/<id>/regenerate-from {"take_n": 5, "confirmed": true}
```

Approval moves packs to `data/inbox/_processed/`; record actual project/job IDs and processed paths so catalogs still link to the scripts. Check each result, persist progress and resume by reading existing project/jobs after interruption. A timed-out POST may have succeeded: inspect before retrying. Never blindly enqueue a second job. Verify exactly one queued/running/paused job per intended project (or a completed result) using the project's full job history; the queue's displayed job list can be limited. Verify stored take/metadata against the approved pack, not just a successful HTTP status. Say "queued" until a render is actually produced and checked.

Completed videos use explicit regeneration, not ordinary enqueue. Deletion or replacement requires the user's applicable authorization. Preserve before-images/prompts and a comparison copy of an existing master when correcting a generated result.

## Cascading take regeneration

CONTINUE depends on the preceding checkpoint. Regenerating take 5 can invalidate 6 and later dependent takes in that session; inspect the returned cascade and actual state, not a hard-coded count or every unrelated scene. Use the app's regeneration API to refresh seeds, output names, checkpoints/completed state and export caches coherently. Preserve unaffected approved takes and other sessions.

Review the preceding take's **final** frame/state before rewriting. Update the authoritative project and retained source pack/script, and verify that NEW alone holds the intended `first_frame`. Avoid a second manual runner or direct database edits that bypass worker safeguards. Do not claim the visual defect is fixed merely because the new prompt is saved.

If changing the queue UI: provide immediate pending feedback and disable/deduplicate repeated actions. For regeneration show each affected video/take separately, with progress for that cascade rather than confusing total-video progress. Prioritize is an explicit preemption request: move the selected video to current and retain the interrupted one first in the queue through the existing safe mechanism. Routine enqueue/import does not authorize preemption. Keep current video pinned and scroll the limited waiting area when maintaining the existing queue layout.

## Readiness and failure diagnosis

Installed files do not imply loaded nodes. If generation reports missing `MiniMaxH3Director`, `MiniMaxH3DirectorGuide`, `DaSiWaH3ContinuityAppend`, `DaSiWa_EnhancedVideoCombine` or `DaSiWaH3ContinuityPublish`, inspect `/object_info` on the **configured running instance**, its launch command, custom-node directory, actual Python interpreter/venv and import logs. Install/update DaSiWa/dependencies in that environment only if needed; then load the correct process. Do not blindly reinstall an already present package or launch a competing ComfyUI.

A background process or opened TCP port is not a readiness check. Before consuming a large queue, verify responsive API, required nodes and model availability for the current graph. Correlate failure timestamps with startup logs: immediate connection failures can mean Promptera resumed its queue before ComfyUI finished importing. Do not relabel connection failures as bad prompts or rewrite every affected story.

When authorized to retry failed work, identify the specific failures, preserve ready takes/checkpoints and retry once readiness is established. Verify a new unique job and report unresolved causes; stop blind repeated retries after the same cause recurs without a change. Do not restart or cancel active generation just to activate unrelated UI/backend work. If restart is necessary, prepare changes first and use existing interruption authorization or ask with the concrete consequence for the current take.

The browser is a client: closing Chrome does not stop an independently running backend/ComfyUI worker. Confirm process ownership before promising that; shutting down the server or computer does stop local generation.
