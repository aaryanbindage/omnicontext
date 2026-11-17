// Knowledge graph over everything in memory, Obsidian-style: you, your projects, their tags,
// devices, handoffs, inbox items and profile facts, linked by structure and by mentions.
// A project named in any text (or written as [[Name]]) links to it; an unknown [[Topic]] becomes a topic node.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mentionFinder(projects) {
  const terms = [];
  for (const p of projects) {
    for (const t of [p.name, p.slug, ...(p.aliases || [])]) {
      const term = String(t || '').trim();
      if (term.length >= 3 && /[a-z]/i.test(term)) terms.push({ term: term.toLowerCase(), slug: p.slug });
    }
  }
  // Longest first so "my game engine" wins over "game".
  terms.sort((a, b) => b.term.length - a.term.length);
  const re = terms.length ? new RegExp(`(?<![\\w-])(${terms.map((t) => esc(t.term)).join('|')})(?![\\w-])`, 'gi') : null;
  const bySlug = new Map(terms.map((t) => [t.term, t.slug]));
  return (text) => {
    const found = new Set();
    const topics = new Set();
    const s = String(text || '');
    for (const m of s.matchAll(/\[\[([^\]|#]{1,80})(?:[|#][^\]]*)?\]\]/g)) {
      const name = m[1].trim();
      const slug = bySlug.get(name.toLowerCase());
      if (slug) found.add(slug);
      else topics.add(name);
    }
    if (re) for (const m of s.matchAll(re)) found.add(bySlug.get(m[1].toLowerCase()));
    return { projects: found, topics };
  };
}

export function buildGraph(store) {
  const nodes = new Map();
  const edges = new Map();
  const node = (id, type, label, extra = {}) => {
    if (!nodes.has(id)) nodes.set(id, { id, type, label, ...extra });
    return id;
  };
  const link = (a, b, kind) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!edges.has(key)) edges.set(key, { source: a, target: b, kind });
  };

  const projects = store.listProjects();
  const find = mentionFinder(projects);
  const mentions = (from, text) => {
    const { projects: ps, topics } = find(text);
    for (const slug of ps) link(from, `project:${slug}`, 'mentions');
    for (const t of topics) link(from, node(`topic:${t.toLowerCase()}`, 'topic', t), 'mentions');
  };

  const you = node('you', 'you', 'You', { detail: store.getProfile().replace(/<!--[\s\S]*?-->/g, '').trim() });

  // Profile facts: bullet lines.
  let i = 0;
  for (const line of store.getProfile().split('\n')) {
    const m = line.match(/^\s*[-*]\s+(.+)/);
    if (!m) continue;
    const text = m[1].replace(/\s*_\(\d{4}-\d\d-\d\d\)_\s*$/, '');
    const id = node(`fact:${i++}`, 'fact', text.length > 48 ? text.slice(0, 46) + '…' : text, { detail: text });
    link(you, id, 'fact');
    mentions(id, text);
  }

  for (const p of projects) {
    const id = node(`project:${p.slug}`, 'project', p.name, {
      slug: p.slug,
      status: p.status || 'active',
      detail: [p.description, p.aliases?.length ? `Aka: ${p.aliases.join(', ')}` : '', p.repo ? `Repo: ${p.repo}` : '']
        .filter(Boolean)
        .join('\n'),
      notes: (p.notes || []).slice(-8).map((n) => n.text),
    });
    link(you, id, 'project');
    for (const t of p.tags || []) link(id, node(`tag:${t.toLowerCase()}`, 'tag', `#${t}`), 'tag');
    for (const d of Object.keys(p.paths || {})) link(id, node(`device:${d}`, 'device', d), 'device');
    mentions(id, [p.description, ...(p.notes || []).map((n) => n.text)].join('\n'));
  }

  for (const h of store.listHandoffs({ status: 'all' })) {
    const id = node(`handoff:${h.id}`, 'handoff', h.title, {
      status: h.status,
      detail: [h.summary, h.nextSteps?.length ? `Next: ${h.nextSteps.join('; ')}` : ''].filter(Boolean).join('\n\n'),
    });
    if (h.project && nodes.has(`project:${h.project}`)) link(id, `project:${h.project}`, 'handoff');
    else link(id, you, 'handoff');
    if (h.device) link(id, node(`device:${h.device}`, 'device', h.device), 'device');
    mentions(id, `${h.title}\n${h.summary}\n${(h.nextSteps || []).join('\n')}`);
  }

  for (const it of store.listInbox()) {
    const id = node(`inbox:${it.id}`, 'inbox', it.text.length > 40 ? it.text.slice(0, 38) + '…' : it.text, { detail: it.text });
    const target = it.project && nodes.has(`project:${it.project}`) ? `project:${it.project}` : you;
    link(id, target, 'inbox');
    mentions(id, it.text);
  }

  const list = [...nodes.values()];
  const degree = new Map(list.map((n) => [n.id, 0]));
  for (const e of edges.values()) {
    degree.set(e.source, degree.get(e.source) + 1);
    degree.set(e.target, degree.get(e.target) + 1);
  }
  for (const n of list) n.degree = degree.get(n.id);
  return { nodes: list, edges: [...edges.values()] };
}

/** Everything one hop (or `depth` hops) from the nodes matching `query`, for the `related` tool. */
export function neighborhood(graph, startIds, depth = 1) {
  const adj = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) {
    adj.get(e.source).push({ id: e.target, kind: e.kind });
    adj.get(e.target).push({ id: e.source, kind: e.kind });
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const seen = new Map(startIds.map((id) => [id, 0]));
  let frontier = [...startIds];
  for (let d = 1; d <= depth; d++) {
    const next = [];
    for (const id of frontier) for (const { id: nb } of adj.get(id) || []) if (!seen.has(nb)) { seen.set(nb, d); next.push(nb); }
    frontier = next;
  }
  return [...seen.entries()]
    .filter(([id, d]) => d > 0 && id !== 'you')
    .map(([id, d]) => ({ ...byId.get(id), distance: d }))
    .sort((a, b) => a.distance - b.distance || b.degree - a.degree);
}
