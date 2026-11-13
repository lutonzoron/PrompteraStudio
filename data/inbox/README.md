# Inbox — stories from any AI (Cursor / Claude / Copilot / …)

Full spec in the repo root: **AI_STORY_INBOX.md** (and **AGENTS.md**).

Same Continuity rules as the MiniMax H3 skill:

- `takes.json` prompts → **English**
- Spoken lines → only `<d>[Portuguese] …</d>`
- `roteiro.md` / titles → Portuguese OK

Pack layout:

```
inbox/
  my_story/
    takes.json     # required
    meta.json      # optional
    roteiro.md     # optional
```

Or `*.takes.json` / `*_takes.json` at the inbox root.

**Does not auto-import.** Open Inbox in the app → Approve or Reject each pack.
Approved → `_processed/`; rejected → `_failed/`.
