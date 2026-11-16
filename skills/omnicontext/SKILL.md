---
name: omnicontext
description: Use the user's persistent OmniContext memory. Use when the user refers to their projects loosely ("my game project", "the website", "that bot"), says resume / continue / pick up where I left off, shares a lasting fact or preference about themselves, finishes or pauses a chunk of work, or asks what you know about them.
---

# OmniContext memory

The user's profile, projects, and handoffs are synced across all their devices and every Claude session. A briefing is injected at session start; the tools below read and update it.

## Resolving references
When the user says "my game project", "the API", "my portfolio", match it against the projects in the briefing (names, aliases, tags, descriptions). If unsure, call `resolve_project`. If nothing matches, ask once, then register it with `upsert_project` with good aliases so it resolves next time.

## Resuming across devices
"resume", "continue where I left off", "what was I doing on my laptop" → `resume_handoff` (pass a query when they name a project). If the handoff shows git state from another device, help match it (fetch, checkout the branch) and warn about uncommitted or unpushed work that stayed behind. If the project isn't linked to a folder on this device, ask where it is and link it with `upsert_project` + `path`.

## Saving
- Before ending a substantial session, or when the user is switching devices, offer to `save_handoff` — a self-contained summary plus concrete next steps.
- New lasting fact about the user → `remember` (one concise line).
- Project decisions / status → `add_project_note`.
- Never store secrets, credentials, or one-off trivia.
- A fact is no longer true → `forget` it (then `remember` the new one if there is one).

## Inbox
Quick captures (dictated on the Apple Watch app, or from `capture`) appear in the briefing under "Inbox". At a natural pause, offer to file them: `file_inbox` as a `fact`, a `note` on a project, or `dismiss`. Clean up dictation errors with the `text` argument.

## Don't
- Don't announce the memory system unprompted or recite the briefing.
- Don't save every message; save what a future session would genuinely need.
