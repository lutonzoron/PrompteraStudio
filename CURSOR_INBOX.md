# Cursor → Promptera Inbox

Full agent spec (any AI): **[AI_STORY_INBOX.md](AI_STORY_INBOX.md)**  
Same Continuity rules as the MiniMax H3 + DaSiWa skill.

## Quick drop

**Before writing the Inbox Markdown/script or pack, ask the user to confirm the
video format and dimensions and wait for an explicit answer.** Offer phone 9:16
(576×1024), horizontal 16:9 (1024×576), square 1:1 (768×768), or feed 4:5
(768×960). An explicit choice already supplied for this pack counts as confirmation.
Record `width`/`height` in `meta.json` and the format/resolution in the Markdown header.

```text
data/inbox/<slug>/
  takes.json   # required — prompts in ENGLISH
  meta.json    # required for new agent packs — confirmed width/height; title/brief may be PT
  roteiro.md   # optional — human script may be PT
```

### Language

| What | Language |
|------|----------|
| `takes.json` → `prompt` | English (locks, action, spatial, SFX) |
| Dialogue only | `<d>[Portuguese] …</d>` |
| Roteiro / meta title | Portuguese OK |

Promptera detects the pack (~5s) but **waits for approval**: UI **Inbox → Aprovar**.

## Roles

| Who | Does |
|-----|------|
| Cursor / Claude / Copilot / … | Writes Continuity `takes.json` (+ optional roteiro) |
| Promptera | Imports, queue, GPU Continuity, review, master |

No OpenAI key is required in the app if the story pack is written by an external agent.
