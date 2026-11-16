import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { resolveProjects } from '../src/resolve.js';
import { buildContext } from '../src/context.js';

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
