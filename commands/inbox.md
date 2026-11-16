---
description: Sort the inbox of quick captures (from the Apple Watch app, the CLI, or other sessions)
---
Call `list_inbox`. For each item, decide where it belongs and propose it in one compact list:
- a durable fact about the user → file as `fact`
- something about a project → file as `note` on that project (resolve loose names with `resolve_project`)
- noise or already handled → `dismiss`

Clean up dictation errors in the wording. Ask the user to confirm the list once, then call `file_inbox` for each item and confirm in one line.
