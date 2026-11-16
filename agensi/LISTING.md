# Agensi listing (copy into agensi.io/dashboard/submit)

Upload: `omnicontext-skill.zip`, attached to each GitHub release, or zip the `agensi/omnicontext` folder.

**Name** (≤60): OmniContext: Cross-Device Memory for Claude

**Summary** (≤300): Your agent remembers who you are, your projects and their nicknames, and where you left off, in every session and on every device. Say "my game project" and it knows which one. Save a handoff on your desktop and resume it on your laptop. Free and open source. Your data stays in a private git repo you own.

**Categories**: Productivity · Developer Tools · Memory & Context

**Pricing**: Free

**Needs access to**: OmniContext MCP server (`npx -y @aaryanbindage/omnicontext mcp`). Local and open source (MIT). Optional sync to a private GitHub repo the user owns.

**Compatibility**: Claude Code (plugin with a session-start briefing), Claude Desktop, Cursor, Windsurf, VS Code and any MCP client. Desktop app for Windows, macOS and Linux (x64 + ARM64). Standalone Apple Watch viewer.

**Docs link**: https://aaryanbindage.github.io/omnicontext/

**Logo**: `icon.png` (512×512) in the repo root

**Screenshots**: `docs/shot-projects.png`, `docs/shot-preview.png`, `docs/shot-profile.png`, `docs/shot-inbox.png`

**Description** (markdown):

OmniContext gives Claude, and any MCP-capable agent, a long-term memory that follows you across sessions and devices.

- **Knows you**: a profile of your role, preferences and tools, read at the start of every session.
- **Knows your projects**: each project has nicknames, so "my game project", "the bot" or "my portfolio" resolve to the right repo, stack and status.
- **Resume anywhere**: save a handoff (summary, next steps, git branch and uncommitted work) and pick it up in any session on any device.
- **Inbox**: dictate a thought on your Apple Watch, and the next session offers to file it.
- **Yours**: plain files in `~/.omnicontext`, synced through a private git repo you own. No cloud service and no account.

This skill tells the agent when to read memory, how to resolve loose references, when to offer a handoff, and what not to store. It uses the free, open-source OmniContext MCP server. Setup is one command, and the skill walks the user through it if the server isn't connected.

**Limitations**: needs the OmniContext MCP server installed. Cross-device sync needs git and a private remote (GitHub is easiest).
