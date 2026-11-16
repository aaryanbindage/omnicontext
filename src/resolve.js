// Resolve vague references ("my game project", "the discord bot") to a stored project.

import path from 'node:path';

const STOP = new Set(
  'my the a an our this that those these project projects app apps thing stuff repo repository codebase code one ' +
    'with for of on in to at i im i\'m working work about called named new old side'.split(' '),
);

const stem = (t) => (t.length > 4 && t.endsWith('ies') ? t.slice(0, -3) + 'y' : t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);

export function tokens(s) {
  return String(s ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t))
    .map(stem);
}

export function scoreProject(p, query) {
  const q = String(query).toLowerCase().trim();
  const names = [p.name, p.slug, ...(p.aliases || [])].filter(Boolean).map((x) => String(x).toLowerCase());
  let score = 0;
  if (names.includes(q)) score += 100;
  for (const n of names) if (n.length > 2 && q.includes(n)) score += 40;

  const nameTok = tokens(names.join(' '));
  const tagTok = tokens((p.tags || []).join(' '));
  const descTok = tokens(p.description);
  const pathTok = tokens(Object.values(p.paths || {}).map((x) => path.basename(String(x))).join(' '));
  const noteTok = tokens((p.notes || []).slice(-10).map((n) => n.text).join(' '));

  for (const t of tokens(query)) {
    if (nameTok.includes(t)) score += 20;
    else if (t.length > 2 && nameTok.some((n) => n.length > 2 && (n.startsWith(t) || t.startsWith(n)))) score += 10;
    if (tagTok.includes(t)) score += 12;
    if (pathTok.includes(t)) score += 8;
    if (descTok.includes(t)) score += 5;
    if (noteTok.includes(t)) score += 2;
  }
  if (score > 0 && p.status === 'archived') score -= 5;
  return score;
}

export function resolveProjects(projects, query, limit = 5) {
  return projects
    .map((project) => ({ project, score: scoreProject(project, query) }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        String(b.project.lastActiveAt || '').localeCompare(String(a.project.lastActiveAt || '')),
    )
    .slice(0, limit);
}
