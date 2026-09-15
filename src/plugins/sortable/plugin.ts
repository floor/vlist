/**
 * vlist v2 — Sortable Plugin
 *
 * Drag-and-drop reordering for virtual lists.
 * Priority 30 — runs after layout plugins and scrollbar, before selection.
 *
 * Features:
 * - Pointer drag-and-drop with ghost element
 * - Keyboard reordering (Space to grab, arrows to move, Space to drop, Escape to cancel)
 * - Items shift via CSS transforms during drag
 * - Auto-scroll when dragging near viewport edges
 * - ARIA attributes and live region announcements
 * - Emits sort:start, sort:end, sort:cancel events
 *
 * The plugin is purely visual during drag — it does NOT reorder data.
 * On drop, it emits `sort:end` with `{ fromIndex, toIndex }`.
 * The consumer reorders their data and calls `setItems()`.
 *
 * Restrictions:
 * - Cannot be combined with grid, masonry, table, or scale plugins
 */

import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import type { EngineState } from "../../core/state";
import { SCROLL_IDLE_TIMEOUT } from "../../constants";
import type { SizeCache } from "../../core/sizes";

// =============================================================================
// Config
// =============================================================================

export interface SortablePluginConfig {
  handle?: string;
  ghostClass?: string;
  shiftDuration?: number;
  edgeScrollZone?: number;
  edgeScrollSpeed?: number;
  dragThreshold?: number;
  /** Touch/pen hold delay without a handle, in milliseconds (default 350).
   * Moving dragThreshold pixels before this expires yields to scrolling. */
  touchDelay?: number;
  ghostContainer?: HTMLElement;
}

// =============================================================================
// Factory
// =============================================================================

export function sortable<T extends VListItem = VListItem>(
  config?: SortablePluginConfig,
): VListPlugin<T> {
  const handleSelector = config?.handle ?? null;
  const ghostClass = config?.ghostClass ?? "vlist-sort-ghost";
  const shiftDuration = config?.shiftDuration ?? 150;
  const edgeScrollZone = config?.edgeScrollZone ?? 40;
  const edgeScrollSpeed = config?.edgeScrollSpeed ?? 20;
  const dragThreshold = config?.dragThreshold ?? 5;
  const touchDelay = Math.max(0, config?.touchDelay ?? 350);
  const ghostContainer = config?.ghostContainer ?? null;

  let engineState: EngineState;
  let scroll: PluginContext<T>["scroll"];
  let sizeCache: SizeCache;
  let storedCtx: PluginContext<T> | null = null;
  let contentEl: HTMLElement;
  let viewportEl: HTMLElement;
  let rootEl: HTMLElement;
  let classPrefix: string;
  let isX: boolean;

  // Precomputed values
  let prop: string;
  let shiftTransition: string;
  let sortingClass: string;
  let settlingClass: string;
  let dragSourceClass: string;

  // ── Drag state ──
  let sorting = false;
  let dragIndex = -1;
  let dropIndex = -1;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerCurrentX = 0;
  let pointerCurrentY = 0;
  let dragInitiated = false;
  let ghost: HTMLElement | null = null;
  let scrollRafId = 0;
  let draggedElement: HTMLElement | null = null;
  let draggedItemSize = 0;
  let ghostOffsetX = 0;
  let ghostOffsetY = 0;
  let dragFocusedItemId: string | number | null = null;

  let touchPointer: number | null = null;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let touchClaimed = false;
  let scrolling = false;
  let lastScrollPosition = NaN, lastScrollTime = -Infinity;
  let pressPosition = 0;
  let touchItem: HTMLElement | null = null;
  let touchTarget: HTMLElement | null = null;
  let renderedOrigin = 0;

  // ── Keyboard state ──
  let kbGrabbed = false;
  let kbGrabbedItemId: string | number = "";
  let kbFromIndex = -1;
  let kbCurrentIndex = -1;
  let kbOriginalItems: T[] = [];

  // ── ARIA ──
  let instructionsId = "";
  let instructionsEl: HTMLElement | null = null;
  let liveRegion: HTMLElement | null = null;
  let kbGrabbedClassName = "";

  // ── Edge scroll state ──
  let inEdgeZone = false;

  // =========================================================================
  // Helpers
  // =========================================================================

  const findItemElement = (target: HTMLElement): HTMLElement | null => {
    return target.closest("[data-index]") as HTMLElement | null;
  };

  const getIndex = (el: HTMLElement): number => {
    const attr = el.dataset.index;
    return attr === undefined ? -1 : +attr;
  };

  const createGhost = (sourceEl: HTMLElement): HTMLElement => {
    const rect = sourceEl.getBoundingClientRect();
    const clone = sourceEl.cloneNode(true) as HTMLElement;
    clone.className = `${classPrefix}-item ${ghostClass}`;
    clone.removeAttribute("data-index");
    clone.style.cssText =
      `position:fixed;pointer-events:none;z-index:10000;width:${rect.width}px;` +
      `height:${rect.height}px;left:${rect.left}px;top:${rect.top}px;` +
      "transition:none;will-change:transform";
    (ghostContainer || document.body).appendChild(clone);
    return clone;
  };

  const updateGhostPosition = (): void => {
    if (!ghost) return;
    ghost.style.left = `${pointerCurrentX - ghostOffsetX}px`;
    ghost.style.top = `${pointerCurrentY - ghostOffsetY}px`;
  };

  const computeDropIndex = (): number => {
    const totalItems = engineState.totalItems;
    if (totalItems === 0) return 0;

    const viewportRect = viewportEl.getBoundingClientRect();
    const scrollPos = scroll.getPixelEquivalent();
    const ghostTop = isX
      ? pointerCurrentX - ghostOffsetX - viewportRect.left + scrollPos
      : pointerCurrentY - ghostOffsetY - viewportRect.top + scrollPos;
    const ghostBottom = ghostTop + draggedItemSize;

    const dragEnd = sizeCache.getOffset(dragIndex) + sizeCache.getSize(dragIndex);

    if (ghostBottom > dragEnd) {
      const rawIndex = sizeCache.indexAtOffset(ghostBottom);
      const mid = sizeCache.getOffset(rawIndex) + sizeCache.getSize(rawIndex) / 2;
      const result = ghostBottom > mid ? rawIndex : rawIndex - 1;
      return Math.min(Math.max(result, dragIndex), totalItems - 1);
    }

    const dragStart = sizeCache.getOffset(dragIndex);
    if (ghostTop < dragStart) {
      const rawIndex = sizeCache.indexAtOffset(ghostTop);
      const mid = sizeCache.getOffset(rawIndex) + sizeCache.getSize(rawIndex) / 2;
      const result = ghostTop < mid ? rawIndex : rawIndex + 1;
      return Math.max(Math.min(result, dragIndex), 0);
    }

    return dragIndex;
  };

  const applyShifts = (): void => {
    const children = contentEl.children;
    const shiftPx = draggedItemSize;

    for (let i = 0; i < children.length; i++) {
      const itemEl = children[i] as HTMLElement;
      const idx = getIndex(itemEl);
      if (idx < 0 || idx === dragIndex) continue;

      let shift = 0;
      if (dropIndex > dragIndex) {
        if (idx > dragIndex && idx <= dropIndex) shift = -shiftPx;
      } else if (dropIndex < dragIndex) {
        if (idx >= dropIndex && idx < dragIndex) shift = shiftPx;
      }

      const baseOffset = sizeCache.getOffset(idx);
      const finalOffset = Math.round(baseOffset + shift - scroll.getRenderOrigin());
      itemEl.style.transition = shiftTransition;
      itemEl.style.transform = `${prop}(${finalOffset}px)`;
    }
  };

  const clearShifts = (): void => {
    const children = contentEl.children;
    for (let i = 0; i < children.length; i++) {
      const itemEl = children[i] as HTMLElement;
      const idx = getIndex(itemEl);
      if (idx >= 0) {
        itemEl.style.transform = `${prop}(${Math.round(sizeCache.getOffset(idx) - scroll.getRenderOrigin())}px)`;
      }
      itemEl.style.transition = "";
    }
  };

  const updateDropPosition = (): void => {
    if (!storedCtx) return;
    const newDropIndex = computeDropIndex();
    if (newDropIndex === dropIndex) return;
    dropIndex = newDropIndex;
    applyShifts();
    storedCtx.emitter.emit("sort:move" as never, { fromIndex: dragIndex, currentIndex: dropIndex } as never);
  };

  const isPointerOutsideViewport = (): boolean => {
    const viewportRect = viewportEl.getBoundingClientRect();
    if (isX) {
      return pointerCurrentX < viewportRect.left || pointerCurrentX > viewportRect.right;
    }
    return pointerCurrentY < viewportRect.top || pointerCurrentY > viewportRect.bottom;
  };

  // ── Selection helpers ──

  const getFocusedIndex = (): number => {
    const fn = storedCtx?.getMethod("_getFocusedIndex") as (() => number) | undefined;
    return fn ? fn() : -1;
  };

  const focusById = (id: string | number): void => {
    const fn = storedCtx?.getMethod("_focusById") as ((id: string | number) => void) | undefined;
    if (fn) fn(id);
  };

  const scrollIntoView = (index: number): void => {
    if (!storedCtx) return;
    const containerSize = isX
      ? viewportEl.clientWidth
      : viewportEl.clientHeight;
    const scrollPos = scroll.getPixelEquivalent();
    const itemTop = sizeCache.getOffset(index);
    const itemBottom = itemTop + sizeCache.getSize(index);

    if (itemTop < scrollPos) {
      storedCtx.scrollTo(Math.max(0, itemTop));
    } else if (itemBottom > scrollPos + containerSize) {
      storedCtx.scrollTo(itemBottom - containerSize);
    }
  };

  const announce = (message: string): void => {
    if (!liveRegion) return;
    liveRegion.textContent = "";
    void liveRegion.offsetHeight;
    liveRegion.textContent = message;
  };

  const getItemLabel = (index: number): string => {
    if (!storedCtx) return "";
    const items = storedCtx.getItems();
    const item = items[index];
    if (!item) return "";
    const el = contentEl.querySelector(`[data-index="${index}"]`) as HTMLElement | null;
    const text = el?.textContent?.trim();
    return text || String(item.id);
  };

  const totalLabel = (): string => String(engineState.totalItems);

  const setChildTransitions = (value: string): void => {
    const children = contentEl.children;
    for (let i = 0; i < children.length; i++) {
      (children[i] as HTMLElement).style.transition = value;
    }
  };

  // =========================================================================
  // Edge Auto-Scroll
  // =========================================================================

  const startEdgeScroll = (): void => {
    const tick = (): void => {
      if (!sorting || !storedCtx) return;

      const viewportRect = viewportEl.getBoundingClientRect();
      let delta = 0;
      const maxT = 3;

      if (isX) {
        const distFromStart = pointerCurrentX - viewportRect.left;
        const distFromEnd = viewportRect.right - pointerCurrentX;
        if (distFromStart < edgeScrollZone) {
          const t = Math.min(maxT, 1 - distFromStart / edgeScrollZone);
          delta = -edgeScrollSpeed * t * t;
        } else if (distFromEnd < edgeScrollZone) {
          const t = Math.min(maxT, 1 - distFromEnd / edgeScrollZone);
          delta = edgeScrollSpeed * t * t;
        }
      } else {
        const distFromTop = pointerCurrentY - viewportRect.top;
        const distFromBottom = viewportRect.bottom - pointerCurrentY;
        if (distFromTop < edgeScrollZone) {
          const t = Math.min(maxT, 1 - distFromTop / edgeScrollZone);
          delta = -edgeScrollSpeed * t * t;
        } else if (distFromBottom < edgeScrollZone) {
          const t = Math.min(maxT, 1 - distFromBottom / edgeScrollZone);
          delta = edgeScrollSpeed * t * t;
        }
      }

      const outsideViewport = isPointerOutsideViewport();

      if (delta !== 0) {
        const currentScroll = scroll.getPixelEquivalent();
        const maxScroll = sizeCache.getTotalSize() - (isX
          ? viewportEl.clientWidth
          : viewportEl.clientHeight);
        const atLimit = (delta < 0 && currentScroll <= 0)
          || (delta > 0 && currentScroll >= maxScroll);

        if (atLimit) {
          inEdgeZone = outsideViewport;
        } else {
          inEdgeZone = true;
          storedCtx.scrollTo(currentScroll + delta);
        }
      } else {
        inEdgeZone = outsideViewport;
      }

      scrollRafId = requestAnimationFrame(tick);
    };
    scrollRafId = requestAnimationFrame(tick);
  };

  const stopEdgeScroll = (): void => {
    if (scrollRafId) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = 0;
    }
  };

  // =========================================================================
  // Cleanup
  // =========================================================================

  const cleanupDrag = (skipRender = false): void => {
    clearTouch();
    sorting = false;
    dragInitiated = false;

    if (ghost && ghost.parentNode) ghost.remove();
    ghost = null;
    draggedElement = null;

    const children = contentEl.children;
    for (let i = 0; i < children.length; i++) {
      const el = children[i] as HTMLElement;
      el.classList.remove(dragSourceClass);
      const idx = getIndex(el);
      if (idx >= 0) {
        el.style.transform = `${prop}(${Math.round(sizeCache.getOffset(idx) - scroll.getRenderOrigin())}px)`;
      }
      el.style.transition = "";
    }

    stopEdgeScroll();
    rootEl.classList.remove(sortingClass);
    document.body.style.cursor = "";

    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();

    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerCancel);

    if (!skipRender && storedCtx) {
      storedCtx.forceRender();
    }
  };

  // =========================================================================
  // Animate Drop
  // =========================================================================

  const animateDrop = (fromIndex: number, toIndex: number): void => {
    if (!storedCtx) return;
    const posChanged = fromIndex !== toIndex && fromIndex >= 0 && toIndex >= 0;

    const finalize = (): void => {
      if (!storedCtx) return;
      sorting = false;
      if (posChanged) {
        rootEl.classList.add(settlingClass);
        storedCtx.emitter.emit("sort:end" as never, { fromIndex, toIndex } as never);
        if (dragFocusedItemId !== null) focusById(dragFocusedItemId);
        cleanupDrag(true);
        requestAnimationFrame(() => rootEl.classList.remove(settlingClass));
      } else {
        rootEl.classList.add(settlingClass);
        storedCtx.emitter.emit("sort:cancel" as never, { originalItems: [...storedCtx.getItems()] } as never);
        cleanupDrag(false);
        requestAnimationFrame(() => rootEl.classList.remove(settlingClass));
      }
    };

    if (!ghost) {
      finalize();
      return;
    }

    const viewportRect = viewportEl.getBoundingClientRect();
    const scrollPos = scroll.getPixelEquivalent();
    const targetOffset = sizeCache.getOffset(toIndex);
    const duration = shiftDuration > 0 ? shiftDuration : 150;

    ghost.style.transition = `left ${duration}ms ease, top ${duration}ms ease`;

    if (isX) {
      ghost.style.left = `${viewportRect.left + targetOffset - scrollPos}px`;
      ghost.style.top = `${viewportRect.top}px`;
    } else {
      ghost.style.left = `${viewportRect.left}px`;
      ghost.style.top = `${viewportRect.top + targetOffset - scrollPos}px`;
    }

    let settled = false;
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      ghost?.removeEventListener("transitionend", onEnd);
      finalize();
    };

    ghost.addEventListener("transitionend", onEnd);
    setTimeout(onEnd, duration + 50);
  };

  // =========================================================================
  // Pointer Events
  // =========================================================================

  const isTouch = (event: PointerEvent): boolean => event.pointerType === "touch" || event.pointerType === "pen";

  function clearTouch(): void {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
    touchItem?.classList.remove(`${classPrefix}-item--touch-sort`);
    touchItem = null;
    touchTarget?.removeEventListener("touchmove", blockTouchMove);
    touchTarget = null;
    if (touchPointer !== null && contentEl.hasPointerCapture(touchPointer)) contentEl.releasePointerCapture(touchPointer);
    touchPointer = null;
    touchClaimed = false;
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerCancel, true);
    document.removeEventListener("pointerdown", secondTouch, true);
    document.removeEventListener("touchmove", blockTouchMove, true);
    contentEl.removeEventListener("contextmenu", blockCallout);
    contentEl.removeEventListener("selectstart", blockCallout);
  }

  function abandonTouch(): void {
    clearTouch();
    if (!dragInitiated) draggedElement = null;
  }

  function secondTouch(event: PointerEvent): void {
    if (!isTouch(event) || event.pointerId === touchPointer) return;
    if (touchClaimed) cancelPointerDrag();
    abandonTouch();
  }

  function blockTouchMove(event: TouchEvent): void {
    if (touchClaimed && event.cancelable) event.preventDefault();
  }

  function blockCallout(event: Event): void {
    if (touchPointer !== null && event.target instanceof Node && touchItem?.contains(event.target)) event.preventDefault();
  }

  function startDrag(): void {
    if (!storedCtx || !draggedElement) return;
    if (touchPointer !== null) {
      touchClaimed = true;
      storedCtx.cancelScroll();
      if (viewportEl.hasPointerCapture(touchPointer)) viewportEl.releasePointerCapture(touchPointer);
      // The source row can be recycled during edge scrolling; capture on the
      // stable content element so the claimed gesture keeps reaching document.
      contentEl.setPointerCapture(touchPointer);
    }
    dragInitiated = true;
    sorting = true;
    dropIndex = dragIndex;
    rootEl.classList.add(sortingClass);
    document.body.style.cursor = "grabbing";

    draggedItemSize = sizeCache.getSize(dragIndex);

    if (draggedElement) {
      ghost = createGhost(draggedElement);
      draggedElement.classList.add(dragSourceClass);
    }

    const focusIdx = getFocusedIndex();
    if (focusIdx >= 0) {
      const items = storedCtx.getItems();
      const focusItem = items[focusIdx];
      dragFocusedItemId = focusItem ? focusItem.id : null;
    } else {
      dragFocusedItemId = null;
    }

    storedCtx.emitter.emit("sort:start" as never, { index: dragIndex } as never);
    startEdgeScroll();
    if (touchClaimed) ghost?.classList.add(`${classPrefix}-sort-ghost--touch`);
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (engineState.destroyed || !storedCtx) return;
    if (sorting) return;
    if (kbGrabbed) kbCancel();
    if (event.button !== 0) return;

    const target = event.target as HTMLElement;
    if (handleSelector) {
      const handle = target.closest(handleSelector);
      if (!handle) return;
    }

    const itemEl = findItemElement(target);
    if (!itemEl) return;

    const index = getIndex(itemEl);
    if (index < 0) return;
    const touch = isTouch(event);
    // The native browser / synthetic viewport catches existing momentum. This
    // contact does not arm a hold, even if the list becomes idle afterward.
    if (touch && ((scrolling && performance.now() - lastScrollTime < SCROLL_IDLE_TIMEOUT) || !event.isPrimary)) return;

    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    pointerCurrentX = event.clientX;
    pointerCurrentY = event.clientY;
    dragIndex = index;
    dragInitiated = false;
    draggedElement = itemEl;

    const rect = itemEl.getBoundingClientRect();
    ghostOffsetX = event.clientX - rect.left;
    ghostOffsetY = event.clientY - rect.top;

    if (touch) {
      touchPointer = event.pointerId;
      touchItem = itemEl;
      // Touch Events retain their original target even when that node is
      // recycled out of the DOM. Keep cancellation attached to that target too.
      touchTarget = target;
      target.addEventListener("touchmove", blockTouchMove, { passive: false });
      pressPosition = scroll.getPixelEquivalent();
      itemEl.classList.add(`${classPrefix}-item--touch-sort`);
      document.addEventListener("pointermove", onPointerMove, true);
      document.addEventListener("pointerup", onPointerUp, true);
      document.addEventListener("pointercancel", onPointerCancel, true);
      document.addEventListener("pointerdown", secondTouch, true);
      document.addEventListener("touchmove", blockTouchMove, { capture: true, passive: false });
      contentEl.addEventListener("contextmenu", blockCallout);
      contentEl.addEventListener("selectstart", blockCallout);
      if (handleSelector) {
        // Reserve handle input before the viewport can begin tracking it.
        storedCtx.cancelScroll();
        event.stopPropagation();
      } else {
        pressTimer = setTimeout(() => { pressTimer = null; startDrag(); }, touchDelay);
      }
      return;
    }
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
  };

  function onPointerMove(event: PointerEvent): void {
    if (!storedCtx) return;
    if (touchPointer !== null && event.pointerId !== touchPointer) return;
    pointerCurrentX = event.clientX;
    pointerCurrentY = event.clientY;

    if (!dragInitiated) {
      const dx = pointerCurrentX - pointerStartX;
      const dy = pointerCurrentY - pointerStartY;
      if (Math.sqrt(dx * dx + dy * dy) < dragThreshold) return;
      if (touchPointer !== null && !handleSelector) { abandonTouch(); return; }
      startDrag();
    }

    if (sorting) {
      if (touchClaimed) event.stopPropagation();
      event.preventDefault();
      updateGhostPosition();
      if (!inEdgeZone) {
        updateDropPosition();
      } else if (isPointerOutsideViewport()) {
        if (dropIndex !== dragIndex) {
          dropIndex = dragIndex;
          clearShifts();
        }
      }
    }
  }

  function onPointerUp(event: PointerEvent): void {
    if (touchPointer !== null) {
      if (event.pointerId !== touchPointer) return;
      if (touchClaimed) event.stopPropagation();
      clearTouch();
    }
    if (!dragInitiated) {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
      draggedElement = null;
      return;
    }

    event.preventDefault();
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerCancel);
    stopEdgeScroll();
    animateDrop(dragIndex, dropIndex);
  }

  const cancelPointerDrag = (): void => {
    if (!dragInitiated) return;
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerCancel);
    stopEdgeScroll();
    clearShifts();
    animateDrop(dragIndex, dragIndex);
  };

  function onPointerCancel(event: PointerEvent): void {
    if (touchPointer !== null && event.pointerId !== touchPointer) return;
    if (touchClaimed) event.stopPropagation();
    cancelPointerDrag();
    clearTouch();
  }

  // =========================================================================
  // Keyboard Reordering
  // =========================================================================

  const clearKbGrabbedClass = (): void => {
    const els = contentEl.querySelectorAll(`.${kbGrabbedClassName}`);
    for (let i = 0; i < els.length; i++) {
      els[i]!.classList.remove(kbGrabbedClassName);
    }
  };

  const applyKbGrabbedClass = (): void => {
    clearKbGrabbedClass();
    const el = contentEl.querySelector(
      `[data-id="${kbGrabbedItemId}"]`,
    ) as HTMLElement | null;
    if (el) el.classList.add(kbGrabbedClassName);
  };

  const kbGrab = (index: number): void => {
    if (!storedCtx) return;
    const items = storedCtx.getItems();
    const item = items[index];
    if (!item) return;

    kbGrabbed = true;
    kbGrabbedItemId = item.id;
    kbFromIndex = index;
    kbCurrentIndex = index;

    kbOriginalItems = [...items] as T[];

    rootEl.classList.add(sortingClass);
    storedCtx.emitter.emit("sort:start" as never, { index } as never);
    applyKbGrabbedClass();

    announce(
      `Grabbed ${getItemLabel(index)}. Current position ${index + 1} of ${totalLabel()}. ` +
      `Use Up and Down arrow keys to move, Space to drop, Escape to cancel.`,
    );
  };

  const kbDrop = (): void => {
    if (!kbGrabbed || !storedCtx) return;
    kbGrabbed = false;

    const toIndex = kbCurrentIndex;
    const label = getItemLabel(toIndex);

    setChildTransitions("none");
    rootEl.classList.remove(sortingClass);
    clearKbGrabbedClass();

    focusById(kbGrabbedItemId);
    storedCtx.forceRender();

    announce(`${label} dropped. Final position ${toIndex + 1} of ${totalLabel()}.`);
    kbOriginalItems = [];

    requestAnimationFrame(() => setChildTransitions(""));
  };

  const kbCancel = (): void => {
    if (!kbGrabbed || !storedCtx) return;
    kbGrabbed = false;

    const originalIndex = kbFromIndex;

    setChildTransitions("none");
    rootEl.classList.remove(sortingClass);
    clearKbGrabbedClass();

    if (kbCurrentIndex !== originalIndex) {
      storedCtx.emitter.emit("sort:cancel" as never, { originalItems: kbOriginalItems } as never);
    }

    focusById(kbGrabbedItemId);
    storedCtx.forceRender();
    scrollIntoView(originalIndex);

    announce(`Reorder cancelled. Returned to position ${originalIndex + 1} of ${totalLabel()}.`);
    kbOriginalItems = [];

    requestAnimationFrame(() => setChildTransitions(""));
  };

  const kbMove = (direction: 1 | -1): void => {
    if (!kbGrabbed || !storedCtx) return;
    const total = engineState.totalItems;
    const newIndex = kbCurrentIndex + direction;
    if (newIndex < 0 || newIndex >= total) return;

    const fromIndex = kbCurrentIndex;
    const toIndex = newIndex;

    setChildTransitions("none");
    storedCtx.emitter.emit("sort:end" as never, { fromIndex, toIndex } as never);

    kbCurrentIndex = toIndex;
    focusById(kbGrabbedItemId);
    storedCtx.forceRender();
    scrollIntoView(toIndex);
    applyKbGrabbedClass();

    announce(`${getItemLabel(toIndex)} moved. New position ${toIndex + 1} of ${totalLabel()}.`);
    requestAnimationFrame(() => setChildTransitions(""));
  };

  // =========================================================================
  // Keyboard Handler
  // =========================================================================

  const onKeydown = (event: KeyboardEvent): void => {
    if (engineState.destroyed) return;

    if (sorting) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelPointerDrag();
      }
      return;
    }

    if (kbGrabbed) {
      switch (event.key) {
        case " ":
        case "Enter":
          event.preventDefault();
          event.stopImmediatePropagation();
          kbDrop();
          return;
        case "Escape":
          event.preventDefault();
          event.stopImmediatePropagation();
          kbCancel();
          return;
        case "ArrowUp":
        case "ArrowLeft":
          event.preventDefault();
          event.stopImmediatePropagation();
          kbMove(-1);
          return;
        case "ArrowDown":
        case "ArrowRight":
          event.preventDefault();
          event.stopImmediatePropagation();
          kbMove(1);
          return;
        default:
          if (!event.key.startsWith("F") && event.key !== "Tab") {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
          return;
      }
    }

    if (event.key === " " && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      const focusedIndex = getFocusedIndex();
      if (focusedIndex >= 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        kbGrab(focusedIndex);
      }
    }
  };

  // =========================================================================
  // Plugin
  // =========================================================================

  return {
    name: "sortable",
    priority: 30,
    conflicts: ["grid", "masonry", "table", "scale", "tree"],

    setup(ctx: PluginContext<T>): void {
      scroll = ctx.scroll;
      storedCtx = ctx;
      engineState = ctx.getState();
      sizeCache = ctx.sizeCache;
      contentEl = ctx.dom.content;
      viewportEl = ctx.dom.viewport;
      rootEl = ctx.dom.root;
      classPrefix = ctx.config.classPrefix;
      isX = ctx.config.axis.primary === "x";

      prop = isX ? "translateX" : "translateY";
      shiftTransition = shiftDuration > 0
        ? `transform ${shiftDuration}ms ease`
        : "none";
      sortingClass = `${classPrefix}--sorting`;
      settlingClass = `${classPrefix}--settling`;
      dragSourceClass = `${classPrefix}-item--drag-source`;
      kbGrabbedClassName = `${classPrefix}-item--kb-sorting`;

      ctx.registerMethod("isSorting", (): boolean => sorting || kbGrabbed);

      // ── Pointer handler on items container ──
      contentEl.addEventListener("pointerdown", onPointerDown);

      // ── Keyboard handler directly on root ──
      // Registered directly (not via ctx.registerKeydownHandler) so
      // stopImmediatePropagation prevents selection from processing keys
      rootEl.addEventListener("keydown", onKeydown);

      // ── ARIA instructions ──
      instructionsId = `${classPrefix}-sort-instructions`;
      instructionsEl = document.createElement("div");
      instructionsEl.id = instructionsId;
      instructionsEl.style.cssText =
        "position:absolute;width:1px;height:1px;padding:0;margin:-1px;" +
        "overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
      instructionsEl.textContent =
        "Press Space to reorder. Use arrow keys to move, Space to drop, Escape to cancel.";
      rootEl.appendChild(instructionsEl);

      // ── Live region for announcements ──
      liveRegion = document.createElement("div");
      liveRegion.setAttribute("role", "status");
      liveRegion.setAttribute("aria-live", "assertive");
      liveRegion.setAttribute("aria-atomic", "true");
      liveRegion.style.cssText =
        "position:absolute;width:1px;height:1px;padding:0;margin:-1px;" +
        "overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
      rootEl.appendChild(liveRegion);

      // ── Cleanup ──
      ctx.registerDestroyHandler(() => {
        if (kbGrabbed) kbCancel();
        cleanupDrag();
        contentEl.removeEventListener("pointerdown", onPointerDown);
        rootEl.removeEventListener("keydown", onKeydown);
        instructionsEl?.remove();
        liveRegion?.remove();
      });
    },

    hooks: {
      onAfterScroll(position): void {
        if (position !== lastScrollPosition) {
          lastScrollPosition = position;
          lastScrollTime = performance.now();
          scrolling = true;
        }
        if (touchPointer !== null && !touchClaimed && position !== pressPosition) abandonTouch();
      },
      onIdle(): void { scrolling = false; },
      onCommit(): void {
        if (!storedCtx) return;
        const origin = scroll.getRenderOrigin();
        const originChanged = origin !== renderedOrigin;
        renderedOrigin = origin;

        const children = contentEl.children;
        for (let i = 0; i < children.length; i++) {
          const el = children[i] as HTMLElement;
          const idx = getIndex(el);
          if (idx < 0) continue;

          // Apply ARIA attributes to all visible items
          el.setAttribute("aria-roledescription", "sortable item");
          el.setAttribute("aria-describedby", instructionsId);

          // During keyboard grab: maintain grabbed visual
          if (kbGrabbed) {
            const id = el.getAttribute("data-id");
            if (id === String(kbGrabbedItemId)) {
              el.classList.add(kbGrabbedClassName);
            } else {
              el.classList.remove(kbGrabbedClassName);
            }
          }

          // During pointer drag: maintain visual state on recycled elements.
          if (sorting) {
            // Logical scrolling moves every item through its render origin.
            // Only reordering shifts should animate, never that coordinate move.
            if (originChanged) el.style.transition = "";
            if (idx === dragIndex) {
              el.classList.add(dragSourceClass);
              draggedElement = el;
            } else {
              el.classList.remove(dragSourceClass);
              let shift = 0;
              if (dropIndex > dragIndex) {
                if (idx > dragIndex && idx <= dropIndex) shift = -draggedItemSize;
              } else if (dropIndex < dragIndex) {
                if (idx >= dropIndex && idx < dragIndex) shift = draggedItemSize;
              }
              const finalOffset = Math.round(sizeCache.getOffset(idx) + shift - scroll.getRenderOrigin());
              el.style.transform = `${prop}(${finalOffset}px)`;
            }
          }
        }
      },
    },

    destroy(): void {
      if (ghost && ghost.parentNode) ghost.remove();
      ghost = null;
      stopEdgeScroll();
      instructionsEl?.remove();
      liveRegion?.remove();
      storedCtx = null;
    },
  };
}
