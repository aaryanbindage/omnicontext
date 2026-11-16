---
description: Register or update the current folder as a named project
argument-hint: "[name and nicknames, e.g. Starfall aka my game]"
---
Register the current directory as a project in omnicontext with `upsert_project`.

User input: "$ARGUMENTS"

Infer what you can from the folder (README, package files, git remote): a clear `name`, a one-to-two sentence `description` (what it is + stack), `tags`, `repo`, and `path` = current directory. Add `aliases` for every way the user is likely to refer to it ("my game", "the rpg", "the bot"), including any they gave. Then show the saved entry in one or two lines.
