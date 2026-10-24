/**
 * report.js: the Download page.
 *
 * It keeps a record of what the person does on the Visualizer (by listening to BTreeUI.on), and turns that record
 * into a report with these parts:
 *     User Inputs, Processing Steps, Intermediate Results, Final Output, Graphs / Tables / Figures
 * plus the latest quiz and the built-in checks, if the person asks for them.
 *
 * The report is first built as a list of "blocks" (heading, paragraph, table, figure ...). Four writers turn the same
 * blocks into: the preview on the page, a text file, a PDF (jsPDF, in vendor/) and a Word .docx file
 * (written by hand: a .docx is a zip file of XML parts, and zip.js below writes the zip).
 * Figures and graphs are SVG; the PDF and Word files carry them as PNG pictures.
 * Everything is made in the browser. Nothing is sent anywhere.
 */
(function () {
  'use strict';
  const UI = window.BTreeUI;
  const $ = (id) => document.getElementById(id);
  const { esc } = UI;

  const MAX_OPS = 400;     // operations remembered; later ones are counted but not listed
  const MAX_FIGS = 10;     // trees drawn as figures in the Intermediate Results part

  // ======================================================================
  // 1. The record of the session
  // ======================================================================
  const session = {
    startedAt: new Date(),
    start: { order: UI.engine.order, tree: UI.engine.cloneTree() },   // the sample tree the page opens with
    log: [],        // {kind:'op', op} or {kind:'other', text, order}
    ops: [],        // every operation, in order
    dropped: 0
  };
  const DETAIL = {
    splits: ['split-overflow'], borrows: ['rotate-left', 'rotate-right'], merges: ['merge-left', 'merge-right']
  };
  const countDetail = (frames, list) => frames.filter((f) => list.includes(f.detail)).length;

  function statsOf(tree) {
    if (!UI.hasNodes(tree)) return { keys: 0, nodes: 0, levels: 0 };
    const s = UI.treeStats(tree);
    return { keys: s.totalKeys, nodes: s.totalNodes, levels: s.height };
  }
  function outcomeOf(op, frames) {
    const has = (d) => frames.some((f) => f.detail === d);
    if (op === 'insert') return has('duplicate') ? 'Not inserted: the key is already in the tree' : 'Inserted';
    if (op === 'delete') return has('missing') ? 'Not deleted: the key is not in the tree' : 'Deleted';
    return has('found') ? 'Found' : 'Not found';
  }
  UI.on((ev) => {
    if (ev.type === 'ops') {
      if (ev.source === 'startup') return;
      if (ev.source === 'example' && ev.label) session.log.push({ kind: 'other', text: `Loaded the example "${ev.label}"`, order: ev.order, by: 'Example' });
      ev.groups.forEach((g) => {
        if (session.ops.length >= MAX_OPS) { session.dropped++; return; }
        const fr = ev.frames.slice(g.start, g.end + 1);
        const last = fr[fr.length - 1];
        const tree = last ? last.tree : ev.tree;
        const op = {
          no: session.ops.length + 1, op: g.op, key: g.key, order: ev.order, by: ev.source === 'example' ? 'Example' : 'Typed',
          steps: fr.map((f) => f.message), tree, stats: statsOf(tree), outcome: outcomeOf(g.op, fr),
          splits: countDetail(fr, DETAIL.splits), borrows: countDetail(fr, DETAIL.borrows), merges: countDetail(fr, DETAIL.merges)
        };
        session.ops.push(op);
        session.log.push({ kind: 'op', op });
      });
    } else if (ev.type === 'clear') {
      session.log.push({ kind: 'other', text: 'Cleared the tree', order: ev.order, by: 'Button' });
    } else if (ev.type === 'order') {
      if (!ev.via) session.log.push({ kind: 'other', text: `Changed the order to ${ev.order}, which cleared the tree`, order: ev.order, by: 'Menu' });
    } else if (ev.type === 'undo' || ev.type === 'redo') {
      session.log.push({ kind: 'other', text: `${ev.type === 'undo' ? 'Undid' : 'Redid'}: ${ev.label}`, order: ev.order, by: 'Button' });
    }
  });

  // ======================================================================
  // 2. Text helpers
  // ======================================================================
  const ASCII_MAP = {
    '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '−': '-', '…': '...',
    '×': 'x', '÷': '/', '≤': '<=', '≥': '>=', '→': '->', '←': '<-', '•': '*', '·': '*',
    '⌈': 'ceil(', '⌉': ')', '⌊': 'floor(', '⌋': ')', ' ': ' ', ' ': ' ', ' ': ' ', ' ': '  ',
    '≠': '!=', '√': 'sqrt', 'Σ': 'sum'
  };
  // Plain ASCII only: the PDF's built-in fonts and the text file must never show a broken character.
  function ascii(s) {
    return String(s).replace(/\t/g, '    ').replace(/[^\x0a\x20-\x7e]/g, (ch) => {
      if (ASCII_MAP[ch] !== undefined) return ASCII_MAP[ch];
      const base = ch.normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
      return base || '?';
    });
  }
  const stripCtl = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
  const plainText = (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/&minus;/g, '-').replace(/&nbsp;|&emsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&[a-z]+;/g, '').replace(/\s+/g, ' ').trim();
  const dateText = (d) => d.toLocaleString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const stamp = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
  const listText = (a) => (a.length ? a.join(', ') : 'none');
  const word = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // ======================================================================
  // 3. Graphs (SVG)
  // ======================================================================
  const CH = { ink: '#1c2738', ink2: '#4b586b', grid: '#d9dee6', a: '#1f4e8c', b: '#b1342b' };
  const SANS = 'Arial, Helvetica, sans-serif';
  function niceStep(max) {
    if (max <= 5) return 1;
    const raw = max / 5, pow = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pow;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  }
  function chartFrame(o, maxY) {
    const W = 640, H = 340, L = 58, R = 22, T = 56, B = 62;
    const step = niceStep(maxY), top = Math.max(step, Math.ceil(maxY / step) * step);
    const pw = W - L - R, ph = H - T - B;
    const X = (i, n) => L + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
    const Y = (v) => T + ph - (v / top) * ph;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.alt)}">`;
    s += `<rect width="${W}" height="${H}" fill="#ffffff"/>`;
    s += `<text x="${L}" y="24" font-family="${SANS}" font-size="15" font-weight="bold" fill="${CH.ink}">${esc(o.title)}</text>`;
    for (let v = 0; v <= top + 1e-9; v += step) {
      s += `<line x1="${L}" y1="${Y(v)}" x2="${W - R}" y2="${Y(v)}" stroke="${CH.grid}" stroke-width="1"/>`;
      s += `<text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" font-family="${SANS}" font-size="12" fill="${CH.ink2}">${v}</text>`;
    }
    s += `<line x1="${L}" y1="${T}" x2="${L}" y2="${T + ph}" stroke="${CH.ink}" stroke-width="1.2"/><line x1="${L}" y1="${T + ph}" x2="${W - R}" y2="${T + ph}" stroke="${CH.ink}" stroke-width="1.2"/>`;
    const n = o.xs.length, every = Math.max(1, Math.ceil(n / 12));
    o.xs.forEach((x, i) => {
      if (i % every === 0 || i === n - 1) s += `<text x="${o.bars ? L + (i + 0.5) * (pw / n) : X(i, n)}" y="${T + ph + 17}" text-anchor="middle" font-family="${SANS}" font-size="12" fill="${CH.ink2}">${x}</text>`;
    });
    s += `<text x="${L + pw / 2}" y="${H - 28}" text-anchor="middle" font-family="${SANS}" font-size="12.5" fill="${CH.ink}">${esc(o.xLabel)}</text>`;
    s += `<text transform="translate(16 ${T + ph / 2}) rotate(-90)" text-anchor="middle" font-family="${SANS}" font-size="12.5" fill="${CH.ink}">${esc(o.yLabel)}</text>`;
    return { s, W, H, L, R, T, ph, pw, X, Y, n };
  }
  function lineChart(o) {   // o: {title, xLabel, yLabel, xs, series:[{name, values, color, dash, shape}], alt}
    const maxY = Math.max(1, ...o.series.map((se) => Math.max(...se.values)));
    const f = chartFrame(o, maxY);
    let s = f.s;
    o.series.forEach((se) => {
      const pts = se.values.map((v, i) => [f.X(i, f.n), f.Y(v)]);
      if (pts.length > 1) s += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${se.color}" stroke-width="2.2"${se.dash ? ` stroke-dasharray="${se.dash}"` : ''}/>`;
      if (pts.length <= 40) pts.forEach(([x, y]) => {
        s += se.shape === 'square' ? `<rect x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" fill="#fff" stroke="${se.color}" stroke-width="1.8"/>` : `<circle cx="${x}" cy="${y}" r="3.8" fill="${se.color}"/>`;
      });
    });
    let lx = f.L;
    o.series.forEach((se) => {
      s += `<line x1="${lx}" y1="42" x2="${lx + 26}" y2="42" stroke="${se.color}" stroke-width="2.2"${se.dash ? ` stroke-dasharray="${se.dash}"` : ''}/>`;
      s += se.shape === 'square' ? `<rect x="${lx + 9.5}" y="38.5" width="7" height="7" fill="#fff" stroke="${se.color}" stroke-width="1.8"/>` : `<circle cx="${lx + 13}" cy="42" r="3.8" fill="${se.color}"/>`;
      s += `<text x="${lx + 32}" y="46" font-family="${SANS}" font-size="12.5" fill="${CH.ink}">${esc(se.name)}</text>`;
      lx += 32 + se.name.length * 7 + 26;
    });
    return { svg: s + '</svg>', w: f.W, h: f.H };
  }
  function barChart(o) {    // o: {title, xLabel, yLabel, xs, values, color, alt}
    o.bars = true;
    const f = chartFrame(o, Math.max(1, ...o.values));
    let s = f.s;
    const slot = f.pw / f.n, bw = Math.min(34, slot * 0.7);
    o.values.forEach((v, i) => {
      const x = f.L + slot * i + (slot - bw) / 2, y = f.Y(v);
      s += `<rect x="${x}" y="${y}" width="${bw}" height="${f.T + f.ph - y}" fill="${o.color}"/>`;
      if (f.n <= 24) s += `<text x="${x + bw / 2}" y="${y - 4}" text-anchor="middle" font-family="${SANS}" font-size="11" fill="${CH.ink}">${v}</text>`;
    });
    return { svg: s + '</svg>', w: f.W, h: f.H };
  }

  // ======================================================================
  // 4. The report as blocks
  // ======================================================================
  function treeFigure(tree, order, caption) {
    const r = UI.standaloneSvg(tree, { palette: 'paper', grid: false, clean: true, order, minWidth: 240 });
    const text = UI.hasNodes(tree) ? UI.treeText(tree) : '(empty tree)';
    return { t: 'fig', svg: r.svg, w: r.width, h: r.height, caption, alt: `${caption}. ${text.replace(/\n/g, '. ')}`, text };
  }
  function pickEven(n, k) {   // k indexes spread over 0..n-1, always including the first and the last
    if (n <= k) return Array.from({ length: n }, (_, i) => i);
    const out = new Set();
    for (let i = 0; i < k; i++) out.add(Math.round((i * (n - 1)) / (k - 1)));
    return Array.from(out);
  }

  function buildModel(o) {
    o = Object.assign({ title: 'B-tree Visualizer: session report', steps: true, inter: true, figs: true, graphs: true, quiz: true, checks: true }, o || {});
    const team = window.BTreeTeam ? window.BTreeTeam.get() : { project: {}, team: [], guide: {} };
    const now = new Date();
    const B = [];
    let secNo = 0;
    const sec = (name) => { secNo++; B.push({ t: 'h2', text: `${secNo}. ${name}` }); };
    const eng = UI.engine;
    const finalTree = eng.cloneTree();
    const ops = session.ops;

    // ---- title block ----
    B.push({ t: 'title', text: stripCtl(o.title).trim() || 'B-tree Visualizer: session report' });
    const kv = [['Project', `${team.project.title || 'B-tree Visualizer'}, ${team.project.subject || 'Database Management Systems'}`], ['Report made', dateText(now)]];
    kv.push(['Developed by', team.team.length ? team.team.map((s) => `${s.name || '(name not added)'} (${s.register || 'register number not added'})`).join('; ') : 'The team details have not been entered yet (see the Developed By page).']);
    kv.push(['Guided by', `${team.guide.name || 'Dr. Swaminathan A'}, ${team.guide.role || 'Assistant Professor'}`]);
    B.push({ t: 'kv', rows: kv });
    B.push({ t: 'p', text: ops.length
      ? `This report records what was done on the Visualizer in this visit: ${word(ops.length, 'operation')} on a B-tree. Every number and every figure below was worked out by the program from those operations.`
      : 'Nothing has been done on the Visualizer yet in this visit, so this report shows only the starting tree. Open the Visualizer, insert, delete or search for some keys, and then make the report again.' });
    const left = [];
    if (!o.steps) left.push('Processing Steps');
    if (!o.inter) left.push('Intermediate Results');
    if (!o.graphs) left.push('Graphs and Tables');
    if (left.length) B.push({ t: 'note', text: `Left out by choice: ${left.join(', ')}.` });
    if (session.dropped) B.push({ t: 'note', text: `Only the first ${MAX_OPS} operations are listed. ${word(session.dropped, 'later operation')} ${session.dropped === 1 ? 'was' : 'were'} done but not recorded.` });

    // ---- 1. User Inputs ----
    sec('User Inputs');
    const startKeys = (function inorder(t) { return UI.hasNodes(t) ? UI.inOrderKeys(t) : []; })(session.start.tree);
    B.push({ t: 'p', text: `Starting point: the Visualizer opens with a sample B-tree of order ${session.start.order} holding the keys ${listText(startKeys)}. It was not typed by the user, so it is shown here only as the starting tree.` });
    if (session.log.length) {
      B.push({ t: 'p', text: 'What was entered, in order:' });
      B.push({ t: 'table', head: ['No.', 'Action', 'Key', 'Order of tree', 'Entered by'], widths: [0.7, 4.4, 0.9, 1.2, 1.2],
        rows: session.log.map((e) => (e.kind === 'op'
          ? [String(e.op.no), { insert: 'Insert', delete: 'Delete', search: 'Search' }[e.op.op], String(e.op.key), String(e.op.order), e.op.by]
          : ['-', e.text, '-', String(e.order), e.by])) });
    } else B.push({ t: 'p', text: 'No keys have been entered yet.' });
    const q = o.quiz && window.BTreeQuiz && window.BTreeQuiz.last;
    if (q) B.push({ t: 'p', text: `Quiz inputs: ${q.requested} question${q.requested === 1 ? '' : 's'} requested at ${q.level} level.` });

    // ---- 2. Processing Steps ----
    if (o.steps) {
      sec('Processing Steps');
      B.push({ t: 'p', text: 'These are the steps the program followed for each operation. A B-tree keeps all its leaves on one level, so each step is one of: walking down to the right node, placing or removing a key, splitting a full node, borrowing from a sibling, or merging two nodes.' });
      if (!ops.length) B.push({ t: 'p', text: 'No operation has been done yet.' });
      ops.forEach((op) => {
        B.push({ t: 'h3', text: `Operation ${op.no}: ${{ insert: 'Insert', delete: 'Delete', search: 'Search' }[op.op]} ${op.key} (order ${op.order})` });
        B.push({ t: 'ol', items: op.steps.map((s) => stripCtl(s)) });
      });
    }

    // ---- 3. Intermediate Results ----
    if (o.inter) {
      sec('Intermediate Results');
      B.push({ t: 'p', text: 'The tree after each operation.' });
      const figAt = new Set(o.figs ? pickEven(ops.length, MAX_FIGS) : []);
      if (o.figs && ops.length) {
        B.push(treeFigure(session.start.tree, session.start.order, `Starting tree (order ${session.start.order})`));
        if (ops.length > MAX_FIGS) B.push({ t: 'note', text: `Figures are drawn for ${figAt.size} of the ${ops.length} operations to keep the file small. The text under every heading shows each one.` });
      }
      if (!ops.length) B.push({ t: 'p', text: 'No operation has been done yet.' });
      ops.forEach((op, i) => {
        B.push({ t: 'h3', text: `After operation ${op.no}: ${{ insert: 'Insert', delete: 'Delete', search: 'Search' }[op.op]} ${op.key}` });
        B.push({ t: 'p', text: `Result: ${op.outcome}. The tree now has ${word(op.stats.keys, 'key')} in ${word(op.stats.nodes, 'node')} on ${word(op.stats.levels, 'level')}.` });
        B.push({ t: 'pre', text: UI.hasNodes(op.tree) ? UI.treeText(op.tree) : '(empty tree)' });
        if (figAt.has(i)) B.push(treeFigure(op.tree, op.order, `Figure: the tree after operation ${op.no} (${{ insert: 'insert', delete: 'delete', search: 'search' }[op.op]} ${op.key})`));
      });
    }

    // ---- 4. Final Output ----
    sec('Final Output');
    const st = statsOf(finalTree);
    const problems = UI.hasNodes(finalTree) ? UI.problemsOf(finalTree) : [];
    B.push({ t: 'p', text: UI.hasNodes(finalTree) ? 'The tree as it is now:' : 'The tree is empty.' });
    B.push({ t: 'pre', text: UI.hasNodes(finalTree) ? UI.treeText(finalTree) : '(empty tree)' });
    if (UI.hasNodes(finalTree)) B.push(treeFigure(finalTree, eng.order, `Figure: the final tree (order ${eng.order})`));
    B.push({ t: 'kv', rows: [
      ['Order of the tree', `${eng.order} (up to ${eng.order - 1} keys and ${eng.order} children in a node)`],
      ['Keys', String(st.keys)], ['Nodes', String(st.nodes)], ['Levels', String(st.levels)],
      ['Keys in sorted order', listText(UI.hasNodes(finalTree) ? UI.inOrderKeys(finalTree) : [])],
      ['B-tree rules', problems.length ? `Broken: ${problems.join(' ')}` : 'All rules hold (keys sorted, every leaf on one level, no node too full or too empty).']
    ] });

    // ---- 5. Graphs, Tables and Figures ----
    if (o.graphs) {
      sec('Graphs, Tables and Figures');
      if (!ops.length) B.push({ t: 'p', text: 'There is nothing to chart until at least one operation has been done.' });
      else {
        const count = (name) => ops.filter((x) => x.op === name).length;
        const sum = (f) => ops.reduce((a, x) => a + f(x), 0);
        B.push({ t: 'h3', text: 'Table A: summary of the operations' });
        B.push({ t: 'table', head: ['Measure', 'Count'], widths: [4, 1], rows: [
          ['Insert operations', String(count('insert'))], ['Delete operations', String(count('delete'))], ['Search operations', String(count('search'))],
          ['Node splits', String(sum((x) => x.splits))], ['Borrows from a sibling', String(sum((x) => x.borrows))], ['Merges of two nodes', String(sum((x) => x.merges))],
          ['Steps recorded in all', String(sum((x) => x.steps.length))]
        ] });
        B.push({ t: 'h3', text: 'Table B: the tree after every operation' });
        B.push({ t: 'table', head: ['No.', 'Operation', 'Result', 'Keys', 'Nodes', 'Levels', 'Steps'], widths: [0.6, 1.5, 3.2, 0.7, 0.8, 0.8, 0.8],
          rows: ops.map((x) => [String(x.no), `${{ insert: 'Insert', delete: 'Delete', search: 'Search' }[x.op]} ${x.key}`, x.outcome, String(x.stats.keys), String(x.stats.nodes), String(x.stats.levels), String(x.steps.length)]) });
        const xs = ops.map((x) => x.no);
        const g1 = lineChart({ title: 'Keys and nodes after each operation', xLabel: 'Operation number', yLabel: 'Count', xs,
          series: [{ name: 'Keys', values: ops.map((x) => x.stats.keys), color: CH.a, shape: 'circle' }, { name: 'Nodes', values: ops.map((x) => x.stats.nodes), color: CH.b, dash: '6 4', shape: 'square' }],
          alt: `Line graph of the number of keys and nodes after each of ${ops.length} operations.` });
        B.push(Object.assign({ t: 'fig', caption: 'Graph 1: the number of keys and nodes after each operation', alt: 'Line graph of keys and nodes after each operation', text: '', isChart: true }, g1));
        const g2 = barChart({ title: 'Steps taken by each operation', xLabel: 'Operation number', yLabel: 'Steps', xs, values: ops.map((x) => x.steps.length), color: CH.a,
          alt: `Bar chart of the number of steps each of the ${ops.length} operations took.` });
        B.push(Object.assign({ t: 'fig', caption: 'Graph 2: the number of steps each operation took', alt: 'Bar chart of steps per operation', text: '', isChart: true }, g2));
        B.push({ t: 'note', text: 'A search takes fewer steps than an insert that splits nodes, because it only walks down and compares. The height (Levels) grows only when the root splits.' });
      }
    }

    // ---- quiz ----
    if (q) {
      sec('Quiz Result');
      B.push({ t: 'p', text: `Level: ${q.level}. Score: ${q.correct} out of ${q.answered}${q.answered ? ` (${q.percent}%)` : ''}.${q.stopped ? ' The quiz was stopped before the last question.' : ''}` });
      if (q.items.length) {
        B.push({ t: 'table', head: ['No.', 'Question', 'Your answer', 'Correct answer', 'Result'], widths: [0.6, 3.6, 1.6, 1.6, 1],
          rows: q.items.map((r) => [String(r.n), r.question.length > 220 ? r.question.slice(0, 217) + '...' : r.question, r.yours, r.right, r.ok ? 'Correct' : 'Not yet']) });
        q.items.forEach((r) => B.push({ t: 'p', text: `Question ${r.n}: ${r.explanation}` }));
      }
    }

    // ---- checks ----
    if (o.checks && window.BTreeTests && !window.BTreeTests.running) {
      const sum = window.BTreeTests.last || window.BTreeTests.run(true);
      sec('Built-in Checks');
      B.push({ t: 'p', text: `${sum.failed ? `${sum.failed} of ${sum.total} checks failed.` : `All ${sum.total} checks passed.`} These test the B-tree engine and the question maker inside your browser.` });
      B.push({ t: 'table', head: ['No.', 'Check', 'Result'], widths: [0.6, 5, 1], rows: sum.results.map((r, i) => [String(i + 1), r.name, r.ok ? 'Passed' : 'Failed']) });
    }

    B.push({ t: 'note', text: 'End of report.' });
    return { title: B[0].text, made: now, blocks: B, author: team.team.map((s) => s.name).filter(Boolean).join(', ') };
  }

  // ======================================================================
  // 5. Writer: the page preview
  // ======================================================================
  function toHtml(model) {
    return model.blocks.map((b) => {
      switch (b.t) {
        case 'title': return `<h1>${esc(b.text)}</h1>`;
        case 'h2': return `<h2>${esc(b.text)}</h2>`;
        case 'h3': return `<h3>${esc(b.text)}</h3>`;
        case 'p': return `<p>${esc(b.text)}</p>`;
        case 'note': return `<p class="r-note">${esc(b.text)}</p>`;
        case 'ol': return `<ol>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ol>`;
        case 'ul': return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
        case 'pre': return `<pre>${esc(b.text)}</pre>`;
        case 'kv': return `<dl class="r-kv">${b.rows.map((r) => `<div><dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd></div>`).join('')}</dl>`;
        case 'table': return `<div class="table-wrap"><table class="plain"><thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        case 'fig': return `<figure>${b.svg}<figcaption>${esc(b.caption)}</figcaption></figure>`;
        default: return '';
      }
    }).join('\n');
  }

  // ======================================================================
  // 6. Writer: the text file
  // ======================================================================
  function wrap(text, width, first, hang) {
    first = first || ''; hang = hang === undefined ? first.replace(/./g, ' ') : hang;
    const out = [];
    let line = first;
    String(text).split(/\n/).forEach((para, pi) => {
      if (pi > 0) { out.push(line.replace(/\s+$/, '')); line = hang; }
      let atStart = line.trim() === '';
      para.split(/\s+/).filter(Boolean).forEach((w) => {
        while (w.length > width - hang.length) {                 // a word longer than a line is cut
          const room = width - line.length;
          if (room < 8 && !atStart) { out.push(line); line = hang; atStart = true; continue; }
          out.push(line + (atStart ? '' : ' ') + w.slice(0, Math.max(1, room - (atStart ? 0 : 1))));
          w = w.slice(Math.max(1, room - (atStart ? 0 : 1)));
          line = hang; atStart = true;
        }
        if (atStart) { line += w; atStart = false; }
        else if (line.length + 1 + w.length <= width) line += ' ' + w;
        else { out.push(line); line = hang + w; }
      });
    });
    out.push(line.replace(/\s+$/, ''));
    return out;
  }
  function textTable(head, rows, weights) {
    const total = 100, cols = head.length, gaps = 3 * (cols - 1);
    const natural = head.map((h, i) => Math.max(h.length, ...rows.map((r) => ascii(r[i]).length)));
    const w = natural.slice();
    while (w.reduce((a, b) => a + b, 0) + gaps > total) {
      let j = 0;
      w.forEach((v, i) => { if (v / (weights ? weights[i] : 1) > w[j] / (weights ? weights[j] : 1)) j = i; });
      if (w[j] <= 6) break;
      w[j]--;
    }
    const line = (cells) => {
      const parts = cells.map((c, i) => wrap(ascii(c), w[i], '', ''));
      const n = Math.max(...parts.map((p) => p.length));
      const res = [];
      for (let k = 0; k < n; k++) res.push(parts.map((p, i) => (p[k] || '').padEnd(w[i])).join(' | ').replace(/\s+$/, ''));
      return res;
    };
    return [].concat(line(head), [w.map((n) => '-'.repeat(n)).join('-+-')], ...rows.map(line));
  }
  function toText(model) {
    const W = 78, out = [];
    model.blocks.forEach((b) => {
      switch (b.t) {
        case 'title': out.push('='.repeat(W), ...wrap(ascii(b.text), W), '='.repeat(W), ''); break;
        case 'h2': out.push('', ascii(b.text), '-'.repeat(Math.min(W, ascii(b.text).length)), ''); break;
        case 'h3': out.push('', ascii(b.text)); break;
        case 'p': out.push(...wrap(ascii(b.text), W), ''); break;
        case 'note': out.push(...wrap('Note: ' + ascii(b.text), W), ''); break;
        case 'ol': b.items.forEach((it, i) => out.push(...wrap(ascii(it), W, `  ${String(i + 1).padStart(2)}. `))); out.push(''); break;
        case 'ul': b.items.forEach((it) => out.push(...wrap(ascii(it), W, '  * '))); out.push(''); break;
        case 'pre': ascii(b.text).split('\n').forEach((l) => out.push('    ' + l)); out.push(''); break;
        case 'kv': b.rows.forEach((r) => out.push(...wrap(ascii(r[1]), W, `${ascii(r[0])}: `, '    '))); out.push(''); break;
        case 'table': out.push(...textTable(b.head, b.rows, b.widths), ''); break;
        case 'fig': out.push(`[${b.isChart ? 'Graph' : 'Figure'}] ${ascii(b.caption)}`);
          if (b.text) ascii(b.text).split('\n').forEach((l) => out.push('    ' + l));
          else out.push('    (the graph is in the PDF and Word versions; its numbers are in Table B)');
          out.push(''); break;
        default: break;
      }
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '') + '\n';
  }

  // ======================================================================
  // 7. Pictures: SVG to PNG
  // ======================================================================
  function rasterize(svg, w, h) {
    return new Promise((resolve, reject) => {
      const scale = Math.max(1, Math.min(3, 1500 / w, 4000 / Math.max(w, h)));
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        const g = c.getContext('2d');
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        const dataUrl = c.toDataURL('image/png');
        const bin = atob(dataUrl.split(',')[1]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        resolve({ dataUrl, bytes, w, h });
      };
      img.onerror = () => reject(new Error('A figure could not be turned into a picture.'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  // ======================================================================
  // 8. Writer: PDF
  // ======================================================================
  async function toPdf(model) {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('The PDF library did not load. Reload the page and try again.');
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const PW = 210, PH = 297, ML = 18, MR = 18, MT = 20, MB = 20, W = PW - ML - MR;
    const INK = [28, 39, 56], BLUE = [31, 78, 140], GREY = [75, 88, 107];
    let y = MT;
    const lh = (pt, k) => pt * 0.3528 * (k || 1.42);
    const ensure = (h) => { if (y + h > PH - MB) { doc.addPage(); y = MT; } };
    function para(text, o) {
      o = Object.assign({ size: 10.5, font: 'helvetica', style: 'normal', indent: 0, color: INK, gap: 2, first: '', keep: 0 }, o || {});
      doc.setFont(o.font, o.style); doc.setFontSize(o.size); doc.setTextColor(...o.color);
      const lines = doc.splitTextToSize(ascii(text), W - o.indent);
      const h = lh(o.size, o.font === 'courier' ? 1.25 : 1.42);
      ensure(h * Math.min(lines.length, 2) + o.keep);
      lines.forEach((l, i) => { ensure(h); doc.text(l, ML + o.indent, y + h * 0.75); y += h; });
      y += o.gap;
    }
    function listItems(items, ordered) {
      items.forEach((it, i) => {
        const label = ordered ? `${i + 1}.` : '*';
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...INK);
        const lines = doc.splitTextToSize(ascii(it), W - 9);
        const h = lh(10.5);
        ensure(h * Math.min(2, lines.length));
        doc.text(label, ML + 3, y + h * 0.75);
        lines.forEach((l) => { ensure(h); doc.text(l, ML + 9, y + h * 0.75); y += h; });
        y += 0.8;
      });
      y += 1.5;
    }
    function table(b) {
      const cols = b.head.length, wts = b.widths || Array(cols).fill(1), sum = wts.reduce((a, c) => a + c, 0);
      const cw = wts.map((x) => (W * x) / sum), size = 9, h1 = lh(size, 1.3), px = 1.6, py = 1.3;
      const maxLines = Math.floor((PH - MT - MB - 2 * py) / h1);
      function row(cells, header) {
        doc.setFont('helvetica', header ? 'bold' : 'normal'); doc.setFontSize(size);
        const lines = cells.map((c, i) => doc.splitTextToSize(ascii(c), cw[i] - 2 * px).slice(0, maxLines));
        const n = Math.max(1, ...lines.map((l) => l.length)), h = n * h1 + 2 * py;
        if (y + h > PH - MB) { doc.addPage(); y = MT; if (!header) row(b.head, true); }
        // All the boxes first, then all the text: jsPDF reuses the text colour as the fill colour if they are mixed.
        doc.setDrawColor(170, 180, 195); doc.setFillColor(232, 238, 246);
        let x = ML;
        cells.forEach((c, i) => { doc.rect(x, y, cw[i], h, header ? 'FD' : 'S'); x += cw[i]; });
        doc.setFont('helvetica', header ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...INK);
        x = ML;
        cells.forEach((c, i) => {
          lines[i].forEach((l, j) => doc.text(l, x + px, y + py + (j + 0.78) * h1));
          x += cw[i];
        });
        doc.setFillColor(255, 255, 255);
        y += h;
      }
      ensure(lh(size, 1.3) * 3 + 4);
      row(b.head, true);
      b.rows.forEach((r) => row(r, false));
      y += 4;
    }
    async function figure(b) {
      const png = await rasterize(b.svg, b.w, b.h);
      let w = b.w * 0.2646, h = b.h * 0.2646;
      const s = Math.min(1, W / w, 90 / h);
      w *= s; h *= s;
      ensure(h + 12);
      doc.addImage(png.dataUrl, 'PNG', ML + (W - w) / 2, y, w, h, undefined, 'FAST');
      y += h + 1.5;
      doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...GREY);
      doc.splitTextToSize(ascii(b.caption), W).forEach((l) => { doc.text(l, PW / 2, y + 3, { align: 'center' }); y += lh(9); });
      y += 4;
    }
    for (const b of model.blocks) {
      switch (b.t) {
        case 'title':
          doc.setFont('helvetica', 'bold'); doc.setFontSize(21); doc.setTextColor(...BLUE);
          doc.splitTextToSize(ascii(b.text), W).forEach((l) => { doc.text(l, ML, y + 7); y += 9; });
          doc.setDrawColor(...BLUE); doc.setLineWidth(0.5); doc.line(ML, y + 1, PW - MR, y + 1); y += 6; break;
        case 'h2':
          ensure(24); y += 3;
          doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...BLUE);
          doc.text(ascii(b.text), ML, y + 5); y += 7;
          doc.setDrawColor(190, 200, 215); doc.setLineWidth(0.3); doc.line(ML, y, PW - MR, y); y += 4; break;
        case 'h3': ensure(22); y += 1.5; para(b.text, { size: 11.5, style: 'bold', gap: 1.5, keep: 12 }); break;
        case 'p': para(b.text); break;
        case 'note': para(b.text, { size: 9.5, style: 'italic', color: GREY }); break;
        case 'ol': listItems(b.items, true); break;
        case 'ul': listItems(b.items, false); break;
        case 'pre': para(b.text, { size: 9, font: 'courier', indent: 3, gap: 3 }); break;
        case 'kv': table({ head: ['Item', 'Value'], widths: [1.3, 4.7], rows: b.rows }); break;
        case 'table': table(b); break;
        case 'fig': await figure(b); break;
        default: break;
      }
    }
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GREY);
      doc.text(ascii(model.title).slice(0, 80), ML, PH - 10);
      doc.text(`Page ${i} of ${n}`, PW - MR, PH - 10, { align: 'right' });
    }
    doc.setProperties({ title: ascii(model.title), subject: 'B-tree Visualizer session report', author: ascii(model.author || 'B-tree Visualizer'), creator: 'B-tree Visualizer' });
    return doc.output('blob');
  }

  // ======================================================================
  // 9. Writer: Word (.docx), with a small zip writer
  // ======================================================================
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  // files: [{name, data: Uint8Array}] -> Uint8Array of a zip file (no compression: the pictures are PNG already)
  function zip(files) {
    const enc = new TextEncoder();
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const chunks = [], central = [];
    let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    });
    let cdSize = 0;
    central.forEach((c) => { cdSize += c.length; });
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = chunks.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
    let p = 0;
    all.forEach((c) => { out.set(c, p); p += c.length; });
    return out;
  }

  const xml = (s) => stripCtl(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const TEXT_W = 9638;   // A4 with 2 cm margins, in twentieths of a point
  const run = (text, rpr) => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
  const para = (inner, ppr) => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-IN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="200"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4E8C"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4E8C"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="1C2738"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:i/><w:color w:val="4B586B"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:after="200"/></w:pPr><w:rPr><w:i/><w:color w:val="4B586B"/><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="284"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="AAB4C3"/><w:left w:val="single" w:sz="4" w:space="0" w:color="AAB4C3"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="AAB4C3"/><w:right w:val="single" w:sz="4" w:space="0" w:color="AAB4C3"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="AAB4C3"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="AAB4C3"/></w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

  async function toDocx(model) {
    const enc = new TextEncoder();
    const media = [];     // {name, bytes}
    let docPrId = 1;
    const body = [];
    function table(head, rows, widths) {
      const cols = head ? head.length : rows[0].length;
      const wts = widths || Array(cols).fill(1), sum = wts.reduce((a, c) => a + c, 0);
      const cw = wts.map((x) => Math.floor((TEXT_W * x) / sum));
      const cell = (txt, i, header) => `<w:tc><w:tcPr><w:tcW w:w="${cw[i]}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EEF6"/>' : ''}</w:tcPr>${para(run(txt, header ? '<w:b/><w:sz w:val="19"/>' : '<w:sz w:val="19"/>'), '<w:spacing w:after="0"/>')}</w:tc>`;
      let s = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${TEXT_W}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>${cw.map((x) => `<w:gridCol w:w="${x}"/>`).join('')}</w:tblGrid>`;
      if (head) s += `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${head.map((h, i) => cell(h, i, true)).join('')}</w:tr>`;
      rows.forEach((r) => { s += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, i) => cell(c, i, false)).join('')}</w:tr>`; });
      return s + '</w:tbl>' + para('', '<w:spacing w:after="120"/>');
    }
    for (const b of model.blocks) {
      switch (b.t) {
        case 'title': body.push(para(run(b.text), '<w:pStyle w:val="Title"/>')); break;
        case 'h2': body.push(para(run(b.text), '<w:pStyle w:val="Heading1"/>')); break;
        case 'h3': body.push(para(run(b.text), '<w:pStyle w:val="Heading2"/>')); break;
        case 'p': body.push(para(run(b.text))); break;
        case 'note': body.push(para(run(b.text), '<w:pStyle w:val="Note"/>')); break;
        case 'ol': b.items.forEach((it, i) => body.push(para(run(`${i + 1}.\t${it}`), '<w:spacing w:after="40"/><w:ind w:left="567" w:hanging="425"/>'))); break;
        case 'ul': b.items.forEach((it) => body.push(para(run(`•\t${it}`), '<w:spacing w:after="40"/><w:ind w:left="567" w:hanging="425"/>'))); break;
        case 'pre': b.text.split('\n').forEach((l) => body.push(para(run(l), '<w:pStyle w:val="Code"/>'))); body.push(para('', '<w:spacing w:after="80"/>')); break;
        case 'kv': body.push(table(null, b.rows, [1.3, 4.7])); break;
        case 'table': body.push(table(b.head, b.rows, b.widths)); break;
        case 'fig': {
          const png = await rasterize(b.svg, b.w, b.h);
          const idx = media.length + 1, name = `image${idx}.png`;
          media.push({ name, bytes: png.bytes });
          let wpx = b.w, hpx = b.h;
          const maxW = 6.3 * 96, maxH = 3.6 * 96, s = Math.min(1, maxW / wpx, maxH / hpx);
          wpx *= s; hpx *= s;
          const cx = Math.round(wpx * 9525), cy = Math.round(hpx * 9525), id = docPrId++;
          body.push(para(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${xml(b.alt || b.caption)}"/>` +
            `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
            `<pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${idx}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
            `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`,
            '<w:keepNext/><w:jc w:val="center"/><w:spacing w:after="40"/>'));
          body.push(para(run(b.caption), '<w:pStyle w:val="Caption"/>'));
          break;
        }
        default: break;
      }
    }
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join('')}` +
      `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      media.map((m, i) => `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('') + '</Relationships>';
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${xml(model.title)}</dc:title><dc:creator>${xml(model.author || 'B-tree Visualizer')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${model.made.toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`;
    const files = [
      { name: '[Content_Types].xml', data: enc.encode(contentTypes) }, { name: '_rels/.rels', data: enc.encode(rootRels) },
      { name: 'word/document.xml', data: enc.encode(documentXml) }, { name: 'word/_rels/document.xml.rels', data: enc.encode(rels) },
      { name: 'word/styles.xml', data: enc.encode(STYLES) }, { name: 'docProps/core.xml', data: enc.encode(core) }
    ].concat(media.map((m) => ({ name: 'word/media/' + m.name, data: m.bytes })));
    return new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  // ======================================================================
  // 10. The page
  // ======================================================================
  const opts = () => ({
    title: $('dlTitle').value, steps: $('dlSteps').checked, inter: $('dlInter').checked, figs: $('dlFigs').checked,
    graphs: $('dlGraphs').checked, quiz: $('dlQuiz').checked, checks: $('dlChecks').checked
  });
  function refreshPreview() {
    try {
      const model = buildModel(opts());
      $('reportPreview').innerHTML = toHtml(model);
    } catch (err) {
      $('reportPreview').textContent = 'The preview could not be made: ' + (err && err.message ? err.message : err);
    }
  }
  let previewTimer = null;
  const later = () => { clearTimeout(previewTimer); previewTimer = setTimeout(refreshPreview, 250); };
  ['dlTitle', 'dlSteps', 'dlInter', 'dlFigs', 'dlGraphs', 'dlQuiz', 'dlChecks'].forEach((id) => {
    $(id).addEventListener('input', later);
    $(id).addEventListener('change', later);
  });
  // "figures" only means something when the intermediate results are on
  $('dlInter').addEventListener('change', () => { $('dlFigs').disabled = !$('dlInter').checked; });
  document.addEventListener('btree:teamchanged', later);
  document.addEventListener('btree:tabshown', (e) => { if (e.detail.id === 'tab-download') refreshPreview(); });

  function save(blob, ext) {
    const name = `btree-report-${stamp(new Date())}.${ext}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return name;
  }
  const kb = (n) => (n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  const BUTTONS = ['btnDlPdf', 'btnDlDocx', 'btnDlTxt'];
  async function download(kind) {
    const status = $('dlStatus');
    status.dataset.state = '';
    BUTTONS.forEach((id) => { $(id).disabled = true; });
    status.textContent = `Making the ${{ pdf: 'PDF', docx: 'Word document', txt: 'text file' }[kind]}...`;
    try {
      // let the browser paint the message before the heavy work starts
      await new Promise((r) => setTimeout(r, 30));
      const model = buildModel(opts());
      let blob;
      if (kind === 'pdf') blob = await toPdf(model);
      else if (kind === 'docx') blob = await toDocx(model);
      else blob = new Blob([toText(model)], { type: 'text/plain;charset=utf-8' });
      const name = save(blob, kind);
      status.dataset.state = 'ok';
      status.textContent = `Saved ${name} (${kb(blob.size)}). It is in your Downloads folder.`;
    } catch (err) {
      status.dataset.state = 'bad';
      status.textContent = `The ${kind === 'docx' ? 'Word document' : kind.toUpperCase()} could not be made: ${err && err.message ? err.message : err}`;
    } finally {
      BUTTONS.forEach((id) => { $(id).disabled = false; });
    }
  }
  $('btnDlPdf').addEventListener('click', () => download('pdf'));
  $('btnDlDocx').addEventListener('click', () => download('docx'));
  $('btnDlTxt').addEventListener('click', () => download('txt'));

  if (document.body.dataset.tab === 'tab-download') refreshPreview();
  else $('reportPreview').innerHTML = '<p class="muted">The preview appears when this page is open.</p>';

  window.BTreeReport = {
    session, buildModel, toText, toHtml, toPdf, toDocx, ascii, zip, crc32,
    options: opts
  };
})();
