/**
 * app.js: the Visualizer page and everything shared between pages.
 *
 * What is in here, top to bottom:
 *   1. small helpers
 *   2. colours for the figure
 *   3. the figure: layout, drawing, pan and zoom, gliding between steps
 *   4. stepping through a recorded operation (slider, play, narration, steps list)
 *   5. insert / delete / search, examples, history
 *   6. pages, Day and Night mode, sound, keyboard
 *   7. figure export (SVG, PNG, text) and the figures on the Learn page
 *
 * The other scripts (practice, quiz, exam, learn, team, report, tests) load after this file and use
 * window.BTreeUI. report.js listens to what happens here through BTreeUI.on().
 * The tree itself lives in btree-engine.js; this file only draws and drives it.
 */
(function () {
  'use strict';

  // ======================================================================
  // 1. Helpers
  // ======================================================================
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // localStorage that never throws (it can be blocked in private windows)
  const store = {
    get(k) { try { return localStorage.getItem('btree.' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('btree.' + k, v); } catch (e) { /* ignore */ } }
  };

  const engine = new BTreeEngine(4);

  // A tiny event bus. The report records what the person does by listening here.
  const listeners = [];
  function emit(ev) {
    ev.at = new Date();
    listeners.forEach((fn) => { try { fn(ev); } catch (err) { /* a listener must never break the page */ } });
  }

  // ======================================================================
  // 2. Colours
  // ======================================================================
  // The figure is drawn with plain attributes (no CSS), so a saved SVG or PNG looks the same
  // as it does on screen. On screen the colours come from the CSS tokens; for exports
  // there are three fixed sets.
  const FONT_BOOK = 'STIX Two Text, Times New Roman, Times, serif';
  const FONT_UI = 'Atkinson Hyperlegible, Segoe UI, system-ui, Arial, sans-serif';
  // trailFill / trailLine colour the nodes already walked through on the way down (the live figure only)
  const FIXED_PALETTES = {
    paper: {
      bg: '#ffffff', grid1: '#e6eef5', grid2: '#d3e0ec', ink: '#1c2738', ink2: '#4b586b', nodeFill: '#ffffff',
      cellLine: '#aebacb', link: '#1c2738', markNode: '#fff6bf', markKey: '#ffe55c', markText: '#1c2738', select: '#1f4e8c',
      trailFill: '#e8f0fa', trailLine: '#1f4e8c',
      kinds: { info: '#4b586b', search: '#1f4e8c', ok: '#1b7544', fix: '#8f5300', del: '#b1342b' }
    },
    plain: {
      bg: '#ffffff', grid1: '#eceff3', grid2: '#d9dee5', ink: '#000000', ink2: '#333333', nodeFill: '#ffffff',
      cellLine: '#777777', link: '#000000', markNode: '#ececec', markKey: '#c8c8c8', markText: '#000000', select: '#000000',
      trailFill: '#f4f4f4', trailLine: '#000000',
      kinds: { info: '#000000', search: '#000000', ok: '#000000', fix: '#000000', del: '#000000' }
    },
    night: {
      bg: '#171e27', grid1: '#1d2631', grid2: '#28323f', ink: '#e7ecf3', ink2: '#aab5c5', nodeFill: '#1f2833',
      cellLine: '#435064', link: '#aab5c5', markNode: '#3d3612', markKey: '#6e5f12', markText: '#fff3b8', select: '#8db8f2',
      trailFill: '#1b2a3f', trailLine: '#8db8f2',
      kinds: { info: '#aab5c5', search: '#8db8f2', ok: '#73d09b', fix: '#f0b65c', del: '#ff9488' }
    }
  };

  function readThemePalette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      bg: v('--sheet'), grid1: v('--grid-minor'), grid2: v('--grid-major'), ink: v('--ink'), ink2: v('--ink-2'),
      nodeFill: dark ? '#1f2833' : v('--sheet'), cellLine: v('--rule-strong'), link: dark ? v('--ink-2') : v('--ink'),
      markNode: v('--mark-wash'), markKey: v('--mark-key'), markText: v('--mark-ink'), select: v('--blue'),
      trailFill: v('--blue-wash'), trailLine: v('--blue'),
      kinds: { info: v('--ink-2'), search: v('--blue'), ok: v('--green'), fix: v('--amber'), del: v('--red') }
    };
  }

  // What kind of step is this? Decides the colour and the label.
  const KIND_OF_ACTION = { info: 'info', search: 'search', insert: 'ok', found: 'ok', split: 'fix', borrow: 'fix', merge: 'fix', shrink: 'fix', delete: 'del', error: 'del' };
  function kindOf(f) {
    if (f.detail === 'descend') return 'search';
    return KIND_OF_ACTION[f.actionType] || 'info';
  }
  const LABEL_OF_DETAIL = {
    'first-key': 'Insert', 'leaf-insert': 'Insert', 'split-overflow': 'Split', 'split-promote': 'Split', 'root-split': 'Split',
    located: 'Delete', predecessor: 'Delete', 'leaf-remove': 'Delete', 'rotate-left': 'Borrow', 'rotate-right': 'Borrow',
    'merge-left': 'Merge', 'merge-right': 'Merge', 'root-shrink': 'Shrink', found: 'Found', 'not-found': 'Not found',
    duplicate: 'Already in the tree', missing: 'Not in the tree', empty: 'Empty tree', cleared: 'Note', emptied: 'Note', restored: 'Undo and redo'
  };
  function labelFor(f, group) {
    if (f.detail === 'descend') return group && group.op === 'search' ? 'Search' : 'Walk down';
    return LABEL_OF_DETAIL[f.detail] || 'Note';
  }

  // ======================================================================
  // 3. The figure
  // ======================================================================
  const CELL_H = 38;       // height of a node
  const LEVEL_GAP = 76;    // space between levels
  const SIB_GAP = 18;      // space between neighbouring nodes
  const PAD = 26;          // space around the whole drawing
  const KEY_FONT = 19;

  // In the middle of a merge the root can have no keys but still have a child, until the next step
  // makes that child the root. The engine's own helpers call such a tree empty, so these wrap them.
  const hasNodes = (t) => !!t && (t.keys.length > 0 || !!(t.children && t.children.length));
  function treeStats(t) {
    if (t && t.keys.length === 0 && t.children && t.children.length) {
      let totalNodes = 0, totalKeys = 0, height = 0;
      (function walk(n, d) { totalNodes++; totalKeys += n.keys.length; height = Math.max(height, d); (n.children || []).forEach((c) => walk(c, d + 1)); })(t, 1);
      return { totalNodes, totalKeys, height, minKeys: engine.minKeys(), maxKeys: engine.maxKeys(), order: engine.order };
    }
    return engine.getStats(t);
  }
  function treeText(t) {
    if (t && t.keys.length === 0 && t.children && t.children.length) {
      const lines = [];
      let level = [t];
      for (let d = 0; level.length; d++) {
        lines.push(`Level ${d}: ` + level.map((n) => `[${n.keys.join(', ')}]`).join('   '));
        level = level.reduce((all, n) => all.concat(n.children || []), []);
      }
      return lines.join('\n');
    }
    return engine.serializeToText(t);
  }
  // The engine's rule check skips a tree whose root has no keys. That is right for an empty tree, but not for a
  // root that is empty for one step while a merge finishes, so that case is reported here.
  function problemsOf(t) {
    const p = engine.validateInvariants(t);
    if (!p.length && t.keys.length === 0 && t.children && t.children.length) p.push('The root has no keys but still has a child.');
    return p;
  }

  // Nodes in one drawing share a cell width so the keys line up like a table.
  function cellWidthFor(root) {
    let chars = 1;
    (function scan(n) {
      n.keys.forEach((k) => { chars = Math.max(chars, String(k).length); });
      (n.children || []).forEach(scan);
    })(root);
    return Math.max(40, Math.ceil(chars * 10 + 20));
  }

  // Work out where every node goes. Leaves are packed left to right; a parent sits above its children.
  function layoutTree(root) {
    if (!root || !root.keys) return null;
    if (root.keys.length === 0 && !(root.children && root.children.length)) return null;   // truly empty
    const cellW = cellWidthFor(root);
    const nodes = [];
    function build(n, depth, parent) {
      const rec = { id: n.id, keys: n.keys.slice(), leaf: !(n.children && n.children.length), depth, parent, kids: [], w: Math.max(1, n.keys.length) * cellW };
      nodes.push(rec);
      (n.children || []).forEach((c) => rec.kids.push(build(c, depth + 1, rec)));
      return rec;
    }
    const top = build(root, 0, null);
    (function measure(n) {
      if (!n.kids.length) { n.sw = n.w; n.span = 0; return n.sw; }
      let span = 0;
      n.kids.forEach((c, i) => { span += measure(c) + (i ? SIB_GAP : 0); });
      n.span = span;
      n.sw = Math.max(n.w, span);
      return n.sw;
    })(top);
    (function place(n, left) {
      if (!n.kids.length) { n.cx = left + n.sw / 2; return; }
      let x = left + (n.sw - n.span) / 2;
      n.kids.forEach((c) => { place(c, x); x += c.sw + SIB_GAP; });
      const mid = (n.kids[0].cx + n.kids[n.kids.length - 1].cx) / 2;
      n.cx = clamp(mid, left + n.w / 2, left + n.sw - n.w / 2);
    })(top, PAD);
    let maxDepth = 0;
    nodes.forEach((n) => {
      n.x = n.cx - n.w / 2;
      n.y = PAD + n.depth * (CELL_H + LEVEL_GAP);
      maxDepth = Math.max(maxDepth, n.depth);
    });
    return {
      nodes, root: top, cellW, empty: false,
      width: top.sw + PAD * 2,
      height: PAD * 2 + (maxDepth + 1) * CELL_H + maxDepth * LEVEL_GAP,
      byId: new Map(nodes.map((n) => [n.id, n]))
    };
  }

  function emptyLayout() {
    return { nodes: [], root: null, cellW: 40, empty: true, width: 320, height: 150, byId: new Map() };
  }

  // Which nodes and keys does this step want highlighted? trail = the nodes already walked through on the way down.
  function marksFor(layout, frame, trail) {
    const nodes = new Set();
    const keys = new Set(frame && frame.highlightKeys ? frame.highlightKeys : []);
    if (layout && frame) {
      layout.nodes.forEach((n) => { if (n.keys.some((k) => frame.highlightNodeKeys.includes(k))) nodes.add(n.id); });
    }
    return { nodes, keys, trail: trail || null };
  }

  // A small label on the top right corner of a node: the keys it holds out of the most it can hold.
  // Green when the count is allowed, red when the node is too full, amber when it is too empty.
  function countBadge(n, pal) {
    const k = n.keys.length, max = engine.maxKeys(), lo = n.parent === null ? 1 : engine.minKeys();
    const colour = k > max ? pal.kinds.del : (k < lo ? pal.kinds.fix : pal.kinds.ok);
    return `<g class="badge" aria-hidden="true" pointer-events="none">` +
      `<rect x="${n.w - 15}" y="-7.5" width="30" height="15" rx="7.5" fill="${colour}" stroke="${pal.bg}" stroke-width="1.5"/>` +
      `<text x="${n.w}" y="0" dy="0.35em" text-anchor="middle" font-family="${FONT_UI}" font-size="10.5" font-weight="700" fill="${pal.bg}">${k}/${max}</text></g>`;
  }

  function nodeMarkup(n, layout, pal, o) {
    const cw = layout.cellW;
    const marked = o.marks && o.marks.nodes.has(n.id);
    const onTrail = !marked && !!(o.marks && o.marks.trail && o.marks.trail.has(n.id));
    const stroke = marked ? o.kindColor : (onTrail ? pal.trailLine : pal.ink);
    const fill = marked ? pal.markNode : (onTrail ? pal.trailFill : pal.nodeFill);
    let s = `<g class="node" data-id="${n.id}" transform="translate(${n.x} ${n.y})"`;
    if (o.interactive) {
      const what = n.keys.length ? `Node holding ${esc(n.keys.join(', '))}` : 'Node with no keys';
      s += ` tabindex="0" role="button" aria-label="${what}${o.counts ? ` (${n.keys.length} of ${engine.maxKeys()} keys)` : ''}"`;
    }
    s += '>';
    const selected = o.selectedId === n.id;
    s += `<rect class="node-focus" x="-5" y="-5" width="${n.w + 10}" height="${CELL_H + 10}" rx="3" fill="none" stroke="${selected ? pal.select : 'none'}" stroke-width="1.6" stroke-dasharray="5 3"/>`;
    s += `<rect x="0" y="0" width="${n.w}" height="${CELL_H}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="${marked ? 2.6 : (onTrail ? 2 : 1.6)}"/>`;
    n.keys.forEach((k, i) => {
      if (o.marks && o.marks.keys.has(k)) s += `<rect x="${i * cw + 1.5}" y="1.5" width="${cw - 3}" height="${CELL_H - 3}" fill="${pal.markKey}"/>`;
    });
    for (let i = 1; i < n.keys.length; i++) {
      s += `<line x1="${i * cw}" y1="1" x2="${i * cw}" y2="${CELL_H - 1}" stroke="${pal.cellLine}" stroke-width="1"/>`;
    }
    n.keys.forEach((k, i) => {
      const acted = o.marks && o.marks.keys.has(k);
      s += `<text x="${i * cw + cw / 2}" y="${CELL_H / 2}" dy="0.35em" text-anchor="middle" font-family="${FONT_BOOK}" font-size="${KEY_FONT}" font-weight="${acted ? 600 : 400}" fill="${acted ? pal.markText : pal.ink}">${esc(k)}</text>`;
    });
    if (!n.leaf) {
      // a node with no keys has a single pointer, drawn in the middle of its bottom edge
      if (n.keys.length === 0) s += `<circle cx="${cw / 2}" cy="${CELL_H}" r="3.4" fill="${pal.ink}"/>`;
      else for (let i = 0; i <= n.keys.length; i++) s += `<circle cx="${i * cw}" cy="${CELL_H}" r="3.4" fill="${pal.ink}"/>`;
    }
    if (o.counts) s += countBadge(n, pal);
    return s + '</g>';
  }

  // o.path = ids of the nodes on the walk so far; the lines between them are drawn heavier and in the search colour.
  function linkMarkup(layout, pal, o) {
    const path = o && o.path;
    let s = '';
    layout.nodes.forEach((p) => {
      p.kids.forEach((c, j) => {
        const slot = p.keys.length === 0 ? 0.5 : Math.min(j, p.keys.length);
        const hot = !!path && path.has(p.id) && path.has(c.id);
        s += `<line class="link" data-p="${p.id}" data-c="${c.id}" data-slot="${slot}" x1="${p.x + slot * layout.cellW}" y1="${p.y + CELL_H}" x2="${c.cx}" y2="${c.y}" stroke="${hot ? pal.trailLine : pal.link}" stroke-width="${hot ? 2.4 : 1.3}"/>`;
      });
    });
    return s;
  }

  // The key being put in (or looked for): a small pill that rides down the tree, just above the node being read.
  function carryMarkup(text, pal) {
    const w = Math.max(26, 12 + String(text).length * 8.6);
    return `<g id="carry" pointer-events="none" transform="translate(-300 -300)" opacity="0">` +
      `<rect x="${-w / 2}" y="-10" width="${w}" height="20" rx="10" fill="${pal.markKey}" stroke="${pal.ink}" stroke-width="1.4"/>` +
      `<text x="0" y="0" dy="0.35em" text-anchor="middle" font-family="${FONT_UI}" font-size="12.5" font-weight="700" fill="${pal.markText}">${esc(text)}</text></g>`;
  }

  function emptyMarkup(layout, pal) {
    const w = layout.cellW;
    const x = (layout.width - w) / 2, y = 34;
    return `<rect x="${x}" y="${y}" width="${w}" height="${CELL_H}" rx="2" fill="none" stroke="${pal.ink2}" stroke-width="1.5" stroke-dasharray="6 4"/>` +
      `<text x="${layout.width / 2}" y="${y + CELL_H + 30}" text-anchor="middle" font-family="${FONT_BOOK}" font-style="italic" font-size="17" fill="${pal.ink2}">empty tree</text>`;
  }

  function gridPatterns(uid, pal, transform) {
    const t = transform ? ` patternTransform="${transform}"` : '';
    return `<pattern id="gm${uid}" width="20" height="20" patternUnits="userSpaceOnUse"${t}><path d="M20 0H0V20" fill="none" stroke="${pal.grid1}" stroke-width="1"/></pattern>` +
      `<pattern id="gM${uid}" width="100" height="100" patternUnits="userSpaceOnUse"${t}><path d="M100 0H0V100" fill="none" stroke="${pal.grid2}" stroke-width="1.2"/></pattern>`;
  }

  let uidCounter = 0;

  // A complete, self-contained SVG of a tree. Used for exports, the lab sheet, the theory page
  // and the practice questions. Everything is drawn with attributes, so it needs no stylesheet.
  function standaloneSvg(root, o) {
    o = o || {};
    const pal = typeof o.palette === 'string' ? FIXED_PALETTES[o.palette] : (o.palette || readThemePalette());
    const layout = layoutTree(root) || emptyLayout();
    const marks = o.frame ? marksFor(layout, o.frame) : { nodes: new Set(), keys: new Set() };
    const kindColor = o.frame ? pal.kinds[kindOf(o.frame)] : pal.ink;
    const minW = o.minWidth || 0;
    const width = Math.max(layout.width, minW), height = layout.height;
    const dx = (width - layout.width) / 2;
    const uid = ++uidCounter;
    const stats = hasNodes(root) ? treeStats(root) : null;
    const order = o.order || engine.order;
    const title = stats ? `B-tree of order ${order} with ${plural(stats.totalKeys, 'key')} in ${plural(stats.totalNodes, 'node')}` : 'Empty B-tree';
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">`;
    s += `<title>${esc(title)}</title>`;
    if (stats) s += `<desc>${esc(treeText(root).replace(/\n/g, ' '))}</desc>`;
    if (o.grid) s += `<defs>${gridPatterns(uid, pal)}</defs>`;
    if (o.background !== false) s += `<rect width="${width}" height="${height}" fill="${pal.bg}"/>`;
    if (o.grid) s += `<rect width="${width}" height="${height}" fill="url(#gm${uid})"/><rect width="${width}" height="${height}" fill="url(#gM${uid})"/>`;
    s += `<g transform="translate(${dx} 0)">`;
    if (layout.empty) s += emptyMarkup(layout, pal);
    else {
      s += linkMarkup(layout, pal);
      layout.nodes.forEach((n) => { s += nodeMarkup(n, layout, pal, { marks, kindColor }); });
    }
    s += '</g></svg>';
    if (o.clean) s = cleanForFile(s);
    return { svg: s, width, height };
  }

  // For a saved file: drop what only the page uses (the keyboard focus ring, class names, data-* hooks).
  function cleanForFile(svg) {
    return svg
      .replace(/<rect class="node-focus"[^>]*\/>/g, '')
      .replace(/ (?:class|data-[a-z]+)="[^"]*"/g, '');
  }

  // Put a static figure into an element and remember how, so a theme change can redraw it.
  function drawFigure(el, tree, opts) {
    el._fig = { tree, opts: opts || {} };
    el.innerHTML = standaloneSvg(tree, Object.assign({ palette: readThemePalette() }, opts || {})).svg;
  }
  function redrawFigures() {
    document.querySelectorAll('.fig-live').forEach((el) => { if (el._fig) drawFigure(el, el._fig.tree, el._fig.opts); });
  }

  // ---- the live figure on the Build tab ----
  const vizViewport = $('vizViewport');
  const treeSvgContainer = $('treeSvgContainer');
  const view = { k: 1, tx: 0, ty: 0, auto: true };   // camera; auto = keep the whole tree in view
  let lastLayout = null;                              // layout of the frame on screen
  let shown = new Map();                              // node id -> {x, y} as currently drawn
  let selectedId = null;
  let tweenId = 0;
  let carryShown = null;                              // where the travelling key was last drawn: {x, y}
  let showCounts = store.get('counts') !== 'off';     // the small count on each node

  function viewportSize() {
    return { w: vizViewport.clientWidth, h: vizViewport.clientHeight };
  }

  function fitTransform(layout) {
    const vp = viewportSize();
    if (!layout || vp.w === 0) return { k: view.k, tx: view.tx, ty: view.ty };
    const k = clamp(Math.min(vp.w / layout.width, vp.h / layout.height), 0.3, 1.4);
    return { k, tx: (vp.w - layout.width * k) / 2, ty: Math.max(0, (vp.h - layout.height * k) / 2) };
  }

  function applyView() {
    const cam = $('camera');
    if (!cam) return;
    cam.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.k})`);
    const pt = `translate(${view.tx} ${view.ty}) scale(${view.k})`;
    const a = $('gridMinor'), b = $('gridMajor');
    if (a) a.setAttribute('patternTransform', pt);
    if (b) b.setAttribute('patternTransform', pt);
  }

  // fn gets the eased progress, and the plain progress as a second argument (0 to 1)
  function runTween(ms, fn) {
    const id = ++tweenId;
    if (ms <= 0 || reducedMotion()) { fn(1, 1); return; }
    const t0 = performance.now();
    fn(0, 0);
    requestAnimationFrame(function loop(now) {
      if (id !== tweenId) return;
      const t = Math.min(1, (now - t0) / ms);
      fn(ease(t), t);
      if (t < 1) requestAnimationFrame(loop);
    });
  }

  function altText(tree) {
    if (!hasNodes(tree)) return 'An empty B-tree.';
    return `B-tree of order ${engine.order}. ` + treeText(tree).replace(/\n/g, '. ');
  }

  function screenSvg(layout, pal, o) {
    let inner;
    if (layout.empty) inner = emptyMarkup(layout, pal);
    else {
      const path = o.marks && o.marks.trail ? new Set(Array.from(o.marks.trail).concat(Array.from(o.marks.nodes))) : null;
      inner = linkMarkup(layout, pal, { path });
      if (o.carry) inner += carryMarkup(o.carry.text, pal);     // under the nodes, so it slips behind a node it passes
      layout.nodes.forEach((n) => { inner += nodeMarkup(n, layout, pal, { marks: o.marks, kindColor: o.kindColor, selectedId: o.selectedId, interactive: true, counts: o.counts }); });
    }
    const t = `translate(${o.cam.tx} ${o.cam.ty}) scale(${o.cam.k})`;
    return `<svg id="figureSvg" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" role="img" aria-label="${esc(o.alt)}">` +
      `<defs>${gridPatterns('', pal, t).replace(/id="gm"/, 'id="gridMinor"').replace(/id="gM"/, 'id="gridMajor"')}</defs>` +
      `<rect width="100%" height="100%" fill="${pal.bg}"/>` +
      `<rect width="100%" height="100%" fill="url(#gridMinor)"/><rect width="100%" height="100%" fill="url(#gridMajor)"/>` +
      `<g id="camera" transform="${t}">${inner}</g></svg>`;
  }

  // Where the travelling key goes in this frame. 'above' = hovering over the node being read;
  // 'into' = dropping into its cell (only when it was already on screen in the frame before).
  function carryPlan(c, layout, marks, from) {
    if (c.mode === 'into') {
      if (!from) return null;
      const n = layout.nodes.find((m) => m.keys.includes(c.key));
      if (!n) return null;
      return { text: c.text, mode: 'into', x: n.x + n.keys.indexOf(c.key) * layout.cellW + layout.cellW / 2, y: n.y + CELL_H / 2, from };
    }
    const id = marks.nodes.values().next().value;
    const n = id && layout.byId.get(id);
    if (!n) return null;
    return { text: c.text, mode: 'above', x: n.cx, y: n.y - 15, from };
  }

  // Draw one recorded frame. If the tree is already on screen, nodes glide to their new places, a node that
  // did not exist a moment ago slides out of its neighbour (a split) and the key being placed rides down.
  function drawFrame(frame, animate, extras) {
    extras = extras || {};
    const pal = readThemePalette();
    const layout = layoutTree(frame.tree) || emptyLayout();
    const marks = marksFor(layout, frame, extras.trail);
    const kindColor = pal.kinds[kindOf(frame)];
    const prevShown = new Map(shown);
    const camFrom = { k: view.k, tx: view.tx, ty: view.ty };
    const camTo = view.auto ? fitTransform(layout) : camFrom;
    if (selectedId && !layout.byId.has(selectedId)) selectedId = null;

    const carryFrom = carryShown;
    const carry = extras.carry && !layout.empty ? carryPlan(extras.carry, layout, marks, carryFrom) : null;
    carryShown = carry && carry.mode === 'above' ? { x: carry.x, y: carry.y } : null;

    treeSvgContainer.innerHTML = screenSvg(layout, pal, { marks, kindColor, selectedId, alt: altText(frame.tree), cam: animate ? camFrom : camTo, counts: showCounts, carry });
    lastLayout = layout;
    shown = new Map();

    const nodeEls = new Map();
    treeSvgContainer.querySelectorAll('.node').forEach((el) => nodeEls.set(el.dataset.id, el));
    const linkEls = Array.from(treeSvgContainer.querySelectorAll('.link'));
    const carryEl = carry ? $('carry') : null;

    // a new node starts from the place of the neighbour next to it (the node it was split from)
    const origin = new Map();
    layout.nodes.forEach((n) => {
      if (prevShown.has(n.id) || !n.parent) return;
      const sibs = n.parent.kids, at = sibs.indexOf(n);
      const near = [sibs[at - 1], sibs[at + 1]].find((s) => s && prevShown.has(s.id));
      if (near) origin.set(n.id, prevShown.get(near.id));
    });

    const step = (e, t) => {
      if (view.auto) {
        view.k = lerp(camFrom.k, camTo.k, e);
        view.tx = lerp(camFrom.tx, camTo.tx, e);
        view.ty = lerp(camFrom.ty, camTo.ty, e);
      }
      applyView();
      // Nodes set off quickly and settle slowly. A node that has just got wider (a key was added) would
      // otherwise sit on top of its neighbour for a moment while the neighbour is still on its way out.
      const m = 1 - Math.pow(1 - t, 3);
      layout.nodes.forEach((n) => {
        const el = nodeEls.get(n.id);
        const isNew = !prevShown.has(n.id);
        const p = prevShown.get(n.id) || origin.get(n.id);
        const x = p ? lerp(p.x, n.x, m) : n.x;
        const y = p ? lerp(p.y, n.y, m) : n.y;
        el.setAttribute('transform', `translate(${x} ${y})`);
        if (isNew && e < 1) el.setAttribute('opacity', String(0.15 + 0.85 * e)); else el.removeAttribute('opacity');
        shown.set(n.id, { x, y });
      });
      linkEls.forEach((l) => {
        const pn = layout.byId.get(l.dataset.p), cn = layout.byId.get(l.dataset.c);
        const ps = shown.get(pn.id), cs = shown.get(cn.id);
        l.setAttribute('x1', ps.x + Number(l.dataset.slot) * layout.cellW);
        l.setAttribute('y1', ps.y + CELL_H);
        l.setAttribute('x2', cs.x + cn.w / 2);
        l.setAttribute('y2', cs.y);
        if (!prevShown.has(cn.id) && e < 1) l.setAttribute('opacity', String(e)); else l.removeAttribute('opacity');
      });
      if (carryEl) {
        const from = carry.from || carry;
        carryEl.setAttribute('transform', `translate(${lerp(from.x, carry.x, e)} ${lerp(from.y, carry.y, e)})`);
        carryEl.setAttribute('opacity', String(carry.mode === 'into' ? 1 - e : (carry.from ? 1 : e)));
      }
    };
    if (!view.auto) { view.k = camFrom.k; }
    runTween(animate ? Math.min(480, speedMs * 0.55) : 0, step);
  }

  // Re-fit after the box changes size, or when the Fit button is pressed.
  function refit(animate) {
    if (!lastLayout) return;
    const to = fitTransform(lastLayout);
    const from = { k: view.k, tx: view.tx, ty: view.ty };
    runTween(animate ? 260 : 0, (e) => {
      view.k = lerp(from.k, to.k, e); view.tx = lerp(from.tx, to.tx, e); view.ty = lerp(from.ty, to.ty, e);
      applyView();
    });
  }

  function zoomAt(px, py, factor) {
    const k = clamp(view.k * factor, 0.25, 3);
    view.tx = px - (px - view.tx) * (k / view.k);
    view.ty = py - (py - view.ty) * (k / view.k);
    view.k = k;
    view.auto = false;
    tweenId++;
    applyView();
  }

  // drag to move
  let drag = null;
  vizViewport.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false, id: e.pointerId };
  });
  vizViewport.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      view.auto = false;
      tweenId++;
      try { vizViewport.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      vizViewport.classList.add('is-dragging');
    }
    view.tx = drag.tx + dx;
    view.ty = drag.ty + dy;
    applyView();
  });
  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    drag = null;
    vizViewport.classList.remove('is-dragging');
  };
  vizViewport.addEventListener('pointerup', endDrag);
  vizViewport.addEventListener('pointercancel', endDrag);
  vizViewport.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;     // plain scrolling still scrolls the page
    e.preventDefault();
    const r = vizViewport.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  $('btnZoomIn').addEventListener('click', () => zoomAt(vizViewport.clientWidth / 2, vizViewport.clientHeight / 2, 1.25));
  $('btnZoomOut').addEventListener('click', () => zoomAt(vizViewport.clientWidth / 2, vizViewport.clientHeight / 2, 1 / 1.25));
  $('btnFitScreen').addEventListener('click', () => { view.auto = true; refit(true); });
  $('btnZoomReset').addEventListener('click', () => {
    if (!lastLayout) return;
    const from = { k: view.k, tx: view.tx, ty: view.ty };
    const to = { k: 1, tx: (vizViewport.clientWidth - lastLayout.width) / 2, ty: 8 };
    view.auto = false;
    runTween(260, (e) => { view.k = lerp(from.k, to.k, e); view.tx = lerp(from.tx, to.tx, e); view.ty = lerp(from.ty, to.ty, e); applyView(); });
  });
  function setCountsUi() { $('btnCounts').setAttribute('aria-pressed', showCounts ? 'true' : 'false'); }
  $('btnCounts').addEventListener('click', () => {
    showCounts = !showCounts;
    store.set('counts', showCounts ? 'on' : 'off');
    setCountsUi();
    redraw();
  });
  if (window.ResizeObserver) {
    new ResizeObserver(() => { if (view.auto && vizViewport.clientWidth) refit(false); }).observe(vizViewport);
  }

  // click a node to see what it holds
  treeSvgContainer.addEventListener('click', (e) => {
    const g = e.target.closest ? e.target.closest('.node') : null;
    if (g) selectNode(g.dataset.id);
  });
  treeSvgContainer.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('node')) {
      e.preventDefault();
      selectNode(e.target.dataset.id);
    }
  });

  function selectNode(id) {
    selectedId = id;
    treeSvgContainer.querySelectorAll('.node').forEach((g) => {
      const r = g.querySelector('.node-focus');
      if (r) r.setAttribute('stroke', g.dataset.id === id ? readThemePalette().select : 'none');
    });
    renderInspector();
  }

  function renderInspector() {
    const box = $('inspectorContent');
    const n = selectedId && lastLayout ? lastLayout.byId.get(selectedId) : null;
    if (!n) { box.textContent = 'Click a node in the figure to see what it holds.'; return; }
    const max = engine.maxKeys(), min = engine.minKeys();
    const isRoot = n.parent === null;
    const lo = isRoot ? 1 : min;
    const role = isRoot ? (n.leaf ? 'the root, and it is also a leaf' : 'the root') : (n.leaf ? 'a leaf' : 'an internal node');
    const within = n.keys.length >= lo && n.keys.length <= max;
    box.innerHTML =
      `<p class="keys">[ ${esc(n.keys.join(', '))} ]</p>` +
      `<p>This is ${role}, on level ${n.depth + 1}. It holds ${plural(n.keys.length, 'key')} and ${n.leaf ? 'has no children' : 'has ' + plural(n.kids.length, 'child')}.</p>` +
      `<p>${isRoot ? 'The root may hold' : 'A node other than the root must hold'} ${lo} to ${max} keys. ` +
      (within ? 'This node is inside that range.' : 'This node is outside that range right now, because the figure is in the middle of a step.') + '</p>';
  }

  // ======================================================================
  // 4. Stepping through what was recorded
  // ======================================================================
  let groups = [];            // one per key operation: {op, key, label, start, end}
  let playTimer = null;
  let speedMs = 900;
  let stepsDirty = true;
  let exampleKey = null;

  const OPNAME = { insert: 'Insert', delete: 'Delete', search: 'Search' };
  const groupOf = (i) => groups.find((g) => i >= g.start && i <= g.end) || null;

  // Run a list of [op, key] pairs on the engine and remember which steps belong to which key.
  // meta says why: {source: 'user' | 'example' | 'startup', label}. Listeners get one 'ops' event with every step.
  function perform(ops, meta) {
    stopPlay();
    engine.frames = [];
    groups = [];
    carryShown = null;
    ops.forEach(([op, key]) => {
      const start = engine.frames.length;
      engine[op](key);
      groups.push({ op, key, label: `${OPNAME[op]} ${key}`, start, end: engine.frames.length - 1 });
    });
    engine.currentFrameIdx = Math.max(0, engine.frames.length - 1);
    stepsDirty = true;
    meta = meta || {};
    emit({
      type: 'ops', source: meta.source || 'user', label: meta.label || '', order: engine.order,
      groups: groups.map((g) => ({ op: g.op, key: g.key, start: g.start, end: g.end })),
      frames: engine.frames.map((f) => ({ message: f.message, detail: f.detail, actionType: f.actionType, tree: f.tree })),
      tree: engine.cloneTree()
    });
  }

  const PLAY_SVG = '<path d="M3 2v12l10-6z"/>';
  const PAUSE_SVG = '<rect x="3" y="2" width="3.6" height="12"/><rect x="9.4" y="2" width="3.6" height="12"/>';

  // ---- what the figure adds to a step: the nodes already walked through, and the key being placed ----
  const TRAIL_DETAILS = ['descend', 'leaf-insert', 'found', 'not-found'];
  function nodeIdsMarkedIn(frame) {
    const ids = [];
    (function walk(n) {
      if (n.keys.some((k) => frame.highlightNodeKeys.includes(k))) ids.push(n.id);
      (n.children || []).forEach(walk);
    })(frame.tree);
    return ids;
  }
  function trailFor(idx) {
    const f = engine.frames[idx], g = groupOf(idx);
    if (!g || !TRAIL_DETAILS.includes(f.detail)) return null;
    const ids = new Set();
    for (let j = g.start; j < idx; j++) {
      if (engine.frames[j].detail === 'descend') nodeIdsMarkedIn(engine.frames[j]).forEach((id) => ids.add(id));
    }
    return ids;
  }
  function carryFor(idx) {
    const f = engine.frames[idx], g = groupOf(idx);
    if (!g || g.op === 'delete') return null;
    if (f.detail === 'descend') return { text: String(g.key), mode: 'above', key: g.key };
    if ((g.op === 'insert' && f.detail === 'leaf-insert') || (g.op === 'search' && f.detail === 'found')) return { text: String(g.key), mode: 'into', key: g.key };
    return null;
  }
  function extrasFor(idx) { return { trail: trailFor(idx), carry: carryFor(idx) }; }

  // Draw the frame on screen again without moving anything (after a theme change, or the Counts button).
  function redraw() {
    if (!lastLayout || !engine.frames.length) return;
    const idx = clamp(engine.currentFrameIdx, 0, engine.frames.length - 1);
    carryShown = null;
    drawFrame(engine.frames[idx], false, extrasFor(idx));
  }

  function render(opts) {
    opts = opts || {};
    const frames = engine.frames;
    if (!frames.length) engine.recordFrame('The tree is empty.', [], [], 'info', 'cleared');
    const idx = clamp(engine.currentFrameIdx, 0, engine.frames.length - 1);
    engine.currentFrameIdx = idx;
    const f = engine.frames[idx];
    drawFrame(f, opts.animate !== false, extrasFor(idx));
    updateCaption(f.tree);
    updateNarration(f, idx);
    updateCode(f, idx);
    updateTransport(idx);
    updateSteps(idx);
    updateReadout(f, idx);
    renderInspector();
    if (opts.sound) chime(f);
  }

  function updateCaption(tree) {
    const st = treeStats(tree);
    $('figCaption').innerHTML = st.totalKeys
      ? `<b>Fig.</b> <i>Order-${engine.order} B-tree, ${plural(st.totalKeys, 'key')} in ${plural(st.totalNodes, 'node')} over ${plural(st.height, 'level')}.</i>`
      : `<b>Fig.</b> <i>Order-${engine.order} B-tree, empty.</i>`;
  }

  function updateNarration(f, idx) {
    const box = $('messageBox');
    box.dataset.kind = kindOf(f);
    $('messageCategory').textContent = labelFor(f, groupOf(idx));
    $('messageBody').textContent = f.message;
  }

  // ---- the pseudocode panel ----
  const codeEl = $('codeLines');
  const codeTabs = Array.from(document.querySelectorAll('.code-tab'));
  let codeOp = 'insert', codeOrder = 0;

  function renderCodeLines(op) {
    codeOp = op;
    codeOrder = engine.order;
    codeEl.innerHTML = window.BTreeCode.lines(op, engine.order)
      .map((l) => `<li class="cl" data-n="${l.n}" style="--ind:${l.indent}"><span class="cl-n">${l.n}</span><span class="cl-t">${l.html}</span></li>`).join('');
    codeEl.dataset.op = op;
    codeEl.setAttribute('aria-label', `Pseudocode for ${op}`);
    codeTabs.forEach((b) => b.setAttribute('aria-pressed', b.dataset.op === op ? 'true' : 'false'));
  }

  // Show the procedure this step belongs to and shade the lines it is carrying out.
  // forceOp: the person picked a tab by hand; steps of another procedure then shade nothing.
  function updateCode(f, idx, forceOp) {
    const g = groupOf(idx);
    const op = forceOp || (g ? g.op : codeOp);
    if (op !== codeOp || codeOrder !== engine.order || !codeEl.children.length) renderCodeLines(op);
    const lines = g && g.op === op ? window.BTreeCode.linesFor(op, f, idx === g.start) : [];
    const on = new Set(lines);
    Array.from(codeEl.children).forEach((li) => {
      const hit = on.has(Number(li.dataset.n));
      li.classList.toggle('is-on', hit);
      if (hit) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current');
    });
    codeEl.dataset.kind = kindOf(f);
    $('messageLine').textContent = lines.length ? `Pseudocode ${window.BTreeCode.phrase(lines)}.` : '';
  }
  codeTabs.forEach((b) => b.addEventListener('click', () => {
    const idx = clamp(engine.currentFrameIdx, 0, engine.frames.length - 1);
    updateCode(engine.frames[idx], idx, b.dataset.op);
  }));

  function updateTransport(idx) {
    const n = engine.frames.length;
    const slider = $('stepSlider');
    slider.max = String(Math.max(1, n));
    slider.value = String(idx + 1);
    slider.disabled = n < 2;
    $('stepCounter').textContent = `Step ${idx + 1} of ${n}`;
    $('btnFirstStep').disabled = $('btnPrevStep').disabled = idx <= 0;
    $('btnNextStep').disabled = $('btnLastStep').disabled = idx >= n - 1;
    $('btnPlayPause').disabled = n < 2;
    setPlayUi(!!playTimer, idx >= n - 1 && n > 1);
  }

  function setPlayUi(playing, atEnd) {
    $('playIcon').innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
    $('playText').textContent = playing ? 'Pause' : (atEnd ? 'Replay' : 'Play');
  }

  function updateSteps(idx) {
    const list = $('stepsTimeline');
    if (stepsDirty) {
      let html = '', lastLabel = null;
      engine.frames.forEach((f, i) => {
        const g = groupOf(i);
        const label = g ? g.label : (f.detail === 'restored' ? 'Undo and redo' : 'Start');
        if (label !== lastLabel || (g && g.start === i)) { html += `<li class="group">${esc(label)}</li>`; lastLabel = label; }
        html += `<li><button type="button" class="step-btn" data-i="${i}" data-kind="${kindOf(f)}"><span class="n">${i + 1}</span><span>${esc(f.message)}</span></button></li>`;
      });
      list.innerHTML = html;
      stepsDirty = false;
      $('stepsSub').textContent = engine.frames.length > 1 ? 'Click a step to jump to it.' : 'Steps will appear here.';
    }
    const prev = list.querySelector('[aria-current="step"]');
    if (prev) prev.removeAttribute('aria-current');
    const cur = list.querySelector(`.step-btn[data-i="${idx}"]`);
    if (cur) {
      cur.setAttribute('aria-current', 'step');
      scrollStepIntoView();
    }
  }

  // Keep the current step inside the visible part of the list. The position is measured from the list itself:
  // offsetTop is measured from whatever element the browser picks as the offset parent (here the page body),
  // which put the list far below the step it should show.
  function scrollStepIntoView() {
    const list = $('stepsTimeline');
    const cur = list.querySelector('.step-btn[aria-current="step"]');
    if (!cur || !list.clientHeight) return;        // no current step, or the Build tab is hidden right now
    const lr = list.getBoundingClientRect(), cr = cur.getBoundingClientRect();
    const top = cr.top - lr.top - list.clientTop + list.scrollTop;   // where the step sits inside the scrolled content
    const bottom = top + cr.height;
    if (top < list.scrollTop + 30) list.scrollTop = Math.max(0, top - 44);
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 10;
  }

  $('stepsTimeline').addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('.step-btn') : null;
    if (!b) return;
    stopPlay();
    engine.currentFrameIdx = Number(b.dataset.i);
    render({ sound: true });
  });

  function updateReadout(f, idx) {
    const st = treeStats(f.tree);
    $('statKeys').textContent = st.totalKeys;
    $('statNodes').textContent = st.totalNodes;
    $('statHeight').textContent = st.height;
    const min = engine.minKeys(), max = engine.maxKeys();
    $('statKeyBounds').textContent = min === 1 ? `Every node holds 1 to ${max} keys.` : `Every node except the root holds ${min} to ${max} keys; the root holds 1 to ${max}.`;

    const problems = problemsOf(f.tree);
    const g = groupOf(idx);
    const finalOfStep = !g || idx === g.end;
    const badge = $('invariantBadge'), detail = $('ruleDetail');
    if (!problems.length) {
      badge.dataset.state = 'ok';
      badge.textContent = 'All rules hold';
      detail.textContent = 'Keys are in order, no node is too full or too empty, every internal node has one more child than keys, and all leaves are on the same level.';
    } else if (!finalOfStep) {
      badge.dataset.state = 'mid';
      badge.textContent = 'In the middle of a step';
      detail.textContent = 'A node is briefly too full or too empty. The next step puts it right.';
    } else {
      badge.dataset.state = 'bad';
      badge.textContent = `${plural(problems.length, 'rule')} broken`;
      detail.textContent = problems[0];
    }
  }

  // ---- play, pause, step ----
  function stopPlay() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    if (engine.frames.length) updateTransport(clamp(engine.currentFrameIdx, 0, engine.frames.length - 1));
  }
  function startPlay() {
    if (engine.frames.length < 2) return;
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    if (engine.currentFrameIdx >= engine.frames.length - 1) { engine.currentFrameIdx = 0; render({ sound: true }); }
    playTimer = setInterval(() => {
      if (engine.currentFrameIdx < engine.frames.length - 1) {
        engine.currentFrameIdx++;
        render({ sound: true });
      } else stopPlay();
    }, speedMs);
    updateTransport(engine.currentFrameIdx);
  }
  const goTo = (i) => { stopPlay(); engine.currentFrameIdx = clamp(i, 0, engine.frames.length - 1); render({ sound: true }); };

  $('btnPlayPause').addEventListener('click', () => (playTimer ? stopPlay() : startPlay()));
  $('btnFirstStep').addEventListener('click', () => goTo(0));
  $('btnPrevStep').addEventListener('click', () => goTo(engine.currentFrameIdx - 1));
  $('btnNextStep').addEventListener('click', () => goTo(engine.currentFrameIdx + 1));
  $('btnLastStep').addEventListener('click', () => goTo(engine.frames.length - 1));
  $('stepSlider').addEventListener('input', (e) => goTo(Number(e.target.value) - 1));
  $('animSpeedSelect').addEventListener('change', (e) => {
    speedMs = Number(e.target.value);
    if (playTimer) startPlay();
  });

  const speakBtn = $('btnSpeakStep');
  if (!('speechSynthesis' in window)) speakBtn.hidden = true;
  speakBtn.addEventListener('click', () => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance($('messageBody').textContent);
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  });

  // ======================================================================
  // 5. Insert, delete, search; examples; history
  // ======================================================================
  const keysInput = $('keysInput');
  const MAX_KEYS_AT_ONCE = 30, MAX_ABS = 99999;

  function showError(msg) { $('errorMessage').textContent = msg; $('errorBanner').hidden = false; }
  function clearError() { $('errorBanner').hidden = true; $('errorMessage').textContent = ''; }

  function parseKeys(raw) {
    const text = (raw || '').trim();
    if (!text) return { error: 'Type at least one whole number first.' };
    const parts = text.split(/[\s,;]+/).filter(Boolean);
    const keys = [];
    for (const p of parts) {
      if (!/^-?\d+$/.test(p)) return { error: `"${p}" is not a whole number. Use whole numbers separated by spaces or commas.` };
      const n = parseInt(p, 10);
      if (Math.abs(n) > MAX_ABS) return { error: `${n.toLocaleString('en-US')} is outside the range -99,999 to 99,999.` };
      keys.push(n);
    }
    if (keys.length > MAX_KEYS_AT_ONCE) return { error: `Enter at most ${MAX_KEYS_AT_ONCE} keys at a time.` };
    return { keys };
  }

  const history = [];
  function logHistory(text) {
    history.unshift({ t: new Date(), text });
    if (history.length > 40) history.pop();
    renderHistory();
  }
  function renderHistory() {
    const list = $('historyList');
    if (!history.length) { list.innerHTML = '<li>Nothing yet.</li>'; return; }
    list.innerHTML = history.map((h) => `<li><span class="t">${esc(h.t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</span>${esc(h.text)}</li>`).join('');
  }
  $('btnClearHistory').addEventListener('click', () => { history.length = 0; renderHistory(); });

  function showExampleNote(text) { const n = $('exampleNote'); n.textContent = text; n.hidden = false; }
  function clearExampleNote() { $('exampleNote').hidden = true; exampleKey = null; }

  // ---- undo and redo: each entry is the whole tree (and its order) as it was before a change ----
  const undoStack = [], redoStack = [];
  const UNDO_LIMIT = 60;
  const snapshotNow = (label) => ({ order: engine.order, tree: engine.cloneTree(), label });

  function updateUndoUi() {
    const u = undoStack[undoStack.length - 1], r = redoStack[redoStack.length - 1];
    const bu = $('btnUndo'), br = $('btnRedo');
    bu.disabled = !u;
    br.disabled = !r;
    bu.title = u ? `Undo: ${u.label} (Ctrl+Z)` : 'Nothing to undo yet';
    br.title = r ? `Redo: ${r.label} (Ctrl+Y)` : 'Nothing to redo';
    bu.setAttribute('aria-label', u ? `Undo ${u.label}` : 'Undo');
    br.setAttribute('aria-label', r ? `Redo ${r.label}` : 'Redo');
  }
  // Call this just before a change is made, with a few words about the change.
  function pushUndo(label) {
    undoStack.push(snapshotNow(label));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    updateUndoUi();
  }
  // Put a saved tree back. The steps list then holds a single "restored" step.
  function restore(snap, message) {
    stopPlay();
    clearError();
    clearExampleNote();
    engine.setOrder(snap.order);                  // also empties the tree and the recorded steps
    engine.root = engine.cloneNode(snap.tree);
    engine.frames = [];
    groups = [];
    carryShown = null;
    selectedId = null;
    stepsDirty = true;
    $('orderSelect').value = String(snap.order);
    updateOrderHint();
    engine.recordFrame(message, [], [], 'info', 'restored');
    engine.currentFrameIdx = 0;
    render({ sound: false });
    updateUndoUi();
  }
  function undo() {
    if (!undoStack.length) return false;
    const snap = undoStack.pop();
    redoStack.push(snapshotNow(snap.label));
    restore(snap, `Undid "${snap.label}": the tree is back as it was before.`);
    emit({ type: 'undo', label: snap.label, order: engine.order, tree: engine.cloneTree() });
    logHistory(`Undid: ${snap.label}`);
    return true;
  }
  function redo() {
    if (!redoStack.length) return false;
    const snap = redoStack.pop();
    undoStack.push(snapshotNow(snap.label));
    restore(snap, `Redid "${snap.label}".`);
    emit({ type: 'redo', label: snap.label, order: engine.order, tree: engine.cloneTree() });
    logHistory(`Redid: ${snap.label}`);
    return true;
  }
  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);

  // Start the steps just made from their first frame and let them play, so the tree can be watched being changed.
  // A single step has nothing to play: it is simply shown.
  function playFromStart() {
    stopPlay();
    engine.currentFrameIdx = 0;
    render({ sound: true });
    startPlay();
  }
  // Another tab needs the finished tree, so a playing operation is carried to its last step first.
  function settleToEnd() {
    const wasPlaying = !!playTimer;
    stopPlay();
    if (!wasPlaying || !engine.frames.length) return;
    engine.currentFrameIdx = engine.frames.length - 1;
    render({ animate: false });
  }

  const labelOfOp = (op, keys) => `${OPNAME[op]} ${keys.length > 6 ? keys.slice(0, 5).join(' ') + ` and ${keys.length - 5} more` : keys.join(' ')}`;

  let typedSinceOp = false;       // has anything been typed in the keys box since the last Insert, Delete or Search?

  function doOp(op) {
    const parsed = parseKeys(keysInput.value);
    if (parsed.error) { showError(parsed.error); keysInput.focus(); return; }
    clearError();
    clearExampleNote();
    if (op !== 'search') pushUndo(labelOfOp(op, parsed.keys));      // a search changes nothing, so there is nothing to undo
    perform(parsed.keys.map((k) => [op, k]), { source: 'user' });
    logHistory(`${OPNAME[op]} ${parsed.keys.join(' ')}`);
    keysInput.value = '';
    typedSinceOp = false;
    playFromStart();
    // On a computer the cursor goes back to the box so the next keys can be typed at once. On a phone that would bring
    // the keyboard up over the figure that has just started to play, so the box is left instead.
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) keysInput.blur();
    else keysInput.focus({ preventScroll: true });
  }
  $('btnInsert').addEventListener('click', () => doOp('insert'));
  $('btnDelete').addEventListener('click', () => doOp('delete'));
  $('btnSearch').addEventListener('click', () => doOp('search'));
  keysInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doOp('insert'); } });
  keysInput.addEventListener('input', () => { typedSinceOp = true; clearError(); });
  $('opsForm').addEventListener('submit', (e) => e.preventDefault());

  function keysInTree() {
    const out = new Set();
    (function walk(n) { n.keys.forEach((k) => out.add(k)); (n.children || []).forEach(walk); })(engine.root);
    return out;
  }
  // Eight random numbers from 5 to 99 that are not in the tree yet (fewer when the tree is nearly full).
  $('btnRandom').addEventListener('click', () => {
    const have = keysInTree(), free = [];
    for (let k = 5; k <= 99; k++) if (!have.has(k)) free.push(k);
    if (!free.length) { showError('The tree already holds every number from 5 to 99. Clear it first, or type your own keys.'); return; }
    for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = free[i]; free[i] = free[j]; free[j] = t; }
    keysInput.value = free.slice(0, 8).join(' ');
    doOp('insert');
  });

  $('btnClear').addEventListener('click', () => {
    stopPlay();
    clearError();
    clearExampleNote();
    if (hasNodes(engine.root)) pushUndo('Clear tree');
    engine.clear();
    groups = [];
    carryShown = null;
    stepsDirty = true;
    emit({ type: 'clear', order: engine.order, tree: engine.cloneTree() });
    logHistory('Cleared the tree');
    render({ sound: false });
  });

  function updateOrderHint() {
    const m = engine.order;
    $('orderConstraintHint').textContent = `Order ${m}: up to ${m - 1} keys and ${m} children per node.`;
  }
  $('orderSelect').addEventListener('change', (e) => {
    stopPlay();
    clearError();
    clearExampleNote();
    pushUndo(`Change the order to ${e.target.value}`);
    engine.setOrder(Number(e.target.value));
    groups = [];
    carryShown = null;
    stepsDirty = true;
    updateOrderHint();
    emit({ type: 'order', order: engine.order, tree: engine.cloneTree() });
    logHistory(`Changed the order to ${engine.order}, which cleared the tree`);
    render({ animate: false });
  });

  // A scenario is: an order, a list of operations, and whether to play the last one straight away.
  const seq = (a, b, s) => { const r = []; for (let x = a; x <= b; x += (s || 1)) r.push(x); return r; };
  const ins = (keys) => keys.map((k) => ['insert', k]);
  const del = (keys) => keys.map((k) => ['delete', k]);

  const EXAMPLES = {
    presetCascade: {
      label: 'Example: root splits twice', order: 3, ops: ins(seq(10, 70, 10)), play: true,
      note: 'Order 3 allows only 2 keys per node, so splits come quickly. Inserting 30 splits the first node and creates a root. Inserting 70 splits a leaf, which overfills the root, so the root splits as well and the tree grows to three levels.'
    },
    presetBorrow: {
      label: 'Example: borrow from the right sibling', order: 4, ops: [...ins(seq(10, 80, 10)), ...del([20, 10])], play: true,
      note: 'Deleting 20 and then 10 empties the leftmost leaf. Its right sibling [40, 50] has a key to spare, so the tree rotates left: 40 moves up and the old separator 30 moves down.'
    },
    presetBorrowLeft: {
      label: 'Example: borrow from the left sibling', order: 4, ops: [...ins(seq(10, 80, 10)), ...del([80, 70])], play: true,
      note: 'Deleting 80 and then 70 empties the rightmost leaf. Its left sibling [40, 50] has a key to spare, so the tree rotates right: 50 moves up and the old separator 60 moves down.'
    },
    presetMerge: {
      label: 'Example: merge and shrink', order: 4, ops: [...ins(seq(10, 60, 10)), ...del([20, 60, 50, 10])], play: true,
      note: 'After the earlier deletions both leaves hold a single key. Deleting 10 empties its leaf and the sibling [40] has nothing to spare, so they merge with the root\'s 30 between them. The root is now empty, so the merged node becomes the root and the tree is one level shorter.'
    },
    presetInternal: {
      label: 'Example: delete an internal key', order: 4, ops: [...ins(seq(10, 70, 10)), ...del([30])], play: true,
      note: '30 sits in the root. Instead of removing it there, the tree takes the largest key to its left (20, the predecessor) out of its leaf and puts it in 30\'s place. The leaf still has a key left, so nothing else changes.'
    },
    presetRipple: {
      label: 'Example: merges reach the root', order: 3, ops: [...ins(seq(1, 7)), ...del([7])], play: true,
      note: 'With order 3 every node is at its minimum of one key. Deleting 7 empties a leaf, no sibling can spare a key, so it merges. That leaves its parent empty, so that merges too, and the root runs out of keys: the tree loses a level.'
    },
    presetGate: {
      label: 'Example: a three-level tree', order: 4, ops: ins(seq(10, 150, 10)), play: false,
      note: 'Fifteen keys at order 4: one key in the root, two nodes below it and five leaves. Press the first-step button and then Play to watch it being built.'
    }
  };

  function loadScenario(spec) {
    stopPlay();
    clearError();
    showTab('tab-builder');
    pushUndo((spec.label || 'Load a scenario').replace(/^Example: /, 'Load the example: '));
    $('orderSelect').value = String(spec.order);
    engine.setOrder(spec.order);
    emit({ type: 'order', order: engine.order, tree: engine.cloneTree(), via: spec.label || 'a scenario' });
    perform(spec.ops, { source: 'example', label: spec.label || 'Scenario' });
    updateOrderHint();
    logHistory(spec.label || 'Loaded a scenario');
    if (spec.note) showExampleNote(spec.note); else clearExampleNote();
    const last = groups[groups.length - 1];
    engine.currentFrameIdx = spec.play && last ? last.start : engine.frames.length - 1;
    selectedId = null;
    render({ animate: false });
    if (spec.play && last) startPlay();
  }
  Object.keys(EXAMPLES).forEach((id) => $(id).addEventListener('click', () => { exampleKey = id; loadScenario(EXAMPLES[id]); }));

  // ======================================================================
  // 6. Tabs, theme, sound, keyboard
  // ======================================================================
  const tabButtons = Array.from(document.querySelectorAll('[role="tab"]'));
  const panes = Array.from(document.querySelectorAll('.pane'));
  const HASH = { 'tab-builder': 'visualizer', 'tab-quiz': 'quiz', 'tab-exam': 'competitive-exam', 'tab-download': 'download', 'tab-help': 'help', 'tab-team': 'developed-by', 'tab-learn': 'learn', 'tab-tests': 'checks' };
  const PANE_FOR_HASH = Object.keys(HASH).reduce((m, id) => { m[HASH[id]] = id; return m; }, {});
  // addresses from earlier versions of the site still lead somewhere sensible
  Object.assign(PANE_FOR_HASH, { build: 'tab-builder', practice: 'tab-quiz', exam: 'tab-exam', theory: 'tab-learn', sheet: 'tab-download', export: 'tab-download', notes: 'tab-help' });

  function showTab(id, opts) {
    if (!HASH[id]) id = 'tab-builder';
    const changed = document.body.dataset.tab !== id;
    tabButtons.forEach((t) => { const on = t.dataset.tab === id; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; });
    panes.forEach((p) => { p.hidden = p.id !== id; });
    document.body.dataset.tab = id;
    if (id !== 'tab-builder') settleToEnd();    // a playing operation should not carry on behind another tab; the other tabs get its finished tree
    if (!(opts && opts.noHash)) { try { history_replace('#' + HASH[id]); } catch (e) { /* file:// can refuse */ } }
    if (id === 'tab-builder') requestAnimationFrame(() => { if (view.auto) refit(false); scrollStepIntoView(); });
    if (id === 'tab-download') updateExportTab();
    if (id === 'tab-learn') ensureTheoryFigures();
    if (changed && !(opts && opts.noScroll)) window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent('btree:tabshown', { detail: { id } }));
  }
  function history_replace(h) { window.history.replaceState(null, '', h); }

  tabButtons.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  $('navTabs').addEventListener('keydown', (e) => {
    const i = tabButtons.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % tabButtons.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + tabButtons.length) % tabButtons.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = tabButtons.length - 1;
    if (j === null) return;
    e.preventDefault();
    tabButtons[j].focus();
    showTab(tabButtons[j].dataset.tab);
  });
  document.querySelectorAll('[data-goto]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); showTab(a.dataset.goto); }));
  // the small jump buttons at the top of the Learn and Help pages
  document.querySelectorAll('[data-scrollto]').forEach((b) => b.addEventListener('click', () => {
    const el = $(b.dataset.scrollto);
    if (!el) return;
    el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    const h = el.querySelector('h3');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }));
  window.addEventListener('hashchange', () => { const id = PANE_FOR_HASH[location.hash.slice(1)]; if (id) showTab(id, { noHash: true }); });

  // theme
  function setTheme(t, remember) {
    document.documentElement.setAttribute('data-theme', t);
    if (remember) store.set('theme', t);
    $('dayModeBtn').setAttribute('aria-pressed', t === 'light' ? 'true' : 'false');
    $('nightModeBtn').setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
    redraw();
    redrawFigures();
    if (document.body.dataset.tab === 'tab-download') updateExportTab();
    emit({ type: 'theme', theme: t });
  }
  $('dayModeBtn').addEventListener('click', () => setTheme('light', true));
  $('nightModeBtn').addEventListener('click', () => setTheme('dark', true));

  // sound: off until the person turns it on
  let soundOn = store.get('sound') === 'on';
  let audioCtx = null;
  function setSoundUi() {
    $('soundLabel').textContent = soundOn ? 'Sound on' : 'Sound off';
    $('soundToggleBtn').setAttribute('aria-pressed', soundOn ? 'true' : 'false');
  }
  function tone(freq, dur, type, vol, delay) {
    if (!soundOn) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t0 = audioCtx.currentTime + (delay || 0);
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(vol || 0.05, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t0); osc.stop(t0 + dur);
    } catch (e) { /* audio blocked: stay silent */ }
  }
  function chime(f) {
    if (!soundOn) return;
    switch (f.actionType) {
      case 'insert': tone(523, 0.14); break;
      case 'split': tone(660, 0.14, 'triangle'); tone(784, 0.16, 'triangle', 0.05, 0.09); break;
      case 'delete': tone(392, 0.14, 'triangle'); break;
      case 'borrow': case 'merge': case 'shrink': tone(440, 0.16, 'triangle'); break;
      case 'found': tone(587, 0.12); tone(880, 0.18, 'sine', 0.05, 0.1); break;
      case 'error': tone(196, 0.2, 'triangle'); break;
      default: tone(330, 0.05, 'sine', 0.03);
    }
  }
  $('soundToggleBtn').addEventListener('click', () => {
    soundOn = !soundOn;
    store.set('sound', soundOn ? 'on' : 'off');
    setSoundUi();
    if (soundOn) tone(523, 0.12);
  });

  // keyboard shortcuts on the Build tab
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey) return;
    if (document.body.dataset.tab !== 'tab-builder') return;
    const t = e.target, tag = t && t.tagName;
    // The cursor goes back to the keys box after every Insert, Delete or Search. While that box is empty there is
    // nothing to type or move through, so Space and the arrow keys are free to control the steps from there, and
    // Ctrl+Z undoes the operation that has just run. Once something has been typed, Ctrl+Z belongs to the box again.
    const k0 = (e.key || '').toLowerCase();
    const idleBox = t === keysInput && keysInput.value === '' &&
      ((e.ctrlKey || e.metaKey) ? (!typedSinceOp && (k0 === 'z' || k0 === 'y')) : (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight'));
    if (!idleBox && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable))) return;   // typing: leave the keys alone
    if (e.ctrlKey || e.metaKey) {
      const k = (e.key || '').toLowerCase();
      if (k === 'z' || k === 'y') {
        e.preventDefault();
        if (k === 'y' || e.shiftKey) redo(); else undo();
      }
      return;
    }
    if (t && t.closest && t.closest('[role="tablist"]')) return;
    const onButton = tag === 'BUTTON' || (t && t.classList && t.classList.contains('node'));
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(engine.currentFrameIdx + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(engine.currentFrameIdx - 1); }
    else if (e.key === 'Home' && !onButton) { e.preventDefault(); goTo(0); }
    else if (e.key === 'End' && !onButton) { e.preventDefault(); goTo(engine.frames.length - 1); }
    else if (e.key === ' ' && !onButton) { e.preventDefault(); if (!e.repeat) { playTimer ? stopPlay() : startPlay(); } }
    else if (e.key === 'Escape') { view.auto = true; refit(true); }
  });

  // ======================================================================
  // 7. Export, theory figures, lab sheet
  // ======================================================================
  function shownFrame() { return engine.frames[clamp(engine.currentFrameIdx, 0, engine.frames.length - 1)]; }

  function exportOptions() {
    const style = (document.querySelector('input[name="exportStyle"]:checked') || {}).value || 'paper';
    return { style, grid: $('optGrid').checked, highlight: $('optHighlight').checked, scale: Number($('optScale').value) || 2 };
  }
  function buildExport() {
    const o = exportOptions(), f = shownFrame();
    return standaloneSvg(f.tree, { palette: o.style, grid: o.grid, frame: o.highlight ? f : null, minWidth: 260, clean: true });
  }
  function updateExportTab() {
    const f = shownFrame();
    $('snapshotPreviewBox').innerHTML = buildExport().svg;
    $('txtExportTree').value = hasNodes(f.tree) ? `B-tree of order ${engine.order}\n${treeText(f.tree)}` : `B-tree of order ${engine.order}\n(empty tree)`;
  }
  ['optGrid', 'optHighlight', 'optScale'].forEach((id) => $(id).addEventListener('change', updateExportTab));
  document.querySelectorAll('input[name="exportStyle"]').forEach((r) => r.addEventListener('change', updateExportTab));

  function fileStem() {
    const st = treeStats(shownFrame().tree);
    return `btree-order-${engine.order}-${st.totalKeys}-keys`;
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function say(msg) {
    const s = $('copyStatus');
    s.textContent = msg;
    clearTimeout(say.t);
    say.t = setTimeout(() => { s.textContent = ''; }, 3500);
  }
  $('btnExportSvg').addEventListener('click', () => {
    download(new Blob([buildExport().svg], { type: 'image/svg+xml;charset=utf-8' }), fileStem() + '.svg');
  });
  $('btnExportPng').addEventListener('click', () => {
    const { svg, width, height } = buildExport();
    const scale = exportOptions().scale;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) download(blob, fileStem() + '.png'); else say('This browser could not make the PNG. Use the SVG instead.');
      }, 'image/png');
    };
    img.onerror = () => say('This browser could not make the PNG. Use the SVG instead.');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  $('btnCopyTextReport').addEventListener('click', () => {
    const text = $('txtExportTree').value;
    const done = () => say('Copied.');
    const fallback = () => { $('txtExportTree').select(); try { document.execCommand('copy'); done(); } catch (e) { say('Select the text and copy it by hand.'); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  });

  // The Learn page shows a few fixed examples, each built by running the engine.
  function treeAfter(order, keys) {
    const e = new BTreeEngine(order);
    e.setOrder(order);
    keys.forEach((k) => e.insert(k));
    return e.cloneTree();
  }
  const LEARN_FIGURES = {
    ref15: { order: 4, keys: seq(10, 150, 10) },
    split3: { order: 3, keys: [10, 20, 30] }
  };
  function ensureTheoryFigures() {
    document.querySelectorAll('[data-figure]').forEach((el) => {
      const spec = LEARN_FIGURES[el.dataset.figure];
      if (!spec) return;
      el.classList.add('fig-live');
      if (!el._fig) drawFigure(el, treeAfter(spec.order, spec.keys), { order: spec.order });
    });
  }

  function inOrderKeys(tree) {
    const out = [];
    (function walk(n) {
      for (let i = 0; i < n.keys.length; i++) { if (n.children && n.children[i]) walk(n.children[i]); out.push(n.keys[i]); }
      if (n.children && n.children[n.keys.length]) walk(n.children[n.keys.length]);
    })(tree);
    return out;
  }

  // ======================================================================
  // Start up
  // ======================================================================
  setSoundUi();
  setCountsUi();
  updateUndoUi();
  setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light', false);
  engine.setOrder(4);
  perform(ins(seq(10, 150, 10)), { source: 'startup' });
  logHistory('Started with an order-4 tree holding the keys 10 to 150');
  updateOrderHint();
  render({ animate: false });
  showTab(PANE_FOR_HASH[location.hash.slice(1)] || 'tab-builder', { noHash: true });

  window.BTreeUI = {
    engine, esc, plural, clamp, store, reducedMotion, seq, ins, del,
    loadScenario, showTab, drawFigure, redrawFigures, standaloneSvg, readThemePalette, tone,
    undo, redo, treeStats, treeText, problemsOf, inOrderKeys, hasNodes,
    on: (fn) => { listeners.push(fn); },
    treeAfter,
    historyEntries: () => history.slice()
  };
})();
