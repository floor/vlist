/**
 * vlist/table - Header
 * Manages the sticky header row that sits above the scrolling viewport.
 */

import type { VListItem } from "../../types";
import type {
  TableLayout,
  TableHeader,
  TableSort,
  ResolvedColumn,
  ColumnSortEvent,
  ColumnClickEvent,
} from "./types";

const INTERACTIVE = "a[href],button,input,select,textarea,[tabindex]";
const MIN_DRAG_DELTA = 1;
const RESIZE_STEP = 10;
const SORT_ASC = "\u25B2"; // ▲
const SORT_DESC = "\u25BC"; // ▼

export const toSorts = (v: unknown, direction: "asc" | "desc" = "asc"): TableSort[] =>
  Array.isArray(v)
    ? v.map((s) => ({ key: s.key, direction: s.direction }))
    : typeof v === "string"
      ? [{ key: v, direction }]
      : (v as { key?: string; direction?: "asc" | "desc" })?.key
        ? [{ key: (v as { key: string }).key, direction: (v as { direction?: "asc" | "desc" }).direction ?? "asc" }]
        : [];

const setAttr = (el: HTMLElement, name: string, val?: string | null | false): void => {
  if (val) el.setAttribute(name, val);
  else el.removeAttribute(name);
};

export const createTableHeader = <T extends VListItem = VListItem>(
  root: HTMLElement,
  headerHeight: number,
  classPrefix: string,
  onResize: (columnIndex: number, newWidth: number) => void,
  onSort?: (event: ColumnSortEvent) => void,
  onClick?: (event: ColumnClickEvent) => void,
  multiSort: boolean = true,
): TableHeader<T> => {
  const rowgroup = document.createElement("div");
  rowgroup.setAttribute("role", "rowgroup");

  const element = document.createElement("div");
  element.className = `${classPrefix}-table-header`;
  element.setAttribute("role", "row");
  element.setAttribute("aria-rowindex", "1");
  element.style.height = `${headerHeight}px`;

  const scrollContainer = document.createElement("div");
  scrollContainer.className = `${classPrefix}-table-header-scroll`;
  scrollContainer.setAttribute("role", "presentation");
  element.appendChild(scrollContainer);

  rowgroup.appendChild(element);
  root.insertBefore(rowgroup, root.firstChild);
  root.style.setProperty("--vlist-table-header-height", `${headerHeight}px`);

  let cells: HTMLElement[] = [];
  let sortIndicators: (HTMLElement | null)[] = [];
  let isVisible = true;
  let currentSorts: TableSort[] = [];
  let currentLayout: TableLayout<T> | null = null;
  let liveRegion: HTMLElement | null = null;
  let ownsLive = false;

  let isDragging = false;
  let dragColumnIndex = -1;
  let dragStartX = 0;
  let dragStartWidth = 0;
  let focusedCellIndex = 0;

  const setTabStop = (index: number): void => {
    cells[focusedCellIndex]?.setAttribute("tabindex", "-1");
    focusedCellIndex = index;
    if (cells[index]) cells[index]!.tabIndex = 0;
  };

  const findCellIndex = (target: EventTarget | null): number => {
    const cell = (target as HTMLElement | null)?.closest<HTMLElement>("[data-column-key]");
    return cell ? cells.indexOf(cell) : -1;
  };

  const createCell = (col: ResolvedColumn<T>, colIndex: number): HTMLElement => {
    const cell = document.createElement("div");
    cell.className = `${classPrefix}-table-header-cell`;
    cell.setAttribute("role", "columnheader");
    cell.setAttribute("aria-colindex", String(colIndex + 1));
    cell.tabIndex = colIndex ? -1 : 0;
    cell.dataset.columnKey = col.def.key;

    const align = col.def.align;
    if (align === "center" || align === "right") {
      cell.classList.add(`${classPrefix}-table-header-cell--${align}`);
    }

    const content = document.createElement("div");
    content.className = `${classPrefix}-table-header-content`;

    const label = col.def.header ? col.def.header(col.def) : col.def.label;
    if (typeof label === "string") {
      content.textContent = label;
    } else {
      content.appendChild(label);
    }
    cell.appendChild(content);

    if (col.def.sortable) {
      const sortIndicator = document.createElement("span");
      sortIndicator.className = `${classPrefix}-table-header-sort`;
      sortIndicator.setAttribute("aria-hidden", "true");
      cell.appendChild(sortIndicator);
      sortIndicators.push(sortIndicator);
      cell.classList.add(`${classPrefix}-table-header-cell--sortable`);
    } else {
      sortIndicators.push(null);
    }

    if (col.resizable) {
      const handle = document.createElement("div");
      handle.className = `${classPrefix}-table-header-resize`;
      handle.dataset.resizeIndex = String(colIndex);
      cell.appendChild(handle);
    }

    return cell;
  };

  const rebuild = (layout: TableLayout<T>): void => {
    currentLayout = layout;
    scrollContainer.textContent = "";
    cells = [];
    sortIndicators = [];
    focusedCellIndex = 0;

    const columns = layout.columns;
    for (let i = 0; i < columns.length; i++) {
      const cell = createCell(columns[i]!, i);
      cells.push(cell);
      scrollContainer.appendChild(cell);
    }

    update(layout);
    if (currentSorts.length) updateSort(currentSorts);
  };

  const update = (layout: TableLayout<T>): void => {
    currentLayout = layout;
    const columns = layout.columns;
    scrollContainer.style.width = `${layout.totalWidth}px`;
    for (let i = 0; i < cells.length && i < columns.length; i++) {
      cells[i]!.style.width = `${columns[i]!.width}px`;
    }
  };

  const updateSort = (
    keyOrSorts: string | null | readonly TableSort[],
    direction: "asc" | "desc" = "asc",
  ): void => {
    currentSorts = toSorts(keyOrSorts, direction);
    if (!currentLayout) return;

    const columns = currentLayout.columns;
    const isMulti = currentSorts.length > 1;
    let descText = "";

    if (isMulti) {
      const parts: string[] = [];
      for (let i = 0; i < currentSorts.length; i++) {
        const s = currentSorts[i]!;
        const raw = columns.find((c) => c.def.key === s.key)?.def.label;
        parts.push(
          `${(typeof raw === "string" ? raw : raw?.textContent) || s.key} ${s.direction === "asc" ? "ascending" : "descending"}`,
        );
      }
      descText = `sorted by ${parts.join(", then ")}`;
      if (!liveRegion) {
        liveRegion = root.querySelector<HTMLElement>('[aria-live="polite"]');
        if (!liveRegion) {
          liveRegion = document.createElement("div");
          liveRegion.className = `${classPrefix}-live`;
          liveRegion.setAttribute("aria-live", "polite");
          root.appendChild(liveRegion);
          ownsLive = true;
        }
        liveRegion.id ||= `${classPrefix}-live`;
      }
      liveRegion.textContent = descText;
    } else if (liveRegion && element.hasAttribute("aria-description")) {
      liveRegion.textContent = "";
    }

    const setDesc = (el: HTMLElement, on: boolean): void => {
      setAttr(el, "aria-description", on && descText);
      setAttr(el, "aria-describedby", on && liveRegion!.id);
    };
    setDesc(element, isMulti);

    for (let i = 0; i < sortIndicators.length && i < columns.length; i++) {
      const indicator = sortIndicators[i];
      if (!indicator) continue;

      const cell = cells[i]!;
      const sortIdx = currentSorts.findIndex((s) => s.key === columns[i]!.def.key);
      const s = currentSorts[sortIdx];

      indicator.textContent = s ? (s.direction === "asc" ? SORT_ASC : SORT_DESC) : "";
      indicator.style.opacity = s ? "0.7" : "0";
      if (s && isMulti) indicator.dataset.sortPriority = String(sortIdx + 1);
      else delete indicator.dataset.sortPriority;
      setAttr(cell, "aria-sort", sortIdx === 0 && (s!.direction === "asc" ? "ascending" : "descending"));
      setDesc(cell, sortIdx > 0);
    }
  };

  const syncScroll = (scrollLeft: number): void => {
    scrollContainer.style.transform = `translateX(${-scrollLeft}px)`;
  };

  const onPointerDown = (e: PointerEvent): void => {
    const target = e.target as HTMLElement;
    if (!target.dataset.resizeIndex) return;

    e.preventDefault();
    e.stopPropagation();

    dragColumnIndex = +target.dataset.resizeIndex!;
    const col = currentLayout?.getColumn(dragColumnIndex);
    if (!col?.resizable) return;

    isDragging = true;
    dragStartX = e.clientX;
    dragStartWidth = col.width;

    root.classList.add(`${classPrefix}--col-resizing`);
    root.style.cursor = "col-resize";
    target.classList.add(`${classPrefix}-table-header-resize--active`);
    target.setPointerCapture(e.pointerId);

    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerUp);
    target.addEventListener("pointercancel", onPointerUp);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!isDragging || !currentLayout) return;
    const delta = e.clientX - dragStartX;
    if (Math.abs(delta) < MIN_DRAG_DELTA) return;
    onResize(dragColumnIndex, Math.max(0, dragStartWidth + delta));
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (!isDragging) return;
    const target = e.target as HTMLElement;
    target.removeEventListener("pointermove", onPointerMove);
    target.removeEventListener("pointerup", onPointerUp);
    target.removeEventListener("pointercancel", onPointerUp);
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {}
    target.classList.remove(`${classPrefix}-table-header-resize--active`);
    root.classList.remove(`${classPrefix}--col-resizing`);
    root.style.cursor = "";
    isDragging = false;
    dragColumnIndex = -1;
  };

  const emitSort = (col: ResolvedColumn<T> | undefined, index: number, addMulti: boolean): boolean => {
    if (!col?.def.sortable || !onSort) return false;
    const key = col.def.key;
    const idx = currentSorts.findIndex((s) => s.key === key);
    if (addMulti && multiSort) {
      const prev = currentSorts[idx]?.direction;
      const direction: "asc" | "desc" | null = prev ? (prev === "asc" ? "desc" : null) : "asc";
      const sorts: TableSort[] = !prev
        ? [...currentSorts, { key, direction: "asc" }]
        : direction
          ? currentSorts.map((s, i) => (i === idx ? { key, direction } : s))
          : currentSorts.filter((_, i) => i !== idx);
      onSort({ key, index, direction, sorts });
    } else {
      const sole = currentSorts.length === 1 && !idx ? currentSorts[0]!.direction : null;
      const direction: "asc" | "desc" | null = sole ? (sole === "asc" ? "desc" : null) : "asc";
      onSort(
        currentSorts.length > 1
          ? { key, index, direction, sorts: direction ? [{ key, direction }] : [] }
          : { key, index, direction },
      );
    }
    return true;
  };

  const onCellClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (target.dataset.resizeIndex || isDragging || !currentLayout) return;

    const colIndex = findCellIndex(target);
    if (colIndex === -1) return;

    const control = target.closest(INTERACTIVE);
    if (control && control !== cells[colIndex]) return;

    const col = currentLayout.columns[colIndex]!;
    onClick?.({ key: col.def.key, index: colIndex, event: e });
    emitSort(col, colIndex, e.shiftKey || e.ctrlKey || e.metaKey);
  };

  const onFocusIn = (e: FocusEvent): void => {
    const idx = findCellIndex(e.target);
    if (idx >= 0) setTabStop(idx);
  };

  const moveFocusToCell = (index: number): void => {
    if (index < 0 || index >= cells.length) return;
    setTabStop(index);
    cells[index]!.focus();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const key = e.key;
    const control = (e.target as HTMLElement).closest(INTERACTIVE);
    if (control && !control.hasAttribute("data-column-key")) return;

    if (key === "ArrowRight" || key === "ArrowLeft") {
      const dir = key === "ArrowRight" ? 1 : -1;
      if (e.ctrlKey || e.metaKey) {
        const col = currentLayout?.getColumn(focusedCellIndex);
        if (col?.resizable) {
          onResize(focusedCellIndex, col.width + dir * RESIZE_STEP);
          e.preventDefault();
        }
      } else {
        const next = focusedCellIndex + dir;
        if (next >= 0 && next < cells.length) {
          moveFocusToCell(next);
          e.preventDefault();
        }
      }
      e.stopPropagation();
      return;
    }

    if (key === "Home" || key === "End") {
      moveFocusToCell(key === "Home" ? 0 : cells.length - 1);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (key === "Enter" || key === " ") {
      if (
        emitSort(
          currentLayout?.getColumn(focusedCellIndex),
          focusedCellIndex,
          e.shiftKey || e.ctrlKey || e.metaKey,
        )
      ) {
        e.preventDefault();
      }
      e.stopPropagation();
      return;
    }

    if (key === "ArrowDown") {
      root.focus();
      e.preventDefault();
      e.stopPropagation();
    }
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("click", onCellClick);
  element.addEventListener("keydown", onKeyDown);
  element.addEventListener("focusin", onFocusIn);

  const show = (): void => {
    if (!isVisible) {
      isVisible = true;
      element.style.display = "";
    }
  };

  const hide = (): void => {
    if (isVisible) {
      isVisible = false;
      element.style.display = "none";
    }
  };

  const destroy = (): void => {
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("click", onCellClick);
    element.removeEventListener("keydown", onKeyDown);
    element.removeEventListener("focusin", onFocusIn);
    root.style.removeProperty("--vlist-table-header-height");
    if (ownsLive) liveRegion?.remove();
    liveRegion = null;
    rowgroup.remove();
    cells = [];
    sortIndicators = [];
    currentSorts = [];
    currentLayout = null;
    isVisible = false;
  };

  return {
    element,
    update,
    updateSort,
    rebuild,
    show,
    hide,
    destroy,
    syncScroll,
  } as TableHeader<T> & { syncScroll: (scrollLeft: number) => void };
};
