// Builds the markdown briefing injected at the start of every Claude session.

const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n…(truncated; ${s.length - n} more chars — call get_profile)` : s);
const ago = (iso) => {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : `${Math.floor(d)}d ago`;
};

export function projectLine(p, device, current) {
  const bits = [`**${p.name}** (\`${p.slug}\`)`];
  if (p.aliases?.length) bits.push(`aka ${p.aliases.map((a) => `"${a}"`).join(', ')}`);
  if (p.tags?.length) bits.push(`[${p.tags.join(', ')}]`);
  if (p.status && p.status !== 'active') bits.push(`(${p.status})`);
  let line = `- ${bits.join(' ')}`;
  if (p.description) line += ` — ${p.description.split('\n')[0].slice(0, 160)}`;
  const here = p.paths?.[device];
  const elsewhere = Object.keys(p.paths || {}).filter((d) => d !== device);
  if (here) line += ` · here: \`${here}\``;
  else if (elsewhere.length) line += ` · on: ${elsewhere.join(', ')}`;
  if (current) line += ' ← **current directory**';
  return line;
}

export function handoffLine(h) {
  const next = h.nextSteps?.length ? ` Next: ${h.nextSteps.slice(0, 2).join('; ')}` : '';
  return `- \`${h.id}\` **${h.title}**${h.project ? ` (${h.project})` : ''} — from ${h.device}, ${ago(h.createdAt)}.${next}`;
}

export function buildContext(store, { cwd } = {}) {
  const device = store.device;
  const projects = store.listProjects();
  const current = store.projectForCwd(cwd);
  const open = store.listHandoffs({ status: 'open', limit: 5 });
  const profile = store.getProfile().replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();

  const out = [];
  out.push(`# OmniContext — what you know about this user (synced across their devices)`);
  out.push(`Device: ${device}. This is the user's own long-term memory, available in every Claude session.`);

  out.push(`\n## About the user\n${clip(profile, 4000) || '_(empty — learn about the user and call `remember`)_'}`);

  out.push(`\n## Their projects (${projects.length})`);
  if (projects.length) {
    out.push(
      'When the user mentions a project loosely ("my game project", "the website"), match it to this list. ' +
        'Use `resolve_project` / `get_project` for full details and notes.',
    );
    for (const p of projects.slice(0, 40)) out.push(projectLine(p, device, current && p.slug === current.slug));
    if (projects.length > 40) out.push(`- …and ${projects.length - 40} more (call \`list_projects\`)`);
  } else {
    out.push('_None yet. When the user works on something ongoing, offer to register it with `upsert_project`._');
  }

  if (current) {
    out.push(`\n## Current project: ${current.name}`);
    if (current.description) out.push(current.description);
    if (current.repo) out.push(`Repo: ${current.repo}`);
    const notes = (current.notes || []).slice(-8);
    if (notes.length) {
      out.push('Recent notes:');
      for (const n of notes) out.push(`- ${n.text} _(${n.device}, ${ago(n.at)})_`);
    }
  } else if (cwd && projects.length) {
    out.push(`\nThe current directory (\`${cwd}\`) isn't linked to a project. If it belongs to one above, ` +
      'call `upsert_project` with `path` to link it on this device.');
  }

  if (open.length) {
    out.push(`\n## Open handoffs (work that can be resumed)`);
    for (const h of open) out.push(handoffLine(h));
    out.push('If the user says "resume", "continue", or "pick up where I left off", call `resume_handoff`.');
  }

  out.push(
    `\n## Keeping this memory useful\n` +
      '- Durable fact about the user (preference, role, tool, goal) → `remember`.\n' +
      '- Decision or status on a project → `add_project_note`.\n' +
      '- Before stopping mid-task, or when asked to hand off → `save_handoff` with a summary and next steps, so any device can resume.\n' +
      "- Don't store secrets, passwords, or API keys.",
  );
  return out.join('\n');
}
