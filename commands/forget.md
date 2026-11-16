---
description: Remove something from your OmniContext profile
argument-hint: "<what to forget>"
---
The user wants this forgotten: "$ARGUMENTS"

Call `get_profile`, find the matching fact line(s), and call `forget` with words unique to them. If several lines match and it's ambiguous, ask which. Confirm in one short line.
