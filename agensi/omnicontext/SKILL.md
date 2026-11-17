---
name: omnicontext
description: Persistent, cross-device memory for the user. Use when the user refers to their projects loosely ("my game project", "the website", "that bot"), says resume / continue / pick up where I left off, shares a lasting fact or preference about themselves, says something is no longer true, finishes or pauses a chunk of work, switches devices, or asks what you know about them.
summary: Give your agent long-term memory of who you are, your projects and their nicknames, and resumable handoffs that sync across all your devices through a private git repo you own.
version: 0.4.1
tags: [memory, context, handoff, cross-device, projects, mcp, claude-code, productivity]
keywords: [long-term memory, persistent context, resume work, project aliases, session handoff, sync]
use_cases:
  - Say "my game project" in any session and the agent knows which repo, stack and status you mean
  - Save a handoff on your desktop and resume the same work on your laptop
  - Keep your preferences and background in every session without repeating yourself
  - Dictate a thought on your Apple Watch and have the next session file it
docs_url: https://aaryanbindage.github.io/omnicontext/
---

# OmniContext memory

OmniContext keeps the user's profile, projects and handoffs in plain files (`~/.omnicontext`), synced across their devices through a private git repo they own. The tools come from the **OmniContext MCP server**.

## Setup (only if the OmniContext tools are missing)

If tools such as `get_context`, `resolve_project` and `save_handoff` aren't available, tell the user OmniContext isn't connected yet and offer these options:

- **Claude Code:** `claude plugin marketplace add aaryanbindage/omnicontext` then `claude plugin install omnicontext@omnicontext`. This also injects the briefing at session start.
- **Claude Desktop / Cursor / any MCP client:** add an MCP server with command `npx` and args `["-y", "@aaryanbindage/omnicontext", "mcp"]`.
- **Sync between devices:** run `npx -y @aaryanbindage/omnicontext sync --github` once per device. It needs the GitHub CLI and creates a private `omnicontext-data` repo.
- Desktop app and docs: https://github.com/aaryanbindage/omnicontext

Don't run install commands without the user's go-ahead.

## Start of a conversation

If no "OmniContext" briefing is already in context, call `get_context` (pass the current directory if you know it) before answering anything personal or project-related.

## Resolving references

When the user says "my game project", "the API" or "my portfolio", match it against the projects in the briefing: names, aliases, tags and descriptions. If unsure, call `resolve_project`. If nothing matches, ask once, then register the project with `upsert_project`, adding generous aliases so it resolves next time.

## Resuming across devices

"Resume", "continue where I left off" or "what was I doing on my laptop" → `resume_handoff` (pass a query if they name a project). If the handoff shows git state from another device, help match it (fetch, then check out the branch) and warn about uncommitted or unpushed work that stayed behind. If the project isn't linked to a folder on this device, ask where it is and link it with `upsert_project` + `path`.

## Saving

- Before ending a substantial session, or when the user is switching devices, offer `save_handoff`: a self-contained summary plus concrete next steps.
- New lasting fact about the user → `remember` (one concise line). A fact is no longer true → `forget`.
- Project decisions and status → `add_project_note`.
- Never store secrets, credentials or one-off trivia.

## Connections

"What else uses X?" or "what's related to my game" → `related` (a project, `#tag`, device or topic). Write `[[Topic]]` in notes to link ideas across projects.

## Inbox

Quick captures (dictated on the Apple Watch app, or saved with `capture`) appear under "Inbox". At a natural pause, offer to file them with `file_inbox`: as a `fact`, as a `note` on a project, or `dismiss`. Clean up dictation errors with `text`.

## Don't

- Don't announce the memory system unprompted or recite the briefing.
- Don't save every message. Save only what a future session would need.
