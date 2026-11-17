// omnicontext CLI: MCP server, Claude Code hooks, and management commands.

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { Store, VERSION } from './store.js';
import { buildContext, projectLine, handoffLine } from './context.js';
import { resolveProjects } from './resolve.js';
import { buildGraph, neighborhood } from './graph.js';
import { sync, pull, initSync, createGithubRemote, syncStatus } from './sync.js';
import { installClaudeDesktop, installClaudeCode, installCodex, installCursor, installGemini, detectAgents } from './install.js';

const HELP = `omnicontext ${VERSION} — persistent, cross-device memory for Claude, Codex and every MCP agent

Usage:
  omnicontext mcp                         Run the MCP server (stdio)
  omnicontext context [--cwd DIR]         Print the briefing Claude sees
  omnicontext status                      Data folder, device, sync state

  omnicontext remember "<fact>"           Add a fact to your profile
  omnicontext forget "<words>"            Remove profile facts containing these words
  omnicontext capture "<text>" [--project P]   Drop a quick note in the inbox
  omnicontext inbox                       List inbox items (captures from the watch and elsewhere)
  omnicontext profile [--edit FILE]       Print profile, or replace it from FILE
  omnicontext projects                    List projects
  omnicontext project add <name> [--alias A]... [--tag T]... [--desc D] [--path DIR] [--repo URL]
  omnicontext project note <project> "<note>"
  omnicontext resolve "<reference>"       e.g. omnicontext resolve "my game project"
  omnicontext handoffs [--all]            List handoffs
  omnicontext graph [--json]              Knowledge graph: counts, hubs (or the full graph as JSON)
  omnicontext related "<thing>"           What's linked to a project, #tag, device or topic

  omnicontext sync                        Sync now
  omnicontext sync --github [NAME]        Create a private GitHub repo (via gh) and sync to it
  omnicontext sync --remote <git-url>     Sync to any git remote you own
  omnicontext device <name>               Name this device
  omnicontext export [FILE]               Write everything to one JSON file (stdout if no FILE)
  omnicontext import FILE [--replace-profile]   Merge an export into this device's memory

  omnicontext install claude-desktop      Add the MCP server to Claude Desktop
  omnicontext install claude-code         Install the Claude Code plugin
  omnicontext install codex               Add it to OpenAI Codex (CLI, IDE, app) + AGENTS.md
  omnicontext install cursor              Add it to Cursor
  omnicontext install gemini              Add it to Gemini CLI + GEMINI.md
  omnicontext install all                 Every agent found on this machine

  omnicontext hook session-start|session-end   (used by the Claude Code plugin)

Data lives in ~/.omnicontext (override with OMNICONTEXT_HOME).`;

function parseFlags(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      if (flags[key] === undefined) flags[key] = val;
      else flags[key] = [].concat(flags[key], val);
    } else pos.push(a);
  }
  return { pos, flags };
}
const list = (v) => (v === undefined || v === true ? undefined : [].concat(v));

async function readStdinJson() {
  if (process.stdin.isTTY) return {};
  return new Promise((resolve) => {
    let data = '';
    const done = () => {
      try {
        resolve(data.trim() ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', done);
    setTimeout(done, 1500);
  });
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;
  const { pos, flags } = parseFlags(rest);

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return console.log(HELP);
  if (cmd === '--version' || cmd === '-v') return console.log(VERSION);

  if (cmd === 'mcp') {
    const { startMcpServer } = await import('./mcp.js');
    return startMcpServer();
  }

  const store = new Store();

  switch (cmd) {
    case 'hook': {
      const input = await readStdinJson();
      const cwd = input.cwd || process.cwd();
      if (pos[0] === 'session-start') {
        if (store.getLocal().autoSync !== false) {
          try {
            pull(store.home, { timeout: 6000 });
          } catch {}
        }
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: buildContext(store, { cwd }) },
          }),
        );
        const p = store.projectForCwd(cwd);
        if (p) store.touchProject(p.slug);
      } else if (pos[0] === 'session-end') {
        // Hand off to a detached process so Claude can exit without waiting on the network.
        if (store.getLocal().autoSync !== false && syncStatus(store.home).configured) {
          spawn(process.execPath, [process.argv[1], 'sync'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        }
      }
      return;
    }

    case 'context':
      return console.log(buildContext(store, { cwd: flags.cwd || process.cwd() }));

    case 'status': {
      const st = syncStatus(store.home);
      console.log(`Data:     ${store.home}\nDevice:   ${store.device}`);
      console.log(`Projects: ${store.listProjects().length}   Open handoffs: ${store.listHandoffs({ status: 'open' }).length}   Inbox: ${store.listInbox().length}`);
      console.log(`Sync:     ${st.configured ? `${st.remote}${st.dirty ? ' (unsynced changes)' : ''}` : 'not configured (omnicontext sync --github)'}`);
      return;
    }

    case 'remember':
      if (!pos.length) throw new Error('Usage: omnicontext remember "<fact>"');
      console.log('Saved:', store.remember(pos.join(' ')));
      return;

    case 'forget': {
      const removed = store.forget(pos.join(' '));
      console.log(removed.length ? `Removed:\n${removed.join('\n')}` : 'No matching fact.');
      return;
    }

    case 'capture': {
      const item = store.capture(pos.join(' '), { project: typeof flags.project === 'string' ? flags.project : '' });
      return console.log(`Captured ${item.id}`);
    }

    case 'inbox':
      for (const i of store.listInbox()) console.log(`${i.id}  ${i.text}${i.project ? `  (${i.project})` : ''}  — ${i.source}`);
      return;

    case 'export': {
      const json = JSON.stringify(store.exportAll(), null, 2) + '\n';
      if (pos[0]) {
        fs.writeFileSync(pos[0], json);
        return console.log(`Exported to ${pos[0]}`);
      }
      return process.stdout.write(json);
    }

    case 'import': {
      if (!pos[0]) throw new Error('Usage: omnicontext import FILE');
      const r = store.importAll(JSON.parse(fs.readFileSync(pos[0], 'utf8')), { replaceProfile: !!flags['replace-profile'] });
      return console.log(`Imported ${r.projects} projects, ${r.handoffs} handoffs, ${r.inbox} inbox items.`);
    }

    case 'profile':
      if (typeof flags.edit === 'string') store.setProfile(fs.readFileSync(flags.edit, 'utf8'));
      return console.log(store.getProfile());

    case 'projects':
      for (const p of store.listProjects()) console.log(projectLine(p, store.device));
      return;

    case 'project': {
      const [sub, name, ...more] = pos;
      if (sub === 'add') {
        const p = store.upsertProject({
          name,
          aliases: list(flags.alias),
          tags: list(flags.tag),
          description: typeof flags.desc === 'string' ? flags.desc : undefined,
          repo: typeof flags.repo === 'string' ? flags.repo : undefined,
          path: flags.path === true ? process.cwd() : flags.path,
        });
        return console.log(`Saved ${p.name} (${p.slug})`);
      }
      if (sub === 'note') {
        store.addProjectNote(name, more.join(' '));
        return console.log('Note added.');
      }
      if (sub === 'rm') {
        store.deleteProject(name);
        return console.log('Removed.');
      }
      throw new Error('Usage: omnicontext project add|note|rm ...');
    }

    case 'resolve': {
      const hits = resolveProjects(store.listProjects(), pos.join(' '));
      if (!hits.length) return console.log('No match.');
      for (const h of hits) console.log(`${String(h.score).padStart(4)}  ${projectLine(h.project, store.device)}`);
      return;
    }

    case 'graph': {
      const g = buildGraph(store);
      if (flags.json) return console.log(JSON.stringify(g, null, 2));
      const by = {};
      for (const n of g.nodes) by[n.type] = (by[n.type] || 0) + 1;
      console.log(`${g.nodes.length} nodes, ${g.edges.length} links: ${Object.entries(by).map(([t, c]) => `${c} ${t}`).join(', ')}`);
      console.log('Most connected:');
      for (const n of g.nodes.filter((n) => n.id !== 'you').sort((a, b) => b.degree - a.degree).slice(0, 8)) console.log(`  ${String(n.degree).padStart(3)}  ${n.label} (${n.type})`);
      return;
    }

    case 'related': {
      const g = buildGraph(store);
      const q = pos.join(' ').trim().toLowerCase();
      let start = g.nodes.filter((n) => n.id !== 'you' && (n.label.toLowerCase() === q || n.id.endsWith(`:${q}`)));
      if (!start.length) {
        const p = resolveProjects(store.listProjects(), q, 1)[0]?.project;
        if (p) start = g.nodes.filter((n) => n.id === `project:${p.slug}`);
      }
      if (!start.length) return console.log('No match.');
      for (const n of neighborhood(g, start.map((n) => n.id))) console.log(`  ${n.label} (${n.type})`);
      return;
    }

    case 'handoffs':
      for (const h of store.listHandoffs({ status: flags.all ? 'all' : 'open' })) console.log(handoffLine(h), `[${h.status}]`);
      return;

    case 'device':
      if (!pos[0]) return console.log(store.device);
      store.setLocal({ deviceName: pos.join(' ') });
      return console.log(`This device is now "${store.device}".`);

    case 'sync': {
      let res;
      if (flags.github) res = createGithubRemote(store.home, typeof flags.github === 'string' ? flags.github : undefined, store.device);
      else if (typeof flags.remote === 'string') res = initSync(store.home, flags.remote, store.device);
      else res = sync(store.home, store.device);
      console.log(res.ok ? `Synced (${[res.committed && 'committed', res.pulled && 'pulled', res.pushed && 'pushed'].filter(Boolean).join(', ') || 'up to date'})` : `Not synced: ${res.reason}`);
      if (!res.ok) process.exitCode = 1;
      return;
    }

    case 'install': {
      if (pos[0] === 'claude-desktop') {
        const file = installClaudeDesktop();
        return console.log(`Added "omnicontext" to ${file}. Restart Claude Desktop.`);
      }
      if (pos[0] === 'claude-code') return console.log(installClaudeCode());
      const others = { codex: ['Codex', installCodex], cursor: ['Cursor', installCursor], gemini: ['Gemini CLI', installGemini] };
      if (others[pos[0]]) {
        const [name, fn] = others[pos[0]];
        return console.log(`Updated ${fn().join(' and ')}. Restart ${name}.`);
      }
      if (pos[0] === 'all') {
        const found = detectAgents();
        const all = { 'claude-code': () => installClaudeCode(), 'claude-desktop': () => `updated ${installClaudeDesktop()}`, ...Object.fromEntries(Object.entries(others).map(([k, [, fn]]) => [k, () => `updated ${fn().join(', ')}`])) };
        for (const [k, fn] of Object.entries(all)) {
          if (!found[k]) {
            console.log(`- ${k}: not found, skipped`);
            continue;
          }
          try {
            console.log(`- ${k}: ${fn().trim().split('\n').pop()}`);
          } catch (e) {
            console.log(`- ${k}: failed: ${e.message}`);
          }
        }
        return console.log('Restart those apps to pick up OmniContext. They all share the same memory.');
      }
      throw new Error('Usage: omnicontext install claude-desktop|claude-code|codex|cursor|gemini|all');
    }

    default:
      console.error(`Unknown command "${cmd}".\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}
