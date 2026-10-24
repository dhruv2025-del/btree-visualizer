/**
 * tests.js: the Checks tab.
 *
 * Each check below runs against the real engine (btree-engine.js), the real formulas and the
 * real question generator. Nothing here is hard-wired to pass: the expected trees were worked
 * out by hand on paper (the steps are in the comments), and one check breaks a tree on purpose
 * to prove the rule checker notices.
 *
 * The checks use their own engines, so running them never disturbs the tree on the Build tab.
 * The random checks print their seed, so a failure can be repeated.
 */
(function () {
  'use strict';

  const UI = window.BTreeUI;
  const $ = (id) => document.getElementById(id);
  const esc = UI.esc;
  const { seq, ins, del } = UI;

  // ---------- helpers ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function assert(cond, message) { if (!cond) throw new Error(message); }

  // A fresh engine with the operations already done. Frames are kept so checks can read them.
  function make(order, ops) {
    const e = new BTreeEngine(order);
    e.setOrder(order);
    e.frames = [];
    ops.forEach(([op, k]) => e[op](k));
    return e;
  }
  // For the big random runs: the same engine, but each step is only counted instead of copying the whole
  // tree, which would make thousands of operations slow. The tree logic does not read the steps.
  function quiet(order, counts) {
    const e = new BTreeEngine(order);
    e.setOrder(order);
    e.recordFrame = (message, highlightNodes, highlightKeys, action, detail) => { if (counts) counts[detail] = (counts[detail] || 0) + 1; };
    return e;
  }
  const details = (e) => e.frames.map((f) => f.detail);
  const levels = (...rows) => rows.map((r, i) => `Level ${i}: ${r}`).join('\n');   // the engine's own text format
  const oneLine = (s) => s.replace(/\n/g, ' | ');

  function expectTree(e, expected) {
    const got = e.serializeToText();
    assert(got === expected, `Expected ${oneLine(expected)} but the tree was ${oneLine(got)}.`);
    const bad = e.validateInvariants();
    assert(bad.length === 0, 'The tree has the right keys but breaks a rule: ' + bad[0]);
  }
  function allNodes(tree) {
    const out = [];
    (function walk(n) { out.push(n); (n.children || []).forEach(walk); })(tree);
    return out;
  }
  // The keys of a tree in sorted order, found by walking it (so this does not rely on the engine).
  function inOrder(n) {
    if (!n.children || !n.children.length) return n.keys.slice();
    let out = [];
    n.keys.forEach((k, i) => { out = out.concat(inOrder(n.children[i]), [k]); });
    return out.concat(inOrder(n.children[n.keys.length]));
  }
  function randomDistinct(rnd, count, space) {
    const s = new Set();
    while (s.size < count) s.add(Math.floor(rnd() * space));
    return Array.from(s);
  }
  function shuffled(rnd, a) {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = r[i]; r[i] = r[j]; r[j] = t; }
    return r;
  }

  // ======================================================================
  // The checks
  // ======================================================================
  const CHECKS = [];
  const check = (name, why, run) => CHECKS.push({ name, why, run });

  // ---- insert ----
  check('A split moves up the right-hand middle key',
    'With an even number of keys there are two middle ones, and the rest of the site assumes the right-hand one moves up.',
    () => {
      // order 4, keys 10 20 30 40: the leaf [10 20 30 40] has 4 keys; the middle keys are 20 and 30; 30 goes up
      expectTree(make(4, ins([10, 20, 30, 40])), levels('[30]', '[10, 20]   [40]'));
    });

  check('Ten to 70 at order 4 gives a root of 30 and 60',
    'Two ordinary splits, then a key moving up into a root that already exists.',
    () => {
      // 10 20 30 40 -> root [30], leaves [10 20] [40]; 50 -> [40 50]; 60 -> [40 50 60]; 70 -> [40 50 60 70] splits, 60 goes up
      expectTree(make(4, ins(seq(10, 70, 10))), levels('[30, 60]', '[10, 20]   [40, 50]   [70]'));
    });

  check('Ten to 70 at order 3 splits all the way up and adds a level',
    'A split that overfills the parent has to split the parent too, up to the root.',
    () => {
      // 10 20 30 -> root [20]; 40 50 -> root [20 40]; 60 -> [50 60]; 70 -> leaf [50 60 70] splits, 60 goes up,
      // root [20 40 60] is too full, 40 goes up into a new root
      const e = make(3, ins(seq(10, 70, 10)));
      expectTree(e, levels('[40]', '[20]   [60]', '[10]   [30]   [50]   [70]'));
      assert(e.getStats().height === 3, 'The tree should have 3 levels.');
    });

  check('Inserting a key that is already there is refused',
    'A B-tree keeps each key once, and the tree must be exactly as it was.',
    () => {
      const e = make(4, ins(seq(10, 50, 10)));
      const before = e.serializeToText();
      e.frames = [];
      const r = e.insert(30);
      assert(r.success === false, 'The insert should report that it failed.');
      assert(e.serializeToText() === before, 'The tree changed.');
      assert(details(e).includes('duplicate'), 'No step explained the refusal.');
    });

  // ---- delete ----
  check('Deleting from a leaf that has keys to spare removes only that key',
    'The common case: no borrowing, no merging, nothing else moves.',
    () => {
      // order 4 minimum is 1 key; deleting 20 from [10 20] leaves [10]
      const e = make(4, ins(seq(10, 70, 10)).concat(del([20])));
      expectTree(e, levels('[30, 60]', '[10]   [40, 50]   [70]'));
      assert(!details(e).some((d) => /^(rotate|merge)/.test(d)), 'It borrowed or merged when it did not need to.');
    });

  check('A leaf that runs out borrows from its right sibling',
    'Rotate left: the sibling\'s smallest key goes up and the separator comes down. The first leaf has no left sibling to ask.',
    () => {
      // 10..80 -> root [30 60], leaves [10 20] [40 50] [70 80]. Delete 20, then 10: leaf [] has no left sibling;
      // right sibling [40 50] has a spare key, so 40 goes up and 30 comes down
      const e = make(4, ins(seq(10, 80, 10)).concat(del([20, 10])));
      expectTree(e, levels('[40, 60]', '[30]   [50]   [70, 80]'));
      assert(details(e).includes('rotate-left'), 'No rotate-left step was recorded.');
    });

  check('A leaf that runs out borrows from its left sibling',
    'Rotate right: the sibling\'s largest key goes up and the separator comes down. The left sibling is asked first.',
    () => {
      // same tree; delete 80, then 70: leaf [] is the last child, so it has no right sibling; its left sibling
      // [40 50] has a spare key, so 50 goes up and 60 comes down
      const e = make(4, ins(seq(10, 80, 10)).concat(del([80, 70])));
      expectTree(e, levels('[30, 50]', '[10, 20]   [40]   [60]'));
      assert(details(e).includes('rotate-right'), 'No rotate-right step was recorded.');
    });

  check('Two small leaves merge and the root disappears',
    'When no sibling can lend, nodes merge. If the root loses its last key the tree gets shorter.',
    () => {
      // 10..60 -> root [30], leaves [10 20] [40 50 60]. Delete 20, 60, 50 -> leaves [10] [40]. Delete 10: leaf [] and the
      // sibling [40] is at the minimum, so they merge with 30 into [30 40]; the root is empty, so [30 40] becomes the root
      const e = make(4, ins(seq(10, 60, 10)).concat(del([20, 60, 50, 10])));
      expectTree(e, levels('[30, 40]'));
      const d = details(e);
      assert(d.some((x) => x.startsWith('merge')) && d.includes('root-shrink'), 'Expected a merge followed by the root shrinking.');
      assert(e.getStats().height === 1, 'The tree should be one level tall.');
    });

  check('Deleting a key from an internal node uses its predecessor',
    'The predecessor (the largest key to the left) sits in a leaf and keeps the order.',
    () => {
      // 10..70 -> root [30 60]. Delete 30: its predecessor is 20 (the last key of the leaf [10 20]); 20 takes its place
      const e = make(4, ins(seq(10, 70, 10)).concat(del([30])));
      expectTree(e, levels('[20, 60]', '[10]   [40, 50]   [70]'));
      assert(details(e).includes('predecessor'), 'No predecessor step was recorded.');
    });

  check('One delete can cause two merges and shorten the tree',
    'Merging can make the parent too small, so the repair has to continue upward.',
    () => {
      // order 3, 1..7 -> root [4], [2] [6], leaves [1] [3] [5] [7]. Delete 7: leaf [] merges into [5] with 6 -> [5 6];
      // the parent [6] is now empty and merges with [2] and 4 -> [2 4]; the root is empty, so [2 4] is the root
      const e = make(3, ins(seq(1, 7)).concat(del([7])));
      expectTree(e, levels('[2, 4]', '[1]   [3]   [5, 6]'));
      assert(details(e).filter((x) => x.startsWith('merge')).length === 2, 'Expected exactly two merges.');
    });

  check('Deleting a key that is not there changes nothing',
    'The tree must be exactly as it was, and the person is told why.',
    () => {
      const e = make(4, ins(seq(10, 50, 10)));
      const before = e.serializeToText();
      e.frames = [];
      const r = e.delete(35);
      assert(r.success === false, 'The delete should report that it failed.');
      assert(e.serializeToText() === before, 'The tree changed.');
      assert(details(e).includes('missing'), 'No step explained the refusal.');
    });

  // ---- search ----
  check('Search finds every key that is there and none that is not',
    'A search that misses a present key, or finds an absent one, makes the whole index useless.',
    () => {
      const rnd = mulberry32(7);
      for (let m = 3; m <= 7; m++) {
        const keys = randomDistinct(rnd, 60, 500);
        const e = make(m, keys.map((k) => ['insert', k]));
        const have = new Set(keys);
        for (let k = -2; k < 503; k++) {
          const r = e.search(k);
          assert(r.found === have.has(k), `Order ${m}: search for ${k} said ${r.found} but it is ${have.has(k) ? 'in' : 'not in'} the tree.`);
        }
      }
    });

  check('A search reads one node per level, at most',
    'This is why a B-tree is fast: the cost is the number of levels, not the number of keys.',
    () => {
      const rnd = mulberry32(11);
      for (let m = 3; m <= 7; m++) {
        const keys = randomDistinct(rnd, 120, 1000);
        const e = make(m, keys.map((k) => ['insert', k]));
        const height = e.getStats().height;
        keys.forEach((k) => {
          const v = e.search(k).visits;
          assert(v >= 1 && v <= height, `Order ${m}: finding ${k} read ${v} nodes in a tree ${height} levels tall.`);
        });
        for (let i = 0; i < 40; i++) {
          const k = 1000 + i;
          assert(e.search(k).visits === height, `Order ${m}: a missing key should be ruled out at a leaf, after ${height} nodes.`);
        }
      }
    });

  // ---- random testing ----
  check('Thousands of random inserts, deletes and searches keep the tree valid and complete',
    'Hand-picked cases miss things. After every single operation this checks the rules and compares the keys with a plain sorted list.',
    (seed) => {
      const rnd = mulberry32(seed);
      const counts = {};
      let ops = 0;
      for (let m = 3; m <= 7; m++) {
        for (let run = 0; run < 4; run++) {
          const e = quiet(m, counts);
          const ref = new Set();
          const space = 25 + Math.floor(rnd() * 90);
          for (let s = 0; s < 150; s++) {
            const k = Math.floor(rnd() * space);
            const r = rnd();
            const kind = r < (s < 70 ? 0.8 : 0.4) ? 'insert' : (r < 0.9 ? 'delete' : 'search');
            const res = e[kind](k);
            if (kind === 'insert') { assert(res.success === !ref.has(k), `insert ${k}: wrong success flag (order ${m}, seed ${seed})`); ref.add(k); }
            else if (kind === 'delete') { assert(res.success === ref.has(k), `delete ${k}: wrong success flag (order ${m}, seed ${seed})`); ref.delete(k); }
            else assert(res.found === ref.has(k), `search ${k}: wrong answer (order ${m}, seed ${seed})`);
            ops++;
            const bad = e.validateInvariants();
            assert(bad.length === 0, `After ${kind} ${k} at order ${m} (seed ${seed}): ${bad[0]}`);
            const want = Array.from(ref).sort((a, b) => a - b).join(',');
            assert(inOrder(e.root).join(',') === want, `After ${kind} ${k} at order ${m} (seed ${seed}) the keys differ from the reference list.`);
          }
        }
      }
      // a random run that never split, borrowed or merged would prove nothing
      const splits = counts['split-overflow'] || 0;
      const rotations = (counts['rotate-left'] || 0) + (counts['rotate-right'] || 0);
      const merges = (counts['merge-left'] || 0) + (counts['merge-right'] || 0);
      const shrinks = counts['root-shrink'] || 0;
      assert(splits > 50 && rotations > 20 && merges > 20 && shrinks > 0, 'The random run did not exercise splits, borrows and merges.');
      return `${ops.toLocaleString('en-US')} operations on orders 3 to 7, with ${splits} splits, ${rotations} borrows, ${merges} merges and ${shrinks} lost levels. Seed ${seed}.`;
    });

  // ---- the recorded steps ----
  check('Every recorded step is its own copy of the tree',
    'The visualizer replays these copies. If they shared nodes, stepping backwards would show the wrong tree.',
    () => {
      const e = make(3, ins(seq(10, 70, 10)));
      const before = e.frames.map((f) => JSON.stringify(allNodes(f.tree).map((n) => n.keys)));
      const seen = new Set();
      e.frames.forEach((f) => allNodes(f.tree).forEach((n) => {
        assert(!seen.has(n), 'Two steps share the same node object.');
        seen.add(n);
      }));
      allNodes(e.root).forEach((n) => assert(!seen.has(n), 'A step shares a node with the live tree.'));
      e.insert(5); e.delete(70);                       // change the live tree afterwards
      const after = e.frames.slice(0, before.length).map((f) => JSON.stringify(allNodes(f.tree).map((n) => n.keys)));
      assert(JSON.stringify(before) === JSON.stringify(after), 'Later operations changed earlier steps.');
      assert(before[0] !== before[before.length - 1], 'The first and last step should differ after several splits.');
    });

  check('The last step of every operation shows the tree as it really is',
    'What the visualizer ends on must be the tree you actually have, not an earlier picture of it.',
    (seed) => {
      const rnd = mulberry32(seed + 3);
      const shape = (n) => JSON.stringify([n.keys, (n.children || []).map(shape)]);
      let ops = 0;
      for (let m = 3; m <= 5; m++) {
        const e = new BTreeEngine(m);
        e.setOrder(m);
        for (let s = 0; s < 120; s++) {
          const k = Math.floor(rnd() * 40);
          const kind = rnd() < (s < 50 ? 0.8 : 0.45) ? 'insert' : 'delete';
          e.frames = [];
          e[kind](k);
          ops++;
          assert(e.frames.length > 0, `${kind} ${k} recorded no steps.`);
          assert(shape(e.frames[e.frames.length - 1].tree) === shape(e.root), `After ${kind} ${k} at order ${m} the last step did not match the real tree (seed ${seed}).`);
        }
      }
      return `${ops} operations. Seed ${seed}.`;
    });

  // ---- the rule checker itself ----
  check('The rule checker accepts a correct tree and notices a broken one',
    'A checker that always says "fine" would make every other check worthless, so five different faults are planted on purpose.',
    () => {
      const good = make(4, ins(seq(10, 70, 10)));
      assert(good.validateInvariants().length === 0, 'It rejected a correct tree.');
      const faults = [
        ['a node with too many keys', (t) => { t.children[0].keys = [1, 2, 3, 4]; }],
        ['keys out of order', (t) => { t.children[1].keys = [50, 40]; }],
        ['a node with too few keys', (t) => { t.children[2].keys = []; }],
        ['leaves on different levels', (t) => { const leaf = t.children[0]; leaf.isLeaf = false; leaf.children = [{ id: 'x', keys: [5], isLeaf: true, children: [] }, { id: 'y', keys: [15], isLeaf: true, children: [] }, { id: 'z', keys: [25], isLeaf: true, children: [] }]; }],
        ['an internal node with the wrong number of children', (t) => { t.keys = [30]; }]
      ];
      faults.forEach(([what, damage]) => {
        const copy = good.cloneTree();
        damage(copy);
        assert(good.validateInvariants(copy).length > 0, `It did not notice ${what}.`);
      });
      return 'Noticed all 5 planted faults.';
    });

  // ---- the formulas ----
  check('Heights of random trees stay inside the range the formulas give',
    'The calculator\'s answers are only worth anything if real trees never fall outside them.',
    (seed) => {
      const M = window.BTreeMath;
      const rnd = mulberry32(seed + 1);
      let trees = 0;
      for (let i = 0; i < 250; i++) {
        const m = 3 + Math.floor(rnd() * 5);
        const n = 1 + Math.floor(rnd() * 400);
        const keys = shuffled(rnd, seq(1, 1000)).slice(0, n);
        const asc = i % 5 === 0;
        const e = quiet(m);
        (asc ? keys.slice().sort((a, b) => a - b) : keys).forEach((k) => e.insert(k));
        const h = e.getStats().height;
        const lo = M.minLevels(m, n), hi = M.maxLevels(m, n);
        assert(h >= lo && h <= hi, `Order ${m} with ${n} keys has ${h} levels, outside ${lo} to ${hi}.`);
        trees++;
      }
      // the smallest possible 3-level tree at order 3 really exists: 1 to 7 in ascending order
      const tight = make(3, ins(seq(1, 7)));
      assert(tight.getStats().height === 3 && Number(M.minKeysInLevels(3, 3)) === 7, 'The tightest 3-level tree at order 3 should hold 7 keys.');
      return `${trees} random trees, orders 3 to 7. Seed ${seed}.`;
    });

  check('The formulas for most and fewest keys agree with counting level by level',
    'The closed forms are written once and counted once, two different ways, and have to match.',
    () => {
      const M = window.BTreeMath;
      for (let m = 3; m <= 12; m++) {
        const t = BigInt(Math.ceil(m / 2));
        let sumMax = 0n, sumMin = 1n;
        for (let h = 1; h <= 7; h++) {
          sumMax += BigInt(m - 1) * BigInt(m) ** BigInt(h - 1);                    // level h: m^(h-1) nodes, each with m-1 keys
          if (h >= 2) sumMin += 2n * t ** BigInt(h - 2) * (t - 1n);                // level h: 2 t^(h-2) nodes, each with t-1 keys
          assert(M.maxKeysInLevels(m, h) === sumMax, `Most keys, order ${m}, ${h} levels.`);
          assert(M.minKeysInLevels(m, h) === sumMin, `Fewest keys, order ${m}, ${h} levels.`);
          assert(M.minLevels(m, M.maxKeysInLevels(m, h)) === h && M.minLevels(m, M.maxKeysInLevels(m, h) + 1n) === h + 1, `Fewest levels around ${h}, order ${m}.`);
          assert(M.maxLevels(m, M.minKeysInLevels(m, h)) === h && M.maxLevels(m, M.minKeysInLevels(m, h + 1) - 1n) === h, `Most levels around ${h}, order ${m}.`);
        }
        const e = new BTreeEngine(Math.min(m, 8));
        if (m <= 8) assert(e.maxKeys() === M.maxKeys(m) && e.minKeys() === M.minKeys(m), `The engine and the formulas disagree on the key limits at order ${m}.`);
      }
    });

  check('The largest order that fits in a block agrees with trying every order',
    'The calculator uses a formula; this tries orders one by one and checks that the formula\'s answer is the biggest that fits.',
    (seed) => {
      const M = window.BTreeMath;
      const rnd = mulberry32(seed + 2);
      for (let i = 0; i < 600; i++) {
        const B = 64 + Math.floor(rnd() * 8000), P = 1 + Math.floor(rnd() * 16), K = 1 + Math.floor(rnd() * 32), R = Math.floor(rnd() * 17);
        const p = M.orderFor(B, P, K, R);
        let best = 0;
        for (let q = 1; M.nodeBytes(q, P, K, R) <= B; q++) best = q;
        assert(p === best, `Block ${B}, key ${K}, pointer ${P}, record pointer ${R}: the formula says ${p}, trying every order says ${best}.`);
      }
      return `600 random block layouts. Seed ${seed}.`;
    });

  // ---- the practice questions ----
  check('Practice questions are well formed, and the right answer is not always in the same place',
    'Every question needs four different answers with exactly one right, and the right one must not sit in the same place every time or it can be guessed.',
    (seed) => {
      const P = window.BTreePractice;
      P.setSeed(seed + 4);
      const per = 300;
      try {
        P.levels.forEach((level) => {
          const where = [0, 0, 0, 0];
          for (let i = 0; i < per; i++) {
            let q;
            try { q = P.generate(level, true); } catch (err) { throw new Error(`A "${level}" question could not be made: ${err.message}`); }
            assert(q.options.length === 4, 'A question did not have four answers.');
            assert(new Set(q.options.map((o) => o.html)).size === 4, 'Two answers were the same in: ' + q.stem);
            assert(q.options.every((o) => o.html.replace(/<[^>]*>/g, '').trim() !== ''), 'An answer was blank in: ' + q.stem);
            assert(q.options.filter((o) => o.correct).length === 1 && q.options[q.answerIndex].correct, 'A question did not have exactly one right answer: ' + q.stem);
            assert(q.explain && q.hint && q.stem, 'A question was missing its wording, hint or explanation.');
            where[q.answerIndex]++;
          }
          where.forEach((n, pos) => assert(n >= per * 0.12 && n <= per * 0.40,
            `At the "${level}" level the right answer was in position ${'ABCD'[pos]} ${n} times out of ${per}.`));
        });
      } finally {
        P.setSeed(null);
      }
      return `${per * P.levels.length} questions, ${per} at each level. Seed ${seed + 4}.`;
    });

  check('Every solved question on the COMPETITIVE EXAM page has its answer worked out again',
    'Each answer on that page was written down after being worked out on paper. Here the engine or the formula works it out a second time, and the two have to agree.',
    () => {
      const X = window.BTreeExam;
      assert(X && X.bank.length >= 50, `The page needs at least 50 solved questions but has ${X ? X.bank.length : 0}.`);
      const bad = X.verify();
      assert(!bad.length, bad.slice(0, 3).join(' | ') + (bad.length > 3 ? ` (and ${bad.length - 3} more)` : ''));
      const gate = X.bank.filter((q) => q.tag.kind === 'gate');
      gate.forEach((q) => assert(/^GATE (CSE|IT) 20\d\d/.test(q.tag.label), `A GATE tag looks wrong: ${q.tag.label}`));
      const withOptions = X.bank.filter((q) => q.opts).length;
      return `${X.bank.length} questions (${gate.length} tagged GATE, ${withOptions} with options, ${X.bank.length - withOptions} numerical). All answers agree.`;
    });

  check('A few exam answers match the answers worked by hand',
    'These were solved on paper without the program: 6p + 9(p-1) <= 512 gives p = 34, 8p + 12(p-1) <= 1024 gives p = 51, and 5 levels of order 5 hold at most 5^3 - 1 = 124 keys when there are 3.',
    () => {
      const M = window.BTreeMath;
      assert(M.orderFor(512, 6, 9, 0) === 34, 'order for 512, 6, 9 should be 34');
      assert(M.orderFor(1024, 8, 12, 0) === 51, 'order for 1024, 8, 12 should be 51');
      assert(M.orderFor(512, 2, 8, 0) === 52, 'order for 512, 2, 8 should be 52');
      assert(M.maxKeysInLevels(5, 3) === 124n && M.minKeysInLevels(5, 3) === 17n, '3 levels of order 5 hold 17 to 124 keys');
      const e = make(4, ins([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]));
      assert(e.frames.filter((f) => f.detail === 'split-overflow').length === 5, 'ten falling keys into order 4 split 5 times');
    });

  check('The quiz asks what it should and gives the exact messages',
    'The quiz makes the number of questions asked for at each of the three levels, and uses the two required sentences for right and wrong answers.',
    (seed) => {
      const Q = window.BTreeQuiz;
      assert(Q && Q.messages.right === 'Yes, you have correctly answered the question.' && Q.messages.wrong === 'Yet to answer correctly.', 'The quiz messages are not the required ones.');
      assert(Q.limits.min === 1 && Q.limits.max >= 20, 'The quiz limits look wrong.');
      window.BTreePractice.setSeed(seed + 9);
      try {
        ['easy', 'medium', 'hard'].forEach((level) => {
          [1, 7, 30].forEach((n) => {
            const items = Q.make(level, n);
            assert(items.length === n, `A ${level} quiz of ${n} gave ${items.length} questions.`);
            items.forEach((q) => assert(q.options.length === 4 && q.options.filter((o) => o.correct).length === 1, `A ${level} question was not well formed.`));
          });
        });
      } finally { window.BTreePractice.setSeed(null); }
    });

  check('The site has the required structure',
    'The tabs must be Visualizer, QUIZ, COMPETITIVE EXAM, Download, Help, Developed By and Learn, with Learn last. There must be a Day Mode and a Night Mode button, and the report must have its five parts.',
    () => {
      const tabs = Array.from(document.querySelectorAll('#navTabs [role="tab"]')).map((b) => b.textContent.trim());
      const want = ['Visualizer', 'QUIZ', 'COMPETITIVE EXAM', 'Download', 'Help', 'Developed By', 'Learn'];
      assert(JSON.stringify(tabs) === JSON.stringify(want), `The tabs are ${tabs.join(', ')}.`);
      assert(/Day Mode/.test($('dayModeBtn').textContent) && /Night Mode/.test($('nightModeBtn').textContent), 'The Day Mode and Night Mode buttons are missing.');
      ['learn-concept', 'learn-video', 'learn-refs'].forEach((id) => assert(document.getElementById(id), `Learn is missing ${id}.`));
      assert(/Swaminathan/.test($('guideName').textContent) && /Assistant Professor/.test($('guideRole').textContent), 'The guide is missing.');
      const R = window.BTreeReport;
      const text = R.toText(R.buildModel({ checks: false }));
      ['User Inputs', 'Processing Steps', 'Intermediate Results', 'Final Output', 'Graphs, Tables and Figures'].forEach((s) => assert(text.includes(s), `The report has no "${s}" part.`));
      assert(/^[\x0a\x20-\x7e]*$/.test(text), 'The text report holds a character that is not plain ASCII.');
      return `${tabs.length} tabs, report parts present.`;
    });

  // ---- saved pictures ----
  check('Saved pictures contain the whole tree and need no stylesheet',
    'A saved picture is opened outside the page, so it cannot rely on the page\'s stylesheet. If it does, it comes out as plain black boxes.',
    () => {
      const e = make(4, ins(seq(10, 150, 10)));
      const tree = e.cloneTree();
      const keys = inOrder(tree);
      const idsOf = (doc) => Array.from(doc.querySelectorAll('[id]')).map((n) => n.getAttribute('id'));
      let firstIds = null;
      ['paper', 'plain', 'night'].forEach((style) => {
        const out = UI.standaloneSvg(tree, { palette: style, grid: true, frame: e.frames[e.frames.length - 1], order: 4 });
        const doc = new DOMParser().parseFromString(out.svg, 'image/svg+xml');
        assert(!doc.querySelector('parsererror'), `${style}: the SVG is not valid XML.`);
        const svg = doc.documentElement;
        assert(svg.getAttribute('viewBox') && Number(svg.getAttribute('width')) > 0 && Number(svg.getAttribute('height')) > 0, `${style}: the SVG has no size.`);
        assert(!doc.querySelector('style, link, script'), `${style}: the SVG relies on a stylesheet or script.`);
        const texts = Array.from(doc.querySelectorAll('text')).map((t) => Number(t.textContent)).sort((a, b) => a - b);
        assert(texts.join(',') === keys.join(','), `${style}: the picture does not show every key exactly once.`);
        doc.querySelectorAll('rect').forEach((r) => assert(r.hasAttribute('fill'), `${style}: a rectangle has no fill of its own.`));
        doc.querySelectorAll('line').forEach((l) => assert(l.hasAttribute('stroke'), `${style}: a line has no colour of its own.`));
        doc.querySelectorAll('text').forEach((t) => assert(t.hasAttribute('fill') && t.hasAttribute('font-size'), `${style}: a key has no colour or size of its own.`));
        if (!firstIds) firstIds = idsOf(doc);
        else assert(idsOf(doc).every((id) => !firstIds.includes(id)), 'Two pictures on one page would share element ids.');
      });
    });

  // ---- the step-by-step view ----
  check('Every step an operation records points at a line of the pseudocode',
    'The code panel shades the lines a step carries out. A step with no line, or a line that does not exist, would leave the panel blank or wrong.',
    (seed) => {
      const rnd = mulberry32(seed + 31);
      const seen = { insert: new Set(), delete: new Set(), search: new Set() };
      let steps = 0;
      for (let order = 3; order <= 7; order++) {
        for (let run = 0; run < 12; run++) {
          const e = new BTreeEngine(order);
          e.setOrder(order);
          const keys = randomDistinct(rnd, 30, 60);
          e.frames = [];
          // building the tree, then inserts (some already there), deletes (some missing) and searches (some missing), run one by one like the Build tab
          const todo = keys.map((k) => ['insert', k]);
          shuffled(rnd, keys).slice(0, 14).forEach((k) => todo.push(['delete', k]));
          for (let i = 0; i < 4; i++) { todo.push(['delete', 100 + i]); todo.push(['insert', keys[i]]); todo.push(['search', 200 + i]); }
          for (let i = 0; i < 8; i++) { todo.push(['insert', 61 + i]); todo.push(['search', keys[i + 5]]); }
          const groups = [];
          todo.forEach(([op, k]) => { const start = e.frames.length; e[op](k); groups.push({ op, start, end: e.frames.length - 1 }); });
          groups.forEach((g) => {
            for (let i = g.start; i <= g.end; i++) {
              const f = e.frames[i];
              const lines = window.BTreeCode.linesFor(g.op, f, i === g.start);
              assert(lines.length > 0, `No pseudocode line for a "${f.detail}" step of ${g.op} (order ${order}).`);
              lines.forEach((n) => assert(Number.isInteger(n) && n >= 1 && n <= window.BTreeCode.lineCount(g.op), `Line ${n} does not exist in the ${g.op} pseudocode.`));
              seen[g.op].add(f.detail);
              steps++;
            }
          });
        }
      }
      // every kind of step that happened is one the table knows, and the table has no kinds the engine never records
      ['insert', 'delete', 'search'].forEach((op) => {
        const known = window.BTreeCode.knownDetails(op);
        seen[op].forEach((d) => assert(known.includes(d), `The ${op} pseudocode does not know the step kind "${d}".`));
      });
      assert(seen.delete.has('merge-left') && seen.delete.has('rotate-left') && seen.delete.has('rotate-right') && seen.insert.has('root-split'),
        'The random runs did not reach every kind of step, so the check proves less than it should.');
      return `${steps} steps.`;
    });

  check('A root with no keys, for one step of a merge, is drawn as an empty node (not as an empty tree)',
    'When the last key leaves the root in a merge, the root is empty for one step before its only child takes over. The figure used to show "empty tree" for that step.',
    () => {
      const e = make(3, ins(seq(1, 7)).concat(del([7])));
      const odd = e.frames.filter((f) => f.tree.keys.length === 0 && f.tree.children.length > 0);
      assert(odd.length > 0, 'The example no longer produces a step with an empty root, so this check has nothing to look at.');
      odd.forEach((f) => {
        const out = UI.standaloneSvg(f.tree, { palette: 'paper', order: 3 });
        const doc = new DOMParser().parseFromString(out.svg, 'image/svg+xml');
        assert(!doc.querySelector('parsererror'), 'The SVG is not valid XML.');
        assert(doc.querySelector('title').textContent !== 'Empty B-tree', 'The picture calls the tree empty.');
        const shownKeys = Array.from(doc.querySelectorAll('text')).map((t) => Number(t.textContent)).sort((a, b) => a - b);
        const realKeys = inOrder(f.tree).sort((a, b) => a - b);
        assert(shownKeys.join(',') === realKeys.join(','), 'The picture does not show every key of the tree below the empty root.');
        assert(UI.treeStats(f.tree).totalKeys === realKeys.length, 'The key count ignores the keys below the empty root.');
        assert(UI.problemsOf(f.tree).length > 0, 'The rule check says all is well with a root that has no keys.');
      });
      // the finished tree of every operation has no such root
      const last = e.frames[e.frames.length - 1];
      assert(UI.problemsOf(last.tree).length === 0, 'The last step still has a problem: ' + UI.problemsOf(last.tree)[0]);
      return `${odd.length} step${odd.length === 1 ? '' : 's'} checked.`;
    });

  // ======================================================================
  // Running and showing the checks
  // ======================================================================
  let shownOnce = false;

  function render(sum) {
    $('testsTableBody').innerHTML = sum.results.map((r, i) =>
      `<tr><td class="num">${i + 1}</td><td class="name">${esc(r.name)}</td><td class="what">${esc(r.why)}</td>` +
      `<td><span class="status ${r.ok ? 'pass' : 'fail'}">${r.ok ? 'Passed' : 'Failed'}</span>` +
      (r.note ? `<span class="${r.ok ? 'pass-detail' : 'fail-detail'}">${esc(r.note)}</span>` : '') +
      `</td><td class="time">${r.ms < 1 ? '&lt;1 ms' : Math.round(r.ms) + ' ms'}</td></tr>`).join('');
    const s = $('checksSummary');
    s.dataset.state = sum.failed ? 'bad' : 'ok';
    s.textContent = sum.failed
      ? `${sum.failed} of ${sum.total} checks failed.`
      : `All ${sum.total} checks passed, in ${Math.round(sum.ms)} ms.`;
  }

  const BTreeTests = {
    last: null,
    // silent = work out the result but leave the Checks tab alone (the lab sheet does this)
    running: false,
    run(silent) {
      BTreeTests.running = true;
      try { return BTreeTests.runInner(silent); } finally { BTreeTests.running = false; }
    },
    runInner(silent) {
      const seed = 1 + Math.floor(Math.random() * 99999);
      const t0 = performance.now();
      const results = CHECKS.map((c) => {
        const start = performance.now();
        let ok = true, note = '';
        try { note = c.run(seed) || ''; } catch (err) { ok = false; note = err && err.message ? err.message : String(err); }
        return { name: c.name, why: c.why, ok, note, ms: performance.now() - start };
      });
      const passed = results.filter((r) => r.ok).length;
      const summary = { total: results.length, passed, failed: results.length - passed, ms: performance.now() - t0, seed, results };
      BTreeTests.last = summary;
      if (!silent) { render(summary); shownOnce = true; }
      return summary;
    }
  };
  window.BTreeTests = BTreeTests;

  $('btnRunAllTests').addEventListener('click', () => BTreeTests.run(false));
  document.addEventListener('btree:tabshown', (e) => {
    if (e.detail.id === 'tab-tests' && !shownOnce) BTreeTests.run(false);
  });
  // a direct link such as #checks or #sheet is handled before this file has loaded, so catch up here
  if (document.body.dataset.tab === 'tab-tests') BTreeTests.run(false);
})();
