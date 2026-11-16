// Cross-device sync: the data folder is a git repo pushed to a (private) remote you own.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function git(home, args, { timeout = 30000, allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: home,
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trim();
  } catch (err) {
    if (allowFail) return null;
    const msg = (err.stderr || err.message || '').toString().trim();
    throw new Error(`git ${args[0]} failed: ${msg}`);
  }
}

export function gitAvailable() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export function syncStatus(home) {
  if (!gitAvailable()) return { configured: false, git: false };
  const isRepo = fs.existsSync(path.join(home, '.git'));
  const remote = isRepo ? git(home, ['remote', 'get-url', 'origin'], { allowFail: true }) : null;
  const dirty = isRepo ? !!git(home, ['status', '--porcelain'], { allowFail: true }) : false;
  const last = isRepo ? git(home, ['log', '-1', '--format=%cI %s'], { allowFail: true }) : null;
  return { configured: !!remote, git: true, isRepo, remote, dirty, lastCommit: last };
}

function ensureRepo(home) {
  if (!fs.existsSync(path.join(home, '.git'))) {
    git(home, ['init', '-q']);
    git(home, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  }
  // Commits need an identity; use a local one if the user has none configured.
  if (!git(home, ['config', 'user.email'], { allowFail: true })) {
    git(home, ['config', 'user.email', 'omnicontext@localhost']);
    git(home, ['config', 'user.name', 'OmniContext']);
  }
}

function commitAll(home, device) {
  git(home, ['add', '-A']);
  if (git(home, ['status', '--porcelain'])) {
    git(home, ['commit', '-q', '-m', `sync from ${device} ${new Date().toISOString()}`]);
    return true;
  }
  return false;
}

/** Connect the data folder to a git remote and do a first sync. */
export function initSync(home, remote, device = os.hostname()) {
  ensureRepo(home);
  if (git(home, ['remote', 'get-url', 'origin'], { allowFail: true })) git(home, ['remote', 'set-url', 'origin', remote]);
  else git(home, ['remote', 'add', 'origin', remote]);
  return sync(home, device, { allowUnrelated: true });
}

/** Commit local changes, merge remote (local wins on conflicting lines), push. */
export function sync(home, device = os.hostname(), { allowUnrelated = false, timeout = 30000 } = {}) {
  const st = syncStatus(home);
  if (!st.git) return { ok: false, reason: 'git is not installed' };
  if (!st.configured) return { ok: false, reason: 'sync not configured — run `omnicontext sync --github` or `--remote <url>`' };
  const committed = commitAll(home, device);
  let pulled = false;
  if (git(home, ['fetch', '-q', 'origin'], { timeout, allowFail: true }) !== null) {
    const hasRemoteMain = git(home, ['rev-parse', '-q', '--verify', 'origin/main'], { allowFail: true });
    if (hasRemoteMain) {
      const before = git(home, ['rev-parse', 'HEAD'], { allowFail: true });
      const args = ['merge', '-q', '--no-edit', '-X', 'ours', 'origin/main'];
      if (allowUnrelated) args.push('--allow-unrelated-histories');
      if (git(home, args, { allowFail: true }) === null) {
        git(home, ['merge', '--abort'], { allowFail: true });
        return { ok: false, reason: 'merge failed; resolve manually in ' + home };
      }
      pulled = before !== git(home, ['rev-parse', 'HEAD'], { allowFail: true });
    }
  } else {
    return { ok: false, committed, reason: 'could not reach remote (offline?)' };
  }
  const pushed = git(home, ['push', '-q', '-u', 'origin', 'main'], { timeout, allowFail: true }) !== null;
  return { ok: pushed, committed, pulled, pushed, reason: pushed ? undefined : 'push failed' };
}

/** Only fetch + merge (fast path for session start). */
export function pull(home, { timeout = 8000 } = {}) {
  const st = syncStatus(home);
  if (!st.configured) return { ok: false };
  commitAll(home, os.hostname());
  if (git(home, ['fetch', '-q', 'origin'], { timeout, allowFail: true }) === null) return { ok: false, reason: 'offline' };
  if (!git(home, ['rev-parse', '-q', '--verify', 'origin/main'], { allowFail: true })) return { ok: true };
  const ok = git(home, ['merge', '-q', '--no-edit', '-X', 'ours', 'origin/main'], { allowFail: true }) !== null;
  if (!ok) git(home, ['merge', '--abort'], { allowFail: true });
  return { ok };
}

/** Create a private GitHub repo with the `gh` CLI and connect it. */
export function createGithubRemote(home, name = 'omnicontext-data', device) {
  const gh = (args) =>
    execFileSync('gh', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let login;
  try {
    login = gh(['api', 'user', '--jq', '.login']);
  } catch {
    throw new Error('GitHub CLI (gh) not found or not logged in. Install https://cli.github.com and run `gh auth login`.');
  }
  const full = `${login}/${name}`;
  try {
    gh(['repo', 'view', full, '--json', 'name']);
  } catch {
    gh(['repo', 'create', full, '--private', '--description', 'My OmniContext data (profile, projects, handoffs)']);
  }
  return initSync(home, `https://github.com/${full}.git`, device);
}
