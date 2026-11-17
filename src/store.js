// File-backed store. One file per record so git sync rarely conflicts.
//
// <home>/
//   profile.md            who you are (markdown, free-form)
//   projects/<slug>.json  one per project
//   handoffs/<id>.json    resumable work, one per handoff
//   inbox/<id>.json       quick captures (e.g. dictated on a watch) waiting to be filed
//   snapshot.json         everything above in one file, for read-only clients like the watch app
//   local.json            device-only settings (never synced)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildGraph } from './graph.js';

export const VERSION = '0.3.0';

export function defaultHome() {
  return process.env.OMNICONTEXT_HOME || path.join(os.homedir(), '.omnicontext');
}

const PROFILE_TEMPLATE = `# About me

<!-- Who you are, what you do, how you like to work. Every Claude session reads this. -->

## Facts
`;

export function slugify(s) {
  const slug = String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return slug || 'project';
}

const now = () => new Date().toISOString();
const uniq = (arr) => [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function listJson(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(dir, f), null))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export class Store {
  constructor(home = defaultHome()) {
    this.home = path.resolve(home);
    this.ensure();
  }

  ensure() {
    fs.mkdirSync(path.join(this.home, 'projects'), { recursive: true });
    fs.mkdirSync(path.join(this.home, 'handoffs'), { recursive: true });
    fs.mkdirSync(path.join(this.home, 'inbox'), { recursive: true });
    if (!fs.existsSync(this.profilePath)) fs.writeFileSync(this.profilePath, PROFILE_TEMPLATE);
    const gitignore = path.join(this.home, '.gitignore');
    if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, 'local.json\n*.tmp\n');
    return this;
  }

  // ---- device-local settings -------------------------------------------

  get localPath() {
    return path.join(this.home, 'local.json');
  }
  getLocal() {
    return readJson(this.localPath, {});
  }
  setLocal(patch) {
    const next = { ...this.getLocal(), ...patch };
    writeJson(this.localPath, next);
    return next;
  }
  get device() {
    return this.getLocal().deviceName || os.hostname();
  }

  // ---- profile ---------------------------------------------------------

  get profilePath() {
    return path.join(this.home, 'profile.md');
  }
  getProfile() {
    try {
      return fs.readFileSync(this.profilePath, 'utf8');
    } catch {
      return PROFILE_TEMPLATE;
    }
  }
  setProfile(content) {
    fs.writeFileSync(this.profilePath, String(content).replace(/\s*$/, '\n'));
    return this.getProfile();
  }
  /** Append a durable fact about the user under "## Facts". */
  remember(fact) {
    const line = `- ${String(fact).trim().replace(/\s+/g, ' ')} _(${now().slice(0, 10)})_`;
    let profile = this.getProfile().replace(/\s*$/, '\n');
    if (!/^## Facts\s*$/m.test(profile)) profile += '\n## Facts\n';
    // Insert at the end of the Facts section (before the next "## " heading, if any).
    const lines = profile.split('\n');
    const start = lines.findIndex((l) => /^## Facts\s*$/.test(l));
    let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
    if (end === -1) end = lines.length;
    while (end > start + 1 && lines[end - 1].trim() === '') end--;
    lines.splice(end, 0, line);
    this.setProfile(lines.join('\n'));
    return line;
  }
  /** Remove profile bullet lines containing `text` (case-insensitive). Returns the removed lines. */
  forget(text) {
    const q = String(text).trim().toLowerCase();
    if (q.length < 3) throw new Error('Give at least 3 characters of the fact to forget');
    const removed = [];
    const kept = this.getProfile().split('\n').filter((l) => {
      const hit = /^\s*[-*]\s/.test(l) && l.toLowerCase().includes(q);
      if (hit) removed.push(l.trim());
      return !hit;
    });
    if (removed.length) this.setProfile(kept.join('\n'));
    return removed;
  }

  // ---- projects --------------------------------------------------------

  projectPath(slug) {
    return path.join(this.home, 'projects', `${slugify(slug)}.json`);
  }
  listProjects() {
    return listJson(path.join(this.home, 'projects')).sort((a, b) =>
      String(b.lastActiveAt || b.updatedAt || '').localeCompare(String(a.lastActiveAt || a.updatedAt || '')),
    );
  }
  getProject(slugOrName) {
    if (!slugOrName) return null;
    const direct = readJson(this.projectPath(slugOrName), null);
    if (direct) return direct;
    const key = String(slugOrName).toLowerCase();
    return (
      this.listProjects().find(
        (p) => p.name.toLowerCase() === key || (p.aliases || []).some((a) => a.toLowerCase() === key),
      ) || null
    );
  }
  /** Create or merge a project. Lists (aliases, tags) are unioned; `path` is stored for this device. */
  upsertProject(input) {
    if (!input?.name && !input?.slug) throw new Error('Project needs a name');
    const existing = this.getProject(input.slug || input.name);
    const p = existing || {
      name: input.name,
      slug: slugify(input.slug || input.name),
      aliases: [],
      tags: [],
      description: '',
      status: 'active',
      repo: '',
      paths: {},
      notes: [],
      createdAt: now(),
    };
    if (input.name) p.name = input.name;
    for (const key of ['description', 'status', 'repo']) {
      if (input[key] !== undefined && input[key] !== null) p[key] = String(input[key]);
    }
    if (input.aliases) p.aliases = uniq(input.replaceLists ? input.aliases : [...p.aliases, ...input.aliases]);
    if (input.tags) p.tags = uniq(input.replaceLists ? input.tags : [...p.tags, ...input.tags]);
    if (input.path) p.paths = { ...p.paths, [input.device || this.device]: path.resolve(input.path) };
    if (input.paths) p.paths = { ...p.paths, ...input.paths };
    p.updatedAt = now();
    writeJson(this.projectPath(p.slug), p);
    return p;
  }
  addProjectNote(slugOrName, text) {
    const p = this.getProject(slugOrName);
    if (!p) throw new Error(`No project "${slugOrName}"`);
    p.notes = [...(p.notes || []), { text: String(text).trim(), at: now(), device: this.device }];
    p.updatedAt = p.lastActiveAt = now();
    writeJson(this.projectPath(p.slug), p);
    return p;
  }
  touchProject(slugOrName) {
    const p = this.getProject(slugOrName);
    if (!p) return null;
    p.lastActiveAt = now();
    writeJson(this.projectPath(p.slug), p);
    return p;
  }
  deleteProject(slug) {
    fs.rmSync(this.projectPath(slug), { force: true });
  }
  /** The project whose path on this device contains `cwd`, or whose repo matches cwd's git remote. */
  projectForCwd(cwd) {
    if (!cwd) return null;
    const norm = (p) => path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
    const here = norm(cwd);
    let best = null;
    for (const p of this.listProjects()) {
      for (const dir of Object.values(p.paths || {})) {
        const d = norm(dir);
        if ((here === d || here.startsWith(d + path.sep.toLowerCase()) || here.startsWith(d + '/')) &&
            (!best || d.length > best.len)) {
          best = { project: p, len: d.length };
        }
      }
    }
    if (best) return best.project;
    const remote = gitRemoteOf(cwd);
    if (remote) {
      const r = normalizeRepo(remote);
      return this.listProjects().find((p) => p.repo && normalizeRepo(p.repo) === r) || null;
    }
    return null;
  }

  // ---- handoffs --------------------------------------------------------

  handoffPath(id) {
    return path.join(this.home, 'handoffs', `${String(id).replace(/[^\w-]/g, '')}.json`);
  }
  saveHandoff({ project, title, summary, nextSteps = [], files = [], cwd = '' }) {
    if (!summary) throw new Error('A handoff needs a summary');
    const id = newId();
    let proj = project ? this.getProject(project) : null;
    if (!proj && cwd) proj = this.projectForCwd(cwd);
    const h = {
      id,
      title: title || summary.split('\n')[0].slice(0, 80),
      project: proj ? proj.slug : project || '',
      summary,
      nextSteps,
      files,
      cwd,
      device: this.device,
      status: 'open',
      createdAt: now(),
    };
    const g = cwd ? gitStateOf(cwd) : null;
    if (g) h.git = g;
    writeJson(this.handoffPath(id), h);
    if (proj) this.touchProject(proj.slug);
    return h;
  }
  listHandoffs({ project, status, limit } = {}) {
    let list = listJson(path.join(this.home, 'handoffs')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (project) {
      const p = this.getProject(project);
      const slug = p ? p.slug : project;
      list = list.filter((h) => h.project === slug);
    }
    if (status && status !== 'all') list = list.filter((h) => h.status === status);
    return limit ? list.slice(0, limit) : list;
  }
  getHandoff(id) {
    return readJson(this.handoffPath(id), null);
  }
  setHandoffStatus(id, status) {
    const h = this.getHandoff(id);
    if (!h) throw new Error(`No handoff "${id}"`);
    h.status = status;
    h[`${status}At`] = now();
    if (status === 'resumed') h.resumedOn = this.device;
    writeJson(this.handoffPath(id), h);
    return h;
  }
  deleteHandoff(id) {
    fs.rmSync(this.handoffPath(id), { force: true });
  }

  // ---- inbox -----------------------------------------------------------

  inboxPath(id) {
    return path.join(this.home, 'inbox', `${String(id).replace(/[^\w-]/g, '')}.json`);
  }
  /** Quick capture to file later: a thought dictated on the watch, a note from the CLI. */
  capture(text, { project = '', source } = {}) {
    const t = String(text ?? '').trim();
    if (!t) throw new Error('Nothing to capture');
    const item = { id: newId(), text: t, project, source: source || this.device, createdAt: now() };
    writeJson(this.inboxPath(item.id), item);
    return item;
  }
  listInbox() {
    return listJson(path.join(this.home, 'inbox')).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }
  /**
   * File an inbox item: as a profile fact, as a note on a project, or drop it.
   * `text` overrides the stored wording (e.g. a cleaned-up version of a dictation).
   */
  fileInbox(id, { as, project, text } = {}) {
    const item = readJson(this.inboxPath(id), null);
    if (!item) throw new Error(`No inbox item "${id}"`);
    const body = text || item.text;
    let result;
    if (as === 'fact') result = this.remember(body);
    else if (as === 'note') {
      const p = this.getProject(project || item.project);
      if (!p) throw new Error(`No project "${project || item.project}" to file the note under`);
      this.addProjectNote(p.slug, body);
      result = p.slug;
    } else if (as !== 'dismiss') throw new Error('`as` must be fact, note or dismiss');
    fs.rmSync(this.inboxPath(id), { force: true });
    return { item, filedAs: as, result };
  }

  // ---- snapshot --------------------------------------------------------

  get snapshotPath() {
    return path.join(this.home, 'snapshot.json');
  }
  /** One-file summary for read-only clients (the watch app). Deterministic, so unchanged data means no new commit. */
  buildSnapshot() {
    const projects = this.listProjects().map((p) => ({
      name: p.name,
      slug: p.slug,
      aliases: p.aliases || [],
      tags: p.tags || [],
      status: p.status || 'active',
      description: p.description || '',
      repo: p.repo || '',
      devices: Object.keys(p.paths || {}),
      notes: (p.notes || []).slice(-10),
      lastActiveAt: p.lastActiveAt || p.updatedAt || p.createdAt || '',
    }));
    const all = this.listHandoffs({ status: 'all' });
    const handoffs = [...all.filter((h) => h.status === 'open'), ...all.filter((h) => h.status !== 'open').slice(0, 10)];
    const inbox = this.listInbox();
    const stamps = [
      ...projects.map((p) => p.lastActiveAt),
      ...all.map((h) => h.doneAt || h.resumedAt || h.createdAt),
      ...inbox.map((i) => i.createdAt),
    ].filter(Boolean).sort();
    return {
      format: 1,
      updatedAt: stamps[stamps.length - 1] || '',
      profile: this.getProfile().replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim(),
      projects,
      handoffs,
      inbox,
      graph: compactGraph(buildGraph(this)),
    };
  }
  writeSnapshot() {
    const next = JSON.stringify(this.buildSnapshot(), null, 1) + '\n';
    let prev = '';
    try {
      prev = fs.readFileSync(this.snapshotPath, 'utf8');
    } catch {}
    if (prev !== next) fs.writeFileSync(this.snapshotPath, next);
    return prev !== next;
  }

  // ---- export / import -------------------------------------------------

  exportAll() {
    return {
      omnicontext: VERSION,
      exportedAt: now(),
      profile: this.getProfile(),
      projects: this.listProjects(),
      handoffs: this.listHandoffs({ status: 'all' }),
      inbox: this.listInbox(),
    };
  }
  /** Merge an export into this store. Existing records with the same id/slug are overwritten. */
  importAll(data, { replaceProfile = false } = {}) {
    if (!data || typeof data !== 'object' || !('projects' in data)) throw new Error('Not an OmniContext export');
    if (data.profile && (replaceProfile || this.getProfile().trim() === PROFILE_TEMPLATE.trim())) this.setProfile(data.profile);
    for (const p of data.projects || []) if (p?.slug) writeJson(this.projectPath(p.slug), p);
    for (const h of data.handoffs || []) if (h?.id) writeJson(this.handoffPath(h.id), h);
    for (const i of data.inbox || []) if (i?.id) writeJson(this.inboxPath(i.id), i);
    return { projects: (data.projects || []).length, handoffs: (data.handoffs || []).length, inbox: (data.inbox || []).length };
  }
}

/** Graph in a compact form for the watch: nodes [id, type, label], edges [source, target, kind]. */
function compactGraph(g) {
  return {
    nodes: g.nodes.map((n) => [n.id, n.type, n.label]),
    edges: g.edges.map((e) => [e.source, e.target, e.kind]),
  };
}

function newId() {
  const stamp = now().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${stamp}-${crypto.randomBytes(2).toString('hex')}`;
}

/** Branch, commit and uncommitted files of the repo at `cwd`, so another device can pick up the same state. */
export function gitStateOf(cwd) {
  const git = (args) => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 4000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  const commit = git(['rev-parse', '--short', 'HEAD']);
  if (!commit) return null;
  const status = git(['status', '--porcelain']) || '';
  const upstream = git(['rev-list', '--count', '@{u}..HEAD']);
  return {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']) || '',
    commit,
    remote: git(['remote', 'get-url', 'origin']) || '',
    uncommitted: status.split('\n').filter(Boolean).slice(0, 30).map((l) => l.slice(3)),
    unpushed: upstream === null ? null : Number(upstream),
  };
}

export function normalizeRepo(url) {
  return String(url)
    .trim()
    .toLowerCase()
    .replace(/^git@([^:]+):/, '$1/')
    .replace(/^[a-z+]+:\/\//, '')
    .replace(/^[^@/]+@/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
}

function gitRemoteOf(cwd) {
  // Walk up to find .git/config without spawning git (keeps hooks fast).
  let dir = path.resolve(cwd);
  for (let i = 0; i < 20; i++) {
    const cfg = path.join(dir, '.git', 'config');
    if (fs.existsSync(cfg)) {
      const m = fs.readFileSync(cfg, 'utf8').match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
      return m ? m[1] : null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
