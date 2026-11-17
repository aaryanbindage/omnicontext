import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { upsertCodexToml, upsertInstructions, installCodex } from '../src/install.js';
import { agentName } from '../src/mcp.js';

test('codex config.toml: replaces only the omnicontext table', () => {
  const src = 'model = "gpt-5"\n\n[mcp_servers.omnicontext]\ncommand = "old"\n\n[mcp_servers.omnicontext.env]\nX = "1"\n\n[mcp_servers.other]\ncommand = "keep"\n';
  const out = upsertCodexToml(src, '[mcp_servers.omnicontext]\ncommand = "npx"');
  assert.match(out, /model = "gpt-5"/);
  assert.match(out, /\[mcp_servers\.other\]\ncommand = "keep"/);
  assert.doesNotMatch(out, /old|X = "1"/);
  assert.equal(out.match(/\[mcp_servers\.omnicontext\]/g).length, 1);
  assert.equal(upsertCodexToml(out, '[mcp_servers.omnicontext]\ncommand = "npx"'), out);
});

test('instructions block is inserted once and replaced in place', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oc-')), 'AGENTS.md');
  fs.writeFileSync(file, '# Mine\n\nKeep this.\n');
  upsertInstructions(file, 'v1');
  upsertInstructions(file, 'v2');
  const s = fs.readFileSync(file, 'utf8');
  assert.match(s, /Keep this\./);
  assert.match(s, /v2/);
  assert.doesNotMatch(s, /v1/);
  assert.equal(s.match(/omnicontext:start/g).length, 1);
});

test('install codex writes config.toml and AGENTS.md under CODEX_HOME', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-codex-'));
  process.env.CODEX_HOME = dir;
  try {
    installCodex();
    installCodex();
    const toml = fs.readFileSync(path.join(dir, 'config.toml'), 'utf8');
    assert.equal(toml.match(/\[mcp_servers\.omnicontext\]/g).length, 1);
    assert.match(toml, /@aaryanbindage\/omnicontext/);
    assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /get_context/);
  } finally {
    delete process.env.CODEX_HOME;
  }
});

test('agent names from MCP client info', () => {
  assert.equal(agentName('codex-mcp-client'), 'Codex');
  assert.equal(agentName('claude-code'), 'Claude Code');
  assert.equal(agentName('cursor-vscode'), 'Cursor');
  assert.equal(agentName('my-agent'), 'my-agent');
});
