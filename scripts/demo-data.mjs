// Fills a store with sample data for screenshots and the watch simulator test.
// Usage: node scripts/demo-data.mjs <dir> [--snapshot out.json]

import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.js';

const dir = path.resolve(process.argv[2] || 'demo-home');
fs.rmSync(dir, { recursive: true, force: true });
const s = new Store(dir);
s.setLocal({ deviceName: 'Desktop' });

s.setProfile(`# About me

Indie game developer and tool builder. I like short answers and working code over explanations.

## Facts
`);
s.remember('Prefers Godot for games and TypeScript for web');
s.remember('Main side project is Starfall');
s.remember('Works on a Windows desktop and a MacBook');

const p = (x) => s.upsertProject(x);
p({ name: 'Starfall', aliases: ['my game', 'the roguelike'], tags: ['godot', 'game'], description: '2D space roguelike with procedural sectors', repo: 'https://github.com/you/starfall', paths: { Desktop: 'C:/dev/starfall', MacBook: '/Users/you/dev/starfall' } });
p({ name: 'Level Editor', tags: ['godot', 'tools'], description: 'In-game editor for Starfall levels', paths: { Desktop: 'C:/dev/level-editor' } });
p({ name: 'Portfolio', aliases: ['my website'], tags: ['astro', 'web'], description: 'Personal site with a Starfall devlog', paths: { MacBook: '/Users/you/dev/site' } });
p({ name: 'Discord Bot', aliases: ['the bot'], tags: ['typescript', 'discord'], description: 'Posts Portfolio updates to Discord' });
p({ name: 'FaceLock', tags: ['python', 'windows'], description: 'Face unlock for Windows apps', status: 'paused' });

s.addProjectNote('starfall', 'Boss fight uses [[State Machines]]');
s.addProjectNote('starfall', 'Try [[Procedural Generation]] for asteroid fields');
s.addProjectNote('level-editor', 'Shares tilemap code with [[Procedural Generation]]');
s.addProjectNote('portfolio', 'Devlog posts go in src/content/devlog');

s.saveHandoff({
  project: 'starfall',
  title: 'Boss AI phase 2',
  summary: 'Phase 2 of the boss now uses the state machine. Attack timings still feel off and the shield phase is unfinished.',
  nextSteps: ['Tune attack timings in boss.gd', 'Add the shield phase', 'Playtest on the MacBook'],
});
s.saveHandoff({ project: 'portfolio', title: 'Devlog page', summary: 'Layout done. Embed the Discord Bot feed next.', nextSteps: ['Embed the feed'] });

s.capture('Grappling hook idea for level 3', { project: 'starfall', source: 'Apple Watch' });
s.capture('Write a post about the bot', { source: 'Apple Watch' });

const i = process.argv.indexOf('--snapshot');
if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(s.buildSnapshot()));
console.log(`demo data in ${dir}`);
