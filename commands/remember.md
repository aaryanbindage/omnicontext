---
description: Remember something about you (or a project) across all Claude sessions
argument-hint: "<fact>"
---
Store this so every future Claude session knows it: "$ARGUMENTS"

- If it's about a specific project, use `add_project_note` on the matching project.
- Otherwise use `remember` to add it to the user's profile.
- Rephrase into one concise, durable fact. Never store secrets.
Confirm in one short line.
