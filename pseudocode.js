/**
 * pseudocode.js: the algorithm text shown beside the figure, and the table that says which
 * lines of it each recorded step is carrying out.
 *
 * Nothing in here runs the algorithm. btree-engine.js does the work and tags every step it
 * records with a "detail" ("leaf-insert", "rotate-left", ...). This file turns that tag into
 * line numbers, so the page can highlight the line that is being carried out at that moment.
 *
 * Writing the lines: *word* is a keyword (bold), _word_ is a variable (italic).
 * {max}, {min} and {minkeys} are filled in from the order of the tree on screen.
 */
(function () {
  'use strict';

  const CODE = {
    insert: {
      title: 'insert(key)',
      lines: [
        [0, '*insert*(_key_):'],
        [1, '*if* _key_ is already in the tree: *stop*'],
        [1, '*if* the tree is empty:'],
        [2, 'root = new leaf holding _key_; *stop*'],
        [1, '_node_ = root'],
        [1, '*while* _node_ is not a leaf:'],
        [2, '_i_ = number of keys in _node_ < _key_'],
        [2, '_node_ = _node_.child[_i_]'],
        [1, 'put _key_ into _node_, in sorted order'],
        [1, '*while* _node_ has more than {max} keys:'],
        [2, 'split _node_ at its middle key, _mid_'],
        [2, '*if* _node_ is the root:'],
        [3, 'new root = [_mid_] over both halves; *stop*'],
        [2, 'move _mid_ up into the parent'],
        [2, '_node_ = parent']
      ]
    },
    delete: {
      title: 'delete(key)',
      lines: [
        [0, '*delete*(_key_):'],
        [1, '*if* _key_ is not in the tree: *stop*'],
        [1, '_node_ = the node that holds _key_'],
        [1, '*if* _node_ is a leaf:'],
        [2, 'remove _key_ from _node_'],
        [1, '*else*:'],
        [2, 'move the predecessor up to replace _key_'],
        [2, '_node_ = the leaf it came out of'],
        [1, '*while* non-root _node_ has {minkeys}:'],
        [2, '*if* left sibling has a spare key:'],
        [3, 'rotate right via the parent; *stop*'],
        [2, '*else if* right sibling has a spare key:'],
        [3, 'rotate left via the parent; *stop*'],
        [2, '*else*:'],
        [3, 'merge _node_ with a sibling and the key between them'],
        [3, '_node_ = parent'],
        [1, '*if* the root has no keys:'],
        [2, '*if* it has a child: that child is the root'],
        [2, '*else*: the tree is empty']
      ]
    },
    search: {
      title: 'search(key)',
      lines: [
        [0, '*search*(_key_):'],
        [1, '*if* the tree is empty: *return* not found'],
        [1, '_node_ = root'],
        [1, '*repeat*:'],
        [2, '*if* _key_ is in _node_: *return* found'],
        [2, '*if* _node_ is a leaf: *return* not found'],
        [2, '_i_ = number of keys in _node_ < _key_'],
        [2, '_node_ = _node_.child[_i_]']
      ]
    }
  };

  /*
   * Which lines each kind of step is carrying out.
   * A plain list is used for every step of that kind. A { first, later } pair is for the
   * kinds that read differently at the start of an operation: the first step of an insert or a
   * search has just taken the root, so "node = root" is part of it.
   */
  const MAP = {
    insert: {
      duplicate: [2],
      'first-key': [3, 4],
      descend: { first: [5], later: [6, 7, 8] },
      'leaf-insert': [9],
      'split-overflow': [10, 11],
      'root-split': [12, 13],
      'split-promote': [14, 15]
    },
    delete: {
      missing: [2],
      located: [3],
      'leaf-remove': [4, 5],
      predecessor: [6, 7, 8],
      'rotate-right': [9, 10, 11],
      'rotate-left': [9, 12, 13],
      'merge-left': [9, 14, 15],
      'merge-right': [9, 14, 15],
      'root-shrink': [17, 18],
      emptied: [17, 19]
    },
    search: {
      empty: [2],
      descend: { first: [3, 7, 8], later: [7, 8] },
      found: { first: [3, 5], later: [5] },
      'not-found': { first: [3, 6], later: [6] }
    }
  };

  const OPS = ['insert', 'delete', 'search'];

  function markup(text) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*(.+?)\*/g, '<b>$1</b>')
      .replace(/_(.+?)_/g, '<i>$1</i>');
  }

  // The lines of one procedure, with the numbers for this order filled in.
  function lines(op, order) {
    const m = order || 4;
    const min = Math.ceil(m / 2) - 1, max = m - 1;
    const fill = (s) => s
      .replace('{minkeys}', 'fewer than ' + min + (min === 1 ? ' key' : ' keys'))
      .replace('{min}', String(min))
      .replace('{max}', String(max));
    return (CODE[op] ? CODE[op].lines : []).map((l, i) => ({ n: i + 1, indent: l[0], html: markup(fill(l[1])) }));
  }

  // The 1-based line numbers a step is carrying out; [] when the step is not part of an operation.
  function linesFor(op, frame, isFirst) {
    const table = MAP[op];
    if (!table || !frame) return [];
    const hit = table[frame.detail];
    if (!hit) return [];
    if (Array.isArray(hit)) return hit.slice();
    return (isFirst ? hit.first : hit.later).slice();
  }

  // "line 9", "lines 10 and 11", "lines 9, 12 and 13", "lines 6 to 8"
  function phrase(nums) {
    if (!nums || !nums.length) return '';
    const sorted = nums.slice().sort((a, b) => a - b);
    const runs = [];
    sorted.forEach((n) => {
      const last = runs[runs.length - 1];
      if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]);
    });
    const parts = [];
    runs.forEach(([a, b]) => {
      if (b - a >= 2) parts.push(a + ' to ' + b);
      else for (let n = a; n <= b; n++) parts.push(String(n));
    });
    const list = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
    return (sorted.length === 1 ? 'line ' : 'lines ') + list;
  }

  const api = {
    OPS,
    title: (op) => (CODE[op] ? CODE[op].title : ''),
    lines,
    linesFor,
    phrase,
    lineCount: (op) => (CODE[op] ? CODE[op].lines.length : 0),
    // every step kind the table knows about, so the Checks tab can compare it with the engine
    knownDetails: (op) => Object.keys(MAP[op] || {})
  };

  if (typeof window !== 'undefined') window.BTreeCode = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
