/**
 * vlist/table — columnPin() feature
 *
 * Freezes columns to the left or right edge of the table so horizontal
 * scrolling does not move them. Partitioned as:
 *   [...leftPinned, ...unpinned, ...rightPinned]
 *
 * Unpinning a column returns it to its original unpinned relative position.
 * Mounted only through `table({ features: [columnPin()] })`. The body of this
 * module is not imported by `table()`, so a plain table pays nothing for it.
 * `TableColumn.pin` is ignored unless this feature is in that array.
 */

import type { VListItem } from "../../types";
import type { VListPlugin } from "../../core/types";
import type { TableColumn, TableLayout, ColumnPinEvent, ColumnResizeEvent } from "./types";
import type { TableFeature } from "./feature";

// =============================================================================
// Types
// =============================================================================

export interface ColumnPinConfig {
  /** Initial pin state by column key (overrides or supplements TableColumn.pin) */
  pins?: Record<string, "left" | "right">;
}

/** Methods the columnPin plugin adds to the list instance. */
export interface ColumnPinMethods {
/**
   * Pin a column to the left or right edge, or unpin it (`null`) to restore
   * its original unpinned position. Present on the list when `columnPin()`
   * is in `table({ features })`.
   */
  setColumnPin(keyOrIndex: string | number, pin: "left" | "right" | null): void;

  /** Current pinned columns keyed by column key. */
  getColumnPins(): Record<string, "left" | "right">;
}

interface StampableCell extends HTMLElement {
  _pinStamp?: number;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Pin columns to the left or right edge.
 *
 * Pass the result to `table({ features: [columnPin()] })`. On its own it
 * mounts nothing, and `TableColumn.pin` does nothing without it. A feature
 * listed earlier can read pin state after setup: the state is published on
 * `_getColumnPinState` and resolved when that hook is read, not when the
 * earlier feature's `attach` runs.
 *
 * Commit, resize, and after-scroll are wrapped here, on the plugin object,
 * before `table()` returns. Those wrappers are not part of a plain table.
 */
export function columnPin<T extends VListItem = VListItem>(
  config?: ColumnPinConfig,
): TableFeature<T, ColumnPinMethods> {
  let syncBodyFn: (() => void) | null = null;
  let syncOffsetsFn: (() => void) | null = null;

  return {
    name: "columnPin",

    attach(plugin: VListPlugin<T>): void {
      const hooks = plugin.hooks ?? {};
      plugin.hooks = hooks;
      const prevCommit = hooks.onCommit;
      const prevResize = hooks.onResize;
      const prevAfter = hooks.onAfterScroll;
      hooks.onCommit = (state): void => {
        prevCommit?.(state);
        syncBodyFn?.();
      };
      hooks.onResize = (width: number, height: number): void => {
        prevResize?.(width, height);
        syncOffsetsFn?.();
      };
      hooks.onAfterScroll = (position: number, direction: number): void => {
        prevAfter?.(position, direction);
        syncOffsetsFn?.();
      };

      const prevSetup = plugin.setup;
      plugin.setup = (ctx): void => {
        prevSetup?.call(plugin, ctx);
        const layout = ctx.hooks.get("_getTableLayout")?.() as TableLayout<T> | null | undefined;
        if (!layout) {
          throw new Error("[vlist] columnPin: table() did not publish a layout");
        }
        mount(ctx, layout);
      };
    },
  };

  function mount(ctx: Parameters<NonNullable<VListPlugin<T>["setup"]>>[0], layout: TableLayout<T>): void {
      const baseUpdateColumns = ctx.hooks.get("updateColumns") as
        | ((columns: TableColumn<T>[]) => void)
        | undefined;

      if (!baseUpdateColumns) {
        throw new Error("[vlist] columnPin: table() did not publish updateColumns");
      }

      const { dom, emitter } = ctx;
      const { classPrefix } = ctx.config;

      const rootPinnedClass = `${classPrefix}--table-pinned`;
      const hdrPinLeftClass = `${classPrefix}-table-header-cell--pin-left`;
      const hdrPinLeftLastClass = `${classPrefix}-table-header-cell--pin-left-last`;
      const hdrPinRightClass = `${classPrefix}-table-header-cell--pin-right`;
      const hdrPinRightFirstClass = `${classPrefix}-table-header-cell--pin-right-first`;
      const cellPinLeftClass = `${classPrefix}-table-cell--pin-left`;
      const cellPinLeftLastClass = `${classPrefix}-table-cell--pin-left-last`;
      const cellPinRightClass = `${classPrefix}-table-cell--pin-right`;
      const cellPinRightFirstClass = `${classPrefix}-table-cell--pin-right-first`;

      // Canonical unpinned column definitions in their original relative order
      let baseColumns: TableColumn<T>[] = [];
      let leftOrder: string[] = [];
      let rightOrder: string[] = [];
      let pins: Record<string, "left" | "right"> = {};
      let pinVersion = 1;
      let internalUpdate = false;
      let pendingExternalSync = false;
      let inSetup = true;

      const initFromColumns = (
        cols: readonly TableColumn<T>[],
        overridePins?: Record<string, "left" | "right">,
      ): void => {
        baseColumns = [];
        leftOrder = [];
        rightOrder = [];
        pins = {};
        for (let i = 0; i < cols.length; i++) {
          const col = cols[i]!;
          baseColumns.push(col);
          const side = overridePins?.[col.key] ?? col.pin;
          if (side === "left") {
            leftOrder.push(col.key);
            pins[col.key] = "left";
          } else if (side === "right") {
            rightOrder.push(col.key);
            pins[col.key] = "right";
          }
        }
      };

      const findBaseCol = (key: string): TableColumn<T> | undefined => {
        for (let i = 0; i < baseColumns.length; i++) {
          if (baseColumns[i]!.key === key) return baseColumns[i]!;
        }
        return undefined;
      };

      const buildOrderedColumns = (): TableColumn<T>[] => {
        const ordered: TableColumn<T>[] = [];
        for (let i = 0; i < leftOrder.length; i++) {
          const col = findBaseCol(leftOrder[i]!);
          if (col) ordered.push({ ...col, pin: "left" });
        }
        for (let i = 0; i < baseColumns.length; i++) {
          const col = baseColumns[i]!;
          if (!pins[col.key]) {
            const copy = { ...col };
            delete copy.pin;
            ordered.push(copy);
          }
        }
        for (let i = 0; i < rightOrder.length; i++) {
          const col = findBaseCol(rightOrder[i]!);
          if (col) ordered.push({ ...col, pin: "right" });
        }
        return ordered;
      };

      const getPinWidths = (): { leftWidth: number; rightWidth: number } => {
        const cols = layout.columns;
        const leftCount = leftOrder.length;
        const rightCount = rightOrder.length;
        let leftWidth = 0;
        let rightWidth = 0;
        for (let i = 0; i < leftCount && i < cols.length; i++) {
          leftWidth += cols[i]!.width;
        }
        for (let i = Math.max(0, cols.length - rightCount); i < cols.length; i++) {
          rightWidth += cols[i]!.width;
        }
        return { leftWidth, rightWidth };
      };

      let lastLeftOffset = NaN;
      let lastRightOffset = NaN;

      const syncPinOffsets = (): void => {
        const hasPins = leftOrder.length > 0 || rightOrder.length > 0;
        if (!hasPins) {
          if (!Number.isNaN(lastLeftOffset)) {
            lastLeftOffset = NaN;
            lastRightOffset = NaN;
            dom.root.classList.remove(rootPinnedClass);
            dom.root.style.removeProperty("--vlist-table-pin-left");
            dom.root.style.removeProperty("--vlist-table-pin-right");
          }
          return;
        }
        const scrollLeft = dom.viewport.scrollLeft;
        const viewportWidth = dom.viewport.clientWidth || ctx.getState().crossSize;
        const leftOffset = leftOrder.length > 0 ? Math.max(0, scrollLeft) : 0;
        const rightOffset =
          rightOrder.length > 0 && viewportWidth > 0
            ? Math.min(0, scrollLeft + viewportWidth - layout.totalWidth)
            : 0;
        if (leftOffset === lastLeftOffset && rightOffset === lastRightOffset) return;
        dom.root.classList.add(rootPinnedClass);
        if (leftOffset !== lastLeftOffset) {
          lastLeftOffset = leftOffset;
          dom.root.style.setProperty("--vlist-table-pin-left", `${leftOffset}px`);
        }
        if (rightOffset !== lastRightOffset) {
          lastRightOffset = rightOffset;
          dom.root.style.setProperty("--vlist-table-pin-right", `${rightOffset}px`);
        }
      };

      const applyCellPinState = (
        cell: HTMLElement,
        colIndex: number,
        totalCols: number,
        leftCount: number,
        rightCount: number,
        isHeader: boolean,
      ): void => {
        const isLeft = colIndex < leftCount;
        const isRight = rightCount > 0 && colIndex >= totalCols - rightCount;
        const isLeftLast = isLeft && colIndex === leftCount - 1;
        const isRightFirst = isRight && colIndex === totalCols - rightCount;

        cell.classList.toggle(isHeader ? hdrPinLeftClass : cellPinLeftClass, isLeft);
        cell.classList.toggle(isHeader ? hdrPinLeftLastClass : cellPinLeftLastClass, isLeftLast);
        cell.classList.toggle(isHeader ? hdrPinRightClass : cellPinRightClass, isRight);
        cell.classList.toggle(isHeader ? hdrPinRightFirstClass : cellPinRightFirstClass, isRightFirst);

        if (isLeft) cell.dataset.pin = "left";
        else if (isRight) cell.dataset.pin = "right";
        else delete cell.dataset.pin;
      };

      const syncHeaderPinClasses = (): void => {
        const headerScroll = dom.root.querySelector<HTMLElement>(
          `.${classPrefix}-table-header-scroll`,
        );
        if (!headerScroll) return;
        const children = headerScroll.children;
        const totalCols = layout.columns.length;
        const leftCount = leftOrder.length;
        const rightCount = rightOrder.length;
        for (let i = 0; i < children.length; i++) {
          applyCellPinState(
            children[i] as HTMLElement,
            i,
            totalCols,
            leftCount,
            rightCount,
            true,
          );
        }
      };

      const syncBodyPinClasses = (): void => {
        const rows = dom.content.children;
        const totalCols = layout.columns.length;
        const leftCount = leftOrder.length;
        const rightCount = rightOrder.length;

        for (let r = 0; r < rows.length; r++) {
          const row = rows[r] as HTMLElement;
          if (row.getAttribute("role") === "presentation") continue;
          const cells = row.children;
          const firstCell = cells[0] as StampableCell | undefined;
          if (!firstCell || firstCell._pinStamp === pinVersion) continue;
          firstCell._pinStamp = pinVersion;
          for (let c = 0; c < cells.length; c++) {
            applyCellPinState(
              cells[c] as HTMLElement,
              c,
              totalCols,
              leftCount,
              rightCount,
              false,
            );
          }
        }
      };

      const syncAllPins = (): void => {
        pinVersion++;
        syncHeaderPinClasses();
        syncBodyPinClasses();
        syncPinOffsets();
      };

      const applyPartition = (): void => {
        internalUpdate = true;
        try {
          baseUpdateColumns(buildOrderedColumns());
        } finally {
          internalUpdate = false;
        }
        syncAllPins();
      };

      // Intercept external list.updateColumns(newCols) via layout.updateColumns
      // (core/create.ts forbids registering a duplicate public method name)
      const origUpdateColumns = layout.updateColumns;
      layout.updateColumns = (newCols: TableColumn<T>[]): void => {
        if (!internalUpdate) {
          initFromColumns(newCols);
          newCols = buildOrderedColumns();
          pendingExternalSync = true;
        }
        origUpdateColumns(newCols);
      };

      // Wrap ctx.render.ifNeeded / force so standalone mock contexts without
      // createVList's commit hook runner still stamp body rows after rendering
      const origIfNeeded = ctx.render.ifNeeded;
      const origForce = ctx.render.force;
      ctx.render.ifNeeded = (): void => {
        origIfNeeded();
        syncBodyPinClasses();
      };
      ctx.render.force = (): void => {
        if (inSetup) return;
        origForce();
        if (pendingExternalSync) {
          pendingExternalSync = false;
          syncAllPins();
        } else {
          syncBodyPinClasses();
        }
      };

      // Initialize from existing table layout columns + optional plugin config
      const initialDefs: TableColumn<T>[] = [];
      for (let i = 0; i < layout.columns.length; i++) {
        initialDefs.push(layout.columns[i]!.def);
      }
      initFromColumns(initialDefs, config?.pins);

      if (leftOrder.length > 0 || rightOrder.length > 0) {
        applyPartition();
      } else {
        syncAllPins();
      }
      inSetup = false;

      syncBodyFn = (): void => {
        if (pendingExternalSync) {
          pendingExternalSync = false;
          syncAllPins();
        } else {
          syncBodyPinClasses();
        }
      };
      syncOffsetsFn = syncPinOffsets;

      // ── Public Methods ──────────────────────────────────────────

      const removeFromArray = (arr: string[], key: string): void => {
        const idx = arr.indexOf(key);
        if (idx >= 0) arr.splice(idx, 1);
      };

      const getColumnPins = (): Record<string, "left" | "right"> => {
        const out: Record<string, "left" | "right"> = {};
        for (let i = 0; i < leftOrder.length; i++) out[leftOrder[i]!] = "left";
        for (let i = 0; i < rightOrder.length; i++) out[rightOrder[i]!] = "right";
        return out;
      };

      const setColumnPin = (
        keyOrIndex: string | number,
        pin: "left" | "right" | null,
      ): void => {
        const key =
          typeof keyOrIndex === "number"
            ? layout.columns[keyOrIndex]?.def.key
            : findBaseCol(keyOrIndex)?.key;
        if (!key) return;

        removeFromArray(leftOrder, key);
        removeFromArray(rightOrder, key);
        delete pins[key];

        if (pin === "left") {
          leftOrder.push(key);
          pins[key] = "left";
        } else if (pin === "right") {
          rightOrder.push(key);
          pins[key] = "right";
        }

        applyPartition();

        const order: string[] = [];
        let newIndex = -1;
        for (let i = 0; i < layout.columns.length; i++) {
          const k = layout.columns[i]!.def.key;
          order.push(k);
          if (k === key) newIndex = i;
        }

        emitter.emit("column:pin" as never, {
          key,
          index: newIndex,
          pin,
          pins: getColumnPins(),
          order,
        } as ColumnPinEvent as never);
      };

      ctx.hooks.method("setColumnPin", setColumnPin);
      ctx.hooks.method("getColumnPins", getColumnPins);
      ctx.hooks.method("_getColumnPinState", () => ({
        getBaseColumns: () => baseColumns,
        getLeftOrder: () => leftOrder,
        getRightOrder: () => rightOrder,
        getPins: getColumnPins,
        setColumnPin,
        syncAllPins,
      }));

      // ── Scroll & Resize Listeners ───────────────────────────────

      const onViewportScroll = (): void => {
        syncPinOffsets();
      };
      dom.viewport.addEventListener("scroll", onViewportScroll, { passive: true });

      const offResize = emitter.on("resize", () => syncPinOffsets());
      const offColResize = emitter.on(
        "column:resize" as never,
        ((ev: ColumnResizeEvent) => {
          for (let i = 0; i < baseColumns.length; i++) {
            if (baseColumns[i]!.key === ev.key) {
              baseColumns[i] = { ...baseColumns[i]!, width: ev.width };
              break;
            }
          }
          syncPinOffsets();
        }) as never,
      );

      // ── Header Focus Clearance & Keyboard Pin Shortcut ──────────

      const onRootFocusIn = (e: FocusEvent): void => {
        const target = e.target as HTMLElement | null;
        const cell = target?.closest<HTMLElement>(`.${classPrefix}-table-header-cell`);
        if (!cell) return;
        const key = cell.dataset.columnKey;
        if (!key || pins[key]) return;

        let col = undefined;
        for (let i = 0; i < layout.columns.length; i++) {
          if (layout.columns[i]!.def.key === key) {
            col = layout.columns[i]!;
            break;
          }
        }
        if (!col) return;

        const { leftWidth, rightWidth } = getPinWidths();
        const viewportWidth = dom.viewport.clientWidth || ctx.getState().crossSize;
        if (viewportWidth <= 0 || layout.totalWidth <= viewportWidth) return;

        const scrollLeft = dom.viewport.scrollLeft;
        const visibleStart = scrollLeft + leftWidth;
        const visibleEnd = scrollLeft + viewportWidth - rightWidth;

        let nextScroll = -1;
        if (col.offset < visibleStart) {
          nextScroll = Math.max(0, col.offset - leftWidth);
        } else if (col.offset + col.width > visibleEnd && visibleEnd > visibleStart) {
          nextScroll = Math.max(
            0,
            Math.min(col.offset - leftWidth, col.offset + col.width - (viewportWidth - rightWidth)),
          );
        }
        if (nextScroll >= 0 && nextScroll !== scrollLeft) {
          dom.viewport.scrollLeft = nextScroll;
          syncPinOffsets();
          dom.viewport.dispatchEvent(new Event("scroll"));
        }
      };

      const onRootKeyDownCapture = (e: KeyboardEvent): void => {
        if (!e.altKey || !e.shiftKey) return;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;

        const target = e.target as HTMLElement | null;
        const cell = target?.closest<HTMLElement>(`.${classPrefix}-table-header-cell`);
        if (!cell) return;

        const key = cell.dataset.columnKey;
        if (!key) return;

        e.preventDefault();
        e.stopPropagation();

        const currentPin = pins[key] ?? null;
        const nextPin: "left" | "right" | null = currentPin
          ? null
          : e.key === "ArrowLeft"
            ? "left"
            : "right";

        setColumnPin(key, nextPin);

        const movedCell = dom.root.querySelector<HTMLElement>(
          `.${classPrefix}-table-header-cell[data-column-key="${key}"]`,
        );
        movedCell?.focus();
      };

      dom.root.addEventListener("focusin", onRootFocusIn);
      dom.root.addEventListener("keydown", onRootKeyDownCapture, true);

      // ── Cleanup ─────────────────────────────────────────────────

      ctx.hooks.onDestroy((): void => {
        dom.viewport.removeEventListener("scroll", onViewportScroll);
        dom.root.removeEventListener("focusin", onRootFocusIn);
        dom.root.removeEventListener("keydown", onRootKeyDownCapture, true);
        offResize();
        offColResize();
        dom.root.classList.remove(rootPinnedClass);
        dom.root.style.removeProperty("--vlist-table-pin-left");
        dom.root.style.removeProperty("--vlist-table-pin-right");
        syncBodyFn = null;
        syncOffsetsFn = null;
      });
  }
}
