/**
 * B-tree engine (DBMS project).
 *
 * This file is only the data structure. It knows nothing about the page, so the
 * checks on the Checks tab (tests.js) can run it on its own.
 *
 * Order m means a node has at most m children, so at most m - 1 keys. Every node
 * except the root keeps at least ceil(m/2) - 1 keys.
 *
 *   insert  - walk down to a leaf and add the key. A node with m keys is split around its
 *             middle key (the right-hand one when there are two) and that key moves up.
 *   delete  - a key in an internal node is swapped with its in-order predecessor first.
 *             A node left too small borrows from a sibling (rotation) or merges with it.
 *   search  - walk down and count the nodes read.
 *
 * Every operation records "frames" (a copy of the tree plus a sentence about what just
 * happened). The visualizer replays them one by one. Each frame has:
 *   tree, message, highlightNodeKeys, highlightKeys, actionType, detail
 * where detail says exactly which case it was (for example "rotate-left" or "merge-right"),
 * so other code never has to read the sentence to find out.
 *
 * v2.1: the sentences were reworded and the highlights widened. The insert, delete and
 * search logic is the same as before and was re-checked against thousands of random runs.
 */

class BTreeNode {
  constructor(isLeaf = true) {
    this.keys = [];
    this.children = [];
    this.isLeaf = isLeaf;
    this.id = 'node_' + Math.random().toString(36).substr(2, 9);
  }
}

class BTreeEngine {
  constructor(order = 4) {
    this.order = order;
    this.root = new BTreeNode(true);
    this.history = [];
    this.frames = [];
    this.currentFrameIdx = 0;
    this.operationCount = 0;
  }

  setOrder(m) {
    if (m < 3 || m > 8) throw new Error("Order must be between 3 and 8");
    this.order = m;
    this.clear();
  }

  clear() {
    this.root = new BTreeNode(true);
    this.history = [];
    this.frames = [];
    this.currentFrameIdx = 0;
    this.operationCount = 0;
    this.recordFrame("The tree is empty.", [], [], 'info', 'cleared');
  }

  minKeys() {
    return Math.ceil(this.order / 2) - 1;
  }

  maxKeys() {
    return this.order - 1;
  }

  // "1 node", "2 nodes": used in the sentences below
  plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  // "now holds [3, 5]", or "is now empty": a leaf can be empty for a moment before it is repaired
  holds(keys) {
    return keys.length ? `now holds [${keys.join(', ')}]` : 'is now empty';
  }

  cloneNode(node) {
    const copy = {
      id: node.id,
      keys: [...node.keys],
      isLeaf: node.isLeaf,
      children: []
    };
    if (!node.isLeaf && node.children) {
      copy.children = node.children.map(c => this.cloneNode(c));
    }
    return copy;
  }

  cloneTree() {
    return this.cloneNode(this.root);
  }

  recordFrame(message, highlightNodeKeys = [], highlightKeys = [], actionType = 'info', detail = '') {
    this.frames.push({
      tree: this.cloneTree(),
      message,
      // A node is highlighted when it contains one of these keys (keys are unique in a B-tree).
      highlightNodeKeys: highlightNodeKeys.filter(k => k !== undefined),
      highlightKeys: highlightKeys.filter(k => k !== undefined),
      actionType,
      detail
    });
  }

  contains(val, node = this.root) {
    let i = 0;
    while (i < node.keys.length && val > node.keys[i]) i++;
    if (i < node.keys.length && node.keys[i] === val) return true;
    if (node.isLeaf) return false;
    return this.contains(val, node.children[i]);
  }

  insert(val) {
    if (this.contains(val)) {
      this.recordFrame(`${val} is already in the tree, so nothing was inserted. A B-tree keeps each key once.`, [val], [val], 'error', 'duplicate');
      return { success: false, reason: "duplicate" };
    }

    this.operationCount++;
    const path = [];
    let curr = this.root;

    if (curr.keys.length === 0) {
      curr.keys.push(val);
      this.recordFrame(`The tree was empty, so ${val} becomes the first key in the root.`, [val], [val], 'insert', 'first-key');
      return { success: true };
    }

    this.recordFrame(`Insert ${val}: start at the root [${curr.keys.join(', ')}].`, [curr.keys[0]], [val], 'search', 'descend');

    while (!curr.isLeaf) {
      let i = 0;
      while (i < curr.keys.length && val > curr.keys[i]) i++;
      path.push({ node: curr, childIdx: i });
      const comp = i < curr.keys.length ? `${val} < ${curr.keys[i]}` : `${val} > ${curr.keys[curr.keys.length - 1]}`;
      curr = curr.children[i];
      this.recordFrame(`${comp}, so go down to the child [${curr.keys.join(', ')}].`, [curr.keys[0]], [val], 'search', 'descend');
    }

    // Insert into leaf in sorted order
    let i = 0;
    while (i < curr.keys.length && val > curr.keys[i]) i++;
    curr.keys.splice(i, 0, val);
    this.recordFrame(`Put ${val} into the leaf, which ${this.holds(curr.keys)}.`, [curr.keys[0]], [val], 'insert', 'leaf-insert');

    // Handle overflow splits
    while (curr.keys.length > this.maxKeys()) {
      const mid = Math.floor(curr.keys.length / 2);
      const promotedKey = curr.keys[mid];

      this.recordFrame(
        `The node [${curr.keys.join(', ')}] now has ${curr.keys.length} keys, but an order-${this.order} node can hold only ${this.maxKeys()}. Split it around the middle key ${promotedKey}.`,
        [curr.keys[0]],
        [promotedKey],
        'split',
        'split-overflow'
      );

      const rightNode = new BTreeNode(curr.isLeaf);
      rightNode.keys = curr.keys.splice(mid + 1);
      if (!curr.isLeaf) {
        rightNode.children = curr.children.splice(mid + 1);
      }
      curr.keys.pop(); // Remove median key from left node

      if (path.length === 0) {
        // Splitting root
        const newRoot = new BTreeNode(false);
        newRoot.keys = [promotedKey];
        newRoot.children = [curr, rightNode];
        this.root = newRoot;
        this.recordFrame(
          `${promotedKey} moves up into a new root. The tree is now ${this.plural(this.getStats().height, 'level')} tall.`,
          [promotedKey, curr.keys[0], rightNode.keys[0]],
          [promotedKey],
          'split',
          'root-split'
        );
        break;
      }

      const parentInfo = path.pop();
      const parent = parentInfo.node;
      const childIdx = parentInfo.childIdx;

      parent.keys.splice(childIdx, 0, promotedKey);
      parent.children.splice(childIdx + 1, 0, rightNode);

      this.recordFrame(
        `${promotedKey} moves up into the parent. The node is now two nodes: [${curr.keys.join(', ')}] and [${rightNode.keys.join(', ')}].`,
        [parent.keys[0], curr.keys[0], rightNode.keys[0]],
        [promotedKey],
        'split',
        'split-promote'
      );

      curr = parent;
    }

    return { success: true };
  }

  delete(val) {
    if (!this.contains(val)) {
      this.recordFrame(`${val} is not in the tree, so there is nothing to delete.`, [], [], 'error', 'missing');
      return { success: false, reason: "not_found" };
    }

    this.operationCount++;
    const path = [];
    let curr = this.root;
    let keyIdx = -1;

    // Search for the node containing the key
    for (;;) {
      let i = 0;
      while (i < curr.keys.length && val > curr.keys[i]) i++;
      if (i < curr.keys.length && curr.keys[i] === val) {
        keyIdx = i;
        break;
      }
      if (curr.isLeaf) break;
      path.push({ node: curr, childIdx: i });
      curr = curr.children[i];
    }

    this.recordFrame(`Delete ${val}: found it in the node [${curr.keys.join(', ')}].`, [curr.keys[0]], [val], 'delete', 'located');

    // Case 1: Key is in an internal node
    if (!curr.isLeaf) {
      path.push({ node: curr, childIdx: keyIdx });
      // Find in-order predecessor (rightmost key of left subtree)
      let predNode = curr.children[keyIdx];
      while (!predNode.isLeaf) {
        path.push({ node: predNode, childIdx: predNode.children.length - 1 });
        predNode = predNode.children[predNode.children.length - 1];
      }
      const predKey = predNode.keys.pop();
      curr.keys[keyIdx] = predKey;

      this.recordFrame(
        `${val} is in an internal node, so replace it with its predecessor ${predKey}, the largest key to its left. ${predKey} came out of a leaf, which ${this.holds(predNode.keys)}.`,
        [predNode.keys[0] || predKey, curr.keys[0]],
        [predKey],
        'delete',
        'predecessor'
      );
      curr = predNode;
    } else {
      // Case 2: Key is in a leaf node
      curr.keys.splice(keyIdx, 1);
      this.recordFrame(`Removed ${val} from its leaf, which ${this.holds(curr.keys)}.`, [curr.keys[0]], [], 'delete', 'leaf-remove');
    }

    // Rebalance upward if underflow occurs
    const minK = this.minKeys();
    while (curr !== this.root && curr.keys.length < minK) {
      const parentInfo = path.pop();
      const parent = parentInfo.node;
      const childIdx = parentInfo.childIdx;

      const leftSibling = childIdx > 0 ? parent.children[childIdx - 1] : null;
      const rightSibling = childIdx < parent.children.length - 1 ? parent.children[childIdx + 1] : null;

      // Try borrowing from left sibling (Rotate right)
      if (leftSibling && leftSibling.keys.length > minK) {
        const borrowedKey = leftSibling.keys.pop();
        const parentKey = parent.keys[childIdx - 1];
        parent.keys[childIdx - 1] = borrowedKey;
        curr.keys.unshift(parentKey);

        if (!leftSibling.isLeaf) {
          curr.children.unshift(leftSibling.children.pop());
        }

        this.recordFrame(
          `The node was too small and its left sibling had a spare key, so rotate right: ${borrowedKey} moved up into the parent and the parent's ${parentKey} moved down into the node.`,
          [curr.keys[0], leftSibling.keys[0], parent.keys[0]],
          [parentKey, borrowedKey],
          'borrow',
          'rotate-right'
        );
        break;
      }

      // Try borrowing from right sibling (Rotate left)
      if (rightSibling && rightSibling.keys.length > minK) {
        const borrowedKey = rightSibling.keys.shift();
        const parentKey = parent.keys[childIdx];
        parent.keys[childIdx] = borrowedKey;
        curr.keys.push(parentKey);

        if (!rightSibling.isLeaf) {
          curr.children.push(rightSibling.children.shift());
        }

        this.recordFrame(
          `The node was too small and its right sibling had a spare key, so rotate left: ${borrowedKey} moved up into the parent and the parent's ${parentKey} moved down into the node.`,
          [curr.keys[0], rightSibling.keys[0], parent.keys[0]],
          [parentKey, borrowedKey],
          'borrow',
          'rotate-left'
        );
        break;
      }

      // Merge with sibling
      if (leftSibling) {
        // Merge curr into leftSibling
        const sepIdx = childIdx - 1;
        const separator = parent.keys.splice(sepIdx, 1)[0];
        parent.children.splice(childIdx, 1);

        leftSibling.keys.push(separator, ...curr.keys);
        if (!curr.isLeaf) {
          leftSibling.children.push(...curr.children);
        }

        this.recordFrame(
          `The node was too small and no sibling had a spare key, so merge it into its left sibling. The parent's ${separator} moves down between them, giving [${leftSibling.keys.join(', ')}].`,
          [leftSibling.keys[0], parent.keys[0]],
          [separator],
          'merge',
          'merge-left'
        );
        curr = parent;
      } else if (rightSibling) {
        // Merge rightSibling into curr
        const sepIdx = childIdx;
        const separator = parent.keys.splice(sepIdx, 1)[0];
        parent.children.splice(childIdx + 1, 1);

        curr.keys.push(separator, ...rightSibling.keys);
        if (!rightSibling.isLeaf) {
          curr.children.push(...rightSibling.children);
        }

        this.recordFrame(
          `The node was too small and no sibling had a spare key, so merge it with its right sibling. The parent's ${separator} moves down between them, giving [${curr.keys.join(', ')}].`,
          [curr.keys[0], parent.keys[0]],
          [separator],
          'merge',
          'merge-right'
        );
        curr = parent;
      }
    }

    // Check if root shrank
    if (this.root.keys.length === 0 && !this.root.isLeaf && this.root.children.length > 0) {
      this.root = this.root.children[0];
      this.recordFrame(`The root has no keys left, so its only child becomes the new root. The tree is one level shorter.`, [this.root.keys[0]], [], 'shrink', 'root-shrink');
    } else if (this.root.keys.length === 0 && this.root.isLeaf) {
      this.recordFrame(`The last key is gone, so the tree is empty.`, [], [], 'info', 'emptied');
    }

    return { success: true };
  }

  search(val) {
    let curr = this.root;
    let nodeVisits = 0;
    const pathKeys = [];

    if (curr.keys.length === 0) {
      this.recordFrame(`Search ${val}: the tree is empty.`, [], [], 'error', 'empty');
      return { found: false, visits: 0, path: [] };
    }

    while (curr) {
      nodeVisits++;
      pathKeys.push([...curr.keys]);
      let i = 0;
      while (i < curr.keys.length && val > curr.keys[i]) i++;

      if (i < curr.keys.length && curr.keys[i] === val) {
        this.recordFrame(
          `Found ${val} in the node [${curr.keys.join(', ')}] (key ${i + 1} of ${curr.keys.length}). The search read ${this.plural(nodeVisits, 'node')}.`,
          [curr.keys[0]],
          [val],
          'found',
          'found'
        );
        return { found: true, visits: nodeVisits, path: pathKeys };
      }

      if (curr.isLeaf) {
        this.recordFrame(
          `${val} is not in the tree. The search reached the leaf [${curr.keys.join(', ')}] and stopped after reading ${this.plural(nodeVisits, 'node')}.`,
          [curr.keys[0]],
          [],
          'error',
          'not-found'
        );
        return { found: false, visits: nodeVisits, path: pathKeys };
      }

      const nextNode = curr.children[i];
      const relation = i < curr.keys.length ? `${val} < ${curr.keys[i]}` : `${val} > ${curr.keys[curr.keys.length - 1]}`;
      this.recordFrame(
        `Search ${val}: ${relation}, so follow pointer ${i + 1} down to [${nextNode.keys.join(', ')}].`,
        [curr.keys[0]],
        [val],
        'search',
        'descend'
      );
      curr = nextNode;
    }

    return { found: false, visits: nodeVisits, path: pathKeys };
  }

  getStats(node = this.root) {
    let totalNodes = 0;
    let totalKeys = 0;
    let maxDepth = 0;

    if (!node || node.keys.length === 0) {
      return { totalNodes: 0, totalKeys: 0, height: 0, minKeys: this.minKeys(), maxKeys: this.maxKeys() };
    }

    const traverse = (n, depth) => {
      totalNodes++;
      totalKeys += n.keys.length;
      maxDepth = Math.max(maxDepth, depth);
      if (!n.isLeaf && n.children) {
        n.children.forEach(c => traverse(c, depth + 1));
      }
    };

    traverse(node, 1);
    return {
      totalNodes,
      totalKeys,
      height: maxDepth,
      minKeys: this.minKeys(),
      maxKeys: this.maxKeys(),
      order: this.order
    };
  }

  validateInvariants(node = this.root) {
    const violations = [];
    if (!node || node.keys.length === 0) return violations;

    let leafDepth = -1;
    let lastKey = -Infinity;

    const check = (n, depth, isRoot) => {
      // Key count check
      if (!isRoot) {
        if (n.keys.length < this.minKeys()) {
          violations.push(`Node [${n.keys}] has ${n.keys.length} keys, below minimum ${this.minKeys()}`);
        }
      }
      if (n.keys.length > this.maxKeys()) {
        violations.push(`Node [${n.keys}] has ${n.keys.length} keys, exceeding maximum ${this.maxKeys()}`);
      }

      // Child count check
      if (!n.isLeaf) {
        if (n.children.length !== n.keys.length + 1) {
          violations.push(`Node [${n.keys}] has ${n.children.length} children but ${n.keys.length} keys (should be k+1)`);
        }
      }

      // Sorted order check
      for (let i = 0; i < n.keys.length; i++) {
        if (!n.isLeaf) check(n.children[i], depth + 1, false);
        if (n.keys[i] <= lastKey) {
          violations.push(`Key order violation: ${n.keys[i]} <= previous ${lastKey}`);
        }
        lastKey = n.keys[i];
      }
      if (!n.isLeaf) {
        check(n.children[n.keys.length], depth + 1, false);
      } else {
        if (leafDepth === -1) leafDepth = depth;
        else if (leafDepth !== depth) {
          violations.push(`Leaf depth mismatch: depth ${depth} vs initial ${leafDepth}`);
        }
      }
    };

    check(node, 1, true);
    return violations;
  }

  serializeToText(node = this.root) {
    if (!node || node.keys.length === 0) return "(Empty tree)";
    const lines = [];
    const queue = [{ node, level: 0 }];

    let currentLvl = -1;
    let lvlNodes = [];

    while (queue.length > 0) {
      const item = queue.shift();
      if (item.level !== currentLvl) {
        if (lvlNodes.length > 0) {
          lines.push(`Level ${currentLvl}: ` + lvlNodes.join('   '));
        }
        currentLvl = item.level;
        lvlNodes = [];
      }
      lvlNodes.push(`[${item.node.keys.join(', ')}]`);
      if (!item.node.isLeaf && item.node.children) {
        for (const child of item.node.children) {
          queue.push({ node: child, level: item.level + 1 });
        }
      }
    }
    if (lvlNodes.length > 0) {
      lines.push(`Level ${currentLvl}: ` + lvlNodes.join('   '));
    }
    return lines.join('\n');
  }
}

// Export for the browser, and for Node (so the engine can be tested without a page)
if (typeof window !== 'undefined') {
  window.BTreeEngine = BTreeEngine;
  window.BTreeNode = BTreeNode;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BTreeEngine, BTreeNode };
}
