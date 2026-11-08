/**
 * vlist/table — columnReorder() feature (#113)
 *
 * Interactive and programmatic column reordering for `table({ features: [columnReorder()] })`:
 * - Pointer drag on header cells (5px threshold, drop indicator, edge auto-scroll,
 *   trailing click/sort suppression)
 * - Keyboard `Alt+ArrowLeft` / `Alt+ArrowRight` on focused header cell (retaining focus)
 * - Programmatic `moveColumn(keyOrFromIndex, toIndex)` and `getColumnOrder()`
 * - In-place header & body cell permutation without re-running `cell()` templates
 * - Preserves sort state (`aria-sort`, sort indicators, `getSorts()`) and clamps
 *   within pin partitions (`[...left, ...unpinned, ...right]`) when `columnPin()` is active.
 *
 * Mounted only through `table({ features: [columnReorder()] })`. Not imported by
 * `table()`, so a plain table pays nothing for it.
 */

import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import type {
  TableColumn,
  TableLayout,
  ResolvedColumn,
  ColumnReorderEvent,
} from "./types";
import type { TableFeature } from "./feature";

// =============================================================================
// Constants & Types
// =============================================================================

const INTERACTIVE = "a[href],button,input,select,textarea,[tabindex]";
const MIN_DRAG_DELTA = 5;
const EDGE_ZONE = 40;
const MAX_SCROLL_SPEED = 15;

export interface ColumnReorderConfig {
  /** Column keys that cannot be reordered (supplements TableColumn.reorderable: false) */
  disabled?: string[];
}

/** Methods the columnReorder feature adds to the list instance. */
export interface ColumnReorderMethods {
  /**
   * Move a column from `keyOrFromIndex` to `toIndex` (clamped to its pin
   * partition when `columnPin()` is active). Present on the list when
   * `columnReorder()` is in `table({ features })`.
   */
  moveColumn(keyOrFromIndex: string | number, toIndex: number): void;

  /** Current ordered column keys (`[...left, ...unpinned, ...right]`). */
  getColumnOrder(): string[];
}

interface PinStateHook<T extends VListItem> {
  getBaseColumns: () => TableColumn<T>[];
  getLeftOrder: () => string[];
  getRightOrder: () => string[];
  getPins: () => Record<string, "left" | "right">;
  syncAllPins: () => void;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Reorder table columns by pointer drag, `Alt+ArrowLeft` / `Alt+ArrowRight`,
 * or `list.moveColumn()`.
 *
 * Pass the result to `table({ features: [columnReorder()] })`. When combined
 * with `columnPin()` (in either array order), `_getColumnPinState` is resolved
 * lazily on each move so columns stay within their left, unpinned, or right
 * partition.
 */
export function columnReorder<T extends VListItem = VListItem>(
  config?: ColumnReorderConfig,
): TableFeature<T, ColumnReorderMethods> {
  const disabledSet = new Set(config?.disabled ?? []);

  return {
    name: "columnReorder",

    attach(plugin: VListPlugin<T>): void {
      const prevSetup = plugin.setup;
      plugin.setup = (ctx: PluginContext<T>): void => {
        prevSetup?.call(plugin, ctx);
        const layout = (
          ctx.hooks.get("_getTableLayout") as (() => TableLayout<T> | null) | undefined
        )?.();
        if (!layout) return;
        mount(ctx, layout);
      };
    },
  };

  function mount(ctx: PluginContext<T>, layout: TableLayout<T>): void {
    const { dom, emitter } = ctx;
    const { classPrefix } = ctx.config;

    const rootReorderingClass = `${classPrefix}--col-reordering`;
    const hdrDraggingClass = `${classPrefix}-table-header-cell--dragging`;
    const dropIndicatorClass = `${classPrefix}-table-drop-indicator`;
    const reorderLiveClass = `${classPrefix}-table-reorder-live`;
    const scrollEvent = new Event("scroll");

    let liveEl: HTMLElement | null = null;

    // Pre-allocated partition bounds scalars (zero per-move object allocation)
    let partMin = 0;
    let partMax = 0;
    let partKind: "left" | "unpinned" | "right" = "unpinned";
    let partLeftCount = 0;
    let partRightCount = 0;

    const getPinState = (): PinStateHook<T> | undefined => {
      const fn = ctx.hooks.get("_getColumnPinState") as
        | (() => PinStateHook<T>)
        | undefined;
      return fn?.();
    };

    const isReorderable = (col: ResolvedColumn<T> | undefined): boolean =>
      Boolean(col && col.def.reorderable !== false && !disabledSet.has(col.def.key));

    const getColLabel = (col: ResolvedColumn<T>): string => {
      const rawLabel = col.def.label;
      return (typeof rawLabel === "string" ? rawLabel : rawLabel?.textContent) || col.def.key;
    };

    const announce = (text: string): void => {
      const rowgroup = dom.root.querySelector<HTMLElement>('[role="rowgroup"]');
      if (!rowgroup) return;
      if (!liveEl) {
        liveEl = document.createElement("div");
        liveEl.className = reorderLiveClass;
        liveEl.style.cssText =
          "position:absolute;width:1px;height:1px;padding:0;margin:-1px;" +
          "overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
        liveEl.setAttribute("aria-live", "polite");
        liveEl.setAttribute("role", "status");
        rowgroup.appendChild(liveEl);
      }
      liveEl.textContent = text;
    };

    const syncPartitionBounds = (
      colIndex: number,
      total: number,
      pinState?: PinStateHook<T>,
    ): void => {
      partLeftCount = pinState ? pinState.getLeftOrder().length : 0;
      partRightCount = pinState ? pinState.getRightOrder().length : 0;
      const rightStart = total - partRightCount;
      if (colIndex < partLeftCount) {
        partMin = 0;
        partMax = partLeftCount - 1;
        partKind = "left";
      } else if (partRightCount > 0 && colIndex >= rightStart) {
        partMin = rightStart;
        partMax = total - 1;
        partKind = "right";
      } else {
        partMin = partLeftCount;
        partMax = rightStart - 1;
        partKind = "unpinned";
      }
    };

    const getColumnOrder = (): string[] => layout.columns.map((c) => c.def.key);

    // ── Core In-Place Column Move ───────────────────────────────

    const moveColumn = (keyOrFromIndex: string | number, toIndex: number): void => {
      const cols = layout.columns as ResolvedColumn<T>[];
      const fromIndex =
        typeof keyOrFromIndex === "number"
          ? keyOrFromIndex
          : cols.findIndex((c) => c.def.key === keyOrFromIndex);
      if (fromIndex < 0 || fromIndex >= cols.length) return;

      const sourceCol = cols[fromIndex]!;
      if (!isReorderable(sourceCol)) return;

      const pinState = getPinState();
      syncPartitionBounds(fromIndex, cols.length, pinState);
      if (partMax < partMin) return;

      const clampedTo = Math.max(partMin, Math.min(partMax, toIndex));
      if (clampedTo === fromIndex) {
        if (toIndex !== fromIndex) {
          announce(`Cannot move ${getColLabel(sourceCol)} past ${partKind} boundary`);
        }
        return;
      }

      // 1. Permute layout.columns in place and recompute cumulative offsets
      const [movedCol] = cols.splice(fromIndex, 1);
      cols.splice(clampedTo, 0, movedCol!);
      let offset = 0;
      for (let i = 0; i < cols.length; i++) {
        cols[i]!.index = i;
        cols[i]!.offset = offset;
        offset += cols[i]!.width;
      }

      // 2. Keep columnPin state arrays synchronized when active
      if (pinState) {
        const rightStart = cols.length - partRightCount;
        if (partKind === "left") {
          const leftOrder = pinState.getLeftOrder();
          const [k] = leftOrder.splice(fromIndex, 1);
          leftOrder.splice(clampedTo, 0, k!);
        } else if (partKind === "right") {
          const rightOrder = pinState.getRightOrder();
          const [k] = rightOrder.splice(fromIndex - rightStart, 1);
          rightOrder.splice(clampedTo - rightStart, 0, k!);
        } else {
          const baseCols = pinState.getBaseColumns();
          const pins = pinState.getPins();
          let u = partLeftCount;
          for (let i = 0; i < baseCols.length; i++) {
            if (!pins[baseCols[i]!.key] && u < rightStart) {
              baseCols[i] = cols[u++]!.def;
            }
          }
        }
      }

      // 3. Reorder header cell in .vlist-table-header-scroll in place
      const headerScroll = dom.root.querySelector<HTMLElement>(
        `.${classPrefix}-table-header-scroll`,
      );
      if (headerScroll) {
        const hCells = headerScroll.children;
        const movedHeaderCell = hCells[fromIndex] as HTMLElement | undefined;
        const movedWasFocused =
          Boolean(movedHeaderCell && document.activeElement === movedHeaderCell);
        const activeTabCell = headerScroll.querySelector<HTMLElement>('[tabindex="0"]');

        if (movedHeaderCell) {
          const refNode =
            clampedTo >= hCells.length - 1
              ? null
              : hCells[clampedTo < fromIndex ? clampedTo : clampedTo + 1]!;
          headerScroll.insertBefore(movedHeaderCell, refNode);
        }

        for (let i = 0; i < hCells.length; i++) {
          const hc = hCells[i] as HTMLElement;
          hc.setAttribute("aria-colindex", String(i + 1));
          const handle = hc.querySelector<HTMLElement>(
            `.${classPrefix}-table-header-resize`,
          );
          if (handle) handle.dataset.resizeIndex = String(i);
        }

        if (movedWasFocused && movedHeaderCell) {
          movedHeaderCell.focus();
          movedHeaderCell.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        } else if (activeTabCell) {
          activeTabCell.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        }
      }

      // 4. Reorder body cells in rendered rows in place (0 template executions)
      const rows = dom.content.children;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r] as HTMLElement;
        if (row.getAttribute("role") === "presentation") continue;
        const rCells = row.children;
        const movedCell = rCells[fromIndex] as HTMLElement | undefined;
        if (movedCell) {
          const refNode =
            clampedTo >= rCells.length - 1
              ? null
              : rCells[clampedTo < fromIndex ? clampedTo : clampedTo + 1]!;
          row.insertBefore(movedCell, refNode);
        }
        for (let c = 0; c < rCells.length && c < cols.length; c++) {
          const cell = rCells[c] as HTMLElement;
          cell.style.left = `${cols[c]!.offset}px`;
          cell.style.width = `${cols[c]!.width}px`;
          cell.setAttribute("aria-colindex", String(c + 1));
        }
      }

      // 5. Re-apply pin boundary classes (--pin-left-last / --pin-right-first)
      pinState?.syncAllPins();

      // 6. Announce move in dedicated polite live region
      announce(`Moved ${getColLabel(movedCol!)} to position ${clampedTo + 1}`);

      // 7. Emit column:reorder
      emitter.emit("column:reorder", {
        key: movedCol!.def.key,
        fromIndex,
        toIndex: clampedTo,
        order: getColumnOrder(),
      } satisfies ColumnReorderEvent);
    };

    ctx.hooks.method("moveColumn", moveColumn);
    ctx.hooks.method("getColumnOrder", getColumnOrder);

    // ── Pointer Drag, Drop Indicator & Edge Auto-Scroll ─────────

    let dragCell: HTMLElement | null = null;
    let dragSourceIndex = -1;
    let dragTargetIndex = -1;
    let dragStartX = 0;
    let dragLastX = 0;
    let dragPointerId = -1;
    let dragViewportLeft = 0;
    let dragViewportWidth = 0;
    let lastIndicatorX = NaN;
    let dragActive = false;
    let suppressNextClick = false;
    let dropIndicator: HTMLElement | null = null;
    let scrollRafId = 0;

    const stopAutoScroll = (): void => {
      if (scrollRafId) {
        cancelAnimationFrame(scrollRafId);
        scrollRafId = 0;
      }
    };

    const ensureDropIndicator = (): HTMLElement => {
      if (!dropIndicator) {
        dropIndicator = document.createElement("div");
        dropIndicator.className = dropIndicatorClass;
        dropIndicator.setAttribute("role", "presentation");
        dropIndicator.setAttribute("aria-hidden", "true");
        dom.root.appendChild(dropIndicator);
      }
      dropIndicator.style.display = "";
      return dropIndicator;
    };

    const updateDropTarget = (clientX: number): void => {
      const cols = layout.columns;
      if (dragSourceIndex < 0 || dragSourceIndex >= cols.length) return;

      syncPartitionBounds(dragSourceIndex, cols.length, getPinState());

      const viewportWidth = dragViewportWidth;
      const localX = clientX - dragViewportLeft;
      const tableX =
        partKind === "left"
          ? localX
          : partKind === "right"
            ? localX + layout.totalWidth - viewportWidth
            : localX + dom.viewport.scrollLeft;

      let targetIdx = dragSourceIndex;
      for (let i = partMin; i <= partMax; i++) {
        const c = cols[i]!;
        const mid = c.offset + c.width / 2;
        if (i < dragSourceIndex && tableX < mid) {
          targetIdx = i;
          break;
        }
        if (i > dragSourceIndex && tableX >= mid) {
          targetIdx = i;
        }
      }

      dragTargetIndex = targetIdx;

      const indicator = ensureDropIndicator();
      const targetCol = cols[targetIdx]!;
      const boundaryTableX =
        targetIdx > dragSourceIndex
          ? targetCol.offset + targetCol.width
          : targetCol.offset;

      const rawIndicatorX =
        partKind === "left"
          ? boundaryTableX
          : partKind === "right"
            ? boundaryTableX - (layout.totalWidth - viewportWidth)
            : boundaryTableX - dom.viewport.scrollLeft;

      const indicatorX = Math.max(0, Math.min(viewportWidth - 2, rawIndicatorX));
      if (indicatorX !== lastIndicatorX) {
        lastIndicatorX = indicatorX;
        indicator.style.transform = `translateX(${indicatorX}px)`;
      }
    };

    const stepEdgeAutoScroll = (): void => {
      scrollRafId = 0;
      if (!dragActive || !dragCell) return;

      syncPartitionBounds(dragSourceIndex, layout.columns.length, getPinState());
      if (partKind !== "unpinned") return;

      const viewportWidth = dragViewportWidth;
      if (viewportWidth <= 0 || layout.totalWidth <= viewportWidth) return;

      const localX = dragLastX - dragViewportLeft;
      const maxScrollLeft = Math.max(0, layout.totalWidth - viewportWidth);

      let delta = 0;
      if (localX < EDGE_ZONE && dom.viewport.scrollLeft > 0) {
        const ratio = Math.min(1, Math.max(0, (EDGE_ZONE - localX) / EDGE_ZONE));
        delta = -Math.ceil(ratio * MAX_SCROLL_SPEED);
      } else if (
        localX > viewportWidth - EDGE_ZONE &&
        dom.viewport.scrollLeft < maxScrollLeft
      ) {
        const ratio = Math.min(
          1,
          Math.max(0, (localX - (viewportWidth - EDGE_ZONE)) / EDGE_ZONE),
        );
        delta = Math.ceil(ratio * MAX_SCROLL_SPEED);
      }

      if (delta !== 0) {
        const nextScroll = Math.max(
          0,
          Math.min(maxScrollLeft, dom.viewport.scrollLeft + delta),
        );
        if (nextScroll !== dom.viewport.scrollLeft) {
          dom.viewport.scrollLeft = nextScroll;
          dom.viewport.dispatchEvent(scrollEvent);
          updateDropTarget(dragLastX);
          scrollRafId = requestAnimationFrame(stepEdgeAutoScroll);
        }
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (!dragCell || (e.pointerId !== undefined && e.pointerId !== dragPointerId)) return;
      dragLastX = e.clientX;

      if (!dragActive) {
        if (Math.abs(e.clientX - dragStartX) < MIN_DRAG_DELTA) return;
        dragActive = true;
        try {
          dragCell.setPointerCapture?.(dragPointerId);
        } catch {}
        dom.root.classList.add(rootReorderingClass);
        dragCell.classList.add(hdrDraggingClass);
      }

      e.preventDefault();
      updateDropTarget(e.clientX);
      stopAutoScroll();
      stepEdgeAutoScroll();
    };

    const finishDrag = (commit: boolean): void => {
      if (!dragCell) return;
      const cell = dragCell;
      const wasActive = dragActive;
      const fromIdx = dragSourceIndex;
      const toIdx = dragTargetIndex;

      stopAutoScroll();
      cell.removeEventListener("pointermove", onPointerMove);
      cell.removeEventListener("pointerup", onPointerUp);
      cell.removeEventListener("pointercancel", onPointerCancel);
      cell.removeEventListener("lostpointercapture", onPointerCancel);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);

      if (wasActive) {
        try {
          cell.releasePointerCapture?.(dragPointerId);
        } catch {}
        dom.root.classList.remove(rootReorderingClass);
        cell.classList.remove(hdrDraggingClass);
        if (dropIndicator) dropIndicator.style.display = "none";
        suppressNextClick = true;
      }

      dragCell = null;
      dragSourceIndex = -1;
      dragTargetIndex = -1;
      dragPointerId = -1;
      lastIndicatorX = NaN;
      dragActive = false;

      if (commit && wasActive && fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
        moveColumn(fromIdx, toIdx);
      }
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (e.pointerId !== undefined && e.pointerId !== dragPointerId) return;
      finishDrag(true);
    };

    const onPointerCancel = (e: PointerEvent): void => {
      if (e.pointerId !== undefined && e.pointerId !== dragPointerId) return;
      finishDrag(false);
    };

    const onHeaderPointerDown = (e: PointerEvent): void => {
      if (dragCell) finishDrag(false);
      suppressNextClick = false;
      if (e.button !== 0) return;

      const target = e.target as HTMLElement | null;
      if (!target || target.dataset.resizeIndex) return;
      if (target.closest(`.${classPrefix}-table-header-resize`)) return;

      const cell = target.closest<HTMLElement>(`.${classPrefix}-table-header-cell`);
      if (!cell) return;

      const control = target.closest(INTERACTIVE);
      if (control && control !== cell) return;

      const key = cell.dataset.columnKey;
      if (!key) return;

      const cols = layout.columns;
      const colIndex = cols.findIndex((c) => c.def.key === key);
      if (colIndex < 0 || !isReorderable(cols[colIndex])) return;

      const rect = dom.viewport.getBoundingClientRect();
      dragViewportLeft = rect.left;
      dragViewportWidth = dom.viewport.clientWidth || rect.width || ctx.getState().crossSize;
      dragCell = cell;
      dragSourceIndex = colIndex;
      dragTargetIndex = colIndex;
      dragStartX = e.clientX;
      dragLastX = e.clientX;
      dragPointerId = e.pointerId;
      lastIndicatorX = NaN;
      dragActive = false;

      cell.addEventListener("pointermove", onPointerMove);
      cell.addEventListener("pointerup", onPointerUp);
      cell.addEventListener("pointercancel", onPointerCancel);
      cell.addEventListener("lostpointercapture", onPointerCancel);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
    };

    const onCaptureClick = (e: MouseEvent): void => {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    };

    // ── Keyboard Alt+ArrowLeft / Alt+ArrowRight ─────────────────

    const onRootKeyDownCapture = (e: KeyboardEvent): void => {
      if (!e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      const control = target.closest(INTERACTIVE);
      if (control && !control.hasAttribute("data-column-key")) return;

      const cell = target.closest<HTMLElement>(`.${classPrefix}-table-header-cell`);
      if (!cell) return;

      const key = cell.dataset.columnKey;
      if (!key) return;

      const cols = layout.columns;
      const fromIndex = cols.findIndex((c) => c.def.key === key);
      if (fromIndex < 0) return;
      if (!isReorderable(cols[fromIndex])) {
        announce(`Cannot move ${getColLabel(cols[fromIndex]!)} (locked)`);
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const dir = e.key === "ArrowRight" ? 1 : -1;
      moveColumn(fromIndex, fromIndex + dir);
    };

    dom.root.addEventListener("pointerdown", onHeaderPointerDown);
    dom.root.addEventListener("click", onCaptureClick, true);
    dom.root.addEventListener("keydown", onRootKeyDownCapture, true);

    // ── Cleanup ─────────────────────────────────────────────────

    ctx.hooks.onDestroy((): void => {
      finishDrag(false);
      dom.root.removeEventListener("pointerdown", onHeaderPointerDown);
      dom.root.removeEventListener("click", onCaptureClick, true);
      dom.root.removeEventListener("keydown", onRootKeyDownCapture, true);
      dropIndicator?.remove();
      dropIndicator = null;
      liveEl?.remove();
      liveEl = null;
    });
  }
}
