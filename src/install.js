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
