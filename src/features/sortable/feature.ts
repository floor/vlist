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
      const horizontal = resolvedConfig.horizontal;

      // Pre-compute reusable values
      const prop = horizontal ? "translateX" : "translateY";
      const shiftTransition = shiftDuration > 0
        ? `transform ${shiftDuration}ms ease`
        : "none";

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

      // Offset from pointer to top-left corner of dragged item
      let ghostOffsetX = 0;
      let ghostOffsetY = 0;

      // ── Register public method ──
      ctx.methods.set("isSorting", (): boolean => sorting);

      // ── Helper: find the item element from an event target ──
      const findItemElement = (target: HTMLElement): HTMLElement | null => {
        return target.closest("[data-index]") as HTMLElement | null;
      };

      // ── Helper: get index from item element ──
      const getIndex = (el: HTMLElement): number => {
        const attr = el.dataset.index;
        return attr === undefined ? -1 : +attr;
      };

      // ── Helper: create the ghost element ──
      const createGhost = (sourceEl: HTMLElement): HTMLElement => {
        const rect = sourceEl.getBoundingClientRect();
        const clone = sourceEl.cloneNode(true) as HTMLElement;
        clone.className = `${classPrefix}-item ${ghostClass}`;
        clone.removeAttribute("data-index");
        clone.style.cssText = [
          "position:fixed",
          "pointer-events:none",
          "z-index:10000",
          `width:${rect.width}px`,
          `height:${rect.height}px`,
          `left:${rect.left}px`,
          `top:${rect.top}px`,
          "transition:none",
          "will-change:transform",
        ].join(";");
        document.body.appendChild(clone);
        return clone;
      };

      // ── Helper: update ghost position ──
      const updateGhostPosition = (): void => {
        if (!ghost) return;
        const x = pointerCurrentX - ghostOffsetX;
        const y = pointerCurrentY - ghostOffsetY;
        ghost.style.left = `${x}px`;
        ghost.style.top = `${y}px`;
      };

      // ── Helper: determine drop index from pointer position ──
      const computeDropIndex = (): number => {
        const totalItems = ctx.dataManager.getTotal();
        if (totalItems === 0) return 0;

        // Use the ghost's LEADING EDGE based on drag direction:
        // - Dragging down → bottom edge of the ghost
        // - Dragging up → top edge of the ghost
        // The shift triggers when this edge crosses the midpoint of a target item.
        const viewportRect = dom.viewport.getBoundingClientRect();
        const scrollPos = ctx.scrollController.getScrollTop();
        const movingDown = horizontal
          ? pointerCurrentX > pointerStartX
          : pointerCurrentY > pointerStartY;
        const ghostEdge = horizontal
          ? pointerCurrentX - ghostOffsetX + (movingDown ? draggedItemSize : 0)
          : pointerCurrentY - ghostOffsetY + (movingDown ? draggedItemSize : 0);
        const pointerInContent = horizontal
          ? ghostEdge - viewportRect.left + dom.viewport.scrollLeft + scrollPos
          : ghostEdge - viewportRect.top + scrollPos;

        // Walk visible items to find the insertion point
        const itemElements = dom.items.querySelectorAll("[data-index]");
        let insertBefore = totalItems; // default: end of list

        for (let i = 0; i < itemElements.length; i++) {
          const itemEl = itemElements[i] as HTMLElement;
          const idx = getIndex(itemEl);
          if (idx < 0) continue;

          // Skip the dragged item itself
          if (idx === dragIndex) continue;

          // Use the original position from sizeCache (not the visual position
          // which may be shifted by transforms)
          const itemOffset = ctx.sizeCache.getOffset(idx);
          const itemSize = ctx.sizeCache.getSize(idx);
          const itemMid = itemOffset + itemSize / 2;

          if (pointerInContent < itemMid) {
            insertBefore = idx > dragIndex ? idx - 1 : idx;
            break;
          }
        }

        // If we iterated past all items, drop at end
        if (insertBefore === totalItems) {
          insertBefore = totalItems - 1;
        }

        return Math.max(0, Math.min(insertBefore, totalItems - 1));
      };

      // ── Apply CSS transforms to shift items out of the way ──
      // vlist positions items via style.transform = translateY(offset).
      // We must READ the base offset from sizeCache and ADD the shift,
      // not overwrite the transform with just the shift value.
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

      // ── Edge auto-scroll ──
      // When the pointer is in the edge zone, only scroll — don't update
      // the drop position. This avoids items shifting while scrolling,
      // which creates a jarring double-movement. Shifts resume when
      // the pointer leaves the edge zone (via onPointerMove).
      let inEdgeZone = false;

      const isPointerOutsideViewport = (): boolean => {
        const viewportRect = dom.viewport.getBoundingClientRect();
        if (horizontal) {
          return pointerCurrentX < viewportRect.left || pointerCurrentX > viewportRect.right;
        }
        return pointerCurrentY < viewportRect.top || pointerCurrentY > viewportRect.bottom;
      };

      const startEdgeScroll = (): void => {
        const tick = (): void => {
          if (!sorting) return;

          const viewportRect = dom.viewport.getBoundingClientRect();
          let delta = 0;

          // Quadratic ramp: gentle at zone boundary, aggressive at the edge.
          // Beyond the viewport, speed grows further but is capped at 3x.
          const maxT = 3;
          if (horizontal) {
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
            const currentScroll = ctx.scrollController.getScrollTop();
            const maxScroll = ctx.sizeCache.getTotalSize() - (horizontal
              ? dom.viewport.clientWidth
              : dom.viewport.clientHeight);
            const atLimit = (delta < 0 && currentScroll <= 0)
              || (delta > 0 && currentScroll >= maxScroll);

            if (atLimit) {
              // At scroll limit: only allow shifts if pointer is inside viewport
              inEdgeZone = outsideViewport;
            } else {
              inEdgeZone = true;
              ctx.scrollController.scrollTo(currentScroll + delta);
            }
          } else {
            // Not in edge zone but pointer could still be outside viewport
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

      // ── Cleanup drag state ──
      // When `skipRender` is true, the consumer's setItems() already
      // triggered a force render — calling clearShifts + forceRender
      // again would be redundant and destructive (ctx.forceRender
      // passes empty selection, causing selected items to blink).
      const cleanupDrag = (skipRender = false): void => {
        sorting = false;
        dragInitiated = false;

        if (ghost && ghost.parentNode) {
          ghost.remove();
        }
        ghost = null;

        if (draggedElement) {
          draggedElement.style.opacity = "";
          draggedElement.style.pointerEvents = "";
          draggedElement = null;
        }

        if (!skipRender) {
          clearShifts();
        }
        stopEdgeScroll();

        dom.root.classList.remove(`${classPrefix}--sorting`);

        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerCancel);

        if (!skipRender) {
          // Re-render to restore clean DOM state
          ctx.forceRender();
        }
      };

      // ── Pointer event handlers ──
      const onPointerDown = (event: PointerEvent): void => {
        if (ctx.state.isDestroyed) return;
        if (sorting) return;
        // Only primary button
        if (event.button !== 0) return;

        const target = event.target as HTMLElement;

        // If handle is configured, check that the target matches
        if (handleSelector) {
          const handle = target.closest(handleSelector);
          if (!handle) return;
        }

        const itemEl = findItemElement(target);
        if (!itemEl) return;

        const index = getIndex(itemEl);
        if (index < 0) return;

        // Store initial pointer position for threshold check
        pointerStartX = event.clientX;
        pointerStartY = event.clientY;
        pointerCurrentX = event.clientX;
        pointerCurrentY = event.clientY;
        dragIndex = index;
        dragInitiated = false;
        draggedElement = itemEl;

        // Compute ghost offset (pointer position relative to item top-left)
        const rect = itemEl.getBoundingClientRect();
        ghostOffsetX = event.clientX - rect.left;
        ghostOffsetY = event.clientY - rect.top;

        // Attach move/up listeners to document for reliable tracking
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
        document.addEventListener("pointercancel", onPointerCancel);
      };

      const onPointerMove = (event: PointerEvent): void => {
        pointerCurrentX = event.clientX;
        pointerCurrentY = event.clientY;

        if (!dragInitiated) {
          // Check threshold
          const dx = pointerCurrentX - pointerStartX;
          const dy = pointerCurrentY - pointerStartY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < dragThreshold) return;

          // Threshold crossed — start the drag
          dragInitiated = true;
          sorting = true;
          dropIndex = dragIndex;

          dom.root.classList.add(`${classPrefix}--sorting`);

          // Cache the dragged item's size for shift calculations
          draggedItemSize = ctx.sizeCache.getSize(dragIndex);

          // Create ghost
          if (draggedElement) {
            ghost = createGhost(draggedElement);

            // Hide the original element
            draggedElement.style.opacity = "0";
            draggedElement.style.pointerEvents = "none";
          }

          // Emit sort:start
          emitter.emit("sort:start", { index: dragIndex });

          // Start edge scrolling
          startEdgeScroll();
        }

        if (sorting) {
          event.preventDefault();
          updateGhostPosition();
          // Don't update drop position while edge-scrolling —
          // avoids jarring shift + scroll double-movement
          if (!inEdgeZone) {
            updateDropPosition();
          } else if (isPointerOutsideViewport()) {
            // Clear shifts when pointer leaves viewport
            if (dropIndex !== dragIndex) {
              dropIndex = dragIndex;
              clearShifts();
            }
          }
        }
      };

      // ── Animate ghost to drop target, then finalize ──
      const animateDrop = (fromIndex: number, toIndex: number): void => {
        if (!ghost) {
          const posChanged = fromIndex !== toIndex && fromIndex >= 0 && toIndex >= 0;
          if (posChanged) {
            // Suppress transitions, then let sort:end → setItems → force render
            const children = dom.items.children;
            for (let i = 0; i < children.length; i++) {
              (children[i] as HTMLElement).style.transition = "none";
            }
            dom.root.classList.remove(`${classPrefix}--sorting`);
            emitter.emit("sort:end", { fromIndex, toIndex });
          }
          cleanupDrag(posChanged);
          if (posChanged) {
            requestAnimationFrame(() => {
              const children = dom.items.children;
              for (let i = 0; i < children.length; i++) {
                (children[i] as HTMLElement).style.transition = "";
              }
            });
          }
          return;
        }

        // Compute where the drop slot is on screen.
        // The target position is the sizeCache offset for `toIndex`,
        // converted to viewport-relative coordinates.
        // Animate both axes so the ghost slides to the exact target position.
        const viewportRect = dom.viewport.getBoundingClientRect();
        const scrollPos = ctx.scrollController.getScrollTop();
        const targetOffset = ctx.sizeCache.getOffset(toIndex);

        const duration = shiftDuration > 0 ? shiftDuration : 150;
        ghost.style.transition = `left ${duration}ms ease, top ${duration}ms ease`;

        if (horizontal) {
          ghost.style.left = `${viewportRect.left - dom.viewport.scrollLeft + targetOffset - scrollPos}px`;
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
          const positionChanged = fromIndex !== toIndex && fromIndex >= 0 && toIndex >= 0;

          if (positionChanged) {
            // Restore the dragged element before emitting sort:end
            if (draggedElement) {
              draggedElement.style.opacity = "";
              draggedElement.style.pointerEvents = "";
            }

            // Suppress ALL transitions on items before any class/style changes.
            // Base vlist.css has `transition: opacity 150ms` on .vlist-item.
            // Example CSS may add `.vlist--sorting .vlist-item { opacity: 0.85 }`.
            // Without suppression, removing .vlist--sorting triggers a visible
            // opacity fade. We also suppress transform transitions so the force
            // render (triggered by the consumer's setItems) snaps positions
            // instantly instead of animating from the shifted offsets.
            const children = dom.items.children;
            for (let i = 0; i < children.length; i++) {
              (children[i] as HTMLElement).style.transition = "none";
            }

            // Now safe to remove sorting class — transitions are suppressed
            dom.root.classList.remove(`${classPrefix}--sorting`);

            // Emit sort:end — consumer calls setItems() which triggers
            // a force render that corrects all transforms and templates.
            // No need to call clearShifts() — the force render handles it.
            emitter.emit("sort:end", { fromIndex, toIndex });
          }
          cleanupDrag(positionChanged);

          // Re-enable transitions on the next frame. By now the browser
          // has committed the final styles, so restoring transitions
          // won't re-trigger any animations.
          if (positionChanged) {
            requestAnimationFrame(() => {
              const children = dom.items.children;
              for (let i = 0; i < children.length; i++) {
                (children[i] as HTMLElement).style.transition = "";
              }
            });
          }
        };

        ghost.addEventListener("transitionend", onEnd);

        // Safety fallback — if transitionend doesn't fire (e.g. ghost already at target)
        setTimeout(onEnd, duration + 50);
      };

      const onPointerUp = (event: PointerEvent): void => {
        if (!dragInitiated) {
          // Never crossed threshold — just cleanup listeners
          document.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerup", onPointerUp);
          document.removeEventListener("pointercancel", onPointerCancel);
          draggedElement = null;
          return;
        }

        event.preventDefault();

        // Stop tracking pointer and edge scroll, but keep ghost visible
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerCancel);
        stopEdgeScroll();

        animateDrop(dragIndex, dropIndex);
      };

      const onPointerCancel = (): void => {
        cleanupDrag();
      };

      // ── Attach pointerdown to items container ──
      dom.items.addEventListener("pointerdown", onPointerDown);

      // ── Destroy cleanup ──
      ctx.destroyHandlers.push(() => {
        cleanupDrag();
        dom.items.removeEventListener("pointerdown", onPointerDown);
      });
    },
  };
};
