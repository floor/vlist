/**
 * vlist/sortable - Builder Feature
 * Drag-and-drop reordering for virtual lists.
 *
 * Priority: 55 (runs after selection at 50, before scrollbar at 60)
 *
 * What it wires:
 * - Pointer event handlers on the items container for drag initiation
 * - Creates a drag ghost element that follows the pointer
 * - Two visual feedback modes:
 *   - `liveReorder: true` (default) — items shift via CSS transforms to make room
 *   - `liveReorder: false` — a static placeholder gap marks the drop position
 * - Auto-scrolls when dragging near viewport edges
 * - Emits sort:start and sort:end events
 *
 * The feature is purely visual during drag — it does NOT reorder data.
 * On drop, it emits a `sort:end` event with `{ fromIndex, toIndex }`.
 * The consumer is responsible for reordering their data array and
 * calling `setItems()` with the new order.
 *
 * IMPORTANT: vlist positions items via `style.transform: translateY(offset)`.
 * The live-reorder shift must ADD to that existing offset, not replace it.
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
   * CSS class added to the placeholder gap (default: 'vlist-sort-placeholder').
   * Only used when `liveReorder` is false.
   */
  placeholderClass?: string;

  /**
   * Enable live reorder mode (default: true).
   *
   * When true, visible items shift out of the way as you drag — like iOS
   * list reordering. Items slide via CSS transforms to make room for the
   * dragged item at its current hover position.
   *
   * When false, a static placeholder element marks the drop position.
   */
  liveReorder?: boolean;

  /**
   * Transition duration for item shift animations in milliseconds (default: 150).
   * Only used when `liveReorder` is true. Set to 0 for instant shifts.
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
  const placeholderClass = config?.placeholderClass ?? "vlist-sort-placeholder";
  const liveReorder = config?.liveReorder ?? true;
  const shiftDuration = config?.shiftDuration ?? 150;
  const edgeScrollZone = config?.edgeScrollZone ?? 40;
  const edgeScrollSpeed = config?.edgeScrollSpeed ?? 8;
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
      let placeholder: HTMLElement | null = null;
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
        return parseInt(el.dataset.index ?? "-1", 10);
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
          "opacity:0.8",
          "transition:none",
          "will-change:transform",
        ].join(";");
        document.body.appendChild(clone);
        return clone;
      };

      // ── Helper: create the placeholder element (static mode only) ──
      const createPlaceholder = (size: number): HTMLElement => {
        const el = document.createElement("div");
        el.className = `${classPrefix}-sort-placeholder ${placeholderClass}`;
        if (horizontal) {
          el.style.cssText = `width:${size}px;height:100%;flex-shrink:0`;
        } else {
          el.style.cssText = `height:${size}px;width:100%`;
        }
        return el;
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

        // Convert pointer to content-relative coordinate
        const viewportRect = dom.viewport.getBoundingClientRect();
        const scrollPos = ctx.scrollController.getScrollTop();
        const pointerInContent = horizontal
          ? pointerCurrentX - viewportRect.left + dom.viewport.scrollLeft + scrollPos
          : pointerCurrentY - viewportRect.top + scrollPos;

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

      // ── Live reorder: apply CSS transforms to shift items ──
      // vlist positions items via style.transform = translateY(offset).
      // We must READ the base offset from sizeCache and ADD the shift,
      // not overwrite the transform with just the shift value.
      const applyShifts = (): void => {
        const itemElements = dom.items.querySelectorAll("[data-index]");
        const shiftPx = draggedItemSize;
        const transition = shiftDuration > 0
          ? `transform ${shiftDuration}ms ease`
          : "none";
        const prop = horizontal ? "translateX" : "translateY";

        for (let i = 0; i < itemElements.length; i++) {
          const itemEl = itemElements[i] as HTMLElement;
          const idx = getIndex(itemEl);
          if (idx < 0) continue;

          // The dragged element is hidden — skip it
          if (idx === dragIndex) continue;

          // Determine if this item needs to shift.
          // When dragging DOWN (dropIndex > dragIndex):
          //   Items between (dragIndex, dropIndex] shift UP by one item size
          // When dragging UP (dropIndex < dragIndex):
          //   Items between [dropIndex, dragIndex) shift DOWN by one item size
          let shift = 0;
          if (dropIndex > dragIndex) {
            if (idx > dragIndex && idx <= dropIndex) {
              shift = -shiftPx;
            }
          } else if (dropIndex < dragIndex) {
            if (idx >= dropIndex && idx < dragIndex) {
              shift = shiftPx;
            }
          }

          // Read the item's base offset from sizeCache and add shift
          const baseOffset = ctx.sizeCache.getOffset(idx);
          const finalOffset = Math.round(baseOffset + shift);

          itemEl.style.transition = transition;
          itemEl.style.transform = `${prop}(${finalOffset}px)`;
        }
      };

      // ── Clear all CSS transforms from items ──
      // Restore each item to its sizeCache base offset (what vlist would set)
      const clearShifts = (): void => {
        const itemElements = dom.items.querySelectorAll("[data-index]");
        const prop = horizontal ? "translateX" : "translateY";
        for (let i = 0; i < itemElements.length; i++) {
          const itemEl = itemElements[i] as HTMLElement;
          const idx = getIndex(itemEl);
          if (idx >= 0) {
            const baseOffset = ctx.sizeCache.getOffset(idx);
            itemEl.style.transform = `${prop}(${Math.round(baseOffset)}px)`;
          }
          itemEl.style.transition = "";
        }
      };

      // ── Helper: update drop position and visual feedback ──
      const updateDropPosition = (): void => {
        const newDropIndex = computeDropIndex();
        if (newDropIndex === dropIndex) return;
        dropIndex = newDropIndex;

        if (liveReorder) {
          applyShifts();
        } else {
          updatePlaceholderPosition();
        }
      };

      // ── Static mode: update placeholder position in DOM ──
      const updatePlaceholderPosition = (): void => {
        if (!placeholder) return;

        const itemElements = dom.items.querySelectorAll("[data-index]");
        let insertBeforeEl: HTMLElement | null = null;

        for (let i = 0; i < itemElements.length; i++) {
          const itemEl = itemElements[i] as HTMLElement;
          const idx = getIndex(itemEl);
          const effectiveTarget = dropIndex >= dragIndex ? dropIndex + 1 : dropIndex;
          if (idx === effectiveTarget) {
            insertBeforeEl = itemEl;
            break;
          }
        }

        if (insertBeforeEl) {
          dom.items.insertBefore(placeholder, insertBeforeEl);
        } else {
          dom.items.appendChild(placeholder);
        }
      };

      // ── Edge auto-scroll ──
      const startEdgeScroll = (): void => {
        const tick = (): void => {
          if (!sorting) return;

          const viewportRect = dom.viewport.getBoundingClientRect();
          let delta = 0;

          if (horizontal) {
            const distFromStart = pointerCurrentX - viewportRect.left;
            const distFromEnd = viewportRect.right - pointerCurrentX;
            if (distFromStart < edgeScrollZone && distFromStart >= 0) {
              delta = -edgeScrollSpeed * (1 - distFromStart / edgeScrollZone);
            } else if (distFromEnd < edgeScrollZone && distFromEnd >= 0) {
              delta = edgeScrollSpeed * (1 - distFromEnd / edgeScrollZone);
            }
          } else {
            const distFromTop = pointerCurrentY - viewportRect.top;
            const distFromBottom = viewportRect.bottom - pointerCurrentY;
            if (distFromTop < edgeScrollZone && distFromTop >= 0) {
              delta = -edgeScrollSpeed * (1 - distFromTop / edgeScrollZone);
            } else if (distFromBottom < edgeScrollZone && distFromBottom >= 0) {
              delta = edgeScrollSpeed * (1 - distFromBottom / edgeScrollZone);
            }
          }

          if (delta !== 0) {
            const currentScroll = ctx.scrollController.getScrollTop();
            ctx.scrollController.scrollTo(currentScroll + delta);
            updateDropPosition();
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
      const cleanupDrag = (): void => {
        sorting = false;
        dragInitiated = false;

        if (ghost && ghost.parentNode) {
          ghost.remove();
        }
        ghost = null;

        if (placeholder && placeholder.parentNode) {
          placeholder.remove();
        }
        placeholder = null;

        if (draggedElement) {
          draggedElement.style.opacity = "";
          draggedElement.style.pointerEvents = "";
          draggedElement = null;
        }

        if (liveReorder) {
          clearShifts();
        }

        stopEdgeScroll();

        dom.root.classList.remove(`${classPrefix}--sorting`);

        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerCancel);

        // Re-render to restore clean DOM state
        ctx.forceRender();
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

          // Static mode: create placeholder
          if (!liveReorder) {
            placeholder = createPlaceholder(draggedItemSize);
          }

          // Emit sort:start
          emitter.emit("sort:start", { index: dragIndex });

          // Start edge scrolling
          startEdgeScroll();
        }

        if (sorting) {
          event.preventDefault();
          updateGhostPosition();
          updateDropPosition();
        }
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

        const fromIndex = dragIndex;
        const toIndex = dropIndex;

        cleanupDrag();

        // Emit sort:end with the reorder intent
        if (fromIndex !== toIndex && fromIndex >= 0 && toIndex >= 0) {
          emitter.emit("sort:end", { fromIndex, toIndex });
        }
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
