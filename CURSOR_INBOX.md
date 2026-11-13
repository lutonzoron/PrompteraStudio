# Cursor → Promptera Inbox

Full agent spec (any AI): **[AI_STORY_INBOX.md](AI_STORY_INBOX.md)**  
Same Continuity rules as the MiniMax H3 + DaSiWa skill.

## Quick drop

```text
data/inbox/<slug>/
  takes.json   # required — prompts in ENGLISH
  meta.json    # optional — title/brief may be PT
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
