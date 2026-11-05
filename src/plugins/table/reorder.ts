/**
 * vlist/table — Column Reorder Plugin (#113)
 *
 * Interactive and programmatic column reordering for `table()`:
 * - Pointer drag on header cells (5px threshold, drop indicator, edge auto-scroll,
 *   trailing click/sort suppression)
 * - Keyboard `Alt+ArrowLeft` / `Alt+ArrowRight` on focused header cell (retaining focus)
 * - Programmatic `moveColumn(keyOrFromIndex, toIndex)` and `getColumnOrder()`
 * - In-place header & body cell permutation without re-running `cell()` templates
 * - Preserves sort state (`aria-sort`, sort indicators, `getSorts()`) and clamps
 *   within pin partitions (`[...left, ...unpinned, ...right]`) when `columnPin()` is active.
 */

import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import type {
  TableColumn,
  TableLayout,
  ResolvedColumn,
  ColumnReorderEvent,
} from "./types";

// =============================================================================
// Constants & Types
// =============================================================================

const INTERACTIVE = "a[href],button,input,select,textarea,[tabindex]";
const MIN_DRAG_DELTA = 5;
const EDGE_ZONE = 40;
const MAX_SCROLL_SPEED = 15;

export interface ColumnReorderPluginConfig {
  /** Column keys that cannot be reordered (supplements TableColumn.reorderable: false) */
  disabled?: string[];
}

export interface ColumnReorderMethods {
  /**
   * Move a column from `keyOrFromIndex` to `toIndex` (clamped to its pin
   * partition when `columnPin()` is active).
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

export function columnReorder<T extends VListItem = VListItem>(
  config?: ColumnReorderPluginConfig,
): VListPlugin<T, ColumnReorderMethods> {
  const disabledSet = new Set(config?.disabled ?? []);

  return {
    name: "columnReorder",
    // Runs after table() (10) and columnPin() (12)
    priority: 14,

    setup(ctx: PluginContext<T>): void {
      const getLayout = ctx.hooks.get("_getTableLayout") as
        | (() => TableLayout<T> | null)
        | undefined;
      const layout = getLayout?.();

      if (!layout) {
        const fail = (): never => {
          ctx.dom.root.remove();
          throw new Error("[vlist] columnReorder: requires table() plugin");
        };
        if (ctx.dom.liveRegion.hasAttribute("role")) {
          ctx.render.setFn(fail, fail);
          return;
        }
        return fail();
      }

      const { dom, emitter } = ctx;
      const { classPrefix } = ctx.config;

      const rootReorderingClass = `${classPrefix}--col-reordering`;
      const hdrDraggingClass = `${classPrefix}-table-header-cell--dragging`;
      const dropIndicatorClass = `${classPrefix}-table-drop-indicator`;

      const getPinState = (): PinStateHook<T> | undefined => {
        const fn = ctx.hooks.get("_getColumnPinState") as
          | (() => PinStateHook<T>)
          | undefined;
        return fn?.();
      };

      const isReorderable = (col: ResolvedColumn<T> | undefined): boolean =>
        Boolean(col && col.def.reorderable !== false && !disabledSet.has(col.def.key));

      const getPartitionBounds = (
        colIndex: number,
        total: number,
        pinState?: PinStateHook<T>,
      ): {
        minIdx: number;
        maxIdx: number;
        partition: "left" | "unpinned" | "right";
        leftCount: number;
        rightCount: number;
      } => {
        const leftCount = pinState ? pinState.getLeftOrder().length : 0;
        const rightCount = pinState ? pinState.getRightOrder().length : 0;
        const rightStart = total - rightCount;
        if (colIndex < leftCount) {
          return {
            minIdx: 0,
            maxIdx: leftCount - 1,
            partition: "left",
            leftCount,
            rightCount,
          };
        }
        if (rightCount > 0 && colIndex >= rightStart) {
          return {
            minIdx: rightStart,
            maxIdx: total - 1,
            partition: "right",
            leftCount,
            rightCount,
          };
        }
        return {
          minIdx: leftCount,
          maxIdx: rightStart - 1,
          partition: "unpinned",
          leftCount,
          rightCount,
        };
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
        const { minIdx, maxIdx, partition, leftCount, rightCount } = getPartitionBounds(
          fromIndex,
          cols.length,
          pinState,
        );
        if (maxIdx < minIdx) return;

        const clampedTo = Math.max(minIdx, Math.min(maxIdx, toIndex));
        if (clampedTo === fromIndex) return;

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
          const rightStart = cols.length - rightCount;
          if (partition === "left") {
            const leftOrder = pinState.getLeftOrder();
            const [k] = leftOrder.splice(fromIndex, 1);
            leftOrder.splice(clampedTo, 0, k!);
          } else if (partition === "right") {
            const rightOrder = pinState.getRightOrder();
            const [k] = rightOrder.splice(fromIndex - rightStart, 1);
            rightOrder.splice(clampedTo - rightStart, 0, k!);
          } else {
            const baseCols = pinState.getBaseColumns();
            const pins = pinState.getPins();
            let u = leftCount;
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

        // 6. Announce move in polite live region
        const rowgroup = dom.root.querySelector<HTMLElement>('[role="rowgroup"]');
        if (rowgroup) {
          let liveEl = rowgroup.querySelector<HTMLElement>('[aria-live="polite"]');
          if (!liveEl) {
            liveEl = document.createElement("div");
            liveEl.style.cssText =
              "position:absolute;width:1px;height:1px;padding:0;margin:-1px;" +
              "overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
            liveEl.setAttribute("aria-live", "polite");
            rowgroup.appendChild(liveEl);
          }
          const rawLabel = movedCol!.def.label;
          const labelText =
            (typeof rawLabel === "string" ? rawLabel : rawLabel?.textContent) ||
            movedCol!.def.key;
          liveEl.textContent = `Moved ${labelText} to position ${clampedTo + 1}`;
        }

        // 7. Emit column:reorder
        const order = getColumnOrder();
        emitter.emit("column:reorder" as never, {
          key: movedCol!.def.key,
          fromIndex,
          toIndex: clampedTo,
          order,
        } as ColumnReorderEvent as never);
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

        const pinState = getPinState();
        const { minIdx, maxIdx, partition } = getPartitionBounds(
          dragSourceIndex,
          cols.length,
          pinState,
        );

        const rect = dom.viewport.getBoundingClientRect();
        const viewportWidth = dom.viewport.clientWidth || ctx.getState().crossSize;
        const localX = clientX - rect.left;
        const tableX =
          partition === "left"
            ? localX
            : partition === "right"
              ? localX + layout.totalWidth - viewportWidth
              : localX + dom.viewport.scrollLeft;

        let targetIdx = dragSourceIndex;
        for (let i = minIdx; i <= maxIdx; i++) {
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

        const targetCol = cols[targetIdx]!;
        const boundaryOffset =
          targetIdx <= dragSourceIndex
            ? targetCol.offset
            : targetCol.offset + targetCol.width;
        const indicatorX =
          partition === "left"
            ? boundaryOffset
            : partition === "right"
              ? boundaryOffset - (layout.totalWidth - viewportWidth)
              : boundaryOffset - dom.viewport.scrollLeft;

        const indicator = ensureDropIndicator();
        indicator.style.transform = `translateX(${indicatorX}px)`;
      };

      const stepEdgeAutoScroll = (): void => {
        scrollRafId = 0;
        if (!dragActive) return;

        const cols = layout.columns;
        const pinState = getPinState();
        const { partition, leftCount, rightCount } = getPartitionBounds(
          dragSourceIndex,
          cols.length,
          pinState,
        );
        if (partition !== "unpinned") return;

        const viewportWidth = dom.viewport.clientWidth || ctx.getState().crossSize;
        if (viewportWidth <= 0 || layout.totalWidth <= viewportWidth) return;

        let leftPinWidth = 0;
        let rightPinWidth = 0;
        for (let i = 0; i < leftCount && i < cols.length; i++) leftPinWidth += cols[i]!.width;
        for (let i = cols.length - rightCount; i < cols.length; i++) {
          if (i >= 0) rightPinWidth += cols[i]!.width;
        }

        const rect = dom.viewport.getBoundingClientRect();
        const leftEdge = rect.left + leftPinWidth;
        const rightEdge = rect.left + viewportWidth - rightPinWidth;
        const maxScroll = layout.totalWidth - viewportWidth;

        let delta = 0;
        if (dragLastX < leftEdge + EDGE_ZONE && dom.viewport.scrollLeft > 0) {
          const ratio = Math.min(1, (leftEdge + EDGE_ZONE - dragLastX) / EDGE_ZONE);
          delta = -Math.max(1, Math.round(ratio * MAX_SCROLL_SPEED));
        } else if (dragLastX > rightEdge - EDGE_ZONE && dom.viewport.scrollLeft < maxScroll) {
          const ratio = Math.min(1, (dragLastX - (rightEdge - EDGE_ZONE)) / EDGE_ZONE);
          delta = Math.max(1, Math.round(ratio * MAX_SCROLL_SPEED));
        }

        if (delta !== 0) {
          const nextScroll = Math.max(0, Math.min(maxScroll, dom.viewport.scrollLeft + delta));
          if (nextScroll !== dom.viewport.scrollLeft) {
            dom.viewport.scrollLeft = nextScroll;
            dom.viewport.dispatchEvent(new Event("scroll"));
            updateDropTarget(dragLastX);
            scrollRafId = requestAnimationFrame(stepEdgeAutoScroll);
          }
        }
      };

      const onPointerMove = (e: PointerEvent): void => {
        if (!dragCell) return;
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
        dragActive = false;

        if (commit && wasActive && fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
          moveColumn(fromIdx, toIdx);
        }
      };

      const onPointerUp = (): void => {
        finishDrag(true);
      };

      const onPointerCancel = (): void => {
        finishDrag(false);
      };

      const onHeaderPointerDown = (e: PointerEvent): void => {
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

        dragCell = cell;
        dragSourceIndex = colIndex;
        dragTargetIndex = colIndex;
        dragStartX = e.clientX;
        dragLastX = e.clientX;
        dragPointerId = e.pointerId;
        dragActive = false;

        cell.addEventListener("pointermove", onPointerMove);
        cell.addEventListener("pointerup", onPointerUp);
        cell.addEventListener("pointercancel", onPointerCancel);
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

        e.preventDefault();
        e.stopPropagation();

        if (!isReorderable(cols[fromIndex])) return;

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
      });
    },
  };
}
