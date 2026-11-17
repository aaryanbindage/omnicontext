const call = (m, ...a) => window.omni.call(m, ...a);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const csv = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const when = (iso) => (iso ? new Date(iso).toLocaleString() : '');

let info = null;
let projects = [];
let current = null;

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = err ? 'err' : '';
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), err ? 7000 : 2500);
}
async function act(fn, ok) {
  try {
    const r = await fn();
    if (ok) toast(typeof ok === 'function' ? ok(r) : ok);
    return r;
  } catch (e) {
    toast(String(e.message || e).replace(/^Error invoking remote method 'omni': (Error: )?/, ''), true);
  }
}

// ---- tabs ---------------------------------------------------------------
document.querySelectorAll('nav button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('nav button, .tab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $('#' + b.dataset.tab).classList.add('active');
    refresh(b.dataset.tab);
  }),
);
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-url]');
  if (a) { e.preventDefault(); call('openUrl', a.dataset.url); }
});

// ---- profile ------------------------------------------------------------
$('#saveProfile').onclick = () => act(() => call('setProfile', $('#profileText').value), 'Profile saved');
$('#addFact').onclick = async () => {
  const f = $('#factInput').value.trim();
  if (!f) return;
  await act(() => call('remember', f), 'Fact added');
  $('#factInput').value = '';
  $('#profileText').value = await call('getProfile');
};

// ---- projects -----------------------------------------------------------
function renderProjectList() {
  $('#projectList').innerHTML = projects
    .map((p) => `<li data-slug="${esc(p.slug)}" class="${current?.slug === p.slug ? 'active' : ''}">${esc(p.name)}${p.status !== 'active' ? `<span class="pill">${esc(p.status)}</span>` : ''}<small>${esc((p.aliases || []).join(', ') || p.description || '')}</small></li>`)
    .join('') || '<li class="muted">No projects yet</li>';
}
function showProject(p) {
  current = p;
  renderProjectList();
  $('#projectEmpty').hidden = !!p;
  $('#projectFields').hidden = !p;
  if (!p) return;
  const f = $('#projectForm');
  f.name.value = p.name || '';
  f.aliases.value = (p.aliases || []).join(', ');
  f.description.value = p.description || '';
  f.tags.value = (p.tags || []).join(', ');
  f.status.value = p.status || 'active';
  f.repo.value = p.repo || '';
  f.path.value = p.paths?.[info.device] || '';
  const others = Object.entries(p.paths || {}).filter(([d]) => d !== info.device);
  $('#otherPaths').textContent = others.length ? 'Elsewhere: ' + others.map(([d, x]) => `${d}: ${x}`).join(' · ') : '';
  $('#notes').innerHTML = [...(p.notes || [])].reverse().map((n) => `<li>${esc(n.text)}<br><small>${esc(n.device)} · ${esc(when(n.at))}</small></li>`).join('');
  $('#deleteProject').hidden = !p.slug;
}
$('#projectList').onclick = (e) => {
  const li = e.target.closest('li[data-slug]');
  if (li) showProject(projects.find((p) => p.slug === li.dataset.slug));
};
$('#newProject').onclick = () => { showProject({ name: '', status: 'active' }); $('#projectForm').name.focus(); };
$('#browse').onclick = async () => {
  const dir = await call('pickFolder');
  if (dir) $('#projectForm').path.value = dir;
};
$('#projectForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const input = {
    name: f.name.value.trim(),
    aliases: csv(f.aliases.value),
    tags: csv(f.tags.value),
    description: f.description.value.trim(),
    status: f.status.value,
    repo: f.repo.value.trim(),
  };
  if (current?.slug) input.slug = current.slug;
  if (f.path.value.trim()) input.path = f.path.value.trim();
  const p = await act(() => call('upsertProject', input), 'Project saved');
  if (p) { await loadProjects(); showProject(projects.find((x) => x.slug === p.slug)); }
};
$('#addNote').onclick = async () => {
  const t = $('#noteInput').value.trim();
  if (!t || !current?.slug) return toast('Save the project first', true);
  await act(() => call('addNote', current.slug, t));
  $('#noteInput').value = '';
  await loadProjects();
  showProject(projects.find((x) => x.slug === current.slug));
};
$('#deleteProject').onclick = async () => {
  if (!current?.slug || !confirm(`Delete "${current.name}"? Its notes are removed on all devices after sync.`)) return;
  await act(() => call('deleteProject', current.slug), 'Deleted');
  await loadProjects();
  showProject(null);
};
async function loadProjects() { projects = await call('listProjects'); renderProjectList(); }

// ---- handoffs -----------------------------------------------------------
async function loadHandoffs() {
  const list = await call('listHandoffs', $('#handoffFilter').value);
  $('#handoffList').innerHTML = list.map((h) => `
    <div class="card" data-id="${esc(h.id)}">
      <h3>${esc(h.title)} <span class="pill">${esc(h.status)}</span></h3>
      <p class="muted">${esc(h.project || 'no project')} · from ${esc(h.device)} · ${esc(when(h.createdAt))}</p>
      <pre>${esc(h.summary)}${h.nextSteps?.length ? '\n\nNext:\n' + h.nextSteps.map((s) => '• ' + esc(s)).join('\n') : ''}</pre>
      <div class="row">
        <button data-act="copy">Copy resume prompt</button>
        ${h.status !== 'done' ? '<button data-act="done">Mark done</button>' : '<button data-act="open">Reopen</button>'}
        <span class="grow"></span><button data-act="del" class="danger">Delete</button>
      </div>
    </div>`).join('') || '<p class="muted">Nothing here. In Claude Code run <code>/omnicontext:handoff</code> to save one.</p>';
}
$('#handoffFilter').onchange = loadHandoffs;
$('#handoffList').onclick = async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('[data-id]').dataset.id;
  const a = btn.dataset.act;
  if (a === 'copy') await act(() => call('copy', `Resume my OmniContext handoff ${id} (use resume_handoff) and continue the work.`), 'Copied — paste into any Claude session');
  if (a === 'done') await act(() => call('setHandoffStatus', id, 'done'));
  if (a === 'open') await act(() => call('setHandoffStatus', id, 'open'));
  if (a === 'del' && confirm('Delete this handoff?')) await act(() => call('deleteHandoff', id));
  loadHandoffs();
};

// ---- graph --------------------------------------------------------------
const TYPE_LABEL = { project: 'Projects', tag: 'Tags', topic: 'Topics', handoff: 'Handoffs', device: 'Devices', fact: 'Facts', inbox: 'Inbox', done: 'Finished handoffs' };
const dot = (t) => `<i class="dot-${t}"></i>`;
let graphView = null;
let graphHidden = new Set(JSON.parse(localStorage.getItem('graphHidden') || '["done"]'));
let graphFirst = true;

function graphPanel(n, neighbours) {
  const panel = $('#graphPanel');
  panel.hidden = !n;
  if (!n) return;
  const groups = {};
  for (const x of neighbours) (groups[x.type] ||= []).push(x);
  panel.innerHTML = `<button class="close" title="Close">×</button>
    <div class="type">${esc(n.type === 'you' ? 'profile' : n.type)}${n.status && n.type !== 'project' ? ' · ' + esc(n.status) : ''}</div>
    <h3>${esc(n.label)}</h3>
    ${n.detail && n.type !== 'you' ? `<p>${esc(n.detail)}</p>` : ''}
    ${n.notes?.length ? `<p class="muted">${n.notes.slice(-3).map(esc).join('\n')}</p>` : ''}
    ${n.type === 'project' ? '<div class="row"><button data-open-project>Open project</button></div>' : ''}
    ${Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([t, xs]) =>
      `<div class="type group">${esc(TYPE_LABEL[t] || t)} (${xs.length})</div><ul>${xs.map((x) => `<li data-node="${esc(x.id)}">${dot(x.type)}${esc(x.label)}</li>`).join('')}</ul>`).join('')}`;
  panel.querySelector('.close').onclick = () => graphView.focus(null) || (panel.hidden = true);
  panel.querySelector('[data-open-project]')?.addEventListener('click', async () => {
    document.querySelector('nav button[data-tab="projects"]').click();
    await loadProjects();
    showProject(projects.find((p) => p.slug === n.slug));
  });
  panel.querySelectorAll('[data-node]').forEach((li) => (li.onclick = () => graphView.focus(li.dataset.node)));
}

function renderGraphFilters() {
  $('#graphFilters').innerHTML = Object.entries(TYPE_LABEL).map(([t, label]) =>
    `<span class="chip ${graphHidden.has(t) ? 'off' : ''}" data-type="${t}">${t === 'done' ? '' : dot(t)}${label}</span>`).join('');
}
$('#graphFilters').onclick = (e) => {
  const chip = e.target.closest('[data-type]');
  if (!chip) return;
  const t = chip.dataset.type;
  graphHidden.has(t) ? graphHidden.delete(t) : graphHidden.add(t);
  localStorage.setItem('graphHidden', JSON.stringify([...graphHidden]));
  renderGraphFilters();
  graphView.setHidden([...graphHidden]);
};
$('#graphSearch').oninput = (e) => graphView.search(e.target.value);
$('#graphSearch').onkeydown = (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim().toLowerCase();
  const hit = lastGraph?.nodes.find((n) => n.label.toLowerCase().includes(q));
  if (hit) graphView.focus(hit.id);
};
$('#graphFit').onclick = () => graphView.fit();
let lastGraph = null;

async function loadGraph() {
  if (!graphView) {
    graphView = window.GraphView.mount($('#graphCanvas'), { onSelect: graphPanel });
    renderGraphFilters();
    graphView.setHidden([...graphHidden]);
  }
  const g = await call('graph');
  const sig = JSON.stringify([g.nodes.map((n) => n.id + n.label + (n.status || '')), g.edges.length]);
  if (sig === lastGraph?.sig) return;
  lastGraph = { ...g, sig };
  $('#graphEmpty').hidden = g.nodes.length > 1;
  graphView.setData(g);
  if (graphFirst) {
    graphFirst = false;
    graphView.settle();
    graphView.fit();
  }
}

// ---- inbox --------------------------------------------------------------
async function loadInbox() {
  const [items, all] = await Promise.all([call('listInbox'), call('listProjects')]);
  projects = all;
  const opts = '<option value="">Project…</option>' + all.map((p) => `<option value="${esc(p.slug)}">${esc(p.name)}</option>`).join('');
  $('#inboxList').innerHTML = items.map((i) => `
    <div class="card" data-id="${esc(i.id)}">
      <textarea rows="2">${esc(i.text)}</textarea>
      <p class="muted">from ${esc(i.source)} · ${esc(when(i.createdAt))}</p>
      <div class="row">
        <button data-act="fact">Save as fact</button>
        <select>${opts.replace(`value="${esc(i.project)}"`, `value="${esc(i.project)}" selected`)}</select>
        <button data-act="note">Add as note</button>
        <span class="grow"></span><button data-act="dismiss" class="danger">Dismiss</button>
      </div>
    </div>`).join('') || '<p class="muted">Inbox is empty.</p>';
}
$('#inboxList').onclick = async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('[data-id]');
  const as = btn.dataset.act;
  const project = card.querySelector('select').value;
  if (as === 'note' && !project) return toast('Pick a project first', true);
  await act(() => call('fileInbox', card.dataset.id, { as, project, text: card.querySelector('textarea').value.trim() }),
    as === 'dismiss' ? 'Dismissed' : as === 'fact' ? 'Saved to profile' : 'Note added');
  refresh('inbox');
};
$('#captureBtn').onclick = async () => {
  const t = $('#captureInput').value.trim();
  if (!t) return;
  await act(() => call('capture', t), 'Captured');
  $('#captureInput').value = '';
  refresh('inbox');
};

// ---- sync ---------------------------------------------------------------
function renderSync() {
  const s = info.sync;
  $('#syncBadge').textContent = s.configured ? `Synced via git${s.last ? ` · ${new Date(s.last.at).toLocaleTimeString()}${s.last.ok ? '' : ' ⚠'}` : ''}` : 'Sync not set up';
  $('#syncStatus').textContent = !s.git
    ? 'git is not installed — install git to enable sync.'
    : s.configured
      ? `Remote: ${s.remote}\nLast commit: ${s.lastCommit || '—'}\nLocal changes pending: ${s.dirty ? 'yes' : 'no'}${s.last ? `\nLast sync: ${new Date(s.last.at).toLocaleString()} — ${s.last.ok ? 'ok' : s.last.reason}` : ''}`
      : 'Not configured. Set it up below on each device.';
  $('#deviceName').value = info.device;
  $('#openData').textContent = info.home;
  $('#autoSync').checked = info.local.autoSync !== false;
  $('#syncMinutes').value = info.local.syncMinutes || 5;
  $('#cdPath').textContent = info.claudeDesktopConfig;
}
const syncMsg = (r) => (r.ok ? 'Synced' : `Not synced: ${r.reason}`);
$('#syncNow').onclick = async () => { await act(() => call('syncNow'), syncMsg); refresh('sync'); };
$('#saveDevice').onclick = async () => { await act(() => call('setDevice', $('#deviceName').value.trim()), 'Device renamed'); refresh('sync'); };
$('#autoSync').onchange = (e) => act(() => call('setLocal', { autoSync: e.target.checked }));
$('#syncMinutes').onchange = (e) => act(() => call('setLocal', { syncMinutes: Number(e.target.value) || 5 }), 'Applies after restart');
$('#openData').onclick = (e) => { e.preventDefault(); call('openData'); };
$('#exportBtn').onclick = () => act(() => call('exportAll'), (f) => (f ? `Exported to ${f}` : 'Cancelled'));
$('#importBtn').onclick = () => act(() => call('importAll'), (r) => (r ? `Imported ${r.projects} projects, ${r.handoffs} handoffs` : 'Cancelled'));
$('#ghCreate').onclick = async () => { await act(() => call('connectGithub', $('#ghName').value.trim()), syncMsg); refresh('sync'); };
$('#connectRemote').onclick = async () => {
  const url = $('#remoteUrl').value.trim();
  if (!url) return;
  await act(() => call('connectRemote', url), syncMsg);
  refresh('sync');
};
window.addEventListener('focus', () => refresh());

// ---- connect ------------------------------------------------------------
$('#installCode').onclick = () => act(() => call('installCode'), 'Claude Code plugin installed — start a new session');
$('#installDesktop').onclick = () => act(() => call('installDesktop', 'app'), (f) => `Added to ${f}\nRestart Claude Desktop.`);
$('#installDesktopNpx').onclick = () => act(() => call('installDesktop', 'npx'), (f) => `Added to ${f}\nRestart Claude Desktop.`);
$('#installCodex').onclick = () => act(() => call('installCodex'), (f) => `Updated ${f.join(' and ')}\nRestart Codex.`);
$('#installCursor').onclick = () => act(() => call('installCursor'), (f) => `Updated ${f.join(', ')}\nRestart Cursor.`);
$('#installGemini').onclick = () => act(() => call('installGemini'), (f) => `Updated ${f.join(' and ')}\nRestart Gemini CLI.`);
$('#copyCfg').onclick = () => act(() => call('copy', $('#genericCfg').textContent), 'Copied');

// ---- refresh ------------------------------------------------------------
async function refresh(tab = document.querySelector('nav button.active').dataset.tab) {
  info = await call('info');
  renderSync();
  const n = (await call('listInbox')).length;
  $('#inboxCount').hidden = !n;
  $('#inboxCount').textContent = n;
  if (tab === 'inbox') loadInbox();
  if (tab === 'graph') loadGraph();
  if (tab === 'profile' && document.activeElement !== $('#profileText')) $('#profileText').value = await call('getProfile');
  if (tab === 'projects') { await loadProjects(); if (current?.slug) showProject(projects.find((p) => p.slug === current.slug) || null); }
  if (tab === 'handoffs') loadHandoffs();
  if (tab === 'preview') $('#contextPreview').textContent = await call('context');
}
refresh('profile');
