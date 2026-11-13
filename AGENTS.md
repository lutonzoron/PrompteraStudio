# Agent instructions (Cursor / Claude / Copilot / etc.)

When the user asks you to **write a story**, **roteiro**, **takes**, or **import into Promptera**:

1. Read **[AI_STORY_INBOX.md](AI_STORY_INBOX.md)** end-to-end  
2. Emit a pack under `data/inbox/<slug>/` with at least `takes.json`  
3. Prefer also `meta.json` + `roteiro.md`  
4. Tell the user to open Promptera → **Inbox → Aprovar** → enqueue  

Do not invent a different import format. The inbox schema in `AI_STORY_INBOX.md` is the source of truth.
