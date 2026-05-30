/**
 * vlist v2 — Tree Layout
 *
 * Manages the flat representation of a tree: DFS traversal, expand/collapse,
 * surgical splice, and index lookups. All mutations target the flatNodes array
 * directly — only setItems/expandAll/collapseAll trigger a full rebuild.
 */

import type { VListItem } from "../../types";
import type { FlatNode } from "./types";

// =============================================================================
// TreeLayout interface
// =============================================================================

export interface TreeLayout<T extends VListItem> {
  flatNodes: FlatNode<T>[];
  readonly expandedIds: Set<string | number>;
  readonly idToIndex: Map<string | number, number>;

  rebuild(items: readonly T[], skipValidation?: boolean): void;
  expand(id: string | number): number;
  collapse(id: string | number): number;
  expandAll(items: readonly T[]): void;
  collapseAll(): void;
  expandTo(id: string | number): void;
  getSubtreeSize(index: number): number;

  addChild(parentId: string | number | null, item: T, index?: number): void;
  removeNode(id: string | number): number;
  moveNode(id: string | number, newParentId: string | number | null, index?: number): void;

  readonly totalVisible: number;
  readonly rootItems: readonly T[];
}

// =============================================================================
// Factory
// =============================================================================

export function createTreeLayout<T extends VListItem>(
  getChildren: (item: T) => T[],
  initialExpandedIds: Set<string | number>,
): TreeLayout<T> {
  const flatNodes: FlatNode<T>[] = [];
  const expandedIds = initialExpandedIds;
  const idToIndex = new Map<string | number, number>();
  let storedRootItems: readonly T[] = [];

  // ── Helpers ──────────────────────────────────────────────────────

  function rebuildIdMap(): void {
    idToIndex.clear();
    for (let i = 0; i < flatNodes.length; i++) {
      idToIndex.set(flatNodes[i]!.id, i);
    }
  }

  function getSubtreeSize(index: number): number {
    const depth = flatNodes[index]!.depth;
    let count = 0;
    for (let j = index + 1; j < flatNodes.length; j++) {
      if (flatNodes[j]!.depth <= depth) break;
      count++;
    }
    return count;
  }

  function walkAndCollect(
    children: readonly T[],
    parentId: string | number | null,
    depth: number,
    out: FlatNode<T>[],
  ): void {
    for (let i = 0; i < children.length; i++) {
      const item = children[i] as T;
      const id = item.id;
      const childItems = getChildren(item);
      const hasChildren = childItems.length > 0;
      const expanded = hasChildren && expandedIds.has(id);

      out.push({
        item,
        id,
        depth,
        parentId,
        hasChildren,
        expanded,
        childCount: childItems.length,
        siblingCount: children.length,
        positionInSiblings: i,
        isLastChild: i === children.length - 1,
        loading: false,
      });

      if (expanded) {
        walkAndCollect(childItems, id, depth + 1, out);
      }
    }
  }

  // ── DFS for finding a node in the original tree ─────────────────

  function findInTree(
    items: readonly T[],
    targetId: string | number,
    ancestors?: (string | number)[],
  ): T | undefined {
    for (const item of items) {
      if (item.id === targetId) return item;
      const ch = getChildren(item);
      if (ch.length > 0) {
        ancestors?.push(item.id);
        const found = findInTree(ch, targetId, ancestors);
        if (found) return found;
        ancestors?.pop();
      }
    }
    return undefined;
  }

  function getSiblingsOf(_id: string | number, parentId: string | number | null): T[] {
    if (parentId === null) return storedRootItems as T[];
    const parent = findInTree(storedRootItems, parentId);
    return parent ? getChildren(parent) : [];
  }

  // ── Validate no cycles (walks source tree, not just visible nodes) ──

  function isDescendantOf(nodeId: string | number, ancestorId: string | number): boolean {
    const ancestor = findInTree(storedRootItems, ancestorId);
    if (!ancestor) return false;
    return findInTree(getChildren(ancestor), nodeId) !== undefined;
  }

  // ── Public API ──────────────────────────────────────────────────

  function validateAllIds(items: readonly T[]): void {
    const seen = new Set<string | number>();
    function walk(children: readonly T[]): void {
      for (const item of children) {
        if (seen.has(item.id)) throw new Error(`[vlist] tree: duplicate id "${item.id}"`);
        seen.add(item.id);
        const ch = getChildren(item);
        if (ch.length > 0) walk(ch);
      }
    }
    walk(items);
  }

  function rebuild(items: readonly T[], skipValidation?: boolean): void {
    storedRootItems = items;
    if (!skipValidation) validateAllIds(items);
    flatNodes.length = 0;
    walkAndCollect(items, null, 0, flatNodes);
    rebuildIdMap();
  }

  function expand(id: string | number): number {
    const index = idToIndex.get(id);
    if (index === undefined) return 0;
    const node = flatNodes[index]!;
    if (!node.hasChildren || node.expanded) return 0;

    const toInsert: FlatNode<T>[] = [];
    const childItems = getChildren(node.item);
    walkAndCollect(childItems, id, node.depth + 1, toInsert);

    if (toInsert.length === 0) return 0;

    node.expanded = true;
    expandedIds.add(id);

    const insertPos = index + 1;
    const tail = flatNodes.splice(insertPos);
    for (let i = 0; i < toInsert.length; i++) flatNodes.push(toInsert[i]!);
    for (let i = 0; i < tail.length; i++) flatNodes.push(tail[i]!);
    rebuildIdMap();

    return toInsert.length;
  }

  function collapse(id: string | number): number {
    const index = idToIndex.get(id);
    if (index === undefined) return 0;
    const node = flatNodes[index]!;
    if (!node.hasChildren || !node.expanded) return 0;

    node.expanded = false;
    expandedIds.delete(id);

    const subtreeSize = getSubtreeSize(index);
    if (subtreeSize > 0) {
      flatNodes.splice(index + 1, subtreeSize);
      rebuildIdMap();
    }

    return subtreeSize;
  }

  function expandAll(items: readonly T[]): void {
    function mark(children: readonly T[]): void {
      for (const item of children) {
        const ch = getChildren(item);
        if (ch.length > 0) { expandedIds.add(item.id); mark(ch); }
      }
    }
    mark(items);
    rebuild(items);
  }

  function collapseAll(): void {
    expandedIds.clear();
    rebuild(storedRootItems, true);
  }

  function expandTo(id: string | number): void {
    const ancestors: (string | number)[] = [];
    if (!findInTree(storedRootItems, id, ancestors)) return;
    for (const ancestorId of ancestors) {
      expandedIds.add(ancestorId);
    }
    rebuild(storedRootItems, true);
  }

  function addChild(parentId: string | number | null, item: T, index?: number): void {
    if (idToIndex.has(item.id) || findInTree(storedRootItems, item.id)) {
      throw new Error(`[vlist] tree: duplicate id "${item.id}"`);
    }

    if (parentId === null) {
      const roots = storedRootItems as T[];
      const insertIdx = index ?? roots.length;
      roots.splice(insertIdx, 0, item);
      rebuild(storedRootItems, true);
      return;
    }

    const parentFlatIdx = idToIndex.get(parentId);
    if (parentFlatIdx === undefined) {
      throw new Error(`[vlist] tree: parent "${parentId}" not found`);
    }

    const parentNode = flatNodes[parentFlatIdx]!;
    const parentChildren = getChildren(parentNode.item);
    const childIdx = index ?? parentChildren.length;
    parentChildren.splice(childIdx, 0, item);

    if (!parentNode.hasChildren) {
      parentNode.hasChildren = true;
      parentNode.childCount = 1;
      parentNode.expanded = false;
    } else {
      parentNode.childCount = parentChildren.length;
    }

    if (parentNode.expanded) {
      rebuild(storedRootItems, true);
    } else {
      rebuildIdMap();
    }
  }

  function removeNode(id: string | number): number {
    const index = idToIndex.get(id);
    if (index === undefined) return 0;

    const node = flatNodes[index]!;
    const subtreeSize = getSubtreeSize(index);
    const totalRemoved = subtreeSize + 1;

    for (let i = index; i < index + totalRemoved; i++) {
      expandedIds.delete(flatNodes[i]!.id);
    }

    flatNodes.splice(index, totalRemoved);

    if (node.parentId !== null) {
      const parentIdx = idToIndex.get(node.parentId);
      if (parentIdx !== undefined) {
        const parentNode = flatNodes[parentIdx]!;
        parentNode.childCount--;
        if (parentNode.childCount === 0) {
          parentNode.hasChildren = false;
          parentNode.expanded = false;
          expandedIds.delete(parentNode.id);
        }
      }
    }

    const siblings = getSiblingsOf(id, node.parentId);
    const sibIdx = siblings.findIndex((s) => s.id === id);
    if (sibIdx >= 0) siblings.splice(sibIdx, 1);

    rebuild(storedRootItems, true);
    return totalRemoved;
  }

  function moveNode(id: string | number, newParentId: string | number | null, index?: number): void {
    if (newParentId !== null && isDescendantOf(newParentId, id)) {
      throw new Error(`[vlist] tree: cannot move "${id}" to its own descendant "${newParentId}"`);
    }
    if (id === newParentId) {
      throw new Error(`[vlist] tree: cannot move "${id}" to itself`);
    }

    const flatIdx = idToIndex.get(id);
    if (flatIdx === undefined) return;
    const node = flatNodes[flatIdx]!;

    const oldSiblings = getSiblingsOf(id, node.parentId);
    const oldIdx = oldSiblings.findIndex((s) => s.id === id);
    if (oldIdx >= 0) oldSiblings.splice(oldIdx, 1);

    if (newParentId === null) {
      const roots = storedRootItems as T[];
      const insertIdx = index ?? roots.length;
      roots.splice(insertIdx, 0, node.item);
    } else {
      const newParent = findInTree(storedRootItems, newParentId);
      if (!newParent) throw new Error(`[vlist] tree: new parent "${newParentId}" not found`);
      const newSiblings = getChildren(newParent);
      const insertIdx = index ?? newSiblings.length;
      newSiblings.splice(insertIdx, 0, node.item);
    }

    rebuild(storedRootItems, true);
  }

  return {
    flatNodes,
    expandedIds,
    idToIndex,
    rebuild,
    expand,
    collapse,
    expandAll,
    collapseAll,
    expandTo,
    getSubtreeSize,
    addChild,
    removeNode,
    moveNode,
    get totalVisible(): number { return flatNodes.length; },
    get rootItems(): readonly T[] { return storedRootItems; },
  };
}
