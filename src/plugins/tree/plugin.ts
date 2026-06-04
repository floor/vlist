/**
 * vlist v2 — Tree Plugin
 *
 * Renders hierarchical data as a virtualized, collapsible tree view with
 * WAI-ARIA treeview keyboard navigation. Owns the tree→flat conversion
 * internally — users work with their original tree structure while the
 * core pipeline sees a flat list.
 *
 * Priority 10 — runs before selection (50).
 *
 * Replaces the render pipeline (like groups/grid/table) to maintain full
 * control over tree-specific ARIA, CSS classes, indent, and expand/collapse.
 */

import type { VListItem, ItemState, ItemTemplate, TreeState, VListEvents } from "../../types";
import type { VListPlugin, PluginContext, ElementPool } from "../../core/types";
import type { SizeCache } from "../../core/sizes";
import type { EngineState } from "../../core/state";
import type { CompressionState } from "../../rendering/scale";
import { calculateCompressedVisibleRange, calculateCompressedItemPosition } from "../../rendering/scale";
import { neutralizeFocusable } from "../../core/dom";
import { createTreeLayout, type TreeLayout } from "./layout";
import type { TreePluginConfig, FlatNode } from "./types";

type ItemStateFn = (index: number, state: ItemState) => void;
type TreeEventKey = keyof VListEvents<VListItem>;

// =============================================================================
// Config resolution helpers
// =============================================================================

const noChildren = (): never[] => [];

function resolveGetChildren<T extends VListItem>(
  config: TreePluginConfig<T>,
): (item: T) => T[] {
  const { children, parentId } = config;
  if (parentId !== undefined) return noChildren;
  if (children === undefined || children === "children") {
    return (item: T) => ((item as Record<string, unknown>).children as T[] | undefined) ?? [];
  }
  if (typeof children === "string") {
    const key = children;
    return (item: T) => ((item as Record<string, unknown>)[key] as T[] | undefined) ?? [];
  }
  return children;
}

function resolveGetLabel<T extends VListItem>(
  config: TreePluginConfig<T>,
): (item: T) => string {
  const { label } = config;
  if (label === undefined) {
    return (item: T) => {
      const r = item as Record<string, unknown>;
      return String(r.name ?? r.label ?? r.title ?? item.id);
    };
  }
  if (typeof label === "string") {
    const key = label;
    return (item: T) => String((item as Record<string, unknown>)[key] ?? item.id);
  }
  return label;
}

function resolveInitialExpanded<T extends VListItem>(
  config: TreePluginConfig<T>,
  items: readonly T[],
  getChildren: (item: T) => T[],
): Set<string | number> {
  const { expanded } = config;
  const set = new Set<string | number>();

  if (expanded === undefined || expanded === false) return set;

  if (Array.isArray(expanded)) {
    for (const id of expanded) set.add(id);
    return set;
  }

  const predicate = expanded === true ? null : (expanded as (item: T) => boolean);
  function collect(children: readonly T[]): void {
    for (const item of children) {
      const ch = getChildren(item);
      if (ch.length > 0) {
        if (!predicate || predicate(item)) set.add(item.id);
        collect(ch);
      }
    }
  }
  collect(items);
  return set;
}

function resolveParentIdMode<T extends VListItem>(
  items: readonly T[],
  config: TreePluginConfig<T>,
): { roots: T[]; getChildren: (item: T) => T[] } {
  const { parentId } = config;
  if (parentId === undefined) throw new Error("[vlist] tree: parentId not set");

  const rawGetPid = typeof parentId === "string"
    ? (item: T) => (item as Record<string, unknown>)[parentId] as string | number | null ?? null
    : parentId;
  const getParentId = (item: T): string | number | null => rawGetPid(item) ?? null;

  const childrenMap = new Map<string | number | null, T[]>();
  const nodeMap = new Map<string | number, T>();

  for (const item of items) {
    nodeMap.set(item.id, item);
    const pid = getParentId(item);
    let bucket = childrenMap.get(pid);
    if (!bucket) {
      bucket = [];
      childrenMap.set(pid, bucket);
    }
    bucket.push(item);
  }

  for (const item of items) {
    const pid = getParentId(item);
    if (pid !== null && pid !== undefined && !nodeMap.has(pid)) {
      console.warn(`[vlist] tree: orphaned node "${item.id}" — parentId "${pid}" not found`);
    }
  }

  return {
    roots: childrenMap.get(null) ?? [],
    getChildren: (item: T): T[] => {
      let children = childrenMap.get(item.id);
      if (!children) {
        children = [];
        childrenMap.set(item.id, children);
      }
      return children;
    },
  };
}

// =============================================================================
// Reusable state singletons — zero allocation per frame
// =============================================================================

const itemState: ItemState = { selected: false, focused: false };
const treeState: TreeState = { depth: 0, expanded: false, hasChildren: false, isLeaf: true, isLastChild: false, loading: false };
itemState.tree = treeState;

// =============================================================================
// Factory
// =============================================================================

export function tree<T extends VListItem = VListItem>(
  config?: TreePluginConfig<T>,
): VListPlugin<T> {
  const cfg = config ?? {};
  const indent = cfg.indent ?? 24;
  const paddingStart = cfg.paddingStart ?? 0;
  const expandOnClick = cfg.expandOnClick ?? false;
  const connectorLines = cfg.connectorLines ?? false;
  const isParentIdMode = cfg.parentId !== undefined;
  let layout: TreeLayout<T>;
  let sizeCache: SizeCache;
  let engineState: EngineState;
  let pool: ElementPool;
  let contentElement: HTMLElement;
  let rootElement: HTMLElement;
  let userTemplate: ItemTemplate<T>;
  let isX: boolean;
  let classPrefix: string;
  let overscan: number;
  let getItemStateFn: (() => ItemStateFn | null) | null = null;
  let getMethod: (name: string) => unknown;
  let emitter: PluginContext<T>["emitter"];
  let getLabel: (item: T) => string;

  let getCompression: (() => CompressionState) | null = null;
  let compressionResolved = false;

  let treeItemClass: string;
  let expandedClass: string;
  let leafClass: string;
  let loadingClass: string;
  let lastChildClass: string;
  let selectedClass: string;
  let focusedClass: string;

  const rendered = new Map<number, HTMLElement>();
  let lastScrollPosition = -1;
  let lastContainerSize = -1;
  let lastTotalSize = -1;
  let forceNextRender = true;
  let lastItems: readonly T[] | null = null;
  let roleSet = false;
  let origSizeCacheRebuild: SizeCache["rebuild"];

  let focusedIndex = -1;
  let focusVisible = false;
  let hasExternalFocus = false;
  let typeAheadBuffer = "";
  let typeAheadTimer: ReturnType<typeof setTimeout> | null = null;

  const compRange = { start: 0, end: -1 };

  // ── Compression ──────────────────────────────────────────────────

  function resolveCompressionFn(): void {
    if (compressionResolved) return;
    compressionResolved = true;
    getCompression = (getMethod("_scale:getCompression") as (() => CompressionState)) ?? null;
  }

  // ── Focus helpers ────────────────────────────────────────────────

  function getEffectiveFocusedIndex(): number {
    if (hasExternalFocus) {
      const fn = getMethod("_getFocusedIndex") as (() => number) | undefined;
      return fn ? fn() : -1;
    }
    return focusVisible ? focusedIndex : -1;
  }

  let cachedSelectFn: ((...ids: (string | number)[]) => void) | null | undefined;
  let cachedFocusFn: ((id: string | number) => void) | null | undefined;
  let cachedFollowFn: (() => boolean) | null | undefined;

  function resolveSelectionMethods(): void {
    if (cachedFocusFn !== undefined) return;
    cachedSelectFn = (getMethod("select") as typeof cachedSelectFn) ?? null;
    cachedFocusFn = (getMethod("_focusById") as typeof cachedFocusFn) ?? null;
    cachedFollowFn = (getMethod("_isFollowFocus") as typeof cachedFollowFn) ?? null;
  }

  function setFocusTo(index: number): void {
    if (index < 0 || index >= layout.totalVisible) return;
    const node = layout.flatNodes[index];
    if (!node) return;

    if (hasExternalFocus) {
      resolveSelectionMethods();
      if (cachedFocusFn) cachedFocusFn(node.id);
      if (cachedFollowFn?.() && cachedSelectFn) {
        cachedSelectFn(node.id);
      } else {
        doForceRender();
      }
      scrollIntoView(index);
    } else {
      focusedIndex = index;
      focusVisible = true;
      contentElement.setAttribute("aria-activedescendant", `${classPrefix}-item-${index}`);
      scrollIntoView(index);
      doForceRender();
    }
  }

  function scrollIntoView(index: number): void {
    const offset = sizeCache.getOffset(index);
    const size = sizeCache.getSize(index);
    const sp = engineState.scrollPosition;
    const cs = engineState.containerSize;
    if (offset < sp) {
      scrollTo(offset);
    } else if (offset + size > sp + cs) {
      scrollTo(offset - cs + size);
    }
  }

  let scrollTo: (pos: number) => void;
  let doForceRender: () => void;
  let ctxGetItems: () => readonly T[];

  // ── Render helpers ───────────────────────────────────────────────

  function buildTransform(offset: number): string {
    return isX ? `translate(${Math.round(offset)}px, 0)` : `translate(0, ${Math.round(offset)}px)`;
  }

  /** Write the content element's scroll size, skipping the DOM write when unchanged. */
  function applyContentSize(totalSize: number): void {
    if (totalSize === lastTotalSize) return;
    lastTotalSize = totalSize;
    contentElement.style[isX ? "width" : "height"] = totalSize + "px";
  }

  function detachAll(): void {
    rendered.forEach((element) => {
      element.remove();
      pool.release(element);
    });
    rendered.clear();
  }

  let lastItemsLength = 0;

  function syncLayoutIfNeeded(): void {
    const currentItems = ctxGetItems();
    if (currentItems === lastItems && currentItems.length === lastItemsLength) return;
    lastItems = currentItems;
    lastItemsLength = currentItems.length;
    // Initial data is validated in setup(); runtime swaps skip the O(n)
    // duplicate-id walk to keep data updates off the validation hot path.
    if (isParentIdMode) {
      const { roots, getChildren: baseGC } = resolveParentIdMode(currentItems, cfg);
      const wrappedGC = cfg.loadChildren
        ? (item: T): T[] => loadedChildrenMap.get(item.id) ?? baseGC(item)
        : baseGC;
      layout = createTreeLayout(wrappedGC, layout.expandedIds);
      layout.rebuild(roots, true);
    } else {
      layout.rebuild(currentItems, true);
    }
    syncTotals();
    detachAll();
  }

  // ── Sync totals after layout changes ─────────────────────────────

  function syncTotals(): void {
    engineState.totalItems = layout.totalVisible;
    origSizeCacheRebuild(layout.totalVisible);
    const totalSize = sizeCache.getTotalSize();
    applyContentSize(totalSize);

    const getSb = getMethod("_scrollbar:getInstance") as (() => { updateBounds(t: number, c: number): void }) | undefined;
    if (getSb) {
      const sb = getSb();
      sb?.updateBounds(totalSize, engineState.containerSize);
    }
  }

  function invalidateTree(): void {
    syncTotals();
    detachAll();
    doForceRender();
  }

  // ── Async children ───────────────────────────────────────────────

  const loadedChildrenMap = new Map<string | number, T[]>();
  const loadingNodes = new Set<string | number>();

  async function loadChildrenFor(id: string | number): Promise<void> {
    if (!cfg.loadChildren || loadingNodes.has(id)) return;

    const flatIdx = layout.idToIndex.get(id);
    if (flatIdx === undefined) return;
    const node = layout.flatNodes[flatIdx]!;

    loadingNodes.add(id);
    node.loading = true;
    queueMicrotask(() => doForceRender());

    try {
      const children = await cfg.loadChildren(node.item);
      loadingNodes.delete(id);

      const currentIdx = layout.idToIndex.get(id);
      if (currentIdx === undefined) return;
      const currentNode = layout.flatNodes[currentIdx]!;
      currentNode.loading = false;

      loadedChildrenMap.set(id, children);

      currentNode.hasChildren = children.length > 0;
      currentNode.childCount = children.length;

      if (children.length > 0) {
        currentNode.expanded = true;
        layout.expandedIds.add(id);
        layout.rebuild(layout.rootItems as T[]);
      }

      invalidateTree();

      emitter.emit("tree:load" as TreeEventKey, {
        id, item: currentNode.item, children,
      } as never);
    } catch (error) {
      loadingNodes.delete(id);
      loadedChildrenMap.set(id, []);

      const currentIdx = layout.idToIndex.get(id);
      if (currentIdx !== undefined) {
        layout.flatNodes[currentIdx]!.loading = false;
      }
      doForceRender();

      emitter.emit("tree:load:error" as TreeEventKey, {
        id, item: node.item, error,
      } as never);
    }
  }

  // ── Expand / Collapse ────────────────────────────────────────────

  function doExpand(id: string | number): void {
    const flatIdx = layout.idToIndex.get(id);
    if (flatIdx === undefined) return;
    const node = layout.flatNodes[flatIdx]!;

    if (cfg.loadChildren && !node.hasChildren && !node.loading) {
      if (!loadedChildrenMap.has(id)) {
        loadChildrenFor(id);
        return;
      }
    }

    const count = layout.expand(id);
    if (count === 0) return;

    invalidateTree();

    emitter.emit("tree:expand" as TreeEventKey, {
      id, item: node.item, depth: node.depth,
    } as never);
  }

  function doCollapse(id: string | number): void {
    const flatIdx = layout.idToIndex.get(id);
    if (flatIdx === undefined) return;
    const node = layout.flatNodes[flatIdx]!;

    const count = layout.collapse(id);
    if (count === 0) return;

    if (!hasExternalFocus && focusedIndex > flatIdx) {
      if (focusedIndex <= flatIdx + count) {
        focusedIndex = flatIdx;
      } else {
        focusedIndex -= count;
      }
      if (focusVisible) {
        contentElement.setAttribute("aria-activedescendant", `${classPrefix}-item-${focusedIndex}`);
      }
    }

    invalidateTree();

    emitter.emit("tree:collapse" as TreeEventKey, {
      id, item: node.item, depth: node.depth,
    } as never);
  }

  // ── Render pipeline ──────────────────────────────────────────────

  function renderNodeElement(
    element: HTMLElement,
    flatNode: FlatNode<T>,
    flatIndex: number,
    isf: ItemStateFn | null,
  ): void {
    const { depth, expanded, hasChildren, loading, siblingCount, positionInSiblings, isLastChild, id } = flatNode;

    element.className = treeItemClass;
    if (expanded) element.classList.add(expandedClass);
    if (!hasChildren) element.classList.add(leafClass);
    if (loading) element.classList.add(loadingClass);
    if (connectorLines && isLastChild) element.classList.add(lastChildClass);

    element.setAttribute("role", "treeitem");
    element.setAttribute("data-index", String(flatIndex));
    element.setAttribute("data-id", String(id));
    element.id = `${classPrefix}-item-${flatIndex}`;
    element.setAttribute("aria-level", String(depth + 1));
    element.setAttribute("aria-setsize", String(siblingCount));
    element.setAttribute("aria-posinset", String(positionInSiblings + 1));
    if (hasChildren) {
      element.setAttribute("aria-expanded", String(expanded));
    } else {
      element.removeAttribute("aria-expanded");
    }

    element.style.paddingLeft = `${paddingStart + depth * indent}px`;
    element.style.setProperty("--vlist-tree-depth", String(depth));
    if (connectorLines) {
      element.style.setProperty("--vlist-tree-indent", `${indent}px`);
      element.style.setProperty("--vlist-tree-pad", `${paddingStart}px`);
    }

    if (isf) isf(flatIndex, itemState);
    else { itemState.selected = false; itemState.focused = false; }

    treeState.depth = depth;
    treeState.expanded = expanded;
    treeState.hasChildren = hasChildren;
    treeState.isLeaf = !hasChildren;
    treeState.isLastChild = isLastChild;
    treeState.loading = loading;

    const content = userTemplate(flatNode.item, flatIndex, itemState);
    if (typeof content === "string") {
      element.innerHTML = content;
    } else {
      element.innerHTML = "";
      element.appendChild(content);
    }
    neutralizeFocusable(element);
  }

  function treeRenderIfNeeded(): void {
    if (engineState.destroyed) return;

    syncLayoutIfNeeded();

    if (!roleSet) {
      roleSet = true;
      contentElement.setAttribute("role", "tree");
      contentElement.setAttribute("tabindex", "0");
      rootElement.classList.add(`${classPrefix}--tree`);
      if (connectorLines) rootElement.classList.add(`${classPrefix}--tree-lines`);
    }

    const scrollPos = engineState.scrollPosition;
    const cs = engineState.containerSize;

    if (!forceNextRender && scrollPos === lastScrollPosition && cs === lastContainerSize) return;
    lastScrollPosition = scrollPos;
    lastContainerSize = cs;
    forceNextRender = false;

    const totalItems = layout.totalVisible;
    if (cs <= 0 || totalItems === 0) {
      if (rendered.size > 0) {
        detachAll();
      }
      return;
    }

    resolveCompressionFn();
    const compression = getCompression?.() ?? null;
    const isCompressed = compression !== null && compression.isCompressed;

    let renderStart: number;
    let renderEnd: number;

    if (isCompressed) {
      calculateCompressedVisibleRange(scrollPos, cs, sizeCache, totalItems, compression, compRange);
      renderStart = Math.max(0, compRange.start - overscan);
      renderEnd = Math.min(totalItems - 1, compRange.end + overscan);
    } else {
      let visStart = sizeCache.indexAtOffset(scrollPos);
      let visEnd = sizeCache.indexAtOffset(scrollPos + cs);
      if (visEnd < totalItems - 1) visEnd++;
      visStart = Math.max(0, visStart);
      visEnd = Math.min(totalItems - 1, Math.max(0, visEnd));
      renderStart = Math.max(0, visStart - overscan);
      renderEnd = Math.min(totalItems - 1, visEnd + overscan);
    }

    if (renderStart === engineState.prevRangeStart && renderEnd === engineState.prevRangeEnd && !engineState.renderPending) return;

    rendered.forEach((element, idx) => {
      if (idx < renderStart || idx > renderEnd) {
        element.remove();
        pool.release(element);
        rendered.delete(idx);
      }
    });

    const isf = getItemStateFn?.() ?? null;
    let fragment: DocumentFragment | null = null;

    for (let i = renderStart; i <= renderEnd; i++) {
      const flatNode = layout.flatNodes[i]!;
      let element = rendered.get(i);

      if (element === undefined) {
        element = pool.acquire();
        renderNodeElement(element, flatNode, i, isf);
        element.style[isX ? "width" : "height"] = `${sizeCache.getSize(i)}px`;
        rendered.set(i, element);
        if (!fragment) fragment = document.createDocumentFragment();
        fragment.appendChild(element);
      } else {
        if (element.getAttribute("data-id") !== String(flatNode.id)
            || element.classList.contains(loadingClass) !== flatNode.loading) {
          renderNodeElement(element, flatNode, i, isf);
        }
      }

      element.style.transform = isCompressed
        ? buildTransform(calculateCompressedItemPosition(i, scrollPos, sizeCache, totalItems, cs, compression!))
        : buildTransform(sizeCache.getOffset(i));

      if (isf) {
        isf(i, itemState);
        element.classList.toggle(selectedClass, itemState.selected);
        element.classList.toggle(focusedClass, itemState.focused);
        if (itemState.selected) element.setAttribute("aria-selected", "true");
        else element.removeAttribute("aria-selected");
      } else if (!hasExternalFocus) {
        const isFocused = focusVisible && focusedIndex === i;
        element.classList.toggle(focusedClass, isFocused);
      }
    }

    if (fragment) contentElement.appendChild(fragment);

    // Total size only changes via layout mutations (syncTotals); the guard
    // skips the DOM write + string alloc on the steady-state scroll path.
    applyContentSize(sizeCache.getTotalSize());

    engineState.prevRangeStart = renderStart;
    engineState.prevRangeEnd = renderEnd;
    engineState.renderPending = false;

    let fillCount = 0;
    for (let i = renderStart; i <= renderEnd && fillCount < engineState.capacity; i++) {
      engineState.visibleIndices[fillCount] = i;
      engineState.visibleOffsets[fillCount] = sizeCache.getOffset(i);
      engineState.visibleSizes[fillCount] = sizeCache.getSize(i);
      fillCount++;
    }
    engineState.visibleCount = fillCount;
    engineState.startIndex = renderStart;
  }

  function treeForceRender(): void {
    if (engineState.destroyed) return;
    engineState.prevRangeStart = -1;
    engineState.prevRangeEnd = -1;
    engineState.renderPending = true;
    forceNextRender = true;
    treeRenderIfNeeded();
  }

  // ── Keyboard: type-ahead ─────────────────────────────────────────

  function handleTypeAhead(char: string, currentIndex: number): void {
    typeAheadBuffer += char.toLowerCase();
    if (typeAheadTimer !== null) clearTimeout(typeAheadTimer);
    typeAheadTimer = setTimeout(() => { typeAheadBuffer = ""; typeAheadTimer = null; }, 500);

    const total = layout.totalVisible;
    for (let offset = 1; offset <= total; offset++) {
      const idx = (currentIndex + offset) % total;
      const node = layout.flatNodes[idx]!;
      const label = getLabel(node.item).toLowerCase();
      if (label.startsWith(typeAheadBuffer)) {
        setFocusTo(idx);
        return;
      }
    }
  }

  // ── Keyboard: expand siblings (*) ────────────────────────────────

  function expandSiblings(node: FlatNode<T>): void {
    let anyAdded = false;
    for (const fn of layout.flatNodes) {
      if (fn.parentId === node.parentId && fn.hasChildren && !fn.expanded) {
        layout.expandedIds.add(fn.id);
        anyAdded = true;
      }
    }
    if (!anyAdded) return;
    layout.rebuild(layout.rootItems as T[], true);
    invalidateTree();
  }

  // =================================================================
  // Plugin return
  // =================================================================

  return {
    name: "tree",
    priority: 10,
    conflicts: ["groups", "grid", "masonry", "table"],

    setup(ctx: PluginContext<T>): void {
      sizeCache = ctx.sizeCache;
      engineState = ctx.getState();
      pool = ctx.pool;
      contentElement = ctx.dom.content;
      rootElement = ctx.dom.root;
      userTemplate = ctx.template;
      isX = ctx.config.axis.primary === "x";
      classPrefix = ctx.config.classPrefix;
      overscan = ctx.config.overscan;
      emitter = ctx.emitter;
      getItemStateFn = ctx.getItemStateFn.bind(ctx);
      getMethod = ctx.getMethod.bind(ctx);
      scrollTo = ctx.scrollTo.bind(ctx);
      doForceRender = ctx.forceRender.bind(ctx);
      ctxGetItems = ctx.getItems.bind(ctx) as () => readonly T[];

      treeItemClass = `${classPrefix}-item ${classPrefix}-tree-node`;
      expandedClass = `${classPrefix}-tree-node--expanded`;
      leafClass = `${classPrefix}-tree-node--leaf`;
      loadingClass = `${classPrefix}-tree-node--loading`;
      lastChildClass = `${classPrefix}-tree-node--last`;
      selectedClass = `${classPrefix}-item--selected`;
      focusedClass = `${classPrefix}-item--focused`;

      const rawItems = ctx.getItems() as readonly T[];
      lastItems = rawItems;
      lastItemsLength = rawItems.length;

      let baseGetChildren: (item: T) => T[];
      let rootItemsArr: readonly T[];

      if (isParentIdMode) {
        const resolved = resolveParentIdMode(rawItems, cfg);
        baseGetChildren = resolved.getChildren;
        rootItemsArr = resolved.roots;
      } else {
        baseGetChildren = resolveGetChildren(cfg);
        rootItemsArr = rawItems;
      }

      const getChildren = cfg.loadChildren
        ? (item: T): T[] => loadedChildrenMap.get(item.id) ?? baseGetChildren(item)
        : baseGetChildren;

      getLabel = resolveGetLabel(cfg);
      const initialExpanded = resolveInitialExpanded(cfg, rootItemsArr, getChildren);
      layout = createTreeLayout(getChildren, initialExpanded);
      layout.rebuild(rootItemsArr);

      origSizeCacheRebuild = sizeCache.rebuild;
      sizeCache.rebuild = (_n: number): void => {
        origSizeCacheRebuild(layout.totalVisible);
      };
      sizeCache.rebuild(layout.totalVisible);

      engineState.totalItems = layout.totalVisible;

      ctx.setVirtualTotalFn(() => layout.totalVisible);
      ctx.setGetItemFn((index: number): T | undefined => {
        const node = layout.flatNodes[index];
        return node ? node.item : undefined;
      });
      ctx.setGetIndexByIdFn((id: string | number): number => {
        return layout.idToIndex.get(id) ?? -1;
      });
      ctx.setRenderFn(treeRenderIfNeeded, treeForceRender);

      ctx.registerMethod("_layoutToDataIndex", (layoutIndex: number): number => layoutIndex);
      ctx.registerMethod("_dataToLayoutIndex", (dataIndex: number): number => dataIndex);
      ctx.registerMethod("_getLoadedItem", (index: number): T | undefined => {
        const node = layout.flatNodes[index];
        return node ? node.item : undefined;
      });
      ctx.registerMethod("_getRenderedElement", (layoutIndex: number): HTMLElement | null =>
        rendered.get(layoutIndex) ?? null,
      );

      // ── Detect external focus management ─────────────────────────

      queueMicrotask(() => {
        hasExternalFocus = !!(getMethod("_getFocusedIndex") || ctx.getItemStateFn());
      });

      // ── Mutation interceptors ────────────────────────────────────

      ctx.setInsertItemFn((item: T, index: number): void => {
        const rawItems = ctxGetItems() as T[];
        const clampedIdx = Math.min(index, rawItems.length);
        rawItems.splice(clampedIdx, 0, item);
        lastItemsLength = rawItems.length;
        layout.rebuild(rawItems);
        invalidateTree();
      });

      ctx.setRemoveItemFn((id: string | number): number => {
        const idx = layout.idToIndex.get(id);

        let removedIds: Set<string | number> | null = null;
        if (isParentIdMode && idx !== undefined) {
          removedIds = new Set<string | number>();
          removedIds.add(id);
          const subtreeSize = layout.getSubtreeSize(idx);
          for (let i = idx + 1; i <= idx + subtreeSize; i++) {
            removedIds.add(layout.flatNodes[i]!.id);
          }
        }

        const removed = layout.removeNode(id);
        if (removed === 0) return -1;
        if (!hasExternalFocus && idx !== undefined && focusedIndex >= idx) {
          focusedIndex = Math.max(0, Math.min(focusedIndex - removed, layout.totalVisible - 1));
        }
        if (isParentIdMode && removedIds) {
          const rawItems = ctxGetItems() as T[];
          for (let i = rawItems.length - 1; i >= 0; i--) {
            if (removedIds.has(rawItems[i]!.id)) rawItems.splice(i, 1);
          }
        }
        lastItemsLength = (ctxGetItems()).length;
        invalidateTree();
        emitter.emit("data:change", { type: "remove", id });
        return removed;
      });

      ctx.setUpdateItemFn((id: string | number, updates: Partial<T>): boolean => {
        const idx = layout.idToIndex.get(id);
        if (idx === undefined) return false;
        const node = layout.flatNodes[idx]!;
        Object.assign(node.item, updates);
        const el = rendered.get(idx);
        if (el) {
          renderNodeElement(el, node, idx, getItemStateFn?.() ?? null);
        }
        emitter.emit("data:change", { type: "update", id });
        return true;
      });

      // ── Click handler ────────────────────────────────────────────

      ctx.registerClickHandler((event: MouseEvent): void => {
        const el = (event.target as HTMLElement).closest("[data-index]") as HTMLElement | null;
        if (!el) return;
        const idx = parseInt(el.dataset.index ?? "-1", 10);
        if (idx < 0) return;
        const node = layout.flatNodes[idx];
        if (!node) return;

        const clickedId = node.id;
        let domRebuilt = false;

        if (expandOnClick && (node.hasChildren || (cfg.loadChildren && !node.loading && !loadedChildrenMap.has(clickedId)))) {
          const prevTotal = layout.totalVisible;
          if (node.expanded) doCollapse(clickedId);
          else doExpand(clickedId);
          domRebuilt = layout.totalVisible !== prevTotal;
        }

        if (hasExternalFocus && domRebuilt) {
          resolveSelectionMethods();
          if (cachedFocusFn) cachedFocusFn(clickedId);
          if (cachedSelectFn) cachedSelectFn(clickedId);
        } else if (!hasExternalFocus) {
          focusedIndex = layout.idToIndex.get(clickedId) ?? idx;
          focusVisible = false;
          contentElement.focus({ preventScroll: true });
        }
      });

      // ── Focus handlers (when no external focus manager) ──────────

      const onFocusIn = (): void => {
        if (engineState.destroyed || hasExternalFocus) return;
        if (!contentElement.matches(":focus-visible") && !rootElement.matches(":focus-visible")) return;
        const t = layout.totalVisible;
        if (t === 0) return;
        focusedIndex = focusedIndex >= 0 ? Math.min(focusedIndex, t - 1) : 0;
        focusVisible = true;
        contentElement.setAttribute("aria-activedescendant", `${classPrefix}-item-${focusedIndex}`);
        scrollIntoView(focusedIndex);
        treeForceRender();
      };
      rootElement.addEventListener("focusin", onFocusIn);

      const onFocusOut = (e: FocusEvent): void => {
        if (engineState.destroyed || hasExternalFocus) return;
        const rel = e.relatedTarget as Node | null;
        if (rel && rootElement.contains(rel)) return;
        focusVisible = false;
        contentElement.removeAttribute("aria-activedescendant");
        treeForceRender();
      };
      rootElement.addEventListener("focusout", onFocusOut);

      // ── Keyboard handler ─────────────────────────────────────────

      ctx.registerKeydownHandler((e: KeyboardEvent): void => {
        if (engineState.destroyed) return;
        const total = layout.totalVisible;
        if (total === 0) return;

        const fi = getEffectiveFocusedIndex();
        if (fi < 0 && !hasExternalFocus && (e.key === "ArrowDown" || e.key === "Home")) {
          setFocusTo(0);
          e.preventDefault();
          return;
        }
        if (fi < 0) return;

        const node = layout.flatNodes[fi];
        if (!node) return;

        switch (e.key) {
          case "ArrowRight": {
            if (node.hasChildren || (cfg.loadChildren && !node.loading)) {
              if (!node.expanded) doExpand(node.id);
              else setFocusTo(fi + 1);
            }
            e.preventDefault();
            break;
          }

          case "ArrowLeft": {
            if (node.hasChildren && node.expanded) {
              doCollapse(node.id);
            } else if (node.parentId !== null) {
              const parentIdx = layout.idToIndex.get(node.parentId);
              if (parentIdx !== undefined) setFocusTo(parentIdx);
            }
            e.preventDefault();
            break;
          }

          case "*": {
            expandSiblings(node);
            e.preventDefault();
            break;
          }

          default: {
            if (!hasExternalFocus) {
              if (e.key === "ArrowDown") { if (fi < total - 1) setFocusTo(fi + 1); e.preventDefault(); break; }
              if (e.key === "ArrowUp") { if (fi > 0) setFocusTo(fi - 1); e.preventDefault(); break; }
              if (e.key === "Home") { setFocusTo(0); e.preventDefault(); break; }
              if (e.key === "End") { setFocusTo(total - 1); e.preventDefault(); break; }
              if (e.key === "Enter") {
                emitter.emit("item:click", { item: node.item, index: fi, event: e as unknown as MouseEvent });
                e.preventDefault();
                break;
              }
            }

            if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
              handleTypeAhead(e.key, fi);
              e.preventDefault();
            }
          }
        }
      });

      // ── Public methods ───────────────────────────────────────────

      ctx.registerMethod("expand", doExpand);
      ctx.registerMethod("collapse", doCollapse);
      ctx.registerMethod("toggle", (id: string | number): void => {
        const idx = layout.idToIndex.get(id);
        if (idx === undefined) return;
        const node = layout.flatNodes[idx]!;
        if (node.expanded) doCollapse(id);
        else doExpand(id);
      });

      ctx.registerMethod("expandAll", (): void => {
        layout.expandAll(layout.rootItems as T[]);
        invalidateTree();
      });

      ctx.registerMethod("collapseAll", (): void => {
        layout.collapseAll();
        invalidateTree();
      });

      ctx.registerMethod("expandTo", (id: string | number): void => {
        layout.expandTo(id);
        invalidateTree();
        const idx = layout.idToIndex.get(id);
        if (idx !== undefined) scrollIntoView(idx);
      });

      ctx.registerMethod("getExpanded", (): (string | number)[] => Array.from(layout.expandedIds));
      ctx.registerMethod("isExpanded", (id: string | number): boolean => layout.expandedIds.has(id));

      const parentIdKey = isParentIdMode && typeof cfg.parentId === "string" ? cfg.parentId : null;

      ctx.registerMethod("addChild", (parentId: string | number | null, item: T, index?: number): void => {
        if (parentIdKey) (item as Record<string, unknown>)[parentIdKey] = parentId;
        if (isParentIdMode) {
          const rawItems = ctxGetItems() as T[];
          rawItems.push(item);
          lastItemsLength = rawItems.length;
        }
        layout.addChild(parentId, item, index);
        invalidateTree();
        emitter.emit("data:change", { type: "add", id: item.id });
      });

      ctx.registerMethod("moveNode", (id: string | number, newParentId: string | number | null, index?: number): void => {
        if (parentIdKey) {
          const flatIdx = layout.idToIndex.get(id);
          if (flatIdx !== undefined) {
            (layout.flatNodes[flatIdx]!.item as Record<string, unknown>)[parentIdKey] = newParentId;
          }
        }
        layout.moveNode(id, newParentId, index);
        invalidateTree();
      });

      ctx.registerMethod("getTreeLayout", () => ({
        totalVisible: layout.totalVisible,
        flatNodes: layout.flatNodes,
      }));

      // ── Destroy ──────────────────────────────────────────────────

      ctx.registerDestroyHandler(() => {
        rootElement.removeEventListener("focusin", onFocusIn);
        rootElement.removeEventListener("focusout", onFocusOut);
        detachAll();
        rootElement.classList.remove(`${classPrefix}--tree`);
        rootElement.classList.remove(`${classPrefix}--tree-lines`);
        if (typeAheadTimer !== null) clearTimeout(typeAheadTimer);
      });
    },

    destroy(): void {
      rendered.clear();
      if (typeAheadTimer !== null) clearTimeout(typeAheadTimer);
    },
  };
}
