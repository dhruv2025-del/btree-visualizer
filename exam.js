/**
 * exam.js: the COMPETITIVE EXAM page. A fixed bank of solved questions.
 *
 * Each question has: tag, stem, options (or none for a numerical answer), the correct answer, and a step-by-step solution.
 * A GATE tag is given only to a question whose paper, year and answer were checked against published solutions; those
 * questions are re-worded here. Every other question is a practice question written for this project.
 * Each question has a check() that works its answer out again with the engine or the formulas, and tests.js runs them all.
 */
(function () {
  'use strict';
  const UI = window.BTreeUI, K = window.BTreePractice.kit, M = K.BTreeMath;
  const $ = (id) => document.getElementById(id);
  const { esc } = UI;
  const LETTERS = ['A', 'B', 'C', 'D'];
  const fmt = K.fmt;

  const GATE = (label) => ({ kind: 'gate', label });
  const PRACTICE = { kind: 'practice', label: 'Practice question' };
  const BANK = [];
  // opts: the four answers; ans: index of the right one; nat: answer text for a numerical-answer question
  function Q(o) { o.n = BANK.length + 1; BANK.push(o); }

  const eq = (got, want, what) => (String(got) === String(want) ? true : `${what}: worked out ${got}, expected ${want}`);
  const treeLine = (tree) => {
    const rows = [];
    (function w(n, d) { (rows[d] = rows[d] || []).push('[' + n.keys.join(', ') + ']'); (n.children || []).forEach((c) => w(c, d + 1)); })(tree, 0);
    return rows.map((r) => r.join(' ')).join(' / ');
  };
  const run = (order, ops) => K.runOps(order, ops);
  const insOps = (a) => a.map((k) => ['insert', k]);
  const delOps = (a) => a.map((k) => ['delete', k]);
  const rootKeys = (r) => r.tree.keys.join(', ');
  // one line per inserted key: the tree after it
  function insertTrace(order, keys) {
    const e = new BTreeEngine(order); e.setOrder(order);
    return keys.map((k) => {
      const s = e.frames.length; e.insert(k);
      const sp = e.frames.slice(s).filter((f) => f.detail === 'split-overflow').length;
      return `Insert ${k}: ${esc(treeLine(e.cloneTree()))}` + (sp ? ` (${sp === 1 ? 'a node split' : sp + ' nodes split'})` : '');
    });
  }
  const msgs = (r, i) => K.framesOf(r, i).map((f) => esc(f.message));
  const ceilHalf = (m) => Math.ceil(m / 2);

  // ============================ 1. Node capacity and rules ============================
  Q({ topic: 'Node capacity and rules', tag: GATE('GATE CSE 2010'),
    stem: '<p>In a B+ tree each node may hold at most 5 keys. What is the fewest keys that a node other than the root may hold?</p>',
    opts: ['1', '2', '3', '4'], ans: 1,
    steps: ['A node with at most 5 keys has at most 6 children, so the order is <i>m</i> = 6.', 'Every node except the root must have at least &lceil;<i>m</i>/2&rceil; = &lceil;6/2&rceil; = 3 children.', 'A node with 3 children holds 3 &minus; 1 = 2 keys. So the fewest keys is <b>2</b>.', '<span class="muted">This is the general rule for internal nodes, which is what the exam&rsquo;s answer follows. Some books allow leaves of a B+ tree a slightly different minimum.</span>'],
    check: () => eq(M.minKeys(6), 2, 'fewest keys, order 6') });
  Q({ topic: 'Node capacity and rules', tag: PRACTICE,
    stem: '<p>A B-tree has order 7. What are the most and the fewest keys in a node that is not the root?</p>',
    opts: ['6 and 3', '7 and 4', '6 and 4', '7 and 3'], ans: 0,
    steps: ['Most keys: <i>m</i> &minus; 1 = 7 &minus; 1 = 6.', 'Fewest keys: &lceil;<i>m</i>/2&rceil; &minus; 1 = &lceil;3.5&rceil; &minus; 1 = 4 &minus; 1 = 3.', 'Answer: <b>6 and 3</b>.'],
    check: () => eq(M.maxKeys(7) + ' and ' + M.minKeys(7), '6 and 3', 'order 7') });
  Q({ topic: 'Node capacity and rules', tag: PRACTICE,
    stem: '<p>The root of a B-tree of order 5 is not a leaf. What is the fewest children it can have?</p>',
    opts: ['1', '2', '3', '5'], ans: 1,
    steps: ['The root must hold at least one key.', 'A node that is not a leaf with <i>k</i> keys has <i>k</i> + 1 children, so with 1 key it has 2 children.', 'The rule &ldquo;at least &lceil;<i>m</i>/2&rceil; = 3 children&rdquo; is for the other nodes; the root is the exception. Answer: <b>2</b>.'],
    check: () => { const r = run(5, insOps([1, 2, 3, 4, 5])); return eq(r.tree.children.length, 2, 'root children after the first split'); } });
  Q({ topic: 'Node capacity and rules', tag: PRACTICE,
    stem: '<p>An internal node of a B-tree of order 9, not the root, holds the fewest keys allowed. How many children does it have?</p>',
    opts: ['4', '5', '6', '9'], ans: 1,
    steps: ['Fewest keys: &lceil;9/2&rceil; &minus; 1 = 5 &minus; 1 = 4.', 'An internal node with 4 keys has 4 + 1 = <b>5</b> children.'],
    check: () => eq(M.minKeys(9) + 1, 5, 'children') });
  Q({ topic: 'Node capacity and rules', tag: PRACTICE,
    stem: '<p>Which of these is <b>not</b> true of a B-tree of order <i>m</i>?</p>',
    opts: ['The keys in a node are in sorted order.', 'All leaves are on the same level.', 'The root must hold at least &lceil;<i>m</i>/2&rceil; &minus; 1 keys, like every other node.', 'An internal node with <i>k</i> keys has <i>k</i> + 1 children.'], ans: 2,
    steps: ['A, B and D are all rules of a B-tree.', 'C is false: the root is the one node that may hold fewer keys. It needs only 1 key. For example, in an order-5 tree every other node needs 2 keys, but a root with 1 key is allowed.', 'Answer: <b>C</b>.'] });
  Q({ topic: 'Node capacity and rules', tag: PRACTICE,
    stem: '<p>A B-tree of order 4 is also called a 2-3-4 tree. How many keys can a node of this tree hold?</p>',
    opts: ['1 to 3', '2 to 4', '1 to 4', '2 to 3'], ans: 0,
    steps: ['Most: <i>m</i> &minus; 1 = 3.', 'Fewest in a node that is not the root: &lceil;4/2&rceil; &minus; 1 = 1. The root also needs at least 1.', 'So a node holds <b>1 to 3</b> keys, and has 2 to 4 children, which is where the name 2-3-4 comes from.'],
    check: () => eq(M.minKeys(4) + ' to ' + M.maxKeys(4), '1 to 3', 'order 4') });
  Q({ topic: 'Node capacity and rules', tag: PRACTICE,
    stem: '<p>A B-tree of order 8 splits a node as soon as it would hold how many keys?</p>',
    opts: ['7', '8', '9', '4'], ans: 1,
    steps: ['A node of order 8 may hold at most 7 keys.', 'The moment an insert gives it <b>8</b> keys it is one too many, so it splits around its middle key.'],
    check: () => eq(M.maxKeys(8) + 1, 8, 'keys at overflow') });

  // ============================ 2. Block size and order ============================
  Q({ topic: 'Block size and order', tag: GATE('GATE IT 2006'),
    stem: '<p>In a B+ tree file structure the search key is 9 bytes, the block size is 512 bytes, a record pointer is 7 bytes and a block pointer is 6 bytes. What is the largest possible order of a non-leaf node?</p>',
    opts: ['23', '24', '34', '44'], ans: 2,
    steps: ['A non-leaf node of a B+ tree stores block pointers and keys only. The record pointer is not used here.', 'For order <i>n</i> it holds <i>n</i> block pointers and <i>n</i> &minus; 1 keys: 6<i>n</i> + 9(<i>n</i> &minus; 1) &le; 512.', '15<i>n</i> &le; 521, so <i>n</i> &le; 34.7. The largest whole number is <b>34</b>.'],
    check: () => eq(M.orderFor(512, 6, 9, 0), 34, 'order') });
  Q({ topic: 'Block size and order', tag: GATE('GATE CSE 2007'),
    stem: '<p>The order of a leaf node of a B+ tree is the largest number of (value, record pointer) pairs it can hold. A leaf also holds one block pointer. The block size is 1 KB (1024 bytes), a record pointer is 7 bytes, the value field is 9 bytes and a block pointer is 6 bytes. What is the order of the leaf node?</p>',
    opts: ['63', '64', '67', '68'], ans: 0,
    steps: ['A leaf with <i>n</i> pairs uses <i>n</i>(7 + 9) bytes for the pairs plus 6 bytes for its block pointer.', 'It must fit in the block: 16<i>n</i> + 6 &le; 1024, so 16<i>n</i> &le; 1018.', '<i>n</i> &le; 63.6, so the order is <b>63</b>.'],
    check: () => eq(Math.floor((1024 - 6) / (7 + 9)), 63, 'leaf order') });
  Q({ topic: 'Block size and order', tag: GATE('GATE CSE 2015'),
    stem: '<p>A B+ tree has a search key of 12 bytes. The block size is 1024 bytes, a record pointer is 10 bytes and a block pointer is 8 bytes. What is the largest number of search keys that a non-leaf node can hold?</p>',
    nat: '50',
    steps: ['A non-leaf node holds <i>n</i> block pointers and <i>n</i> &minus; 1 keys. The 10-byte record pointer is not stored in it.', '8<i>n</i> + 12(<i>n</i> &minus; 1) &le; 1024, so 20<i>n</i> &le; 1036 and <i>n</i> &le; 51.8.', 'The largest order is 51, so the node holds 51 &minus; 1 = <b>50</b> keys.'],
    check: () => eq(M.orderFor(1024, 8, 12, 0) - 1, 50, 'keys') });
  Q({ topic: 'Block size and order', tag: GATE('GATE CSE 2017'),
    stem: '<p>In a B+ tree the search key is 8 bytes, the block size is 512 bytes and a pointer is 2 bytes. What is the largest order of the tree?</p>',
    nat: '52',
    steps: ['A node of order <i>p</i> holds <i>p</i> pointers and <i>p</i> &minus; 1 keys.', '2<i>p</i> + 8(<i>p</i> &minus; 1) &le; 512, so 10<i>p</i> &le; 520.', '<i>p</i> &le; 52. The largest order is <b>52</b>.'],
    check: () => eq(M.orderFor(512, 2, 8, 0), 52, 'order') });
  Q({ topic: 'Block size and order', tag: PRACTICE,
    stem: '<p>The internal nodes of a B+ tree use 1024-byte blocks. A key is 10 bytes and a block pointer is 8 bytes. What is the largest order of an internal node?</p>',
    opts: ['56', '57', '58', '102'], ans: 1,
    steps: ['8<i>p</i> + 10(<i>p</i> &minus; 1) &le; 1024, so 18<i>p</i> &le; 1034 and <i>p</i> &le; 57.4.', 'Check: 57 &times; 8 + 56 &times; 10 = 1016 &le; 1024, but 58 &times; 8 + 57 &times; 10 = 1034 &gt; 1024.', 'The order is <b>57</b>.'],
    check: () => eq(M.orderFor(1024, 8, 10, 0), 57, 'order') });
  Q({ topic: 'Block size and order', tag: PRACTICE,
    stem: '<p>A B-tree node stores, for every key, a 12-byte key and an 8-byte record pointer, plus block pointers of 8 bytes. The block is 2048 bytes. What is the largest order?</p>',
    opts: ['72', '73', '74', '102'], ans: 1,
    steps: ['A node of order <i>p</i> holds <i>p</i> block pointers and <i>p</i> &minus; 1 keys, each with a record pointer.', '8<i>p</i> + (<i>p</i> &minus; 1)(12 + 8) &le; 2048, so 28<i>p</i> &le; 2068 and <i>p</i> &le; 73.9.', 'Check: 73 &times; 8 + 72 &times; 20 = 2024 &le; 2048, and 74 &times; 8 + 73 &times; 20 = 2052 &gt; 2048. Order <b>73</b>.'],
    check: () => eq(M.orderFor(2048, 8, 12, 8), 73, 'order') });
  Q({ topic: 'Block size and order', tag: PRACTICE,
    stem: '<p>The leaf of a B+ tree holds pairs of (16-byte key, 8-byte record pointer) and one 8-byte pointer to the next leaf. The block is 4096 bytes. How many pairs can a leaf hold?</p>',
    opts: ['169', '170', '171', '256'], ans: 1,
    steps: ['<i>n</i>(16 + 8) + 8 &le; 4096, so 24<i>n</i> &le; 4088.', '<i>n</i> &le; 170.3, so a leaf holds <b>170</b> pairs.'],
    check: () => eq(Math.floor((4096 - 8) / 24), 170, 'pairs') });
  Q({ topic: 'Block size and order', tag: PRACTICE,
    stem: '<p>An internal node of a B+ tree uses 4-byte keys and 4-byte block pointers in a 512-byte block. What is the most keys it can hold?</p>',
    opts: ['62', '63', '64', '127'], ans: 1,
    steps: ['4<i>p</i> + 4(<i>p</i> &minus; 1) &le; 512 gives 8<i>p</i> &le; 516, so <i>p</i> &le; 64.5 and the order is 64.', 'Keys: 64 &minus; 1 = <b>63</b>. (64 &times; 4 + 63 &times; 4 = 508 bytes.)'],
    check: () => eq(M.orderFor(512, 4, 4, 0) - 1, 63, 'keys') });
  Q({ topic: 'Block size and order', tag: PRACTICE,
    stem: '<p>A B-tree stores keys of 20 bytes, record pointers of 12 bytes and block pointers of 8 bytes in 512-byte blocks. What is the largest order?</p>',
    opts: ['12', '13', '14', '16'], ans: 1,
    steps: ['8<i>p</i> + (<i>p</i> &minus; 1)(20 + 12) &le; 512, so 40<i>p</i> &le; 544 and <i>p</i> &le; 13.6.', 'Check: 13 &times; 8 + 12 &times; 32 = 488 &le; 512; 14 &times; 8 + 13 &times; 32 = 528 &gt; 512. Order <b>13</b>.'],
    check: () => eq(M.orderFor(512, 8, 20, 12), 13, 'order') });
  Q({ topic: 'Block size and order', tag: PRACTICE,
    stem: '<p>A B+ tree internal node uses 16-byte keys and 8-byte pointers in an 8192-byte block. What is the largest order?</p>',
    opts: ['341', '342', '343', '512'], ans: 1,
    steps: ['8<i>p</i> + 16(<i>p</i> &minus; 1) &le; 8192, so 24<i>p</i> &le; 8208 and <i>p</i> &le; 342.', 'A node of order 342 uses 342 &times; 8 + 341 &times; 16 = 8192 bytes: it fills the block exactly. Order <b>342</b>.'],
    check: () => eq(M.orderFor(8192, 8, 16, 0), 342, 'order') });
  Q({ topic: 'Block size and order', tag: PRACTICE,
    stem: '<p>Keys are 8 bytes, block pointers 8 bytes and record pointers 8 bytes, in 1024-byte blocks. What are the largest orders of a B+ tree internal node and of a B-tree node, in that order?</p>',
    opts: ['64 and 43', '43 and 64', '64 and 64', '63 and 42'], ans: 0,
    steps: ['B+ internal node, no record pointers: 8<i>p</i> + 8(<i>p</i> &minus; 1) &le; 1024 gives <i>p</i> &le; 64.5, so 64.', 'B-tree node, every key has a record pointer: 8<i>p</i> + 16(<i>p</i> &minus; 1) &le; 1024 gives 24<i>p</i> &le; 1040, so <i>p</i> &le; 43.3, so 43.', 'Answer: <b>64 and 43</b>. The B+ tree gets more children per block, so it is shallower.'],
    check: () => eq(M.orderFor(1024, 8, 8, 0) + ' and ' + M.orderFor(1024, 8, 8, 8), '64 and 43', 'orders') });
  Q({ topic: 'Block size and order', tag: PRACTICE,
    stem: '<p>A B+ tree internal node uses 10-byte keys and 6-byte pointers in a 512-byte block, with the largest possible order. How many bytes of the block does a full node leave unused?</p>',
    opts: ['0', '6', '10', '16'], ans: 2,
    steps: ['6<i>p</i> + 10(<i>p</i> &minus; 1) &le; 512 gives 16<i>p</i> &le; 522, so <i>p</i> = 32.', 'A full node uses 32 &times; 6 + 31 &times; 10 = 502 bytes.', 'Unused: 512 &minus; 502 = <b>10</b> bytes. (Order 33 would need 518 bytes.)'],
    check: () => eq(512 - M.nodeBytes(M.orderFor(512, 6, 10, 0), 6, 10, 0), 10, 'unused bytes') });

  // ============================ 3. Levels and keys ============================
  Q({ topic: 'Levels and keys', tag: GATE('GATE CSE 2020'),
    stem: '<p>A database is indexed by a B+ tree on a disk with 4 KB (4096-byte) blocks. A search key is 12 bytes and a tree (disk) pointer is 8 bytes. The database has one million records and each record fits in one block. Nothing is in main memory at the start. What is the least number of disk accesses needed to retrieve any record?</p>',
    nat: '4',
    steps: ['Order of a node: 8<i>p</i> + 12(<i>p</i> &minus; 1) &le; 4096 gives 20<i>p</i> &le; 4108, so <i>p</i> = 205.', 'Two levels of full nodes hold at most 205<sup>2</sup> &minus; 1 = 42,024 keys, which is fewer than a million. Three levels hold up to 205<sup>3</sup> &minus; 1 = 8,615,124 keys, which is enough. So the index has 3 levels and a search reads 3 index blocks.', 'One more block read fetches the record itself: 3 + 1 = <b>4</b>.'],
    check: () => eq(M.minLevels(M.orderFor(4096, 8, 12, 0), 1000000) + 1, 4, 'disk accesses') });
  Q({ topic: 'Levels and keys', tag: PRACTICE,
    stem: '<p>What is the most keys a B-tree of order 5 with 3 levels can hold?</p>',
    opts: ['100', '124', '125', '156'], ans: 1,
    steps: ['When every node is full, each node has 4 keys and 5 children.', 'Level 1: 1 node, 4 keys. Level 2: 5 nodes, 20 keys. Level 3: 25 nodes, 100 keys.', 'Total 4 + 20 + 100 = <b>124</b>, which is 5<sup>3</sup> &minus; 1.'],
    check: () => eq(M.maxKeysInLevels(5, 3), 124n, 'max keys') });
  Q({ topic: 'Levels and keys', tag: PRACTICE,
    stem: '<p>What is the fewest keys a B-tree of order 5 with 3 levels can hold?</p>',
    opts: ['15', '17', '18', '26'], ans: 1,
    steps: ['The root holds 1 key and has 2 children. Every other node holds at least &lceil;5/2&rceil; &minus; 1 = 2 keys, and an internal one has at least 3 children.', 'Level 1: 1 key. Level 2: 2 nodes with 2 keys = 4. Level 3: 2 &times; 3 = 6 nodes with 2 keys = 12.', 'Total 1 + 4 + 12 = <b>17</b>, which is 2 &times; 3<sup>2</sup> &minus; 1.'],
    check: () => eq(M.minKeysInLevels(5, 3), 17n, 'min keys') });
  Q({ topic: 'Levels and keys', tag: PRACTICE,
    stem: '<p>What is the fewest keys a B-tree of order 3 with 4 levels can hold?</p>',
    opts: ['14', '15', '16', '31'], ans: 1,
    steps: ['With order 3 every node holds at least 1 key. The root has 2 children and so does every internal node.', 'Nodes per level: 1, 2, 4, 8. Each holds 1 key, so 1 + 2 + 4 + 8 = <b>15</b>.'],
    check: () => eq(M.minKeysInLevels(3, 4), 15n, 'min keys') });
  Q({ topic: 'Levels and keys', tag: PRACTICE,
    stem: '<p>What is the most nodes a B-tree of order 4 with 3 levels can have?</p>',
    opts: ['16', '20', '21', '64'], ans: 2,
    steps: ['The most nodes come when every internal node has 4 children.', 'Levels: 1, 4 and 16 nodes. Total 1 + 4 + 16 = <b>21</b>.'],
    check: () => eq(1 + 4 + 16, 21, 'nodes') });
  Q({ topic: 'Levels and keys', tag: PRACTICE,
    stem: '<p>What is the fewest nodes a B-tree of order 5 with 4 levels can have?</p>',
    opts: ['15', '25', '27', '40'], ans: 2,
    steps: ['The fewest nodes come when the root has 2 children and every other internal node has the fewest allowed, &lceil;5/2&rceil; = 3.', 'Levels: 1, 2, 2 &times; 3 = 6, 6 &times; 3 = 18 nodes.', 'Total 1 + 2 + 6 + 18 = <b>27</b>.'],
    check: () => eq(1 + 2 + 6 + 18, 27, 'nodes') });
  Q({ topic: 'Levels and keys', tag: PRACTICE,
    stem: '<p>A full B-tree of order 4 has 3 levels. How many keys are on its third level?</p>',
    opts: ['36', '48', '63', '64'], ans: 1,
    steps: ['A full tree of order 4 has 1, 4 and 16 nodes on its three levels.', 'Every node holds 3 keys, so the third level holds 16 &times; 3 = <b>48</b> keys. (All three levels: 3 + 12 + 48 = 63 = 4<sup>3</sup> &minus; 1.)'],
    check: () => eq(16 * 3, 48, 'keys') });
  Q({ topic: 'Levels and keys', tag: PRACTICE,
    stem: '<p>At least how many levels does a B-tree of order 6 need to hold 200 keys?</p>',
    opts: ['2', '3', '4', '5'], ans: 1,
    steps: ['The fewest levels come when every node is full. <i>h</i> levels hold at most 6<sup><i>h</i></sup> &minus; 1 keys.', '6<sup>2</sup> &minus; 1 = 35 is too few. 6<sup>3</sup> &minus; 1 = 215 &ge; 200.', 'So at least <b>3</b> levels.'],
    check: () => eq(M.minLevels(6, 200), 3, 'levels') });
  Q({ topic: 'Levels and keys', tag: PRACTICE,
    stem: '<p>At most how many levels can a B-tree of order 6 have when it holds 200 keys?</p>',
    opts: ['4', '5', '6', '7'], ans: 1,
    steps: ['The most levels come when every node is as empty as allowed. With <i>t</i> = &lceil;6/2&rceil; = 3, <i>h</i> levels hold at least 2<i>t</i><sup><i>h</i>&minus;1</sup> &minus; 1 keys.', '<i>h</i> = 5: 2 &times; 81 &minus; 1 = 161 &le; 200. <i>h</i> = 6: 2 &times; 243 &minus; 1 = 485 &gt; 200.', 'So at most <b>5</b> levels.'],
    check: () => eq(M.maxLevels(6, 200), 5, 'levels') });
  Q({ topic: 'Levels and keys', tag: PRACTICE,
    stem: '<p>A B-tree of order 100 holds 1,000,000 keys. How many levels does it have?</p>',
    opts: ['3', '4', '5', '6'], ans: 1,
    steps: ['Three full levels hold only 100<sup>3</sup> &minus; 1 = 999,999 keys, one too few, so at least 4 levels are needed.', 'With <i>t</i> = 50, the most levels: 2 &times; 50<sup>3</sup> &minus; 1 = 249,999 &le; 1,000,000, but 2 &times; 50<sup>4</sup> &minus; 1 = 12,499,999 is too many for 5 levels to be possible.', 'So the tree has exactly <b>4</b> levels.'],
    check: () => eq(M.minLevels(100, 1000000) + ' ' + M.maxLevels(100, 1000000), '4 4', 'levels') });
  Q({ topic: 'Levels and keys', tag: PRACTICE,
    stem: '<p>A B-tree stores a 10-byte key, a 6-byte block pointer and an 8-byte record pointer per entry in 512-byte blocks, and indexes 100,000 keys. What is the most blocks one search may read?</p>',
    opts: ['4', '5', '6', '7'], ans: 1,
    steps: ['Order: 6<i>p</i> + 18(<i>p</i> &minus; 1) &le; 512 gives 24<i>p</i> &le; 530, so <i>p</i> = 22.', 'Most levels: <i>t</i> = 11 and 2 &times; 11<sup><i>h</i>&minus;1</sup> &minus; 1 &le; 100,000. 11<sup>4</sup> = 14,641 gives 29,281 and 11<sup>5</sup> = 161,051 gives too many, so <i>h</i> &minus; 1 = 4 and <i>h</i> = 5.', 'A search reads one block per level: at most <b>5</b>.'],
    check: () => { const p = M.orderFor(512, 6, 10, 8); return eq(p + ' ' + M.maxLevels(p, 100000), '22 5', 'order and levels'); } });

  // ============================ 4. Insertion ============================
  Q({ topic: 'Insertion', tag: GATE('GATE CSE 2008'),
    stem: '<p>A B-tree of order 4 is built from scratch by 10 successive insertions. What is the largest number of node-splitting operations that can take place?</p>',
    opts: ['3', '4', '5', '6'], ans: 2,
    figSol: { order: 4, ops: insOps([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]), label: 'The tree after 10, 9, 8, ... , 1 have been inserted:' },
    steps: () => ['Order 4 means a node holds at most 3 keys, so a node splits when an insert gives it 4.', 'Splits are most frequent when keys arrive in sorted order. Here the keys arrive in falling order, and the site&rsquo;s rule is used (the right-hand middle key moves up):'].concat(insertTrace(4, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1])).concat(['Splits: when 7 (1), 5 (1), 3 (1) and 1 (2) are inserted, which makes <b>5</b>. In rising order with the left-hand middle moving up, the count is the same.', 'A program that tried all 3,628,800 orders of ten keys found that the number of splits is always 2, 3 or 5, never more. So the largest is <b>5</b>.']),
    check: () => { const r = run(4, insOps([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])); return eq(r.e.frames.filter((f) => f.detail === 'split-overflow').length, 5, 'splits'); } });
  Q({ topic: 'Insertion', tag: GATE('GATE IT 2005'),
    stem: '<p>A B-tree used as the index of a large table has four levels, counting the root. A new key is inserted. What is the largest number of nodes that can be newly created in the process?</p>',
    opts: ['5', '4', '3', '2'], ans: 0,
    steps: ['The most nodes are created when every node on the path from the root to the leaf is full.', 'The leaf splits, which creates 1 new node. Its parent is full too, so it splits (1 new node), and so does the next one up (1 new node), and the root (1 new node). That is one new node for each of the 4 levels.', 'The root has split, so a new root is created above the two halves: 1 more node.', 'Total 4 + 1 = <b>5</b>.'],
    check: () => eq(4 + 1, 5, 'new nodes') });
  Q({ topic: 'Insertion', tag: GATE('GATE CSE 2009'),
    stem: '<p>A B+ tree has internal nodes of order 3 (at most 3 pointers, so at most 2 keys) and leaf nodes of order 2 (at most 2 data items). The keys 10, 3, 6, 8, 4, 2, 1 are inserted in this order into the empty tree. What is the largest number of times leaf nodes get split?</p>',
    opts: ['2', '3', '4', '5'], ans: 2,
    steps: ['Rule used (Elmasri and Navathe): when a leaf gets 3 items, the first 2 stay and the last one moves to a new leaf; the largest key of the left leaf is copied up to the parent, and a key equal to a separator goes left. An internal node that gets 3 keys sends its middle key up.', 'Insert 10, 3: the leaf is [3, 10]. No split.', 'Insert 6: [3, 6, 10] splits into [3, 6] and [10]; 6 is copied up. <b>Leaf split 1.</b>', 'Insert 8: 8 is larger than 6, so it goes to [10] and gives [8, 10]. No split.', 'Insert 4: [3, 4, 6] splits into [3, 4] and [6]; 4 is copied up, so the parent holds 4, 6. <b>Leaf split 2.</b>', 'Insert 2: [2, 3, 4] splits into [2, 3] and [4]; 3 is copied up, so the parent holds 3, 4, 6, which is too many. The parent splits and 4 moves up. <b>Leaf split 3.</b>', 'Insert 1: [1, 2, 3] splits into [1, 2] and [3]; 2 is copied up. <b>Leaf split 4.</b>', 'Answer: <b>4</b>. Other conventions for splitting can give a different count, which is why an answer should state its rule.'] });
  Q({ topic: 'Insertion', tag: PRACTICE,
    stem: '<p>The keys 5, 15, 25, 35, 45 are inserted in this order into an empty B-tree of order 3. What does the root hold?</p>',
    opts: ['25', '15, 35', '15, 25', '25, 35'], ans: 1,
    steps: () => insertTrace(3, [5, 15, 25, 35, 45]).concat(['The root holds <b>15, 35</b>, and the tree has two levels.']),
    check: () => eq(rootKeys(run(3, insOps([5, 15, 25, 35, 45]))), '15, 35', 'root') });
  Q({ topic: 'Insertion', tag: PRACTICE,
    stem: '<p>The keys 1, 2, 3, 4, 5, 6, 7 are inserted in this order into an empty B-tree of order 4. When a node has two middle keys, the right-hand one moves up. What does the root hold?</p>',
    opts: ['4', '3, 6', '3, 5', '4, 6'], ans: 1,
    figSol: { order: 4, ops: insOps([1, 2, 3, 4, 5, 6, 7]), label: 'The finished tree:' },
    steps: () => insertTrace(4, [1, 2, 3, 4, 5, 6, 7]).concat(['The root holds <b>3, 6</b>.']),
    check: () => eq(rootKeys(run(4, insOps([1, 2, 3, 4, 5, 6, 7]))), '3, 6', 'root') });
  Q({ topic: 'Insertion', tag: PRACTICE,
    stem: '<p>The keys 1, 2, 3, 4, 5, 6, 7 are inserted in this order into an empty B-tree of order 3. How many levels does the tree have?</p>',
    opts: ['2', '3', '4', '7'], ans: 1,
    figSol: { order: 3, ops: insOps([1, 2, 3, 4, 5, 6, 7]), label: 'The finished tree:' },
    steps: () => insertTrace(3, [1, 2, 3, 4, 5, 6, 7]).concat(['The root is split when 7 is inserted, so the tree has <b>3</b> levels.']),
    check: () => eq(run(3, insOps([1, 2, 3, 4, 5, 6, 7])).e.getStats().height, 3, 'levels') });
  Q({ topic: 'Insertion', tag: PRACTICE,
    stem: '<p>The keys 1, 2, 3, 4, 5, 6, 7 are inserted in this order into an empty B-tree of order 3. How many times does a node split in all?</p>',
    opts: ['3', '4', '5', '7'], ans: 1,
    steps: () => insertTrace(3, [1, 2, 3, 4, 5, 6, 7]).concat(['Splits: inserting 3 (1), 5 (1) and 7 (2: a leaf, then the node above it) gives 1 + 1 + 2 = <b>4</b>.']),
    check: () => eq(run(3, insOps([1, 2, 3, 4, 5, 6, 7])).e.frames.filter((f) => f.detail === 'split-overflow').length, 4, 'splits') });
  Q({ topic: 'Insertion', tag: PRACTICE,
    stem: '<p>The keys 10, 20, 30, 40, 50, 60, 70, 80 are inserted in this order into an empty B-tree of order 5. How many leaves does it have?</p>',
    opts: ['2', '3', '4', '5'], ans: 1,
    figSol: { order: 5, ops: insOps([10, 20, 30, 40, 50, 60, 70, 80]), label: 'The finished tree:' },
    steps: () => insertTrace(5, [10, 20, 30, 40, 50, 60, 70, 80]).concat(['The tree has <b>3</b> leaves under a root of two keys.']),
    check: () => eq(run(5, insOps([10, 20, 30, 40, 50, 60, 70, 80])).tree.children.length, 3, 'leaves') });
  Q({ topic: 'Insertion', tag: PRACTICE,
    stem: '<p>A leaf of a B-tree of order 5 holds 12, 18, 25, 31 and is full. The key 22 is inserted. Which key moves up into the parent?</p>',
    opts: ['18', '22', '25', '31'], ans: 1,
    steps: ['With 22 the leaf holds 12, 18, 22, 25, 31: five keys, one too many.', 'It splits around its middle key, the third of five: <b>22</b>. The leaves become [12, 18] and [25, 31].'],
    check: () => eq(rootKeys(run(5, insOps([12, 18, 25, 31, 22]))), '22', 'promoted key') });
  Q({ topic: 'Insertion', tag: PRACTICE,
    stem: '<p>A leaf of a B-tree of order 4 holds 20, 30, 40 and is full. The key 35 is inserted. When a node has two middle keys the right-hand one moves up. Which key moves up?</p>',
    opts: ['20', '30', '35', '40'], ans: 2,
    steps: ['With 35 the leaf holds 20, 30, 35, 40: four keys, one too many.', 'The two middle keys are 30 and 35. The right-hand one, <b>35</b>, moves up. The leaves become [20, 30] and [40]. (A book that moves up the left-hand key would send up 30.)'],
    check: () => eq(rootKeys(run(4, insOps([20, 30, 40, 35]))), '35', 'promoted key') });
  Q({ topic: 'Insertion', tag: PRACTICE,
    stem: '<p>The keys 10, 20, ..., 150 (fifteen keys, in steps of 10) are inserted in this order into an empty B-tree of order 4. How many nodes does the tree have?</p>',
    opts: ['7', '8', '9', '15'], ans: 1,
    figSol: { order: 4, ops: insOps(K.shuffle ? [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150] : []), label: 'The finished tree:' },
    steps: () => ['The finished tree has 1 key in the root, 2 nodes on the second level and 5 leaves.', 'Total 1 + 2 + 5 = <b>8</b> nodes, on 3 levels.'],
    check: () => eq(run(4, insOps([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150])).e.getStats().totalNodes, 8, 'nodes') });
  Q({ topic: 'Insertion', tag: PRACTICE,
    stem: '<p>The keys 7, 3, 9, 1, 5 are inserted in this order into an empty B-tree of order 3. What does the root hold?</p>',
    opts: ['7', '3, 7', '3, 5', '5'], ans: 1,
    steps: () => insertTrace(3, [7, 3, 9, 1, 5]).concat(['The root holds <b>3, 7</b>.']),
    check: () => eq(rootKeys(run(3, insOps([7, 3, 9, 1, 5]))), '3, 7', 'root') });

  // ============================ 5. Deletion ============================
  Q({ topic: 'Deletion', tag: PRACTICE,
    stem: '<p>The keys 10, 20, ..., 80 are inserted in this order into an empty B-tree of order 4. Then 20 is deleted, and then 10. A leaf that is too small first borrows from its left sibling, then from its right sibling. What does the root hold now?</p>',
    opts: ['30, 60', '40, 60', '30, 50', '50, 60'], ans: 1,
    figSol: { order: 4, ops: insOps([10, 20, 30, 40, 50, 60, 70, 80]).concat(delOps([20, 10])), label: 'The tree after both deletes:' },
    steps: () => { const r = run(4, insOps([10, 20, 30, 40, 50, 60, 70, 80]).concat(delOps([20, 10]))); return ['After the inserts the root is [30, 60] over the leaves [10, 20], [40, 50] and [70, 80].'].concat(msgs(r, 8)).concat(msgs(r, 9)).concat(['The root holds <b>40, 60</b>.']); },
    check: () => eq(rootKeys(run(4, insOps([10, 20, 30, 40, 50, 60, 70, 80]).concat(delOps([20, 10])))), '40, 60', 'root') });
  Q({ topic: 'Deletion', tag: PRACTICE,
    stem: '<p>The keys 10, 20, ..., 80 are inserted in this order into an empty B-tree of order 4. Then 80 is deleted, and then 70. The leaf that is left empty borrows from its left sibling. Which key moves up into the root?</p>',
    opts: ['40', '50', '60', '70'], ans: 1,
    figSol: { order: 4, ops: insOps([10, 20, 30, 40, 50, 60, 70, 80]).concat(delOps([80, 70])), label: 'The tree after both deletes:' },
    steps: () => { const r = run(4, insOps([10, 20, 30, 40, 50, 60, 70, 80]).concat(delOps([80, 70]))); return ['After the inserts the root is [30, 60] over the leaves [10, 20], [40, 50] and [70, 80].'].concat(msgs(r, 9)).concat(['The sibling&rsquo;s largest key, <b>50</b>, moves up and the old separator 60 moves down.']); },
    check: () => { const r = run(4, insOps([10, 20, 30, 40, 50, 60, 70, 80]).concat(delOps([80, 70]))); return eq(rootKeys(r), '30, 50', 'root'); } });
  Q({ topic: 'Deletion', tag: PRACTICE,
    stem: '<p>The keys 10, 20, ..., 70 are inserted into an empty B-tree of order 4, so the root holds 30 and 60. The key 30 is now deleted. Which key takes its place in the root?</p>',
    opts: ['10', '20', '40', '50'], ans: 1,
    steps: ['The tree is [30, 60] over [10, 20], [40, 50] and [70].', '30 is in an internal node, so it is replaced by its predecessor, the largest key in the subtree to its left: <b>20</b>.', 'The leaf [10, 20] still has a key left, so nothing else changes. The root is now [20, 60].'],
    check: () => eq(rootKeys(run(4, insOps([10, 20, 30, 40, 50, 60, 70]).concat(delOps([30])))), '20, 60', 'root') });
  Q({ topic: 'Deletion', tag: PRACTICE,
    stem: '<p>In a B-tree of order 6 a leaf that is not the root holds its fewest allowed keys and loses one. Its left sibling holds 3 keys and its right sibling holds 2. What does the tree do?</p>',
    opts: ['Borrow a key from the left sibling', 'Borrow a key from the right sibling', 'Merge with the left sibling', 'Merge with the right sibling'], ans: 0,
    steps: ['The fewest keys is &lceil;6/2&rceil; &minus; 1 = 2, so the leaf now has 1 key, one too few.', 'The right sibling has exactly 2 keys: it has none to spare. The left sibling has 3, one more than the minimum, so it can lend one.', 'A key can be borrowed, so no merge is needed: <b>borrow from the left sibling</b>.'],
    check: () => eq(M.minKeys(6), 2, 'minimum') });
  Q({ topic: 'Deletion', tag: PRACTICE,
    stem: '<p>In a B-tree of order 5 a leaf holds its fewest allowed keys and loses one. Both its siblings hold exactly the fewest allowed. The leaf merges with a sibling and the key between them in the parent. How many keys does the merged node hold?</p>',
    opts: ['3', '4', '5', '2'], ans: 1,
    steps: ['The fewest keys is &lceil;5/2&rceil; &minus; 1 = 2. The small leaf now has 1 key.', 'The merged node holds the 1 key, the sibling&rsquo;s 2 keys and the 1 key from the parent: 1 + 2 + 1 = <b>4</b>.', '4 is exactly the most a node of order 5 may hold, so the merge fits.'],
    check: () => eq(1 + M.minKeys(5) + 1, M.maxKeys(5), 'merged keys') });
  Q({ topic: 'Deletion', tag: PRACTICE,
    stem: '<p>The keys 1, 2, ..., 7 are inserted into an empty B-tree of order 3, which then has 3 levels. The key 7 is deleted. How many levels does the tree have now?</p>',
    opts: ['1', '2', '3', '4'], ans: 1,
    figSol: { order: 3, ops: insOps([1, 2, 3, 4, 5, 6, 7]).concat(delOps([7])), label: 'The tree after the delete:' },
    steps: () => { const r = run(3, insOps([1, 2, 3, 4, 5, 6, 7]).concat(delOps([7]))); return msgs(r, 7).concat(['The root has lost its last key, so the tree is one level shorter: <b>2</b> levels.']); },
    check: () => eq(run(3, insOps([1, 2, 3, 4, 5, 6, 7]).concat(delOps([7]))).e.getStats().height, 2, 'levels') });

  // ============================ 6. Search cost ============================
  Q({ topic: 'Search cost', tag: PRACTICE,
    stem: '<p>The tree below is a B-tree of order 4. How many nodes are read when searching for the key 85?</p>',
    figure: { order: 4, ops: insOps([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150]) },
    opts: ['1', '2', '3', '5'], ans: 2,
    steps: ['Start at the root [90]. 85 is smaller than 90, so go to the left child.', 'In [30, 60], 85 is larger than both, so go to the third child [70, 80].', '[70, 80] is a leaf and 85 is not in it, so the search ends: not found.', 'Nodes read: root, [30, 60] and [70, 80] = <b>3</b>.'],
    check: () => eq(run(4, insOps([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150])).e.search(85).visits, 3, 'nodes read') });
  Q({ topic: 'Search cost', tag: PRACTICE,
    stem: '<p>A B-tree index of order 100 holds 1,000,000 keys. Every node is one block, and the matching record is in a block of its own, found through a record pointer. How many block reads does one lookup need?</p>',
    opts: ['4', '5', '6', '20'], ans: 1,
    steps: ['A tree of order 100 with 1,000,000 keys has 4 levels, so the search reads 4 blocks of the index.', 'The record is in one more block: 4 + 1 = <b>5</b> reads.'],
    check: () => eq(M.minLevels(100, 1000000) + 1, 5, 'reads') });
  Q({ topic: 'Search cost', tag: PRACTICE,
    stem: '<p>A B-tree has 3 levels. A search is made for a key that is not in it. How many nodes does the search read?</p>',
    opts: ['1', '2', '3', 'It depends on the key'], ans: 2,
    steps: ['At each node the search either finds the key or goes down to a child. A missing key is never found on the way.', 'So it always goes all the way to a leaf, which is on the third level.', 'It reads exactly <b>3</b> nodes, whatever the key.'],
    check: () => eq(run(3, insOps([1, 2, 3, 4, 5, 6, 7])).e.search(100).visits, 3, 'nodes read') });

  // ============================ 7. Concepts ============================
  Q({ topic: 'B-tree and B+ tree concepts', tag: GATE('GATE CSE 2024'),
    stem: '<p>In a B+ tree, the requirement that every node be at least half full (50% occupancy) is relaxed for which one of the following?</p>',
    opts: ['Only the root node', 'All leaf nodes', 'All internal nodes', 'Only the leftmost leaf node'], ans: 0,
    steps: ['Every node of a B+ tree except one must stay at least half full, so that the tree stays shallow.', 'The exception is the root, which may hold as few as one key (or, as a leaf, one entry).', 'Answer: <b>only the root node</b>.'] });
  Q({ topic: 'B-tree and B+ tree concepts', tag: PRACTICE,
    stem: '<p>Which of these is true of a B+ tree but <b>not</b> of a B-tree?</p>',
    opts: ['All leaves are on the same level.', 'Records (or pointers to them) are kept only in the leaves, and the leaves are linked in key order.', 'A node holds many keys in sorted order.', 'A full node is split when a key is inserted.'], ans: 1,
    steps: ['A, C and D describe both kinds of tree.', 'Only a B+ tree keeps all its records at the leaves, repeats keys in the inner nodes just to guide the search, and links the leaves into a list.', 'Answer: <b>B</b>.'] });
  Q({ topic: 'B-tree and B+ tree concepts', tag: PRACTICE,
    stem: '<p>Why is a B+ tree better than a B-tree for a range query such as &ldquo;all keys from 40 to 90&rdquo;?</p>',
    opts: ['After the first key is found, the linked leaves can be read in order without going back up the tree.', 'It always has fewer levels.', 'Its keys are not sorted, so no comparison is needed.', 'It never splits.'], ans: 0,
    steps: ['A range query needs every key between two values, in order.', 'In a B+ tree all the keys are in the leaves and the leaves are linked, so after finding 40 you follow the links to 90.', 'In a B-tree you must walk up and down between levels. Answer: <b>A</b>.'] });
  Q({ topic: 'B-tree and B+ tree concepts', tag: PRACTICE,
    stem: '<p>What makes a B-tree one level taller?</p>',
    opts: ['Inserting a key into a leaf that is not full', 'A split of the root', 'Deleting a key from a leaf', 'A split of any leaf'], ans: 1,
    steps: ['Splitting a node below the root only moves a key up into its parent. All the paths keep the same length.', 'When the root itself splits, a new root is created above it, and every leaf moves down one level together. Answer: <b>a split of the root</b>.'],
    check: () => eq(run(3, insOps([1, 2, 3])).e.getStats().height + ' ' + run(3, insOps([1, 2])).e.getStats().height, '2 1', 'height') });
  Q({ topic: 'B-tree and B+ tree concepts', tag: PRACTICE,
    stem: '<p>What makes a B-tree one level shorter?</p>',
    opts: ['A merge that takes the last key out of the root', 'Borrowing a key from a sibling', 'Deleting a key from a leaf that has keys to spare', 'Searching for a missing key'], ans: 0,
    steps: ['Borrowing and plain deletes do not change how many levels there are.', 'A merge pulls a key down from the parent. If the parent is the root and it loses its last key, its only child becomes the root. Answer: <b>A</b>.'],
    check: () => eq(run(3, insOps([1, 2, 3, 4, 5, 6, 7]).concat(delOps([7]))).e.getStats().height, 2, 'height') });
  Q({ topic: 'B-tree and B+ tree concepts', tag: PRACTICE,
    stem: '<p>Why do database indexes use a B-tree rather than a balanced binary tree?</p>',
    opts: ['A node fills a whole disk block, so the tree is shallow and a search reads few blocks.', 'A B-tree needs no sorting.', 'A binary tree cannot hold numbers.', 'A B-tree never needs to be rebalanced.'], ans: 0,
    steps: ['Reading a block from disk is far slower than comparing keys in memory, so the number of blocks read is what counts.', 'A balanced binary tree with a million keys has about 20 levels. A B-tree of order 100 has 4. Answer: <b>A</b>.'] });
  Q({ topic: 'B-tree and B+ tree concepts', tag: PRACTICE,
    stem: '<p>Which of these statements about a B-tree of order <i>m</i> are true?<br>S1: All leaves are on the same level.<br>S2: A root that is not a leaf has at least two children.<br>S3: Every node other than the root holds at least &lceil;<i>m</i>/2&rceil; keys.</p>',
    opts: ['S1 and S2 only', 'S1 and S3 only', 'S2 and S3 only', 'S1, S2 and S3'], ans: 0,
    steps: ['S1 is true: the tree grows and shrinks only at the root.', 'S2 is true: a root with at least 1 key has at least 2 children.', 'S3 is false: the minimum is &lceil;<i>m</i>/2&rceil; &minus; 1 keys. For <i>m</i> = 4 a node may hold just 1 key, which is less than 2.', 'Answer: <b>S1 and S2 only</b>.'],
    check: () => eq(M.minKeys(4), 1, 'minimum keys for order 4') });

  // ---- rendering ----
  const letter = (i) => LETTERS[i];
  const answerText = (q) => (q.nat != null ? q.nat : `${letter(q.ans)}. ${q.opts[q.ans]}`);
  const stepsOf = (q) => (typeof q.steps === 'function' ? q.steps() : q.steps);
  function drawInto(parent, spec, label) {
    const tree = K.runOps(spec.order, spec.ops).tree;
    if (label) { const p = document.createElement('p'); p.className = 'fig-label'; p.textContent = label; parent.appendChild(p); }
    const box = document.createElement('div');
    box.className = 'q-figure fig-live';
    parent.appendChild(box);
    UI.drawFigure(box, tree, { order: spec.order });
  }

  function cardFor(q) {
    const li = document.createElement('li');
    li.className = 'exq';
    li.id = 'exq' + q.n;
    li.dataset.kind = q.tag.kind;
    li.dataset.topic = q.topic;
    const opts = q.opts
      ? `<ol class="exq-options" type="A">${q.opts.map((o, i) => `<li data-i="${i}"${i === q.ans ? ' data-correct="true"' : ''}><span class="o-letter">${LETTERS[i]}</span><span class="o-text">${o}</span><span class="o-mark">Correct</span></li>`).join('')}</ol>`
      : '<p class="exq-nat">This is a numerical-answer question: work out the number.</p>';
    li.innerHTML =
      `<header class="exq-head"><span class="exq-no">Question ${q.n}</span><span class="exq-tag" data-kind="${q.tag.kind}"><span class="visually-hidden">Tag: </span>${esc(q.tag.label)}</span><span class="exq-topic">${esc(q.topic)}</span></header>` +
      `<div class="exq-stem">${q.stem}</div><div class="exq-fig" data-slot="q"></div>${opts}` +
      `<div class="exq-sol"><p class="exq-answer"><b>Correct Answer:</b> ${q.nat != null ? esc(q.nat) : letter(q.ans) + '. ' + q.opts[q.ans]}</p>` +
      `<h4>Solution</h4><ol class="exq-steps">${stepsOf(q).map((s) => `<li>${s}</li>`).join('')}</ol><div class="exq-fig" data-slot="s"></div></div>`;
    if (q.figure) drawInto(li.querySelector('[data-slot="q"]'), q.figure);
    if (q.figSol) drawInto(li.querySelector('[data-slot="s"]'), q.figSol, q.figSol.label);
    return li;
  }

  const topics = Array.from(new Set(BANK.map((q) => q.topic)));
  function applyFilters() {
    const kind = $('examTagFilter').value, topic = $('examTopicFilter').value, text = $('examSearch').value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll('#examList > li').forEach((li) => {
      const q = BANK[Number(li.id.slice(3)) - 1];
      const hay = (q.topic + ' ' + q.tag.label + ' ' + li.querySelector('.exq-stem').textContent + ' ' + (q.opts || []).join(' ')).toLowerCase();
      const ok = (kind === 'all' || q.tag.kind === kind) && (topic === 'all' || q.topic === topic) && (!text || hay.includes(text));
      li.hidden = !ok;
      if (ok) shown++;
    });
    $('examCount').textContent = `Showing ${shown} of ${BANK.length} questions. ${BANK.filter((q) => q.tag.kind === 'gate').length} are previous-year GATE questions.`;
    $('examEmpty').hidden = shown > 0;
  }
  function applySolutions() {
    $('examList').classList.toggle('hide-solutions', !$('examShowSolutions').checked);
  }

  const list = $('examList');
  BANK.forEach((q) => list.appendChild(cardFor(q)));
  topics.forEach((t) => { const o = document.createElement('option'); o.value = t; o.textContent = t; $('examTopicFilter').appendChild(o); });
  ['examTagFilter', 'examTopicFilter'].forEach((id) => $(id).addEventListener('change', applyFilters));
  $('examSearch').addEventListener('input', applyFilters);
  $('examShowSolutions').addEventListener('change', applySolutions);
  applyFilters();
  applySolutions();

  window.BTreeExam = {
    bank: BANK,
    // every question's answer worked out again; returns a list of problems (empty when all agree)
    verify() {
      const bad = [];
      BANK.forEach((q) => {
        const where = `Question ${q.n} (${q.tag.label})`;
        if (q.opts) {
          if (q.opts.length !== 4) bad.push(`${where}: has ${q.opts.length} options`);
          if (new Set(q.opts).size !== q.opts.length) bad.push(`${where}: two options are the same`);
          if (!(q.ans >= 0 && q.ans < q.opts.length)) bad.push(`${where}: the right answer is not one of the options`);
        } else if (q.nat == null) bad.push(`${where}: no answer`);
        if (!stepsOf(q).length) bad.push(`${where}: no solution`);
        if (typeof q.check === 'function') { const r = q.check(); if (r !== true) bad.push(`${where}: ${r}`); }
      });
      return bad;
    },
    answerText
  };
})();
