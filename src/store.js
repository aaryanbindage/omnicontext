// File-backed store. One file per record so git sync rarely conflicts.
//
// <home>/
//   profile.md            who you are (markdown, free-form)
//   projects/<slug>.json  one per project
//   handoffs/<id>.json    resumable work, one per handoff
//   local.json            device-only settings (never synced)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const VERSION = '0.1.3';

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
    const stamp = now().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const id = `${stamp}-${crypto.randomBytes(2).toString('hex')}`;
    const proj = project ? this.getProject(project) : null;
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
