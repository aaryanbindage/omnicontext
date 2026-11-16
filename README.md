<p align="center"><img src="docs/icon.png" width="96" alt="OmniContext logo" /></p>

<h1 align="center">OmniContext</h1>

<p align="center"><b>Persistent, cross-device memory for Claude.</b><br/>
Every Claude session — Claude Code, Claude Desktop, any MCP client, on any of your machines — knows who you are, what you're working on, and where you left off.</p>

<p align="center">
<a href="https://github.com/aaryanbindage/omnicontext/releases/latest">Download (Mac · Windows · Linux)</a> ·
<a href="#claude-code-plugin">Claude Code plugin</a> ·
<a href="#claude-desktop--other-mcp-clients">MCP server</a> ·
<a href="https://aaryanbindage.github.io/omnicontext/">Website</a>
</p>

<p align="center">
<a href="https://www.npmjs.com/package/omnicontext"><img alt="npm" src="https://img.shields.io/npm/v/omnicontext"></a>
<a href="https://github.com/aaryanbindage/omnicontext/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/aaryanbindage/omnicontext/actions/workflows/ci.yml/badge.svg"></a>
<a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

---

```text
You (on your laptop):  continue my game project
Claude:                Resuming Starfall (the Godot space roguelike). Last session on your desktop
                       you finished the enemy state machine; next up is the boss fight timings…
```

## What it does

- **Knows you.** A profile (role, preferences, tools, facts) shared with every session. Claude adds to it when you tell it something lasting (`remember`).
- **Knows your projects.** Name them once, give them nicknames, and "my game project", "the website" or "that bot" resolve to the right one in any session. Each project keeps notes, its repo, and its folder on each device.
- **Resumes across devices.** `/omnicontext:handoff` saves a self-contained summary and next steps. On another machine, `/omnicontext:resume` picks it up and opens the project's folder on that device.
- **Syncs without a cloud service.** Your memory is a folder of plain Markdown and JSON files (`~/.omnicontext`) synced through a **private git repo you own**. Nothing goes to a third-party server.
- **Works everywhere.** It's a Claude Code plugin with auto-injected context, an MCP server for Claude Desktop, Cursor, VS Code, Windsurf and Zed, a desktop app for Mac, Windows and Linux, and a CLI.

## Install

### Desktop app (Mac · Windows · Linux)

Download from **[Releases](https://github.com/aaryanbindage/omnicontext/releases/latest)**:

| OS | File |
|---|---|
| Windows | `OmniContext-Setup-x.y.z.exe` (installer) or `…-Windows-x64.zip` (portable) |
| macOS | `…-macOS-arm64.dmg` (Apple Silicon) / `…-macOS-x64.dmg` (Intel) |
| Linux | `…-Linux-x86_64.AppImage` or `…-Linux-amd64.deb` |

The app lets you edit your profile, projects and handoffs, set up sync, and connect Claude Code and Claude Desktop with one click. It stays in the tray and syncs in the background.

> macOS builds aren't notarized yet. If macOS says the app is damaged, run `xattr -cr /Applications/OmniContext.app`.

### Claude Code plugin

```text
/plugin marketplace add aaryanbindage/omnicontext
/plugin install omnicontext@omnicontext
```

Requires Node.js 18+. You get:

| | |
|---|---|
| **SessionStart hook** | injects your profile, project index, the current project, and open handoffs |
| **SessionEnd hook** | syncs your memory to your other devices |
| `/omnicontext:handoff [title]` | save the current work so it can be resumed anywhere |
| `/omnicontext:resume [project]` | continue the latest (or a named) handoff |
| `/omnicontext:remember <fact>` | remember something about you or a project |
| `/omnicontext:project [name aka nickname]` | register this folder as a project |
| `/omnicontext:sync` | sync now |
| MCP tools + skill | Claude resolves "my X project", saves notes and handoffs |

### Claude Desktop & other MCP clients

**One click:** download `omnicontext.mcpb` from Releases and open it with Claude Desktop.
You can also use the desktop app (**Connect Claude → Install**) or run `npx omnicontext install claude-desktop`.

**Manually** (Claude Desktop, Cursor, Windsurf, VS Code, Zed, Cline and others):

```json
{
  "mcpServers": {
    "omnicontext": { "command": "npx", "args": ["-y", "omnicontext", "mcp"] }
  }
}
```

### CLI

```bash
npm i -g omnicontext
omnicontext project add "Starfall" --alias "my game" --tag godot --desc "2D space roguelike" --path .
omnicontext resolve "my game project"
omnicontext remember "Prefers TypeScript and short answers"
omnicontext sync --github          # one-time: create a private repo and sync
```

## Sync your devices

On your **first** device:

```bash
omnicontext sync --github                  # needs the GitHub CLI (gh auth login); creates <you>/omnicontext-data (private)
# or
omnicontext sync --remote <any git url you own>
```

On **every other** device, connect the same repo:

```bash
omnicontext sync --remote https://github.com/<you>/omnicontext-data.git
omnicontext device "MacBook"               # optional: a friendly device name
```

You can do the same from the desktop app's **Sync & devices** tab. After that, sync runs on its own: at the start and end of each Claude Code session, a few seconds after the MCP server makes a change, and every few minutes while the desktop app is open. Each record is its own file, so two devices rarely conflict. When they do, the local version wins, and git history keeps everything.

## MCP tools

| Tool | Purpose |
|---|---|
| `get_context` | Full briefing: profile, projects, open handoffs (for clients without hooks) |
| `get_profile` / `update_profile` / `remember` | Read and update what Claude knows about you |
| `list_projects` / `get_project` / `upsert_project` / `add_project_note` | Manage projects, nicknames, per-device folders, notes |
| `resolve_project` | "my game project" → the matching project, ranked |
| `save_handoff` / `list_handoffs` / `resume_handoff` / `complete_handoff` | Cross-device resume |
| `search_memory` | Search the profile, notes, and handoffs |
| `sync_now` | Push and pull with your other devices |

It also provides the prompts `resume` and `handoff`.

## Data format

```text
~/.omnicontext/
  profile.md               # you — edit freely
  projects/starfall.json   # name, aliases, tags, description, repo, paths per device, notes
  handoffs/<id>.json       # title, summary, next steps, files, device, status
  local.json               # this device only (name, sync prefs) — not synced
```

Set `OMNICONTEXT_HOME` to use a different folder. You can also put the folder in Dropbox, iCloud or OneDrive instead of using git sync.

## Privacy

Everything stays on your machines and in the git remote you choose. OmniContext has no server, no telemetry, and no account. Don't store secrets in it. The instructions it gives Claude say the same.

## Development

```bash
npm install
npm test
npm run build          # bundles dist/omnicontext.mjs (used by the plugin, the app, and npm)
cd app && npm install && npm start     # run the desktop app
```

Releases: push a `v*` tag. GitHub Actions builds the Windows, macOS and Linux apps and the `.mcpb` bundle, and publishes to npm.

## License

MIT © aaryanbindage
