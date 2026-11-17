---
name: omnicontext
description: Persistent, cross-agent, cross-device memory for the user. Use when the user refers to their projects loosely ("my game project", "the website", "that bot"), says resume / continue / pick up where I left off (including work started in Claude or another agent), shares a lasting fact or preference about themselves, says something is no longer true, finishes or pauses a chunk of work, switches tools or devices, or asks what you know about them.
---


# OmniContext memory

The same memory is shared by every agent the user runs (Codex, Claude, Cursor, Gemini CLI, …), so a handoff saved in Claude can be resumed here and vice versa. OmniContext keeps the user's profile, projects and handoffs in plain files (`~/.omnicontext`), synced across their devices through a private git repo they own. The tools come from the **OmniContext MCP server**.

## Setup (only if the OmniContext tools are missing)

If tools such as `get_context`, `resolve_project` and `save_handoff` aren't available, tell the user OmniContext isn't connected yet and offer these options:

- **Codex:** `npx -y @aaryanbindage/omnicontext install codex` adds the MCP server to `~/.codex/config.toml`, or install this plugin from the `aaryanbindage/omnicontext` marketplace.
- **Every agent on this machine at once** (Claude Code, Claude Desktop, Codex, Cursor, Gemini CLI): `npx -y @aaryanbindage/omnicontext install all`.
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
