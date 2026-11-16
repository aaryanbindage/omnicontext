---
description: Save the current work as a handoff you can resume on any device
argument-hint: "[optional title or note]"
---
Save a handoff of what we're working on with the `save_handoff` tool from omnicontext.

Write it for a future assistant on a different machine that has none of this conversation:
- **title**: short and specific ($ARGUMENTS if given)
- **summary**: the goal, what's been done, key decisions and why, current state, anything surprising
- **next_steps**: concrete, ordered actions
- **files**: the key files touched (relative to the project root)
- **project**: the matching project from context; if this folder isn't a registered project, register it first with `upsert_project` (include `path` = current directory and helpful aliases)
- **cwd**: the current directory

Then confirm in one line with the handoff id.
