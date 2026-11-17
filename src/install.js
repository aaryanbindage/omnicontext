// Wire OmniContext into Claude Desktop and Claude Code.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export const MARKETPLACE = 'aaryanbindage/omnicontext';

export function claudeDesktopConfigPath() {
  const home = os.homedir();
  if (process.platform === 'win32')
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  if (process.platform === 'darwin')
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude', 'claude_desktop_config.json');
}

/** Add (or replace) the "omnicontext" MCP server entry in Claude Desktop's config. */
export function installClaudeDesktop(server = { command: 'npx', args: ['-y', '@aaryanbindage/omnicontext', 'mcp'] }) {
  const file = claudeDesktopConfigPath();
  let cfg = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    try {
      cfg = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`${file} is not valid JSON; fix it before installing.`);
    }
    fs.copyFileSync(file, file + '.bak');
  }
  cfg.mcpServers = { ...(cfg.mcpServers || {}), omnicontext: server };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return file;
}

function run(cmd, args) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Install the Claude Code plugin through the `claude` CLI. */
export function installClaudeCode() {
  try {
    run('claude', ['--version']);
  } catch {
    throw new Error('Claude Code CLI (`claude`) not found on PATH. Install it, then run: ' +
      `claude plugin marketplace add ${MARKETPLACE} && claude plugin install omnicontext@omnicontext`);
  }
  const log = [];
  try {
    log.push(run('claude', ['plugin', 'marketplace', 'add', MARKETPLACE]));
  } catch (e) {
    // Already added is fine; anything else is surfaced by the install step.
    log.push(String(e.stderr || e.message));
  }
  try {
    run('claude', ['plugin', 'marketplace', 'update', 'omnicontext']);
  } catch {}
  log.push(run('claude', ['plugin', 'install', 'omnicontext@omnicontext']));
  return log.join('\n').trim();
}

// ---- Other agents: Codex, Cursor, Gemini CLI. Same MCP server, same memory. ----

const NPX = ['-y', '@aaryanbindage/omnicontext', 'mcp'];

/** Short standing instructions for agents that read a global instructions file (AGENTS.md, GEMINI.md). */
export const AGENT_INSTRUCTIONS = `## OmniContext memory

You have the user's long-term memory through the **omnicontext** MCP tools. It is shared with every other agent they use (Claude, Codex, Cursor, …) on every device.

- At the start of a conversation, call \`get_context\` (pass the current directory) before answering anything personal or project-related.
- "My game project", "the website" and similar refer to projects in that briefing; use \`resolve_project\` if unsure.
- "Resume" / "continue where I left off" → \`resume_handoff\`. Before ending substantial work, or when the user switches tools or devices, offer \`save_handoff\` with concrete next steps.
- Lasting facts about the user → \`remember\` (no longer true → \`forget\`); project decisions → \`add_project_note\`. Inbox items → offer \`file_inbox\`.
- Never store secrets. Don't recite the briefing or announce the memory system.`;

const START = '<!-- omnicontext:start -->';
const END = '<!-- omnicontext:end -->';

/** Insert or replace the OmniContext block in a markdown instructions file. */
export function upsertInstructions(file, body = AGENT_INSTRUCTIONS) {
  const block = `${START}\n${body}\n${END}`;
  let s = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const re = /<!-- omnicontext:start -->[\s\S]*?<!-- omnicontext:end -->/;
  s = re.test(s) ? s.replace(re, block) : (s.trim() ? s.replace(/\s*$/, '\n\n') : '') + block + '\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, s);
  return file;
}

/** Replace (or append) the [mcp_servers.omnicontext] table in a Codex config.toml. */
export function upsertCodexToml(src, table) {
  const lines = src.split(/\r?\n/);
  const out = [];
  let skip = false;
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) skip = /^mcp_servers\.(omnicontext|"omnicontext")(\.|$)/.test(header[1].trim());
    if (!skip) out.push(line);
  }
  const body = out.join('\n').replace(/\s*$/, '');
  return (body ? body + '\n\n' : '') + table + '\n';
}

const tomlStr = (s) => JSON.stringify(s);

export function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

/** Add the MCP server to Codex (CLI, IDE extension and app share ~/.codex/config.toml) plus standing instructions in ~/.codex/AGENTS.md. */
export function installCodex() {
  const dir = codexHome();
  const file = path.join(dir, 'config.toml');
  const [command, args] = process.platform === 'win32' ? ['cmd', ['/c', 'npx', ...NPX]] : ['npx', NPX];
  const table = [
    '[mcp_servers.omnicontext]',
    `command = ${tomlStr(command)}`,
    `args = [${args.map(tomlStr).join(', ')}]`,
    'startup_timeout_sec = 60',
  ].join('\n');
  const src = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (src) fs.copyFileSync(file, file + '.bak');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, upsertCodexToml(src, table));
  const agents = upsertInstructions(path.join(dir, 'AGENTS.md'));
  return [file, agents];
}

function upsertJsonServers(file) {
  let cfg = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    try {
      cfg = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`${file} is not valid JSON; fix it before installing.`);
    }
    fs.copyFileSync(file, file + '.bak');
  }
  cfg.mcpServers = { ...(cfg.mcpServers || {}), omnicontext: { command: 'npx', args: NPX } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return file;
}

/** Cursor reads global MCP servers from ~/.cursor/mcp.json. */
export function installCursor() {
  return [upsertJsonServers(path.join(os.homedir(), '.cursor', 'mcp.json'))];
}

/** Gemini CLI: ~/.gemini/settings.json for the server, ~/.gemini/GEMINI.md for instructions. */
export function installGemini() {
  const dir = path.join(os.homedir(), '.gemini');
  return [upsertJsonServers(path.join(dir, 'settings.json')), upsertInstructions(path.join(dir, 'GEMINI.md'))];
}

/** Which agents look installed on this machine. */
export function detectAgents() {
  const home = os.homedir();
  const has = (p) => fs.existsSync(p);
  let claudeCli = false;
  try {
    run('claude', ['--version']);
    claudeCli = true;
  } catch {}
  return {
    'claude-code': claudeCli,
    'claude-desktop': has(path.dirname(claudeDesktopConfigPath())),
    codex: has(codexHome()),
    cursor: has(path.join(home, '.cursor')),
    gemini: has(path.join(home, '.gemini')),
  };
}
