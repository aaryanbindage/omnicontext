---
description: Resume work you started in another session or on another device
argument-hint: "[project or topic — blank for most recent]"
---
Call the omnicontext `resume_handoff` tool${ARGUMENTS:+ with query "$ARGUMENTS"} to load the handoff. Query: "$ARGUMENTS" (if empty, omit the query to get the most recent open handoff).

Then:
1. Restate in 2–4 lines where things stand and what's next.
2. If the project folder is on this device, work there; if it isn't linked here, ask the user where it lives (or whether to clone the repo) and link it with `upsert_project` + `path`.
3. Continue with the first next step unless the user says otherwise.
