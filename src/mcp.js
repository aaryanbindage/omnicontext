// MCP server (stdio). Works in Claude Code, Claude Desktop, and any MCP client.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Store, VERSION, gitStateOf } from './store.js';
import { resolveProjects } from './resolve.js';
import { buildContext } from './context.js';
import { buildGraph, neighborhood } from './graph.js';
import { sync, syncStatus } from './sync.js';

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

/** Friendly name of the connected agent, from its MCP client info (or OMNICONTEXT_AGENT). */
export function agentName(clientName = '') {
  if (process.env.OMNICONTEXT_AGENT) return process.env.OMNICONTEXT_AGENT;
  const n = clientName.toLowerCase();
  const known = [
    ['claude-code', 'Claude Code'],
    ['claude', 'Claude'],
    ['codex', 'Codex'],
    ['chatgpt', 'ChatGPT'],
    ['openai', 'ChatGPT'],
    ['cursor', 'Cursor'],
    ['gemini', 'Gemini CLI'],
    ['windsurf', 'Windsurf'],
    ['vscode', 'VS Code'],
    ['visual studio code', 'VS Code'],
    ['zed', 'Zed'],
    ['goose', 'Goose'],
    ['cline', 'Cline'],
  ];
  return known.find(([k]) => n.includes(k))?.[1] || clientName;
}

/** How to get this device's checkout to where the handoff left off. */
function gitSection(h, device) {
  const g = h.git;
  if (!g) return '';
  const lines = [`\n## Git state on ${h.device}`, `Branch \`${g.branch}\` at \`${g.commit}\`${g.remote ? ` (${g.remote})` : ''}.`];
  if (g.unpushed) lines.push(`⚠ ${g.unpushed} commit(s) were not pushed from ${h.device}; they won't be on the remote.`);
  if (g.uncommitted?.length)
    lines.push(`⚠ Uncommitted changes on ${h.device} (not available here unless pushed): ${g.uncommitted.slice(0, 10).join(', ')}${g.uncommitted.length > 10 ? ', …' : ''}`);
  if (h.device !== device) lines.push(`To match it here: \`git fetch && git checkout ${g.branch} && git pull\`.`);
  return lines.join('\n') + '\n';
}

/** Build the OmniContext MCP server (any transport). `flush()` pushes a pending sync right away. */
export function createMcpServer(store = new Store(), { agent: defaultAgent = '' } = {}) {
  const server = new McpServer(
    { name: 'omnicontext', version: VERSION },
    {
      instructions:
        "OmniContext is the user's long-term memory, shared by every agent they use on every device. Call get_context at the start of a conversation (unless an OmniContext briefing is already in context), resolve loose project references against it, offer save_handoff before ending substantial work, and use remember / add_project_note for lasting facts. Never store secrets.",
    },
  );

  // Push writes to the sync remote shortly after they happen (debounced).
  let timer;
  const changed = () => {
    if (store.getLocal().autoSync === false) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        if (syncStatus(store.home).configured) sync(store.home, store.device);
      } catch {}
    }, 4000);
  };

  const guard = (fn) => async (args) => {
    try {
      return await fn(args);
    } catch (e) {
      return fail(String(e.message || e));
    }
  };

  server.registerTool(
    'get_context',
    {
      title: 'Get user context',
      description:
        "Briefing about the user: profile, all projects, open handoffs. Call at the start of a conversation (when it wasn't injected automatically) or when the user refers to something you don't recognise.",
      inputSchema: { cwd: z.string().optional().describe('Current working directory, to detect the active project') },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ cwd }) => text(buildContext(store, { cwd }))),
  );

  server.registerTool(
    'get_profile',
    {
      title: 'Get profile',
      description: "The user's full profile markdown (who they are, preferences, facts).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(async () => text(store.getProfile())),
  );

  server.registerTool(
    'remember',
    {
      title: 'Remember a fact about the user',
      description:
        'Save a durable fact about the user (role, preference, tool, goal, constraint) to their profile so every future session knows it. For project-specific info use add_project_note. Never store secrets.',
      inputSchema: { fact: z.string().min(3).describe('One concise fact, e.g. "Prefers TypeScript over JavaScript"') },
    },
    guard(async ({ fact }) => {
      const line = store.remember(fact);
      changed();
      return text(`Saved to profile: ${line}`);
    }),
  );

  server.registerTool(
    'forget',
    {
      title: 'Forget a fact',
      description: 'Remove profile facts (bullet lines) that contain the given text, e.g. when the user says something is no longer true.',
      inputSchema: { text: z.string().min(3).describe('Words from the fact to remove') },
      annotations: { destructiveHint: true },
    },
    guard(async ({ text: q }) => {
      const removed = store.forget(q);
      if (!removed.length) return fail(`No profile fact contains "${q}". Use get_profile to see the exact wording.`);
      changed();
      return text(`Removed ${removed.length} line(s):\n${removed.join('\n')}`);
    }),
  );

  server.registerTool(
    'update_profile',
    {
      title: 'Rewrite profile',
      description: 'Replace the whole profile markdown. Read it with get_profile first and keep existing facts unless the user asks to remove them.',
      inputSchema: { content: z.string().describe('Full new profile markdown') },
    },
    guard(async ({ content }) => {
      store.setProfile(content);
      changed();
      return text('Profile updated.');
    }),
  );

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: "All of the user's projects with aliases, tags, status and paths.",
      inputSchema: { status: z.string().optional().describe('Filter by status, e.g. active, paused, archived') },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ status }) => {
      const list = store.listProjects().filter((p) => !status || p.status === status);
      return text(list.map(({ notes, ...p }) => ({ ...p, noteCount: notes?.length || 0 })));
    }),
  );

  server.registerTool(
    'resolve_project',
    {
      title: 'Resolve a project reference',
      description:
        'Turn a loose reference like "my game project", "the bot", or "that website" into the matching project(s), best first, with full details and notes.',
      inputSchema: { query: z.string().describe('What the user called it') },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ query }) => {
      const hits = resolveProjects(store.listProjects(), query, 3);
      if (!hits.length) return text(`No project matches "${query}". Ask the user which project they mean, then register it with upsert_project.`);
      return text(hits.map((h) => ({ score: h.score, ...h.project })));
    }),
  );

  server.registerTool(
    'get_project',
    {
      title: 'Get project',
      description: 'Full details, notes, and recent handoffs for one project (by slug, name, or alias).',
      inputSchema: { project: z.string() },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ project }) => {
      const p = store.getProject(project) || resolveProjects(store.listProjects(), project, 1)[0]?.project;
      if (!p) return fail(`No project "${project}"`);
      return text({ ...p, handoffs: store.listHandoffs({ project: p.slug, limit: 5 }) });
    }),
  );

  server.registerTool(
    'upsert_project',
    {
      title: 'Create or update project',
      description:
        'Register a project or update it. Aliases are what the user calls it ("my game", "the rpg") — add them generously so future references resolve. Pass `path` to link a folder on this device.',
      inputSchema: {
        name: z.string().describe('Display name'),
        description: z.string().optional().describe('What it is, stack, goal — one or two sentences'),
        aliases: z.array(z.string()).optional().describe('Nicknames the user uses for it'),
        tags: z.array(z.string()).optional(),
        status: z.enum(['active', 'paused', 'done', 'archived']).optional(),
        repo: z.string().optional().describe('Git remote URL'),
        path: z.string().optional().describe('Absolute folder path on this device'),
      },
    },
    guard(async (args) => {
      const p = store.upsertProject(args);
      changed();
      return text({ saved: p.slug, project: p });
    }),
  );

  server.registerTool(
    'add_project_note',
    {
      title: 'Add project note',
      description: 'Record a decision, status update, or important detail on a project. Visible to all future sessions.',
      inputSchema: { project: z.string().describe('Slug, name, or alias'), note: z.string() },
    },
    guard(async ({ project, note }) => {
      const target = store.getProject(project) || resolveProjects(store.listProjects(), project, 1)[0]?.project;
      if (!target) return fail(`No project "${project}". Create it with upsert_project first.`);
      store.addProjectNote(target.slug, note);
      changed();
      return text(`Note added to ${target.name}.`);
    }),
  );

  server.registerTool(
    'save_handoff',
    {
      title: 'Save handoff',
      description:
        'Save the state of the current work so it can be resumed later in any session, by any agent (Claude, Codex, Cursor, …), on any device. Write it for a future assistant with no memory of this conversation: goal, what was done, key decisions, where things are, and concrete next steps.',
      inputSchema: {
        title: z.string().describe('Short title'),
        summary: z.string().describe('Self-contained summary of the work so far'),
        next_steps: z.array(z.string()).optional(),
        project: z.string().optional().describe('Project slug/name/alias this belongs to'),
        files: z.array(z.string()).optional().describe('Key files involved (paths relative to the project)'),
        cwd: z.string().optional(),
      },
    },
    guard(async ({ title, summary, next_steps, project, files, cwd }) => {
      const proj = project ? store.getProject(project) || resolveProjects(store.listProjects(), project, 1)[0]?.project : null;
      // Claude Code starts MCP servers in the project folder, so fall back to it to capture the git state.
      const dir = cwd || (gitStateOf(process.cwd()) ? process.cwd() : '');
      const clientName = server.server.getClientVersion()?.name;
      const agent = clientName ? agentName(clientName) : defaultAgent;
      const h = store.saveHandoff({ title, summary, nextSteps: next_steps, files, cwd: dir, project: proj?.slug || project, agent });
      changed();
      return text(`Handoff saved: ${h.id}. Resume on any device with "resume ${h.title}" or /omnicontext:resume.`);
    }),
  );

  server.registerTool(
    'list_handoffs',
    {
      title: 'List handoffs',
      description: 'Saved handoffs, newest first.',
      inputSchema: {
        project: z.string().optional(),
        status: z.enum(['open', 'resumed', 'done', 'all']).optional().describe('Default: open'),
        limit: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ project, status = 'open', limit = 10 }) => text(store.listHandoffs({ project, status, limit }))),
  );

  server.registerTool(
    'resume_handoff',
    {
      title: 'Resume handoff',
      description:
        'Load a handoff to continue that work here. Give an id, or a project / words from the title; with nothing it picks the most recent open handoff. Marks it resumed.',
      inputSchema: {
        id: z.string().optional(),
        query: z.string().optional().describe('Project name or words from the title'),
      },
    },
    guard(async ({ id, query }) => {
      let h = id ? store.getHandoff(id) : null;
      if (!h) {
        const open = store.listHandoffs({ status: 'open' });
        if (query) {
          const proj = resolveProjects(store.listProjects(), query, 1)[0]?.project;
          const q = query.toLowerCase();
          h = open.find((x) => proj && x.project === proj.slug) ||
            open.find((x) => `${x.title} ${x.summary}`.toLowerCase().includes(q));
        } else h = open[0];
      }
      if (!h) return fail('No matching open handoff. Use list_handoffs with status "all" to see older ones.');
      store.setHandoffStatus(h.id, 'resumed');
      changed();
      const proj = h.project ? store.getProject(h.project) : null;
      const localPath = proj?.paths?.[store.device];
      return text(
        `# Resuming: ${h.title}\nFrom ${h.device}${h.agent ? ` (${h.agent})` : ''} at ${h.createdAt}${proj ? ` · project ${proj.name}` : ''}\n` +
          (localPath ? `Project folder on this device: ${localPath}\n` : proj ? `Project folder isn't linked on this device yet.\n` : '') +
          gitSection(h, store.device) +
          `\n## Summary\n${h.summary}\n` +
          (h.nextSteps?.length ? `\n## Next steps\n${h.nextSteps.map((s) => `- ${s}`).join('\n')}\n` : '') +
          (h.files?.length ? `\n## Files\n${h.files.map((s) => `- ${s}`).join('\n')}\n` : ''),
      );
    }),
  );

  server.registerTool(
    'complete_handoff',
    {
      title: 'Complete handoff',
      description: 'Mark a handoff done once its work is finished.',
      inputSchema: { id: z.string() },
    },
    guard(async ({ id }) => {
      store.setHandoffStatus(id, 'done');
      changed();
      return text(`Handoff ${id} marked done.`);
    }),
  );

  server.registerTool(
    'search_memory',
    {
      title: 'Search memory',
      description: 'Full-text search across profile, project notes, and handoffs.',
      inputSchema: { query: z.string() },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ query }) => {
      const q = query.toLowerCase();
      const hits = [];
      for (const line of store.getProfile().split('\n')) if (line.toLowerCase().includes(q)) hits.push({ in: 'profile', text: line.trim() });
      for (const p of store.listProjects()) {
        if (`${p.name} ${p.description} ${(p.aliases || []).join(' ')}`.toLowerCase().includes(q))
          hits.push({ in: `project:${p.slug}`, text: p.description || p.name });
        for (const n of p.notes || []) if (n.text.toLowerCase().includes(q)) hits.push({ in: `project:${p.slug}`, text: n.text, at: n.at });
      }
      for (const h of store.listHandoffs({ status: 'all' }))
        if (`${h.title} ${h.summary} ${(h.nextSteps || []).join(' ')}`.toLowerCase().includes(q))
          hits.push({ in: `handoff:${h.id}`, text: h.title, status: h.status });
      for (const i of store.listInbox()) if (i.text.toLowerCase().includes(q)) hits.push({ in: `inbox:${i.id}`, text: i.text });
      return text(hits.length ? hits.slice(0, 30) : `Nothing found for "${query}".`);
    }),
  );

  server.registerTool(
    'related',
    {
      title: 'Find related things',
      description:
        'Walk the knowledge graph from a project, tag (e.g. "#godot"), device, or [[topic]]: returns linked projects, tags, handoffs, facts and inbox items. Use for "what else is connected to X" or "which of my projects use Y".',
      inputSchema: {
        query: z.string().describe('Project reference, #tag, device name, or topic'),
        depth: z.number().int().min(1).max(3).optional().describe('Hops to follow (default 1)'),
      },
      annotations: { readOnlyHint: true },
    },
    guard(async ({ query, depth = 1 }) => {
      const g = buildGraph(store);
      const q = query.trim().toLowerCase().replace(/^\[\[|\]\]$/g, '');
      let start = g.nodes.filter((n) => n.id !== 'you' && (n.label.toLowerCase() === q || n.label.toLowerCase() === `#${q}` || n.id.endsWith(`:${q}`)));
      if (!start.length) {
        const p = resolveProjects(store.listProjects(), query, 1)[0]?.project;
        if (p) start = g.nodes.filter((n) => n.id === `project:${p.slug}`);
      }
      if (!start.length) return fail(`Nothing in the graph matches "${query}".`);
      const hits = neighborhood(g, start.map((n) => n.id), depth);
      return text({
        from: start.map((n) => n.label),
        related: hits.map(({ id, type, label, distance, status }) => ({ type, label, id, distance, ...(status ? { status } : {}) })),
      });
    }),
  );

  server.registerTool(
    'capture',
    {
      title: 'Capture to inbox',
      description:
        "Drop a quick thought into the user's inbox to sort out later (all devices see it). Prefer remember / add_project_note when you already know where it belongs.",
      inputSchema: {
        text: z.string().min(1),
        project: z.string().optional().describe('Project it probably relates to'),
      },
    },
    guard(async ({ text: t, project }) => {
      const item = store.capture(t, { project });
      changed();
      return text(`Captured ${item.id}.`);
    }),
  );

  server.registerTool(
    'list_inbox',
    {
      title: 'List inbox',
      description: 'Quick captures (for example dictated on the Apple Watch app) waiting to be filed.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guard(async () => {
      const items = store.listInbox();
      return text(items.length ? items : 'Inbox is empty.');
    }),
  );

  server.registerTool(
    'file_inbox',
    {
      title: 'File inbox item',
      description:
        'Move an inbox item into memory: as a profile fact, as a note on a project, or dismiss it. You may pass cleaned-up `text` (dictations are often rough).',
      inputSchema: {
        id: z.string(),
        as: z.enum(['fact', 'note', 'dismiss']),
        project: z.string().optional().describe('Required when as=note, unless the item already names a project'),
        text: z.string().optional().describe('Rewritten wording to store instead of the raw capture'),
      },
    },
    guard(async ({ id, as, project, text: t }) => {
      const target = project ? store.getProject(project) || resolveProjects(store.listProjects(), project, 1)[0]?.project : null;
      const r = store.fileInbox(id, { as, project: target?.slug || project, text: t });
      changed();
      return text(as === 'dismiss' ? `Dismissed ${id}.` : `Filed ${id} as ${as}${as === 'note' ? ` on ${r.result}` : ''}.`);
    }),
  );

  // Read-only resources, for clients that browse MCP resources.
  server.registerResource(
    'profile',
    'omnicontext://profile',
    { title: 'Profile', description: "The user's profile", mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: store.getProfile() }] }),
  );
  server.registerResource(
    'briefing',
    'omnicontext://context',
    { title: 'Briefing', description: 'The full session briefing', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: buildContext(store) }] }),
  );
  server.registerResource(
    'project',
    new ResourceTemplate('omnicontext://projects/{slug}', {
      list: async () => ({
        resources: store.listProjects().map((p) => ({ uri: `omnicontext://projects/${p.slug}`, name: p.name, mimeType: 'application/json' })),
      }),
    }),
    { title: 'Project', description: 'One project with notes', mimeType: 'application/json' },
    async (uri, { slug }) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(store.getProject(String(slug)), null, 2) }],
    }),
  );

  server.registerTool(
    'sync_now',
    {
      title: 'Sync now',
      description: 'Push/pull memory to the user\'s sync remote so other devices see it.',
      inputSchema: {},
    },
    guard(async () => text(sync(store.home, store.device))),
  );

  server.registerPrompt(
    'resume',
    { title: 'Resume my last work', description: 'Continue the most recent open handoff from any device.' },
    () => ({
      messages: [{ role: 'user', content: { type: 'text', text: 'Call resume_handoff and continue that work. Start by briefly restating where things stand.' } }],
    }),
  );
  server.registerPrompt(
    'handoff',
    { title: 'Save a handoff', description: 'Save the current work so it can be resumed on another device.' },
    () => ({
      messages: [{ role: 'user', content: { type: 'text', text: 'Summarise what we are working on and call save_handoff with a self-contained summary, the project, key files, and concrete next steps.' } }],
    }),
  );

  const flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    try {
      if (syncStatus(store.home).configured) sync(store.home, store.device);
    } catch {}
  };
  return { server, flush };
}

export async function startMcpServer(store = new Store()) {
  const { server, flush } = createMcpServer(store);
  await server.connect(new StdioServerTransport());
  // Flush any pending sync before exit.
  const exit = () => {
    flush();
    process.exit(0);
  };
  process.stdin.on('close', exit);
  process.on('SIGTERM', exit);
}
