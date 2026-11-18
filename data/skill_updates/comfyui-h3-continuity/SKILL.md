---
name: comfyui-h3-continuity
description: >-
  Author, import and run MiniMax H3 video+audio with ComfyUI DaSiWa Continuity
  and Promptera Inbox. Covers NEW/CONTINUE takes, I2VA character and art continuity,
  realistic Strange Footages, cumulative exports and safe queue/regeneration workflows.
  Use for this H3 pipeline, MythicAlchemy, REF2VA or Continuity story packs; not LTX.
---

# ComfyUI MiniMax H3 + DaSiWa Continuity

Use the existing pipeline: roteiro Markdown -> takes JSON -> validated Inbox/API or runner -> final session exports. Preserve the user's chosen model pack, art direction and review mode.

## Read the relevant reference

- **Promptera stories, Inbox, batches, queues or regeneration:** read [promptera-inbox.md](promptera-inbox.md) and the current repository's `AGENTS.md` and `AI_STORY_INBOX.md`. The repository schema is authoritative; do not invent another importer format.
- **Recurring characters or animated stories:** read [character-identity.md](character-identity.md). Review the actual approved renders and their final story state before writing a continuation.
- **Strange Footages / realistic surveillance / UFO phone video:** read [footage-direction.md](footage-direction.md). These are series-specific preferences, not the art direction of all H3 work.
- **Approval UI or rejected takes:** read [take-validation.md](take-validation.md).
- **Preview/master assembly:** read [deliverables.md](deliverables.md).
- **Fresh installation:** read [SETUP.md](SETUP.md). Debug nodes/workflows with [reference.md](reference.md); existing examples are in [examples.md](examples.md).

## Choices and authorization

- Before authoring each new Promptera pack or batch, obtain explicit format **and numeric dimensions**. An explicit choice already supplied for that batch counts; do not ask again. Offer vertical 9:16 (576x1024), horizontal 16:9 (1024x576), square (768x768), feed 4:5 (768x960), or accept specified custom dimensions. Store `width`/`height` in metadata and record them in Markdown. Editing an existing video preserves its confirmed dimensions unless changed by the user.
- Establish SFW/NSFW and unattended vs take-by-take review if unknown. Existing explicit series/session choices persist until changed; do not repeatedly reconfirm automatic generation. Ask only for genuinely missing choices.
- Writing packs alone does not authorize approval, enqueue, deletion or regeneration. When those actions are requested, carry them through and verify the result. Existing authorization for the current batch need not be requested again.
- Respect a request to preserve ongoing generations. Content changes and enqueueing should not require stopping the worker. If activation really requires an interrupting restart, prepare the change first and resolve interruption authorization before restarting.

## Takes, scenes and prompts

- `prompt` fields are English. Spoken words are Portuguese only inside `<d>[Portuguese] ...</d>`; human titles/Markdown may be Portuguese. Keep dialogue short enough for the take, but include the conversations necessary to tell the requested story. Footages normally use ambience only.
- One subject action/beat per take, with matching local timestamps and duration. H3 accepts 2-15 seconds; choose duration by the action. Current Strange Footages use 8-10 seconds, usually one NEW take per video.
- Every take has a concise CONTINUITY LOCK plus explicit LEFT/RIGHT/CENTER, front/back and camera anchors. State entry/exit pose, prop and door states when they matter.
- NEW starts a session; CONTINUE extends the same shot from its latest valid checkpoint. A hard cut, new location or camera reset uses NEW and a new session. **Never invent a cut every three takes.** Three or four takes is a performance preference, not a limit on a meaningful scene. A sustained conversation can run longer in the same scene/session when preserving that shot is required; explain the increasing compute cost if relevant. Only split at a motivated transition or by an explicitly chosen technical strategy.
- Match the **end** of the preceding take, including a render still in progress: distinguish intended script state from what is actually confirmed. Do not repeat completed story beats because an export is not ready yet.
- Use take-specific audio. A shared sound block listing knocks, footsteps and hinges can make every silent take repeat those actions. A voice from behind a door is not a visible character. Encode exactly which character is visible, who speaks, and which props stay untouched.

## Identity and art

For a fixed cast, approve one concrete art reference/design and keep it throughout. For the current Chapeuzinho story, preserve the approved classic hand-drawn 2D Disney-era treatment, exact character designs and cottage; do not rotate among visual inspirations.

Use sheets only as design sources. Prefer a single in-scene I2VA plate for NEW, with characters already placed in the confirmed framing. CONTINUE uses the ready latent checkpoint, `use_references: false`, no image reinjection. When supported by Promptera, `first_frame` points to an existing image inside `data/` and belongs only on NEW. Resolve repeated silhouette/identity failures with a corrected scene plate rather than appending more negatives to the same contradictory prompt.

If an anchor is wrong, do not extend that affected block. Fix its plate/NEW; avoid stopping unrelated jobs.

## Running and export

- Prefer the repository's existing importer/API/worker over launching a second runner. Standalone runner: [scripts/h3_continuity_runner.py](scripts/h3_continuity_runner.py); optional review UI: [scripts/take_validate.py](scripts/take_validate.py). Do not start two runners on one session.
- Check the **selected** ComfyUI instance, Python environment, loaded custom nodes and models before submitting a large queue. An installed node directory is not proof that nodes imported into the running server. Verify readiness, not just a spawned process or open port; see [promptera-inbox.md](promptera-inbox.md).
- Keep models appropriate to the requested pack. Typical SFW: `minimax_h3_fl2va_pruned_int8_convrot.safetensors` + `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`. NSFW, only when chosen: `MINIMAXH3/10Eros_Max_SingularityV2_PRISM2_PikaFlex_0.85_int8HQ.safetensors` + `minimaxH3_qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors`. VAE files: `minimax_h3_video_vae_fp16.safetensors` and `minimax_h3_audio_vae_fp32.safetensors`. Check current workflows instead of assuming filenames still exist.
- Preserve repository/workflow settings. Typical technical settings are 24 fps, euler, 8 steps, overlap 22, `output_mode: full`; they do not override user-confirmed dimensions or per-take duration.
- Full outputs are cumulative **within a session**. Build a film from the latest valid Full for each session in story order, not every intermediate Full and not just the globally last take. Regeneration invalidates downstream outputs/checkpoints in the affected session. Verify actual media duration, A/V streams, scene order and fresh preview before calling export complete.
- An imported, queued or schema-valid project is not a successfully rendered or visually approved video. Report which stage is actually verified.

## Sharing

Copy this whole skill folder, including the linked references, scripts, templates and workflows. Suitable locations include a discoverable personal skills directory or `.cursor/skills/comfyui-h3-continuity/` in a project. The recipient still needs the compatible ComfyUI nodes, Python dependencies and models.
