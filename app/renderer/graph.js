// Obsidian-style force-directed graph of everything in memory, drawn on a canvas.
// window.GraphView.mount(canvas, { onSelect }) → { setData(graph), setHidden(types), search(q), focus(id), fit(), settle() }

(() => {
  const TYPE_ORDER = ['you', 'project', 'tag', 'topic', 'handoff', 'device', 'fact', 'inbox'];

  function palette() {
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    return {
      bg: v('--bg'),
      text: v('--text'),
      muted: v('--muted'),
      line: dark ? 'rgba(160,170,200,0.22)' : 'rgba(80,90,120,0.22)',
      lineHi: v('--accent'),
      type: {
        you: v('--accent'),
        project: v('--accent'),
        tag: v('--accent2'),
        topic: dark ? '#f0abfc' : '#c026d3',
        handoff: dark ? '#fbbf24' : '#d97706',
        device: dark ? '#94a3b8' : '#64748b',
        fact: dark ? '#86efac' : '#16a34a',
        inbox: dark ? '#fda4af' : '#e11d48',
      },
    };
  }

  function mount(canvas, { onSelect } = {}) {
    const ctx = canvas.getContext('2d');
    let nodes = [];
    let edges = [];
    let byId = new Map();
    let adj = new Map();
    let hidden = new Set();
    let view = { x: 0, y: 0, k: 1 };
    let alpha = 1;
    let hover = null;
    let selected = null;
    let matches = null;
    let drag = null;
    let raf = 0;
    let colors = palette();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { colors = palette(); kick(0); });

    const radius = (n) => (n.type === 'you' ? 9 : n.type === 'project' ? 5 + Math.sqrt(n.degree) * 2.2 : 3 + Math.sqrt(n.degree) * 1.2);
    const visible = (n) => !hidden.has(n.type) && !(n.type === 'handoff' && hidden.has('done') && n.status && n.status !== 'open');

    function setData(g) {
      const old = byId;
      nodes = g.nodes.map((n) => {
        const prev = old.get(n.id);
        const a = Math.random() * Math.PI * 2;
        const r = 40 + Math.random() * 200;
        return { ...n, x: prev?.x ?? Math.cos(a) * r, y: prev?.y ?? Math.sin(a) * r, vx: 0, vy: 0, fixed: n.type === 'you' && !prev };
      });
      byId = new Map(nodes.map((n) => [n.id, n]));
      edges = g.edges.map((e) => ({ s: byId.get(e.source), t: byId.get(e.target), kind: e.kind })).filter((e) => e.s && e.t);
      adj = new Map(nodes.map((n) => [n.id, new Set()]));
      for (const e of edges) { adj.get(e.s.id).add(e.t.id); adj.get(e.t.id).add(e.s.id); }
      const you = byId.get('you');
      if (you && !old.size) { you.x = 0; you.y = 0; }
      if (selected && !byId.has(selected.id)) selected = null;
      kick(old.size ? 0.3 : 1);
    }

    // ---- simulation -----------------------------------------------------
    function tick() {
      const vis = nodes.filter(visible);
      const n = vis.length;
      const repel = 1400;
      for (let i = 0; i < n; i++) {
        const a = vis[i];
        for (let j = i + 1; j < n; j++) {
          const b = vis[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.25; }
          if (d2 > 250000) continue;
          const f = (repel * alpha) / d2;
          const fx = dx * f, fy = dy * f;
          a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
        }
      }
      for (const e of edges) {
        if (!visible(e.s) || !visible(e.t)) continue;
        const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = e.kind === 'project' ? 110 : e.kind === 'fact' ? 60 : 50;
        // Like d3: weaker springs on hubs so they don't get yanked around.
        const k = 0.5 / Math.min(adj.get(e.s.id).size, adj.get(e.t.id).size);
        const f = ((d - rest) / d) * k * alpha;
        const fx = dx * f, fy = dy * f;
        e.t.vx -= fx; e.t.vy -= fy; e.s.vx += fx; e.s.vy += fy;
      }
      for (const a of vis) {
        a.vx -= a.x * 0.01 * alpha;
        a.vy -= a.y * 0.01 * alpha;
        if (a.fixed || a === drag?.node) { a.vx = a.vy = 0; continue; }
        a.vx *= 0.6; a.vy *= 0.6;
        a.x += a.vx; a.y += a.vy;
      }
      alpha = alpha * 0.99;
    }

    function kick(a = 0.5) {
      alpha = Math.max(alpha, a);
      if (!raf) {
        draw(); // right away too: rAF doesn't run while the window is hidden
        raf = requestAnimationFrame(frame);
      }
    }
    function frame() {
      raf = 0;
      if (alpha > 0.005) tick();
      draw();
      if (alpha > 0.005 || drag) raf = requestAnimationFrame(frame);
    }

    // ---- drawing --------------------------------------------------------
    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2 + view.x, h / 2 + view.y);
      ctx.scale(view.k, view.k);

      const focus = hover || selected;
      const near = focus ? adj.get(focus.id) : null;
      const lit = (n) => !focus || n === focus || near.has(n.id);
      const hit = (n) => !matches || matches.has(n.id);

      ctx.lineWidth = 1 / view.k;
      for (const e of edges) {
        if (!visible(e.s) || !visible(e.t)) continue;
        const on = focus && (e.s === focus || e.t === focus);
        ctx.strokeStyle = on ? colors.lineHi : colors.line;
        ctx.globalAlpha = focus && !on ? 0.25 : matches && !(hit(e.s) && hit(e.t)) ? 0.25 : 1;
        ctx.beginPath(); ctx.moveTo(e.s.x, e.s.y); ctx.lineTo(e.t.x, e.t.y); ctx.stroke();
      }

      for (const n of nodes) {
        if (!visible(n)) continue;
        const r = radius(n);
        const finished = n.type === 'handoff' && n.status !== 'open';
        ctx.globalAlpha = (lit(n) ? 1 : 0.18) * (hit(n) ? 1 : 0.2) * (finished ? 0.45 : 1);
        ctx.fillStyle = colors.type[n.type] || colors.muted;
        ctx.beginPath();
        if (n.type === 'tag') ctx.rect(n.x - r, n.y - r, r * 2, r * 2);
        else ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (n === selected || (matches && matches.has(n.id))) {
          ctx.strokeStyle = colors.text; ctx.lineWidth = 2 / view.k;
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 3 / view.k, 0, Math.PI * 2); ctx.stroke();
          ctx.lineWidth = 1 / view.k;
        }
      }

      // Labels: always for big nodes and the focused neighbourhood, otherwise once zoomed in (like Obsidian).
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const fontPx = 12 / view.k;
      ctx.font = `${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      for (const n of nodes) {
        if (!visible(n)) continue;
        const important = n.type === 'you' || n.type === 'project' || n.degree >= 4;
        const show = (focus ? lit(n) : true) && (important || view.k > 1.3 || !!focus || (matches && matches.has(n.id)));
        if (!show) continue;
        ctx.globalAlpha = (lit(n) ? 1 : 0.25) * (hit(n) ? 1 : 0.3) * (important || view.k > 1.6 || focus ? 1 : (view.k - 1.3) / 0.3);
        ctx.fillStyle = n.type === 'project' || n.type === 'you' ? colors.text : colors.muted;
        ctx.fillText(n.label, n.x, n.y + radius(n) + 3 / view.k);
      }
      ctx.globalAlpha = 1;
    }

    // ---- interaction ----------------------------------------------------
    const toWorld = (ev) => {
      const r = canvas.getBoundingClientRect();
      return { x: (ev.clientX - r.left - r.width / 2 - view.x) / view.k, y: (ev.clientY - r.top - r.height / 2 - view.y) / view.k };
    };
    const pick = (p) => {
      let best = null, bd = Infinity;
      for (const n of nodes) {
        if (!visible(n)) continue;
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        const r = radius(n) + 4 / view.k;
        if (d < r && d < bd) { best = n; bd = d; }
      }
      return best;
    };

    canvas.addEventListener('pointerdown', (ev) => {
      canvas.setPointerCapture(ev.pointerId);
      const p = toWorld(ev);
      const node = pick(p);
      drag = { node, sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved: false };
      if (node) kick(0.3);
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (drag) {
        if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 3) drag.moved = true;
        if (drag.node) {
          const p = toWorld(ev);
          drag.node.x = p.x; drag.node.y = p.y;
          kick(0.3);
        } else {
          view.x = drag.vx + ev.clientX - drag.sx;
          view.y = drag.vy + ev.clientY - drag.sy;
          kick(0);
        }
        return;
      }
      const n = pick(toWorld(ev));
      if (n !== hover) { hover = n; canvas.style.cursor = n ? 'pointer' : 'grab'; kick(0); }
    });
    canvas.addEventListener('pointerup', () => {
      if (drag && !drag.moved) select(drag.node);
      if (drag?.node && drag.moved && drag.node.type === 'you') drag.node.fixed = true;
      drag = null;
      kick(0);
    });
    canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; kick(0); } });
    canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = ev.clientX - r.left - r.width / 2, my = ev.clientY - r.top - r.height / 2;
      const k = Math.min(4, Math.max(0.2, view.k * Math.exp(-ev.deltaY * 0.0015)));
      view.x = mx - ((mx - view.x) * k) / view.k;
      view.y = my - ((my - view.y) * k) / view.k;
      view.k = k;
      kick(0);
    }, { passive: false });

    function select(n) {
      selected = n || null;
      onSelect?.(selected, selected ? [...adj.get(selected.id)].map((id) => byId.get(id)).filter(visible) : []);
      kick(0);
    }

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, canvas.clientWidth * dpr);
      canvas.height = Math.max(1, canvas.clientHeight * dpr);
      kick(0);
    }
    new ResizeObserver(resize).observe(canvas);

    return {
      setData,
      resize,
      setHidden(types) { hidden = new Set(types); kick(0.4); if (selected && !visible(selected)) select(null); },
      search(q) {
        q = q.trim().toLowerCase();
        matches = q ? new Set(nodes.filter((n) => visible(n) && n.label.toLowerCase().includes(q)).map((n) => n.id)) : null;
        kick(0);
        return matches ? matches.size : 0;
      },
      focus(id) {
        const n = byId.get(id);
        if (!n) return select(null);
        view.x = -n.x * view.k - Math.min(150, canvas.clientWidth / 6); // leave room for the details panel
        view.y = -n.y * view.k;
        select(n);
      },
      fit() {
        const vis = nodes.filter(visible);
        if (!vis.length) return;
        const xs = vis.map((n) => n.x), ys = vis.map((n) => n.y);
        const w = Math.max(...xs) - Math.min(...xs) + 80, h = Math.max(...ys) - Math.min(...ys) + 80;
        view.k = Math.min(2, Math.max(0.2, Math.min(canvas.clientWidth / w, canvas.clientHeight / h)));
        view.x = -((Math.max(...xs) + Math.min(...xs)) / 2) * view.k;
        view.y = -((Math.max(...ys) + Math.min(...ys)) / 2) * view.k;
        kick(0);
      },
      settle(steps = 600) { for (let i = 0; i < steps && alpha > 0.005; i++) tick(); kick(0); },
      TYPE_ORDER,
    };
  }

  window.GraphView = { mount };
})();
