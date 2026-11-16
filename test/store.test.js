import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { resolveProjects } from '../src/resolve.js';
import { buildContext } from '../src/context.js';
import { execFileSync } from 'node:child_process';

const tmp = () => new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'omni-')));

test('remember appends under Facts', () => {
  const s = tmp();
  s.remember('Prefers TypeScript');
  s.remember('Lives in Toronto');
  const profile = s.getProfile();
  assert.match(profile, /## Facts\n- Prefers TypeScript.*\n- Lives in Toronto/);
});

test('resolves loose project references', () => {
  const s = tmp();
  s.upsertProject({ name: 'Starfall', aliases: ['my game'], tags: ['godot', 'game'], description: 'A 2D space roguelike' });
  s.upsertProject({ name: 'Portfolio site', tags: ['website', 'astro'] });
  s.upsertProject({ name: 'FaceLock', description: 'Windows face unlock app' });
  const top = (q) => resolveProjects(s.listProjects(), q)[0]?.project.slug;
  assert.equal(top('my game project'), 'starfall');
  assert.equal(top('the games'), 'starfall');
  assert.equal(top('my website'), 'portfolio-site');
  assert.equal(top('facelock'), 'facelock');
  assert.equal(resolveProjects(s.listProjects(), 'my project').length, 0);
});

test('upsert merges aliases and links paths per device', () => {
  const s = tmp();
  s.upsertProject({ name: 'Starfall', aliases: ['game'] });
  const p = s.upsertProject({ name: 'starfall', aliases: ['rpg'], path: os.tmpdir() });
  assert.deepEqual(p.aliases, ['game', 'rpg']);
  assert.equal(p.paths[s.device], path.resolve(os.tmpdir()));
  assert.equal(s.projectForCwd(path.join(os.tmpdir(), 'sub')).slug, 'starfall');
});

test('handoffs round-trip and show in context', () => {
  const s = tmp();
  s.upsertProject({ name: 'Starfall', aliases: ['my game'] });
  const h = s.saveHandoff({ project: 'my game', title: 'Boss AI', summary: 'Wrote state machine', nextSteps: ['tune timings'] });
  assert.equal(h.project, 'starfall');
  const ctx = buildContext(s, { cwd: os.tmpdir() });
  assert.match(ctx, /Boss AI/);
  assert.match(ctx, /Starfall/);
  s.setHandoffStatus(h.id, 'resumed');
  assert.equal(s.listHandoffs({ status: 'open' }).length, 0);
});

test('forget removes matching facts only', () => {
  const s = tmp();
  s.remember('Prefers TypeScript');
  s.remember('Uses a Mac at work');
  assert.equal(s.forget('typescript').length, 1);
  assert.doesNotMatch(s.getProfile(), /TypeScript/);
  assert.match(s.getProfile(), /Uses a Mac/);
  assert.equal(s.forget('nothing like this').length, 0);
});

test('inbox captures can be filed as facts or notes', () => {
  const s = tmp();
  s.upsertProject({ name: 'Starfall', aliases: ['my game'] });
  const a = s.capture('boss should drop a key', { project: 'starfall', source: 'Apple Watch' });
  const b = s.capture('I am vegetarian');
  const c = s.capture('random');
  assert.equal(s.listInbox().length, 3);
  assert.match(buildContext(s), /Inbox \(3/);
  s.fileInbox(a.id, { as: 'note' });
  s.fileInbox(b.id, { as: 'fact', text: 'Is vegetarian' });
  s.fileInbox(c.id, { as: 'dismiss' });
  assert.equal(s.listInbox().length, 0);
  assert.equal(s.getProject('starfall').notes[0].text, 'boss should drop a key');
  assert.match(s.getProfile(), /- Is vegetarian/);
});

test('snapshot is deterministic and covers everything', () => {
  const s = tmp();
  s.upsertProject({ name: 'Starfall', aliases: ['my game'] });
  s.saveHandoff({ project: 'starfall', title: 'Boss AI', summary: 'x' });
  s.capture('idea');
  assert.equal(s.writeSnapshot(), true);
  assert.equal(s.writeSnapshot(), false);
  const snap = JSON.parse(fs.readFileSync(s.snapshotPath, 'utf8'));
  assert.equal(snap.format, 1);
  assert.equal(snap.projects[0].slug, 'starfall');
  assert.equal(snap.handoffs[0].title, 'Boss AI');
  assert.equal(snap.inbox[0].text, 'idea');
});

test('handoffs record git state of cwd', () => {
  const s = tmp();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-repo-'));
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  try {
    git('init', '-q', '-b', 'feature');
    git('-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-q', '--allow-empty', '-m', 'x');
  } catch {
    return; // git missing
  }
  fs.writeFileSync(path.join(repo, 'wip.txt'), 'x');
  const h = s.saveHandoff({ title: 't', summary: 's', cwd: repo });
  assert.equal(h.git.branch, 'feature');
  assert.deepEqual(h.git.uncommitted, ['wip.txt']);
});

test('export and import round-trip', () => {
  const a = tmp();
  a.remember('Likes tea');
  a.upsertProject({ name: 'Starfall' });
  a.saveHandoff({ title: 't', summary: 's' });
  const b = tmp();
  const r = b.importAll(JSON.parse(JSON.stringify(a.exportAll())));
  assert.deepEqual(r, { projects: 1, handoffs: 1, inbox: 0 });
  assert.match(b.getProfile(), /Likes tea/);
});
