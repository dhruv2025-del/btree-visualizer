/**
 * practice.js: the question maker, the quick answers, and the calculator.
 *
 *   1. BTreeMath      the formulas for order, keys and levels (also used by tests.js and exam.js)
 *   2. helpers        random numbers, building trees with the engine
 *   3. questions      one function per kind of question; each returns the question and its answer
 *   4. the bank       Easy, Medium and Hard are the levels beginner, intermediate and gate
 *   5. quick answers  written in advance, matched to what you type by keywords (shown on the Learn page)
 *   6. calculator     the order and height calculator (shown on the COMPETITIVE EXAM page)
 *
 * quiz.js runs the quiz on top of generate(), and exam.js uses the helpers exported as BTreePractice.kit.
 * Tree questions are made by running btree-engine.js, the same engine as the Visualizer, so the
 * answer is whatever the engine does. Hard questions use BTreeMath. Nothing here talks to a server.
 */
(function () {
  'use strict';

  const UI = window.BTreeUI;
  const { esc, plural } = UI;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => n.toLocaleString('en-US');           // 1234567 -> "1,234,567" (works for BigInt too)
  const article = (n) => (/^(8|11|18|8\d)$/.test(String(n)) ? 'an' : 'a');   // "an 8-byte", "a 6-byte"

  // ======================================================================
  // 1. The formulas
  // ======================================================================
  // m = order (most children). t = ceil(m/2) = fewest children of a node that is not the root.
  // "Levels" counts the root as level 1, so a single node is 1 level.
  // BigInt is used where numbers can get large (m to the power h) so nothing overflows.
  const BTreeMath = {
    maxKeys: (m) => m - 1,
    minKeys: (m) => Math.ceil(m / 2) - 1,                  // every node except the root
    minChildren: (m) => Math.ceil(m / 2),

    // Most keys a tree with h levels can hold: every node full.   m^h - 1
    maxKeysInLevels(m, h) { return BigInt(m) ** BigInt(h) - 1n; },

    // Fewest keys a tree with h levels can hold: one key in the root, every other node at its
    // minimum, which gives 2 t^(h-1) - 1.
    minKeysInLevels(m, h) { return 2n * BigInt(Math.ceil(m / 2)) ** BigInt(h - 1) - 1n; },

    // Fewest levels that can hold n keys.
    minLevels(m, n) {
      const N = BigInt(n);
      let h = 1;
      while (BTreeMath.maxKeysInLevels(m, h) < N) h++;
      return h;
    },

    // Most levels that n keys can be spread over.
    maxLevels(m, n) {
      const N = BigInt(n);
      let h = 1;
      while (BTreeMath.minKeysInLevels(m, h + 1) <= N) h++;
      return h;
    },

    // A node of order p holds p block pointers (P bytes each) and p - 1 keys (K bytes each),
    // and with record pointers (R bytes) every key carries one too. It has to fit in B bytes.
    nodeBytes(p, P, K, R) { return p * P + (p - 1) * (K + R); },
    // The largest such p. For a B+ tree internal node there are no record pointers, so R = 0.
    orderFor(B, P, K, R) { return Math.floor((B + K + R) / (P + K + R)); }
  };
  window.BTreeMath = BTreeMath;

  // ======================================================================
  // 2. Helpers
  // ======================================================================
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let rng = Math.random;                                   // tests.js swaps in a seeded one
  const rnd = (n) => Math.floor(rng() * n);
  const pick = (a) => a[rnd(a.length)];
  function shuffle(a) {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = r[i]; r[i] = r[j]; r[j] = t; }
    return r;
  }
  function distinctInts(count, lo, hi) {
    const s = new Set();
    while (s.size < count) s.add(lo + rnd(hi - lo + 1));
    return Array.from(s);
  }

  // Build a tree by inserting the keys one after another into a fresh engine.
  function build(order, keys) {
    const e = new BTreeEngine(order);
    e.setOrder(order);
    keys.forEach((k) => e.insert(k));
    return e;
  }
  const insertOps = (keys) => keys.map((k) => ['insert', k]);
  const list = (keys) => keys.join(', ');                  // 20, 40
  const bracket = (keys) => '[' + keys.join(', ') + ']';   // [20, 40]

  function allNodes(tree) {
    const out = [];
    (function walk(n) { out.push(n); (n.children || []).forEach(walk); })(tree);
    return out;
  }
  const isLeaf = (n) => !(n.children && n.children.length);
  const sortedKeys = (tree) => allNodes(tree).reduce((a, n) => a.concat(n.keys), []).sort((a, b) => a - b);
  function levelRows(tree) {
    const rows = [];
    (function walk(n, d) {
      rows[d] = rows[d] || { nodes: 0, keys: 0 };
      rows[d].nodes++;
      rows[d].keys += n.keys.length;
      (n.children || []).forEach((c) => walk(c, d + 1));
    })(tree, 0);
    return rows;
  }
  function describeLevels(tree) {
    return levelRows(tree).map((r, i) => `level ${i + 1} has ${plural(r.nodes, 'node')} holding ${plural(r.keys, 'key')}`).join('; ');
  }

  // Whole numbers close to c (never c itself, never below lo), as strings: good wrong answers.
  function near(c, lo) {
    const out = [];
    for (let d = 1; d <= 3 || out.length < 4; d++) {
      if (c - d >= lo) out.push(String(c - d));
      out.push(String(c + d));
    }
    return out;
  }

  const byNumber = (a, b) => a - b;
  // Wrong answers for "which keys are in the root?": the keys of other nodes, the root with one key
  // swapped for another key of the tree, and a few random lists of the same length.
  function rootKeyWrongs(rootKeys, trees, allKeys) {
    const wrong = [];
    trees.forEach((t) => allNodes(t).filter((n) => n !== t).forEach((n) => wrong.push(list(n.keys))));
    const others = allKeys.filter((x) => !rootKeys.includes(x));
    rootKeys.forEach((x, i) => { const sw = rootKeys.slice(); sw[i] = pick(others); wrong.push(list(sw.sort(byNumber))); });
    for (let i = 0; i < 4; i++) wrong.push(list(shuffle(allKeys).slice(0, rootKeys.length).sort(byNumber)));
    return wrong;
  }

  // A scenario is what "Try this in the builder" opens.
  function scenario(order, ops, play, note) {
    return { order, ops, play: !!play, label: 'Opened from a quiz question', note };
  }
  const insertNote = (keys) => 'The tree from the quiz question. The keys were inserted in this order: ' + list(keys) + '. Use the step buttons to watch it being built.';

  // A question spec has:
  //   stem      the question (html)           context   paragraphs shown under it (html strings)
  //   tree      a tree to draw under it       order     the order of that tree
  //   correct   the right answer (html)       wrong     a pool of wrong answers (html)
  //   hint      html                          explain   html, shown after answering
  //   afterTree a tree to draw in the explanation        scenario  for "Try this in the builder"
  // finalize() picks three different wrong answers, shuffles the four, and notes where the right one went.
  const isBlank = (html) => String(html).replace(/<[^>]*>/g, '').trim() === '';
  function finalize(spec) {
    if (isBlank(spec.correct)) throw new Error('The right answer was blank for: ' + spec.stem);
    const seen = new Set([spec.correct]);
    const wrong = [];
    shuffle(spec.wrong).forEach((w) => { if (!isBlank(w) && !seen.has(w)) { seen.add(w); wrong.push(w); } });
    if (wrong.length < 3) throw new Error('Not enough different wrong answers for: ' + spec.stem);
    const options = shuffle([{ html: spec.correct, correct: true }].concat(wrong.slice(0, 3).map((w) => ({ html: w, correct: false }))));
    return Object.assign({}, spec, { options, answerIndex: options.findIndex((o) => o.correct) });
  }

  // ======================================================================
  // 3. Questions, level 1: basics
  // ======================================================================
  const CEIL_M2 = '<span class="ceil"><i>m</i>/2</span>';

  function genMaxKeys() {
    const m = 3 + rnd(6);                                  // orders 3 to 8
    const c = new BTreeEngine(m).maxKeys();                // the engine knows its own limit
    return {
      stem: `In a B-tree of order <i>m</i> = ${m}, what is the largest number of keys one node can hold?`,
      correct: String(c),
      wrong: near(c, 1).concat([String(m), String(m + 1)]),
      hint: 'A node with <i>k</i> keys has <i>k</i> + 1 children, and the order is the most children a node may have.',
      explain: `<p>Order ${m} means a node can have at most ${m} children. A node with <i>k</i> keys has <i>k</i> + 1 children, so it can hold at most ${m} &minus; 1 = <b>${c}</b> keys.</p>`
    };
  }

  function genMinKeys() {
    const m = 3 + rnd(6);
    const e = new BTreeEngine(m);
    const c = e.minKeys();
    const t = Math.ceil(m / 2);
    return {
      stem: `In a B-tree of order <i>m</i> = ${m}, what is the smallest number of keys a node other than the root may hold?`,
      correct: String(c),
      wrong: [String(t), String(Math.floor(m / 2)), String(Math.floor(m / 2) - 1), String(m - 1), String(Math.max(1, c - 1))].concat(near(c, 1)),
      hint: `The rule is that such a node keeps at least ${CEIL_M2} &minus; 1 keys. Work out ${CEIL_M2} first.`,
      explain: `<p>Every node except the root keeps at least ${CEIL_M2} &minus; 1 keys. For <i>m</i> = ${m} that is ${t} &minus; 1 = <b>${c}</b>. (An internal node with that many keys has ${t} children, the fewest it may have.)</p>`
    };
  }

  function genChildren() {
    const k = 1 + rnd(6);
    if (rnd(2) === 0) {
      const c = k + 1;
      return {
        stem: `A node of a B-tree is not a leaf and holds ${plural(k, 'key')}. How many children does it have?`,
        correct: String(c),
        wrong: [String(k), String(k + 2), String(2 * k), String(Math.max(1, k - 1))].concat(near(c, 1)),
        hint: 'Each key sits between two children, and there is one more child at the far end.',
        explain: `<p>Every key has a child on its left, and the last key also has one on its right. So ${plural(k, 'key')} means <b>${c}</b> children.</p>`
      };
    }
    const c = k + 1;
    return {
      stem: `An internal node of a B-tree has ${c} children. How many keys does it hold?`,
      correct: String(k),
      wrong: [String(c), String(c + 1), String(2 * c), String(Math.max(1, k - 1))].concat(near(k, 1)),
      hint: 'A node with <i>k</i> keys has <i>k</i> + 1 children.',
      explain: `<p>A node with <i>k</i> keys has <i>k</i> + 1 children, so ${c} children means ${c} &minus; 1 = <b>${k}</b> ${k === 1 ? 'key' : 'keys'}.</p>`
    };
  }

  // A small random tree: order, the keys in the order they were inserted, and the engine that holds it.
  function randomTree(orders, nLo, nHi) {
    const order = pick(orders);
    const keys = distinctInts(nLo + rnd(nHi - nLo + 1), 3, 98);
    const e = build(order, keys);
    return { order, keys, e, tree: e.cloneTree(), stats: e.getStats() };
  }

  function genReadCounts() {
    const t = randomTree([3, 4, 5], 8, 15);
    const leaves = allNodes(t.tree).filter(isLeaf).length;
    const variants = [
      { stem: 'How many keys does this tree hold in total?', c: t.stats.totalKeys, hint: 'Add up the keys node by node. Each box holds the keys written in it.' },
      { stem: 'How many nodes does this tree have? (A node is one box.)', c: t.stats.totalNodes, hint: 'Count the boxes, one level at a time.' },
      { stem: 'How many levels does this tree have? (The root is level 1.)', c: t.stats.height, hint: 'Follow any path from the root down to a leaf and count the boxes on it. Every path has the same length.' },
      { stem: 'How many leaves does this tree have? (A leaf is a node with no children.)', c: leaves, hint: 'All the leaves are in the bottom row.' },
      { stem: 'How many keys are in the root?', c: t.tree.keys.length, hint: 'The root is the box at the top.' }
    ];
    const v = pick(variants);
    return {
      stem: v.stem,
      context: [`<p>This is a B-tree of order ${t.order}.</p>`],
      tree: t.tree, order: t.order,
      correct: String(v.c),
      wrong: near(v.c, 1),
      hint: v.hint,
      explain: `<p>Counting level by level: ${describeLevels(t.tree)}. So the tree has ${plural(t.stats.totalKeys, 'key')} in ${plural(t.stats.totalNodes, 'node')} over ${plural(t.stats.height, 'level')}, and ${leaves} of the nodes ${leaves === 1 ? 'is a leaf' : 'are leaves'}. The answer is <b>${v.c}</b>.</p>`,
      scenario: scenario(t.order, insertOps(t.keys), false, insertNote(t.keys))
    };
  }

  function genRootKeys() {
    const t = randomTree([3, 4, 5], 9, 15);
    const rootKeys = t.tree.keys;
    return {
      stem: 'Which keys are in the root of this tree?',
      context: [`<p>This is a B-tree of order ${t.order}. The root is the box at the top.</p>`],
      tree: t.tree, order: t.order,
      correct: list(rootKeys),
      wrong: rootKeyWrongs(rootKeys, [t.tree], sortedKeys(t.tree)),
      hint: 'The root is the single node on level 1. Read the keys left to right.',
      explain: `<p>The top box holds <b>${list(rootKeys)}</b>. The other boxes are on lower levels.</p>`,
      scenario: scenario(t.order, insertOps(t.keys), false, insertNote(t.keys))
    };
  }

  function genSearchVisits() {
    const t = randomTree([3, 4], 10, 16);                  // the smaller orders give taller trees
    const have = sortedKeys(t.tree);
    const present = rnd(10) < 7;
    let target;
    if (present) target = pick(have);
    else { do { target = 3 + rnd(96); } while (have.includes(target)); }
    const probe = build(t.order, t.keys);                  // a second copy of the same tree to search in
    probe.frames = [];
    const r = probe.search(target);
    const c = r.visits;
    const walk = r.path.map(bracket).join(', then ');
    return {
      stem: present
        ? `A search looks for ${target}. How many nodes does it read, counting the root?`
        : `${target} is not in this tree. How many nodes does a search read before it can say so?`,
      context: [`<p>This is a B-tree of order ${t.order}.</p>`],
      tree: t.tree, order: t.order,
      correct: String(c),
      wrong: near(c, 1),
      hint: present
        ? 'At each node, either the key is there, or comparing it with the keys tells you which child to go to.'
        : 'A missing key can only be ruled out at a leaf, so the search has to go all the way down.',
      explain: `<p>The search reads ${walk}. That is <b>${c}</b> ${c === 1 ? 'node' : 'nodes'}.${present ? '' : ' A search for a missing key always ends at a leaf, so it reads one node on every level.'}</p>`,
      scenario: scenario(t.order, insertOps(t.keys).concat([['search', target]]), true, insertNote(t.keys) + ' The last step searches for ' + target + '.')
    };
  }

  // A few ideas that are better asked in words. These are written by hand, not generated.
  const CONCEPTS = [
    {
      stem: 'When can a B-tree get taller?',
      correct: 'Only when the root splits',
      wrong: ['Whenever any leaf splits', 'Whenever a key is inserted', 'Whenever a leaf is deleted'],
      hint: 'Think about which node is the only one that has nothing above it.',
      explain: '<p>A split pushes a key into the parent, so most splits just add a key to a node that already exists. Only when the <b>root</b> splits is there no parent, so a new root is made above it. That adds one level to every path at once, which is why the leaves stay on the same level.</p>'
    },
    {
      stem: 'Where are the leaves of a B-tree?',
      correct: 'All on the same level',
      wrong: ['On levels that differ by at most one', 'Anywhere, as long as the keys stay sorted', 'Only on the right-hand side'],
      hint: 'This is what makes every search read the same number of nodes.',
      explain: '<p>All leaves are on the same level. The tree only grows or shrinks at the root, which moves every leaf down or up together, so the leaves can never get out of step.</p>'
    },
    {
      stem: 'Why does a B-tree node hold many keys instead of one?',
      correct: 'So that one node fills one disk block and the tree stays shallow',
      wrong: ['So that the same key can be stored twice', 'So that the keys do not need to be sorted', 'Because a node can only be read once'],
      hint: 'Think about what is slow when data is on a disk.',
      explain: '<p>Reading a disk block is slow compared with comparing numbers in memory. If one node fills one block, each block read narrows the search a great deal, and the tree needs only a few levels, so only a few reads.</p>'
    },
    {
      stem: 'A node splits. What happens to its middle key?',
      correct: 'It moves up into the parent',
      wrong: ['It is deleted', 'It stays in the left half', 'It moves down into a leaf'],
      hint: 'The two new nodes need something to tell them apart.',
      explain: '<p>After the split there are two nodes where there was one. The middle key is what separates them, so it moves up into the parent, where it sits between the pointers to the two new nodes.</p>'
    },
    {
      stem: 'What does this B-tree do when you insert a key that is already in it?',
      correct: 'It refuses and leaves the tree unchanged',
      wrong: ['It stores the key a second time', 'It splits the node', 'It replaces the old key and moves it to the root'],
      hint: 'Look at what the Visualizer says if you try it.',
      explain: '<p>A B-tree as taught here keeps each key once. The insert is refused and the tree stays as it was.</p>'
    },
    {
      stem: 'Which of these can make a B-tree shorter?',
      correct: 'A delete whose merges take the last key out of the root',
      wrong: ['Any insert', 'A search', 'A delete from a leaf that has keys to spare'],
      hint: 'The tree can only change height at the root.',
      explain: '<p>The tree gets shorter only when merging removes the last key of the root. The root\'s only child then becomes the new root. Inserts never make it shorter, searches change nothing, and a delete from a leaf with spare keys just removes the key.</p>'
    }
  ];
  function genConcept() {
    const c = pick(CONCEPTS);
    return { stem: c.stem, correct: c.correct, wrong: c.wrong.slice(), hint: c.hint, explain: c.explain };
  }

  // ======================================================================
  // 3. Questions, level 2: operations
  // ======================================================================
  const MIDDLE_RULE = '<p>When a node has two middle keys, the right-hand one moves up.</p>';
  const DELETE_RULE = '<p>A node that becomes too small first tries to borrow from its left sibling, then from its right sibling, and merges only if neither can spare a key. A sibling can spare a key if it has more than the minimum.</p>';

  function narration(frames) {
    return '<p>This is what the engine does, step by step:</p><ol>' + frames.map((f) => `<li>${esc(f.message)}</li>`).join('') + '</ol>';
  }

  function genInsertOutcome() {
    const order = pick([3, 4, 5]);
    const keys = distinctInts(6 + rnd(6), 5, 95);
    if (rnd(10) < 3) keys.sort((a, b) => a - b);          // now and then, in ascending order
    const e = build(order, keys);
    const tree = e.cloneTree();
    const stats = e.getStats();
    const splits = e.frames.filter((f) => f.detail === 'split-overflow').length;
    const rootKeys = tree.keys;

    const context = [
      `<p>Start with an empty B-tree of order ${order}. Insert these keys one at a time, in this order:</p>`,
      `<p class="key-seq">${list(keys)}</p>`
    ];
    if (order % 2 === 0) context.push(MIDDLE_RULE);

    const variants = [
      () => {
        const wrong = rootKeyWrongs(rootKeys, [tree], keys);
        wrong.push(list(keys.slice(0, rootKeys.length).sort(byNumber)));             // just the first keys typed
        return { stem: 'Which keys are in the root afterwards?', correct: list(rootKeys), wrong, hint: 'The root changes only when it splits. Walk through the keys and note each time a node gets too full.' };
      },
      () => ({ stem: 'How many levels does the tree have afterwards? (The root is level 1.)', correct: String(stats.height), wrong: near(stats.height, 1), hint: 'The tree gets a new level only when the root splits.' }),
      () => ({ stem: 'How many nodes does the tree have afterwards?', correct: String(stats.totalNodes), wrong: near(stats.totalNodes, 1), hint: 'A split of an ordinary node adds one node. A split of the root adds two, because there is also a new root.' }),
      () => ({ stem: 'How many times does a node split while these keys are inserted?', correct: String(splits), wrong: near(splits, 0), hint: `A node splits each time it ends up with ${order} keys, one more than an order-${order} node may hold.` })
    ];
    const v = pick(variants)();
    return {
      stem: v.stem,
      context,
      correct: v.correct,
      wrong: v.wrong,
      hint: v.hint,
      explain: `<p>The finished tree is drawn below. It holds ${plural(stats.totalKeys, 'key')} in ${plural(stats.totalNodes, 'node')} over ${plural(stats.height, 'level')}, and a node split ${plural(splits, 'time')} on the way. The answer is <b>${v.correct}</b>.</p>`,
      afterTree: tree, afterLabel: 'The finished tree:', order,
      scenario: scenario(order, insertOps(keys), false, insertNote(keys))
    };
  }

  function genSplitPromote() {
    const order = pick([3, 4, 5, 6]);
    const all = distinctInts(order, 10, 90).sort((a, b) => a - b);   // the keys the node holds once it overflows
    const lastIdx = rnd(order);
    const newKey = all[lastIdx];
    const first = all.filter((_, i) => i !== lastIdx);                // order - 1 keys fill one node
    const e = build(order, first);
    e.frames = [];
    e.insert(newKey);
    const promoted = e.root.keys[0];
    const left = e.root.children[0].keys.slice();
    const right = e.root.children[1].keys.slice();
    const mid = Math.floor(order / 2);

    const context = [`<p>An order-${order} B-tree is a single node holding ${list(first)}. You insert ${newKey}. The node now holds ${order} keys, one too many, so it splits around its middle key.</p>`];
    if (order % 2 === 0) context.push(MIDDLE_RULE);

    let q;
    if (order >= 4 && rnd(2) === 0) {
      const wrong = [
        `${list(left.concat(promoted))} and ${list(right)}`,
        `${list(left)} and ${list([promoted].concat(right))}`
      ];
      [mid - 1, mid + 1].forEach((j) => { if (j >= 1 && j <= all.length - 2) wrong.push(`${list(all.slice(0, j))} and ${list(all.slice(j + 1))}`); });
      q = {
        stem: 'What are the two nodes after the split? (The key that moved up is not in either of them.)',
        correct: `${list(left)} and ${list(right)}`, wrong,
        hint: 'First find the middle key. It goes up. The keys on its left form one node and the keys on its right form the other.'
      };
    } else {
      const wrong = all.filter((k) => k !== promoted).map(String);
      if (order === 3) wrong.push('None. The node just keeps growing');
      q = {
        stem: 'Which key moves up into the new root?',
        correct: String(promoted), wrong,
        hint: `Write the ${order} keys in order. The middle one is in position ${mid + 1} counting from the left.`
      };
    }
    return {
      stem: q.stem, context, correct: q.correct, wrong: q.wrong, hint: q.hint,
      explain: `<p>With the new key the node holds ${list(all)}. The middle key is the one in position ${mid + 1} counting from the left: <b>${promoted}</b>. It moves up into a new root. The keys before it (${list(left)}) stay in the left node, and the keys after it (${list(right)}) form the right node.</p>`,
      afterTree: e.cloneTree(), afterLabel: 'After the split:', order,
      scenario: scenario(order, insertOps(first.concat([newKey])), true, 'The node from the practice question, filled and then split. The last insert plays automatically.')
    };
  }

  const DELETE_CLASS = {
    plain: 'Just remove it. Nothing else changes.',
    left: 'Borrow a key from the left sibling (rotate right).',
    right: 'Borrow a key from the right sibling (rotate left).',
    merge: 'Merge the leaf with a sibling.'
  };
  // What did the tree do about the node that lost a key? Look at the first fix the engine made.
  function deleteClass(frames) {
    const fix = frames.map((f) => f.detail).find((d) => /^(rotate|merge)/.test(d));
    if (!fix) return 'plain';
    return fix === 'rotate-right' ? 'left' : fix === 'rotate-left' ? 'right' : 'merge';
  }

  function genDeleteCase() {
    for (let attempt = 0; attempt < 40; attempt++) {
      const order = pick([3, 4, 5]);
      const keys = distinctInts(10 + rnd(8), 5, 95);
      const tree = build(order, keys).cloneTree();
      const leafKeys = allNodes(tree).filter(isLeaf).reduce((a, n) => a.concat(n.keys), []);
      // really delete each leaf key from its own copy of the tree, and group the keys by what happened
      const groups = {};
      leafKeys.forEach((k) => {
        const probe = build(order, keys);
        probe.frames = [];
        probe.delete(k);
        const c = deleteClass(probe.frames);
        (groups[c] = groups[c] || []).push(k);
      });
      const kinds = Object.keys(groups);
      if (kinds.length < 2) continue;                      // want a tree where the answer is not obvious
      const cls = pick(kinds);
      const k = pick(groups[cls]);
      const e = build(order, keys);
      e.frames = [];
      e.delete(k);
      const min = e.minKeys();
      return {
        stem: `What does the tree have to do when ${k} is deleted?`,
        context: [`<p>This is a B-tree of order ${order}. You delete <b>${k}</b>, which sits in a leaf. Every node other than the root must keep at least ${plural(min, 'key')}.</p>`, DELETE_RULE],
        tree, order,
        correct: DELETE_CLASS[cls],
        wrong: Object.keys(DELETE_CLASS).filter((c) => c !== cls).map((c) => DELETE_CLASS[c]),
        hint: `Count the keys the leaf has left. If that is at least ${min}, nothing else is needed. If not, check whether the left sibling has more than ${min}, then the right one.`,
        explain: narration(e.frames),
        afterTree: e.cloneTree(), afterLabel: 'After the delete:',
        scenario: scenario(order, insertOps(keys).concat([['delete', k]]), true, 'The tree from the practice question, with ' + k + ' being deleted. The delete plays automatically.')
      };
    }
    throw new Error('No suitable delete found');
  }

  function genAfterDelete() {
    for (let attempt = 0; attempt < 40; attempt++) {
      const order = pick([3, 4, 5]);
      const keys = distinctInts(10 + rnd(8), 5, 95);
      const base = build(order, keys);
      const tree = base.cloneTree();
      const stats0 = base.getStats();
      const rootBefore = tree.keys.slice();
      const all = sortedKeys(tree);
      // delete every key from its own copy of the tree and remember what happened
      const results = all.map((k) => {
        const e = build(order, keys);
        e.frames = [];
        e.delete(k);
        return { k, e, after: e.cloneTree(), stats: e.getStats() };
      });
      const wantNodes = rnd(2) === 0;
      const pool = wantNodes
        ? results.filter((r) => r.stats.totalNodes !== stats0.totalNodes)
        : results.filter((r) => list(r.after.keys) !== list(rootBefore));
      if (!pool.length) continue;
      const r = pick(pool);
      const k = r.k;
      const context = [
        `<p>This is a B-tree of order ${order}. You delete <b>${k}</b>.</p>`,
        '<p>If the key is not in a leaf, it is first replaced by its predecessor, the largest key to its left.</p>',
        DELETE_RULE
      ];
      let q;
      if (wantNodes) {
        q = {
          stem: `How many nodes does the tree have after ${k} is deleted?`,
          correct: String(r.stats.totalNodes), wrong: near(r.stats.totalNodes, 1),
          hint: 'Only a merge removes a node. A borrow or a plain delete leaves the same nodes.'
        };
      } else {
        const i = all.indexOf(k);
        const pred = all[i - 1], succ = all[i + 1];
        const wrong = [list(rootBefore)];                                                  // the root as it was
        if (rootBefore.length > 1) wrong.push(list(rootBefore.filter((x) => x !== k)));    // the root with k just removed (not when that leaves nothing)
        if (rootBefore.includes(k)) {
          if (pred !== undefined) wrong.push(list(rootBefore.map((x) => (x === k ? pred : x))));
          if (succ !== undefined) wrong.push(list(rootBefore.map((x) => (x === k ? succ : x))));
        }
        rootKeyWrongs(r.after.keys, [tree, r.after], all.filter((x) => x !== k)).forEach((w) => wrong.push(w));
        q = {
          stem: `Which keys are in the root after ${k} is deleted?`,
          correct: list(r.after.keys), wrong,
          hint: 'Follow the delete step by step. A borrow or a merge below the root can change what the root holds.'
        };
      }
      return {
        stem: q.stem, context, tree, order,
        correct: q.correct, wrong: q.wrong, hint: q.hint,
        explain: narration(r.e.frames),
        afterTree: r.after, afterLabel: 'After the delete:',
        scenario: scenario(order, insertOps(keys).concat([['delete', k]]), true, 'The tree from the practice question, with ' + k + ' being deleted. The delete plays automatically.')
      };
    }
    throw new Error('No suitable delete found');
  }

  // ======================================================================
  // 3. Questions, level 3: exam style (formulas)
  // ======================================================================
  const working = (lines) => '<div class="working">' + lines.map((l) => `<div>${l}</div>`).join('') + '</div>';
  const maxK = (m, h) => fmt(BTreeMath.maxKeysInLevels(m, h));
  const minK = (m, h) => fmt(BTreeMath.minKeysInLevels(m, h));
  const levelWord = (n) => (n === 1 ? 'level' : 'levels');

  // The working for "most levels n keys can occupy" and "fewest levels", shared by the quiz and the exam tab.
  function explainMaxLevels(m, N, sym) {
    sym = sym || 'm';
    const t = Math.ceil(m / 2);
    const hi = BTreeMath.maxLevels(m, N);
    const rows = [];
    for (let h = 1; h <= hi + 1; h++) rows.push(`<i>h</i> = ${h}: ${minK(m, h)}`);
    return working([
      `Let <i>t</i> = <span class="ceil"><i>${sym}</i>/2</span> = ${t}. The fewest keys a tree with <i>h</i> levels can hold is 2<i>t</i><sup><i>h</i>&minus;1</sup> &minus; 1:`,
      rows.join(';&emsp;'),
      `${fmt(N)} keys fit in ${hi} ${levelWord(hi)} (${minK(m, hi)} &le; ${fmt(N)}) but not in ${hi + 1} (${minK(m, hi + 1)} &gt; ${fmt(N)}).`,
      `So the most levels is <b>${hi}</b>.`
    ]);
  }
  function explainMinLevels(m, N, sym) {
    sym = sym || 'm';
    const lo = BTreeMath.minLevels(m, N);
    const rows = [];
    for (let h = 1; h <= lo; h++) rows.push(`<i>h</i> = ${h}: ${maxK(m, h)}`);
    return working([
      `The most keys a tree with <i>h</i> levels can hold, with every node full, is <i>${sym}</i><sup><i>h</i></sup> &minus; 1:`,
      rows.join(';&emsp;'),
      lo > 1
        ? `${lo - 1} ${levelWord(lo - 1)} hold${lo - 1 === 1 ? 's' : ''} at most ${maxK(m, lo - 1)}, which is less than ${fmt(N)}. ${lo} levels hold up to ${maxK(m, lo)}.`
        : `One level holds up to ${maxK(m, 1)}, which is enough.`,
      `So the fewest levels is <b>${lo}</b>.`
    ]);
  }
  // The working for "largest order that fits in a block".
  function explainOrder(B, P, K, R) {
    const p = BTreeMath.orderFor(B, P, K, R);
    const q = K + R;
    const withRec = R > 0;
    return {
      p,
      html: working([
        `A node of order <i>p</i> holds <i>p</i> block pointers and <i>p</i> &minus; 1 keys${withRec ? ', and each key comes with a record pointer' : ''}.`,
        withRec ? `<i>p</i>&middot;${P} + (<i>p</i> &minus; 1)&middot;(${K} + ${R}) &le; ${B}` : `<i>p</i>&middot;${P} + (<i>p</i> &minus; 1)&middot;${K} &le; ${B}`,
        `${P + q}<i>p</i> &minus; ${q} &le; ${B}, so <i>p</i> &le; ${B + q} / ${P + q} = ${((B + q) / (P + q)).toFixed(2)}`,
        `The largest whole number is <i>p</i> = <b>${p}</b>.`,
        `Check: ${p} uses ${p}&middot;${P} + ${p - 1}&middot;${q} = ${BTreeMath.nodeBytes(p, P, K, R)} bytes. ${p + 1} would need ${BTreeMath.nodeBytes(p + 1, P, K, R)} bytes, which is more than ${B}.`
      ])
    };
  }


  // The working for "most / fewest keys in a tree with h levels".
  function explainKeysInLevels(m, h, wantMax) {
    const t = Math.ceil(m / 2);
    if (wantMax) {
      const terms = [];
      for (let i = 1; i <= h; i++) terms.push(String((m - 1) * m ** (i - 1)));
      return working([
        `With every node full, level 1 has 1 node, level 2 has ${m}, level 3 has ${m * m}, and so on. Each node holds ${m - 1} keys.`,
        `${terms.join(' + ')} = ${m}<sup>${h}</sup> &minus; 1 = <b>${maxK(m, h)}</b>`
      ]);
    }
    const terms = ['1'];
    for (let i = 2; i <= h; i++) terms.push(String(2 * t ** (i - 2) * (t - 1)));
    return working([
      `With every node as empty as allowed, the root holds 1 key and has 2 children. Every other node holds ${t - 1} ${t - 1 === 1 ? 'key' : 'keys'}, and every internal node below the root has ${t} children, so level 2 has 2 nodes, level 3 has ${2 * t}, and so on.`,
      `${terms.join(' + ')} = 2&middot;${t}<sup>${h - 1}</sup> &minus; 1 = <b>${minK(m, h)}</b>`
    ]);
  }

  function genOrderFromBlock() {
    const withRec = rnd(2) === 1;
    const B = pick([512, 1024, 2048, 4096]);
    const K = pick([4, 8, 10, 12, 16]);
    const P = pick([4, 6, 8, 10]);
    const R = withRec ? pick([4, 6, 8, 10]) : 0;
    const ex = explainOrder(B, P, K, R);
    const p = ex.p;
    const wrong = [
      Math.floor(B / (P + K + R)),                         // forgets that a node has one more pointer than keys
      p - 1,                                               // gives the number of keys, not the order
      p + 1,
      Math.ceil((B + K + R) / (P + K + R)),                // rounds up instead of down
      Math.floor((B + K) / (P + K)),                       // leaves the record pointer out
      p - 2, p + 2
    ].filter((x) => x >= 1).map(String);
    return {
      stem: withRec
        ? `In a B-tree node every key is stored with ${article(R)} ${R}-byte record pointer, and the node also holds one block pointer for each child. The block size is ${B} bytes, a key takes ${K} bytes and a block pointer takes ${P} bytes. What is the largest order <i>p</i> a node can have?`
        : `A B+ tree keeps only keys and block pointers in an internal node. The block size is ${B} bytes, a key takes ${K} bytes and a block pointer takes ${P} bytes. What is the largest order <i>p</i> an internal node can have?`,
      correct: String(p), wrong,
      hint: 'Write the size of a node in terms of <i>p</i>: <i>p</i> block pointers and <i>p</i> &minus; 1 keys. Then make that no bigger than the block.',
      explain: ex.html
    };
  }

  function genLevels() {
    const m = pick([5, 6, 7, 8, 10]);
    const N = pick([100, 200, 500, 1000, 2000, 5000, 10000]);
    const wantMax = rnd(2) === 1;
    const lo = BTreeMath.minLevels(m, N), hi = BTreeMath.maxLevels(m, N);
    const c = wantMax ? hi : lo;
    return {
      stem: `A B-tree of order ${m} holds ${fmt(N)} keys. What is the ${wantMax ? 'largest' : 'smallest'} number of levels it can have? (A single node is 1 level.)`,
      correct: String(c),
      wrong: near(c, 1).concat([String(wantMax ? lo : hi), String(c - 1)]),
      hint: wantMax
        ? 'The tree has the most levels when every node is as empty as the rules allow. Find the fewest keys a tree with <i>h</i> levels can hold.'
        : 'The tree has the fewest levels when every node is full. Find the most keys a tree with <i>h</i> levels can hold.',
      explain: wantMax ? explainMaxLevels(m, N) : explainMinLevels(m, N)
    };
  }

  function genKeysInLevels() {
    const m = pick([3, 4, 5, 6, 7, 8]);
    const h = pick([2, 3, 4]);
    const wantMax = rnd(2) === 1;
    const t = Math.ceil(m / 2);
    const mx = BTreeMath.maxKeysInLevels(m, h), mn = BTreeMath.minKeysInLevels(m, h);
    const c = wantMax ? mx : mn;
    const Bn = BigInt;
    const slips = wantMax
      ? [Bn(m) ** Bn(h), Bn(m) ** Bn(h - 1) - 1n, Bn(m - 1) * Bn(h), mn, Bn(m) ** Bn(h + 1) - 1n]
      : [2n * Bn(m) ** Bn(h - 1) - 1n, Bn(t) ** Bn(h) - 1n, 2n * Bn(t) ** Bn(h) - 1n, 2n * Bn(t) ** Bn(h - 1), mx];
    return {
      stem: `What is the ${wantMax ? 'largest' : 'smallest'} number of keys a B-tree of order ${m} with ${h} levels can hold? (The root is level 1.)`,
      correct: fmt(c),
      wrong: slips.map(fmt).concat(near(Number(c), 1).map((s) => fmt(Number(s)))),
      hint: wantMax ? 'The tree holds the most keys when every node is full.' : 'The tree holds the fewest keys when the root has one key and every other node has as few as the rules allow.',
      explain: explainKeysInLevels(m, h, wantMax)
    };
  }

  const READ_CASES = [[100, 1000000], [200, 10000000], [50, 100000], [20, 100000], [10, 10000], [64, 1000000], [128, 500000]];
  function genBlockReads() {
    const [m, N] = pick(READ_CASES);
    const lo = BTreeMath.minLevels(m, N), hi = BTreeMath.maxLevels(m, N);
    return {
      stem: `An index is a B-tree of order ${m} that holds ${fmt(N)} keys, and every node is stored in its own disk block. In the worst case, how many blocks must be read to find one key?`,
      context: ['<p>Count index nodes only, and assume nothing is kept in memory.</p>'],
      correct: String(hi),
      wrong: near(hi, 1).concat([String(lo), String(hi + 1), String(hi - 1)]),
      hint: 'One block is read per level. The worst case is the tallest tree these keys can make.',
      explain: explainMaxLevels(m, N)
    };
  }

  // ---------- picking a question ----------
  const BANK = {
    beginner: [genMaxKeys, genMinKeys, genChildren, genReadCounts, genReadCounts, genRootKeys, genSearchVisits, genSearchVisits, genConcept],
    intermediate: [genInsertOutcome, genInsertOutcome, genSplitPromote, genDeleteCase, genDeleteCase, genAfterDelete],
    gate: [genOrderFromBlock, genOrderFromBlock, genLevels, genKeysInLevels, genBlockReads]
  };
  const LEVEL_FOR = { easy: 'beginner', medium: 'intermediate', hard: 'gate' };    // the names the QUIZ page uses

  // strict = give up at the first problem instead of trying again (tests.js uses this)
  function generate(level, strict) {
    const makers = BANK[level] || BANK.intermediate;
    let lastErr = null;
    for (let i = 0; i < (strict ? 1 : 20); i++) {
      try { return finalize(pick(makers)()); } catch (err) { lastErr = err; }
    }
    throw lastErr;
  }
  window.BTreePractice = {
    generate,
    levels: Object.keys(BANK),
    LEVEL_FOR,
    setSeed(seed) { rng = seed == null ? Math.random : mulberry32(seed); }
  };

  // ======================================================================
  // 5. Quick answers
  // ======================================================================
  // Written in advance. What you type is compared with the keywords of each answer;
  // nothing is sent anywhere and nothing is generated.
  const QA = [
    { q: 'What is the order of a B-tree?', suggest: true,
      k: ['order', 'degree', 'children', 'maximum', 'define', 'definition', 'mean'],
      a: '<p>The order <i>m</i> is the largest number of children a node may have. A node with <i>k</i> keys has <i>k</i> + 1 children, so it holds at most <i>m</i> &minus; 1 keys.</p><p>Books do not all agree. Some define the order as the minimum degree <i>t</i> instead, so check which definition a question uses.</p>' },
    { q: 'How many keys must a node hold?',
      k: ['keys', 'many', 'hold', 'fewest', 'least', 'most', 'minimum', 'maximum', 'root', 'node'],
      a: `<p>At most <i>m</i> &minus; 1. Every node except the root must hold at least ${CEIL_M2} &minus; 1, and the root needs at least one key. For order 5 that is 2 to 4 keys in an ordinary node.</p>` },
    { q: 'Why does a split move a key up?',
      k: ['split', 'splits', 'splitting', 'promote', 'move', 'middle', 'overflow', 'full', 'parent', 'why'],
      a: '<p>A node with one key too many is cut in two, and one key is left over: the middle one. It is exactly the key that separates the two new nodes, so it goes into the parent, where it divides the pointers to them.</p>' },
    { q: 'Which key moves up when a node with an even number of keys splits?',
      k: ['even', 'middle', 'left', 'right', 'convention', 'which', 'two', 'median'],
      a: '<p>With an even number of keys there are two middle keys. This site moves up the right-hand one, so the left piece ends up one key longer than the right piece. Some books move up the left-hand one, which does the opposite. Both give valid B-trees, so an exam answer should say which rule it used.</p>' },
    { q: 'When does a B-tree get taller?', suggest: true,
      k: ['taller', 'tall', 'grow', 'grows', 'height', 'increase', 'level', 'levels', 'root', 'split'],
      a: '<p>Only when the root splits. A new root is made above the old one, so every leaf moves down one level together. That is why all the leaves stay on the same level.</p>' },
    { q: 'When does a B-tree get shorter?',
      k: ['shorter', 'short', 'shrink', 'shrinks', 'height', 'decrease', 'lose', 'level', 'levels', 'root', 'merge'],
      a: '<p>When a delete causes merges that take the last key out of the root. The root\'s only remaining child then becomes the root. A delete from a leaf with keys to spare never changes the height.</p>' },
    { q: 'What is the difference between borrowing and merging?', suggest: true,
      k: ['borrow', 'borrowing', 'rotate', 'rotation', 'merge', 'merging', 'difference', 'sibling', 'underflow', 'delete'],
      a: '<p>Both fix a node that has become too small.</p><p><b>Borrowing</b> (a rotation) takes a key from a sibling that has more than the minimum, by way of the parent: the sibling\'s nearest key goes up and the parent\'s separating key comes down. The parent keeps the same number of keys.</p><p><b>Merging</b> joins the small node, a sibling with nothing to spare and the separating key from the parent into one node. The parent loses a key, so it may become too small as well.</p><p>This site tries the left sibling first, then the right one, and merges only if neither can lend.</p>' },
    { q: 'Why is the predecessor used when deleting an internal key?',
      k: ['predecessor', 'successor', 'internal', 'delete', 'replace', 'swap', 'inorder', 'leaf'],
      a: '<p>A key in an internal node separates two subtrees, so it cannot just be removed. The predecessor, the largest key in the subtree to its left, always sits in a leaf and fits exactly between the same two subtrees. It takes the place of the deleted key, and the job becomes an ordinary delete from a leaf. The successor (the smallest key to the right) works just as well; this site uses the predecessor.</p>' },
    { q: 'Why must all leaves be on the same level?',
      k: ['leaves', 'leaf', 'same', 'level', 'balanced', 'balance', 'depth', 'equal'],
      a: '<p>It means every search reads the same number of nodes, so no search is much slower than another. The rules keep it true on their own: the tree only grows and shrinks at the root, which moves all the leaves together.</p>' },
    { q: 'What is the difference between a B-tree and a B+ tree?',
      k: ['bplus', 'difference', 'leaf', 'leaves', 'linked', 'record', 'pointer', 'pointers', 'data'],
      a: '<p>In a B+ tree only the leaves hold the records (or pointers to them), and the leaves are linked in order. The internal nodes hold only keys to guide the search, so more of them fit in a block and the tree is shallower. A B-tree keeps data in internal nodes as well. Most database indexes are B+ trees. This site simulates a plain B-tree.</p>' },
    { q: 'Why do databases use B-trees instead of binary trees?',
      k: ['database', 'databases', 'binary', 'disk', 'block', 'blocks', 'shallow', 'why', 'instead', 'avl'],
      a: '<p>Reading a block from a disk is far slower than comparing keys in memory. A binary tree has one key per node, so finding something takes many block reads. A B-tree node fills a whole block with keys, so each read narrows the search a lot and the tree is only a few levels deep.</p>' },
    { q: 'How do I find the order from the block size?', suggest: true,
      k: ['block', 'size', 'order', 'calculate', 'formula', 'bytes', 'pointer', 'fit', 'fits', 'work'],
      a: '<p>Write the size of a node in terms of the order <i>p</i>: <i>p</i> block pointers and <i>p</i> &minus; 1 keys, plus a record pointer for each key in a B-tree. Make that no more than the block size and solve for the largest whole <i>p</i>.</p><p>For a B+ tree internal node: <i>p</i>&middot;<i>P</i> + (<i>p</i> &minus; 1)&middot;<i>K</i> &le; <i>B</i>. The calculator on the COMPETITIVE EXAM page does this with your numbers and shows the working.</p>' },
    { q: 'How many levels can a tree with N keys have?', suggest: true,
      k: ['levels', 'level', 'height', 'many', 'keys', 'bound', 'log', 'calculate', 'minimum', 'maximum', 'tall'],
      a: `<p>At least the smallest <i>h</i> with <i>m</i><sup><i>h</i></sup> &minus; 1 &ge; <i>N</i> (every node full), and at most the largest <i>h</i> with 2<i>t</i><sup><i>h</i>&minus;1</sup> &minus; 1 &le; <i>N</i> (every node as empty as allowed), where <i>t</i> = ${CEIL_M2}. This site counts the root as level 1.</p>` },
    { q: 'How fast are search, insert and delete?',
      k: ['fast', 'complexity', 'time', 'speed', 'cost', 'search', 'insert', 'delete', 'log', 'big'],
      a: '<p>Each one goes down a single path from the root to a leaf, so it reads about as many nodes as the tree has levels. That grows like log <i>N</i>, where the base of the logarithm is the number of children per node. Splits and merges walk back up the same path, so the work stays in proportion to the number of levels.</p>' },
    { q: 'What happens if I insert a key that is already there?',
      k: ['duplicate', 'duplicates', 'same', 'twice', 'already', 'repeat', 'repeated', 'insert'],
      a: '<p>This site refuses and says so. A B-tree as taught here keeps each key once. (Real indexes can allow duplicates by adding a tie-breaker, but that is a different design.)</p>' },
    { q: 'Does the order I insert keys in change the tree?',
      k: ['order', 'insertion', 'sequence', 'shape', 'different', 'sorted', 'ascending', 'random', 'insert', 'same'],
      a: '<p>Yes. The same keys can make different trees. Inserting in ascending order always splits the rightmost leaf, which tends to leave the nodes on the left only about half full. Random order tends to fill nodes more evenly. Try the keys 10 to 150 in order on the Visualizer, then the same keys shuffled.</p>' },
    { q: 'What are overflow and underflow?',
      k: ['overflow', 'underflow', 'full', 'empty', 'small', 'big', 'too'],
      a: '<p><b>Overflow</b> is a node with more keys than the order allows. It is fixed by splitting. <b>Underflow</b> is a node, other than the root, with fewer keys than the minimum. It is fixed by borrowing from a sibling or merging with one.</p>' },
    { q: 'Can the root have just one key?',
      k: ['root', 'one', 'single', 'key', 'fewer', 'exception'],
      a: '<p>Yes. The root is the one node allowed to hold fewer keys than the minimum, as long as it holds at least one. A root that is not a leaf and holds one key has two children.</p>' }
  ];

  const STOP = new Set('the and for are was were that this these those with from have has had how what why when which does did can could should would you your there their than then but not its into about'.split(' '));
  // Words are compared by their first four letters with a trailing "s" removed, so that
  // "merge", "merges" and "merging" all match.
  const norm = (w) => w.replace(/s$/, '').slice(0, 4);
  function tokens(text) {
    return text.toLowerCase().replace(/b\s*\+|b\s*plus/g, 'bplus')
      .split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)).map(norm);
  }
  QA.forEach((e) => { e.words = new Set(e.k.map(norm).concat(tokens(e.q))); });

  function scoreQa(queryTokens) {
    return QA.map((e, i) => {
      const hits = queryTokens.filter((t) => e.words.has(t)).length;
      return { i, hits, score: hits + hits / (e.words.size + 1) };    // the second part only breaks ties
    }).sort((a, b) => b.score - a.score);
  }

  const qaOut = $('aiTutorResponse');
  function showQa(i) { qaOut.innerHTML = `<p class="q">${esc(QA[i].q)}</p>${QA[i].a}`; }
  function qaButtons(indexes) {
    return '<div class="qa-suggest">' + indexes.map((i) => `<button type="button" class="textbtn" data-qa="${i}">${esc(QA[i].q)}</button>`).join('') + '</div>';
  }

  function ask(text) {
    const typed = text.trim();
    if (!typed) { qaOut.innerHTML = '<p>Type a question first, or pick one of the questions above.</p>'; return; }
    const toks = Array.from(new Set(tokens(typed)));
    const ranked = scoreQa(toks);
    const best = ranked[0];
    const enough = best.hits >= 2 || (best.hits === 1 && toks.length <= 2);
    if (enough) showQa(best.i);
    else qaOut.innerHTML = `<p>There is no written answer that matches &ldquo;${esc(typed)}&rdquo;. These are the closest:</p>` + qaButtons(ranked.slice(0, 3).map((r) => r.i));
  }

  $('qaSuggest').innerHTML = QA.map((e, i) => (e.suggest ? `<button type="button" class="textbtn" data-qa="${i}">${esc(e.q)}</button>` : '')).join('');
  [$('qaSuggest'), qaOut].forEach((box) => box.addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('[data-qa]') : null;
    if (b) showQa(Number(b.dataset.qa));
  }));
  $('qaForm').addEventListener('submit', (e) => { e.preventDefault(); ask($('aiPromptInput').value); });
  qaOut.innerHTML = '<p class="muted">Pick a question above, or type your own. The answer appears here.</p>';

  // ======================================================================
  // 6. The calculator
  // ======================================================================
  // ---- the calculator ----
  function setFormula(withRec) {
    $('calcFormula').innerHTML = withRec
      ? '<i>p</i>&middot;<i>P</i> + (<i>p</i> &minus; 1)&middot;(<i>K</i> + <i>R</i>) &le; <i>B</i>'
      : '<i>p</i>&middot;<i>P</i> + (<i>p</i> &minus; 1)&middot;<i>K</i> &le; <i>B</i>';
    $('calcRecordPointer').disabled = !withRec;           // a B+ tree internal node has no record pointers
    $('calcTotalRecords').disabled = !withRec;            // the level count below is for the B-tree structure
  }

  function readWhole(id, min, max) {
    const el = $(id);
    if (el.disabled) return 0;
    const text = el.value.trim();
    if (text === '' || !/^\d+$/.test(text)) return null;
    const v = Number(text);
    return v >= min && v <= max ? v : null;
  }

  function runCalculator() {
    const withRec = $('calcStructBtree').checked;
    setFormula(withRec);
    const out = $('calcResultOrder'), det = $('calcResultDetails');
    const B = readWhole('calcBlockSize', 1, 10000000);
    const K = readWhole('calcKeySize', 1, 1000000);
    const P = readWhole('calcPointerSize', 1, 1000000);
    const R = withRec ? readWhole('calcRecordPointer', 0, 1000000) : 0;
    const N = withRec ? readWhole('calcTotalRecords', 1, 1e15) : 1;
    if ([B, K, P, R, N].some((x) => x === null)) {
      out.textContent = 'Check the boxes';
      det.innerHTML = '<p>Every box needs a whole number. The block size can be up to 10,000,000 bytes, the key, pointer and record-pointer sizes up to 1,000,000, and the number of keys up to 1,000,000,000,000,000.</p>';
      return;
    }
    const ex = explainOrder(B, P, K, R);
    const p = ex.p;
    out.innerHTML = `<i>p</i> = ${fmt(p)}`;
    if (p < 3) {
      det.innerHTML = `<p>A B-tree needs an order of at least 3, and a block of ${fmt(B)} bytes with these sizes fits only order ${p}. Use a bigger block or smaller keys and pointers.</p>` + ex.html;
      return;
    }
    const t = Math.ceil(p / 2);
    const spare = B - BTreeMath.nodeBytes(p, P, K, R);
    let html = '<dl>' +
      `<dt>Keys in one node</dt><dd>At most ${fmt(p - 1)}. At least ${fmt(t - 1)} in every node except the root, which needs at least 1.</dd>` +
      `<dt>Children of an internal node</dt><dd>At most ${fmt(p)}, and at least ${fmt(t)} unless it is the root.</dd>` +
      `<dt>Unused bytes in a full node</dt><dd>${fmt(spare)} of ${fmt(B)}</dd>`;
    if (withRec) {
      const lo = BTreeMath.minLevels(p, N), hi = BTreeMath.maxLevels(p, N);
      html += `<dt>Levels for ${fmt(N)} keys</dt><dd>${lo === hi ? lo : `${lo} at the fewest, ${hi} at the most`}</dd>` +
        `<dt>Blocks read for one search</dt><dd>${lo === hi ? lo : `between ${lo} and ${hi}`}, one block per level</dd>`;
    }
    html += '</dl><h4>Working: the order</h4>' + ex.html;
    if (withRec) {
      html += '<h4>Working: the fewest levels</h4>' + explainMinLevels(p, N, 'p') + '<h4>Working: the most levels</h4>' + explainMaxLevels(p, N, 'p');
    } else {
      html += '<p class="muted">Levels are worked out for the B-tree structure. Choose that option above to see them. A B+ tree also needs the size of its leaf nodes, which hold the records, so its level count is not calculated here.</p>';
    }
    det.innerHTML = html;
  }
  $('btnCalculateGate').addEventListener('click', runCalculator);
  document.querySelectorAll('input[name="calcStructure"]').forEach((r) => r.addEventListener('change', runCalculator));
  ['calcBlockSize', 'calcKeySize', 'calcPointerSize', 'calcRecordPointer', 'calcTotalRecords'].forEach((id) => {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runCalculator(); } });
    $(id).addEventListener('change', runCalculator);
  });

  // ---- helpers for worked answers (used by exam.js) ----
  // Run [op, key] pairs on a fresh engine and remember which frames belong to which pair.
  const levelsText = (tree) => working(UI.engine.serializeToText(tree).split('\n').map((line) => esc(line).replace(/ {3}/g, '&emsp;')));
  function runOps(order, ops) {
    const e = new BTreeEngine(order);
    e.setOrder(order);
    const marks = [];
    ops.forEach(([op, k]) => { const start = e.frames.length; e[op](k); marks.push([start, e.frames.length]); });
    return { e, marks, tree: e.cloneTree() };
  }
  const framesOf = (r, opIndex) => r.e.frames.slice(r.marks[opIndex][0], r.marks[opIndex][1]);

  // ======================================================================
  // Start up
  // ======================================================================
  setFormula($('calcStructBtree').checked);
  runCalculator();

  // What exam.js and quiz.js build on.
  window.BTreePractice.kit = {
    BTreeMath, fmt, article, list, bracket, working, build, runOps, framesOf, levelsText, near, shuffle, pick, rnd,
    explainOrder, explainMaxLevels, explainMinLevels, explainKeysInLevels, maxK, minK, describeLevels
  };
})();
