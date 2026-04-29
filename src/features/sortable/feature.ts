/**
 * vlist/sortable - Builder Feature
 * Drag-and-drop reordering for virtual lists.
 *
 * Priority: 55 (runs after selection at 50, before scrollbar at 60)
 *
 * What it wires:
 * - Pointer event handlers on the items container for drag initiation
 * - Creates a drag ghost element that follows the pointer
 * - Items shift via CSS transforms to make room (like iOS list reordering)
 * - Auto-scrolls when dragging near viewport edges
 * - Emits sort:start and sort:end events
 *
 * The feature is purely visual during drag — it does NOT reorder data.
 * On drop, it emits a `sort:end` event with `{ fromIndex, toIndex }`.
 * The consumer is responsible for reordering their data array and
 * calling `setItems()` with the new order.
 *
 * IMPORTANT: vlist positions items via `style.transform: translateY(offset)`.
 * The shift must ADD to that existing offset, not replace it.
 *
 * Added methods: isSorting
 * Added events: sort:start, sort:end
 */

import type { VListItem } from "../../types";
import type { VListFeature, BuilderContext } from "../../builder/types";

// =============================================================================
// Feature Config
// =============================================================================

/** Sortable feature configuration */
export interface SortableConfig {
  /**
   * CSS selector for the drag handle within each item.
   * When set, only elements matching this selector initiate a drag.
   * When omitted, the entire item is draggable.
   *
   * ```ts
   * withSortable({ handle: '.drag-handle' })
   * ```
   */
  handle?: string;

  /**
   * CSS class added to the drag ghost element (default: 'vlist-sort-ghost').
   * The ghost is a clone of the dragged item that follows the pointer.
   */
  ghostClass?: string;

  /**
   * Transition duration for item shift animations in milliseconds (default: 150).
   * Set to 0 for instant shifts.
   */
  shiftDuration?: number;

  /**
   * Size of the auto-scroll zone at viewport edges in pixels (default: 40).
   * When the pointer enters this zone during drag, the list auto-scrolls.
   */
  edgeScrollZone?: number;

  /**
   * Auto-scroll speed in pixels per frame (default: 8).
   */
  edgeScrollSpeed?: number;

  /**
   * Minimum distance in pixels the pointer must move before drag starts (default: 5).
   * Prevents accidental drags on click.
   */
  dragThreshold?: number;
}

// =============================================================================
// Feature Factory
// =============================================================================

/**
 * Create a sortable feature for the builder.
 *
 * Enables drag-and-drop reordering of items in the virtual list.
 *
 * ```ts
 * import { vlist } from 'vlist'
 * import { withSortable } from 'vlist/sortable'
 *
 * const list = vlist({ ... })
 *   .use(withSortable({ handle: '.drag-handle' }))
 *   .build()
 *
 * list.on('sort:end', ({ fromIndex, toIndex }) => {
 *   const reordered = [...items]
 *   const [moved] = reordered.splice(fromIndex, 1)
 *   reordered.splice(toIndex, 0, moved)
 *   list.setItems(reordered)
 * })
 * ```
 */
export const withSortable = <T extends VListItem = VListItem>(
  config?: SortableConfig,
): VListFeature<T> => {
  const handleSelector = config?.handle ?? null;
  const ghostClass = config?.ghostClass ?? "vlist-sort-ghost";
  const shiftDuration = config?.shiftDuration ?? 150;
  const edgeScrollZone = config?.edgeScrollZone ?? 40;
  const edgeScrollSpeed = config?.edgeScrollSpeed ?? 20;
  const dragThreshold = config?.dragThreshold ?? 5;

  return {
    name: "withSortable",
    priority: 55,

    methods: ["isSorting"] as const,

    conflicts: ["withGrid", "withMasonry", "withTable"] as const,

    setup(ctx: BuilderContext<T>): void {
      const { dom, emitter, config: resolvedConfig } = ctx;
      const { classPrefix } = resolvedConfig;
      const hz = resolvedConfig.horizontal;

      // Pre-compute orientation-dependent values
      const prop = hz ? "translateX" : "translateY";
      const shiftTransition = shiftDuration > 0
        ? `transform ${shiftDuration}ms ease`
        : "none";
      const sortingClass = `${classPrefix}--sorting`;

      // ── Drag state ──
      let sorting = false;
      let dragIndex = -1;
      let dropIndex = -1;
      let pointerStartMain = 0;
      let pointerMain = 0;
      let pointerCross = 0;
      let dragInitiated = false;
      let ghost: HTMLElement | null = null;
      let scrollRafId = 0;
      let draggedElement: HTMLElement | null = null;
      let draggedItemSize = 0;

      // Offset from pointer to top-left corner of dragged item
      let ghostOffsetMain = 0;
      let ghostOffsetCross = 0;

      // ── Register public method ──
      ctx.methods.set("isSorting", (): boolean => sorting);

      // ── Helper: get index from item element ──
      const getIndex = (el: HTMLElement): number => {
        const attr = el.dataset.index;
        return attr === undefined ? -1 : +attr;
      };

      // ── Helper: set transition on all item children ──
      const setTransitions = (value: string): void => {
        const c = dom.items.children;
        for (let i = 0; i < c.length; i++) {
          (c[i] as HTMLElement).style.transition = value;
        }
      };

      // ── Helper: split pointer event into main/cross axes ──
      const readPointer = (e: PointerEvent): void => {
        if (hz) {
          pointerMain = e.clientX;
          pointerCross = e.clientY;
        } else {
          pointerMain = e.clientY;
          pointerCross = e.clientX;
        }
      };

      // ── Helper: create the ghost element ──
      const createGhost = (sourceEl: HTMLElement): HTMLElement => {
        const rect = sourceEl.getBoundingClientRect();
        const clone = sourceEl.cloneNode(true) as HTMLElement;
        clone.className = `${classPrefix}-item ${ghostClass}`;
        clone.removeAttribute("data-index");
        clone.style.cssText = `position:fixed;pointer-events:none;z-index:10000;width:${rect.width}px;height:${rect.height}px;left:${rect.left}px;top:${rect.top}px;transition:none;will-change:transform`;
        document.body.appendChild(clone);
        return clone;
      };

      // ── Helper: update ghost position ──
      const updateGhostPosition = (): void => {
        if (!ghost) return;
        if (hz) {
          ghost.style.left = `${pointerMain - ghostOffsetMain}px`;
          ghost.style.top = `${pointerCross - ghostOffsetCross}px`;
        } else {
          ghost.style.left = `${pointerCross - ghostOffsetCross}px`;
          ghost.style.top = `${pointerMain - ghostOffsetMain}px`;
        }
      };

      // ── Helper: viewport edges on main axis (avoids tuple allocation) ──
      let vpStart = 0;
      let vpEnd = 0;
      const readViewport = (): void => {
        const r = dom.viewport.getBoundingClientRect();
        if (hz) { vpStart = r.left; vpEnd = r.right; }
        else { vpStart = r.top; vpEnd = r.bottom; }
      };

      // ── Helper: determine drop index from pointer position ──
      const computeDropIndex = (): number => {
        const totalItems = ctx.dataManager.getTotal();
        if (totalItems === 0) return 0;

        // Use the ghost's LEADING EDGE based on drag direction:
        // - Dragging down/right → trailing edge of the ghost
        // - Dragging up/left → leading edge of the ghost
        readViewport();
        const scrollPos = ctx.scrollController.getScrollTop();
        const movingForward = pointerMain > pointerStartMain;
        const ghostEdge = pointerMain - ghostOffsetMain + (movingForward ? draggedItemSize : 0);
        const posInContent = ghostEdge - vpStart + scrollPos;

        // Walk visible items to find the insertion point
        const children = dom.items.children;
        let insertBefore = totalItems;

        for (let i = 0; i < children.length; i++) {
          const itemEl = children[i] as HTMLElement;
          const idx = getIndex(itemEl);
          if (idx < 0 || idx === dragIndex) continue;

          const itemMid = ctx.sizeCache.getOffset(idx) + ctx.sizeCache.getSize(idx) / 2;

          if (posInContent < itemMid) {
            insertBefore = idx > dragIndex ? idx - 1 : idx;
            break;
          }
        }

        if (insertBefore === totalItems) insertBefore = totalItems - 1;
        return Math.max(0, Math.min(insertBefore, totalItems - 1));
      };

      // ── Apply CSS transforms to shift items out of the way ──
      const applyShifts = (): void => {
        const children = dom.items.children;
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

          const finalOffset = Math.round(ctx.sizeCache.getOffset(idx) + shift);
          itemEl.style.transition = shiftTransition;
          itemEl.style.transform = `${prop}(${finalOffset}px)`;
        }
      };

      // ── Restore items to their sizeCache base offsets ──
      const clearShifts = (): void => {
        const children = dom.items.children;
        for (let i = 0; i < children.length; i++) {
          const itemEl = children[i] as HTMLElement;
          const idx = getIndex(itemEl);
          if (idx >= 0) {
            itemEl.style.transform = `${prop}(${Math.round(ctx.sizeCache.getOffset(idx))}px)`;
          }
          itemEl.style.transition = "";
        }
      };

      // ── Helper: update drop position and visual feedback ──
      const updateDropPosition = (): void => {
        const newDropIndex = computeDropIndex();
        if (newDropIndex === dropIndex) return;
        dropIndex = newDropIndex;
        applyShifts();
      };

      // ─�� Edge auto-scroll ──
      // When the pointer is in the edge zone, only scroll — don't update
      // the drop position. This avoids items shifting while scrolling,
      // which creates a jarring double-movement. Shifts resume when
      // the pointer leaves the edge zone (via onPointerMove).
      let inEdgeZone = false;

      const isPointerOutside = (): boolean => {
        readViewport();
        return pointerMain < vpStart || pointerMain > vpEnd;
      };

      const startEdgeScroll = (): void => {
        const tick = (): void => {
          if (!sorting) return;

          readViewport();
          let delta = 0;

          // Quadratic ramp: gentle at zone boundary, aggressive at the edge.
          // Beyond the viewport, speed grows further but is capped at 3x.
          const maxT = 3;
          const distFromStart = pointerMain - vpStart;
          const distFromEnd = vpEnd - pointerMain;
          if (distFromStart < edgeScrollZone) {
            const t = Math.min(maxT, 1 - distFromStart / edgeScrollZone);
            delta = -edgeScrollSpeed * t * t;
          } else if (distFromEnd < edgeScrollZone) {
            const t = Math.min(maxT, 1 - distFromEnd / edgeScrollZone);
            delta = edgeScrollSpeed * t * t;
          }

          const outside = isPointerOutside();

          if (delta !== 0) {
            const currentScroll = ctx.scrollController.getScrollTop();
            const containerSize = hz ? dom.viewport.clientWidth : dom.viewport.clientHeight;
            const maxScroll = ctx.sizeCache.getTotalSize() - containerSize;
            const atLimit = (delta < 0 && currentScroll <= 0)
              || (delta > 0 && currentScroll >= maxScroll);

            if (atLimit) {
              inEdgeZone = outside;
            } else {
              inEdgeZone = true;
              ctx.scrollController.scrollTo(currentScroll + delta);
            }
          } else {
            inEdgeZone = outside;
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

      // ── Cleanup drag state ──
      // When `skipRender` is true, the consumer's setItems() already
      // triggered a force render — calling clearShifts + forceRender
      // again would be redundant and destructive (ctx.forceRender
      // passes empty selection, causing selected items to blink).
      const cleanupDrag = (skipRender = false): void => {
        sorting = false;
        dragInitiated = false;

        if (ghost && ghost.parentNode) ghost.remove();
        ghost = null;

        if (draggedElement) {
          draggedElement.style.opacity = "";
          draggedElement.style.pointerEvents = "";
          draggedElement = null;
        }

        if (!skipRender) clearShifts();
        stopEdgeScroll();
        dom.root.classList.remove(sortingClass);
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerCancel);
        if (!skipRender) ctx.forceRender();
      };

      // ── Finalize a successful sort ──
      // Suppress transitions, remove sorting class, emit sort:end,
      // then restore transitions in the next frame.
      const finalizeDrop = (fromIndex: number, toIndex: number): void => {
        if (draggedElement) {
          draggedElement.style.opacity = "";
          draggedElement.style.pointerEvents = "";
        }
        // Suppress ALL transitions before class/style changes.
        // Base vlist.css has `transition: opacity 150ms` on .vlist-item —
        // without this, removing .vlist--sorting triggers a visible fade.
        setTransitions("none");
        dom.root.classList.remove(sortingClass);
        // Consumer calls setItems() which triggers a force render
        // that corrects all transforms and templates.
        emitter.emit("sort:end", { fromIndex, toIndex });
        cleanupDrag(true);
        requestAnimationFrame(() => setTransitions(""));
      };

      // ── Pointer event handlers ──
      const onPointerDown = (event: PointerEvent): void => {
        if (ctx.state.isDestroyed) return;
        if (sorting) return;
        if (event.button !== 0) return;

        const target = event.target as HTMLElement;

        if (handleSelector) {
          if (!target.closest(handleSelector)) return;
        }

        const itemEl = target.closest("[data-index]") as HTMLElement | null;
        if (!itemEl) return;

        const index = getIndex(itemEl);
        if (index < 0) return;

        readPointer(event);
        pointerStartMain = pointerMain;
        dragIndex = index;
        dragInitiated = false;
        draggedElement = itemEl;

        // Compute ghost offset (pointer position relative to item top-left)
        const rect = itemEl.getBoundingClientRect();
        if (hz) {
          ghostOffsetMain = event.clientX - rect.left;
          ghostOffsetCross = event.clientY - rect.top;
        } else {
          ghostOffsetMain = event.clientY - rect.top;
          ghostOffsetCross = event.clientX - rect.left;
        }

        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
        document.addEventListener("pointercancel", onPointerCancel);
      };

      const onPointerMove = (event: PointerEvent): void => {
        readPointer(event);

        if (!dragInitiated) {
          const dx = event.clientX - (hz ? pointerStartMain : pointerCross);
          const dy = event.clientY - (hz ? pointerCross : pointerStartMain);
          if (Math.sqrt(dx * dx + dy * dy) < dragThreshold) return;

          dragInitiated = true;
          sorting = true;
          dropIndex = dragIndex;

          dom.root.classList.add(sortingClass);
          draggedItemSize = ctx.sizeCache.getSize(dragIndex);

          if (draggedElement) {
            ghost = createGhost(draggedElement);
            draggedElement.style.opacity = "0";
            draggedElement.style.pointerEvents = "none";
          }

          emitter.emit("sort:start", { index: dragIndex });
          startEdgeScroll();
        }

        if (sorting) {
          event.preventDefault();
          updateGhostPosition();
          if (!inEdgeZone) {
            updateDropPosition();
          } else if (isPointerOutside()) {
            if (dropIndex !== dragIndex) {
              dropIndex = dragIndex;
              clearShifts();
            }
          }
        }
      };

      // ── Animate ghost to drop target, then finalize ──
      const animateDrop = (fromIndex: number, toIndex: number): void => {
        const posChanged = fromIndex !== toIndex && fromIndex >= 0 && toIndex >= 0;

        if (!ghost) {
          if (posChanged) finalizeDrop(fromIndex, toIndex);
          else cleanupDrag();
          return;
        }

        // Compute where the drop slot is on screen
        const vpRect = dom.viewport.getBoundingClientRect();
        const scrollPos = ctx.scrollController.getScrollTop();
        const targetOffset = ctx.sizeCache.getOffset(toIndex);

        const duration = shiftDuration > 0 ? shiftDuration : 150;
        ghost.style.transition = `left ${duration}ms ease, top ${duration}ms ease`;

        if (hz) {
          ghost.style.left = `${vpRect.left - dom.viewport.scrollLeft + targetOffset - scrollPos}px`;
          ghost.style.top = `${vpRect.top}px`;
        } else {
          ghost.style.left = `${vpRect.left}px`;
          ghost.style.top = `${vpRect.top + targetOffset - scrollPos}px`;
        }

        let settled = false;
        const onEnd = (): void => {
          if (settled) return;
          settled = true;
          ghost?.removeEventListener("transitionend", onEnd);
          if (posChanged) finalizeDrop(fromIndex, toIndex);
          else cleanupDrag();
        };

        ghost.addEventListener("transitionend", onEnd);
        setTimeout(onEnd, duration + 50);
      };

      const onPointerUp = (event: PointerEvent): void => {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerCancel);

        if (!dragInitiated) {
          draggedElement = null;
          return;
        }

        event.preventDefault();
        stopEdgeScroll();
        animateDrop(dragIndex, dropIndex);
      };

      const onPointerCancel = (): void => {
        cleanupDrag();
      };

      dom.items.addEventListener("pointerdown", onPointerDown);

      ctx.destroyHandlers.push(() => {
        cleanupDrag();
        dom.items.removeEventListener("pointerdown", onPointerDown);
      });
    },
  };
};
