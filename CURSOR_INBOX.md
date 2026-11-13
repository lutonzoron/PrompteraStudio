# Cursor → Promptera Inbox

Full agent spec (any AI): **[AI_STORY_INBOX.md](AI_STORY_INBOX.md)**

## Quick drop

```text
data/inbox/<slug>/
  takes.json   # required
  meta.json    # optional
  roteiro.md   # optional
```

Promptera detects the pack (~5s toast) but **waits for approval**: UI **Inbox → Aprovar**.

## Roles

| Who | Does |
|-----|------|
| Cursor / Claude / Copilot / … | Writes Continuity `takes.json` (+ optional roteiro) |
| Promptera | Imports, queue, GPU Continuity, review, master |

No OpenAI key is required in the app if the story pack is written by an external agent.
