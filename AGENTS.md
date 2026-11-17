# Agent instructions (Cursor / Claude / Copilot / etc.)

When the user asks you to **write a story**, **roteiro**, **takes**, or **import into Promptera**:

1. Read **[AI_STORY_INBOX.md](AI_STORY_INBOX.md)** end-to-end — it is the Continuity skill rules for this repo  
2. **Before writing the Inbox Markdown/script or pack, ask the user to confirm the video format and dimensions. Wait for an explicit answer; never assume a default.** Offer phone vertical 9:16 (576×1024), horizontal 16:9 (1024×576), square 1:1 (768×768), or feed portrait 4:5 (768×960). If the user already explicitly supplied the format/dimensions for this pack, that counts as confirmation; do not ask again. Record the confirmed dimensions as `width` and `height` in `meta.json` and in the Markdown header.
3. Emit a pack under `data/inbox/<slug>/` with at least `takes.json` and `meta.json` containing the confirmed dimensions.
4. Prefer also `roteiro.md`
5. Tell the user to open Promptera → **Inbox → Aprovar** → enqueue

### Non-negotiable (same as H3 Continuity skill)

- Take **`prompt` fields = English** (locks, spatial, ONE action, camera, SFX)  
- Spoken lines only as `<d>[Portuguese] …</d>` — sparse; most takes mute  
- Do **not** mix Portuguese action into prompts  
- `roteiro.md` / titles may be Portuguese for humans  
- 1 action per take · ≤3–4 takes per session · NEW session on hard cut  
- CONTINUITY LOCK + spatial map; anti sheet-leak (no studio sheet dump on continues)

Do not invent a different import format. The inbox schema in `AI_STORY_INBOX.md` is the source of truth.
