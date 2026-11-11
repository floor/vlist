/**
 * vlist/table — rowAttributes() feature
 *
 * Opt-in per-row classes and attributes for `table({ features: [rowAttributes(fn)] })`.
 * The callback returns `{ class, attrs }` for a row; the feature wraps the
 * table renderer and applies the record after every paint:
 * - `render()` — decorate every data row in the rendered range
 *
 * The table plugin drives every row change through `render()` (a selection
 * flip, an `updateItem()` call or a scroll all end in a repaint), so the
 * renderer's `updateItem()` / `updateItemClasses()` methods are not overridden.
 *
 * The table renderer owns row classes (it rewrites `className` wholesale on a
 * selection or focus change) and releases pooled rows without knowing which
 * attributes it did not set, so this module remembers what it wrote per
 * element and diffs it on every item change, and re-adds the class on every
 * frame. Nothing global to reset: a released element carries its own memo.
 *
 * Mounted only through `table({ features: [rowAttributes()] })`. Not imported
 * by `table()`, so a plain table pays nothing for it.
 */

import type { Range, VListItem } from "../../types";
import type { PluginContext, VListPlugin } from "../../core/types";
import type { TableRendererInstance } from "./renderer";
import type { TableFeature } from "./feature";
import type { RowAttributes } from "./types";

// =============================================================================
// Constants
// =============================================================================

/** Attributes the table owns; a record naming one never overrides it. */
const RESERVED_ATTRS = new Set([
  "id",
  "role",
  "data-index",
  "data-id",
  "aria-rowindex",
  "aria-selected",
]);

/** The role a data or placeholder row carries; a group header is "presentation". */
const DATA_ROW_ROLE = "row";
const GROUP_HEADER_ROLE = "presentation";

/** Split a `class` string, dropping empty names (`classList.add` rejects ""). */
const classNames = (value: string): string[] => value.split(/\s+/).filter(Boolean);

// =============================================================================
// Per-element memo
// =============================================================================

interface RowMemo<T extends VListItem> {
  item: T;
  index: number;
  record: RowAttributes | void;
  /** Attribute names this feature wrote and must remove when the record drops them. */
  names: string[];
}

/** A row element carrying the attributes this feature wrote on it. */
type MemoRow<T extends VListItem> = HTMLElement & {
  __vlistRowAttrs?: RowMemo<T>;
};

// =============================================================================
// Factory
// =============================================================================

/**
 * Add classes and attributes to table rows.
 *
 * ```ts
 * table({
 *   columns,
 *   rowHeight: 40,
 *   features: [rowAttributes((item) => item.status === "error"
 *     ? { class: "row-error", attrs: { "data-status": "error" } }
 *     : undefined)],
 * })
 * ```
 *
 * The callback runs when a row is mounted for an item or its item/index
 * changes — not on selection or focus changes. Group-header rows are never
 * decorated. The reserved names `id`, `role`, `data-index`, `data-id`,
 * `aria-rowindex` and `aria-selected` are ignored.
 */
export function rowAttributes<T extends VListItem = VListItem>(
  fn: (item: T, index: number) => RowAttributes | void,
): TableFeature<T> {
  return {
    name: "rowAttributes",

    attach(plugin: VListPlugin<T>): void {
      const prevSetup = plugin.setup;
      plugin.setup = (ctx: PluginContext<T>): void => {
        prevSetup?.call(plugin, ctx);
        const replaceRenderer = ctx.hooks.get("_wrapTableRenderer") as
          | ((
              wrap: (
                prev: TableRendererInstance<T> | null,
              ) => TableRendererInstance<T> | null,
            ) => void)
          | undefined;
        replaceRenderer?.((base) => base && wrapRenderer(base, fn));
      };
    },
  };
}

// =============================================================================
// Renderer wrapper
// =============================================================================

function wrapRenderer<T extends VListItem>(
  base: TableRendererInstance<T>,
  fn: (item: T, index: number) => RowAttributes | void,
): TableRendererInstance<T> {
  /**
   * Apply the record for one row. The callback runs when the element now
   * carries a different item or index; otherwise what the last record wrote
   * is still on the element, untouched by the renderer.
   */
  const decorate = (el: MemoRow<T>, index: number, item: T): void => {
    let memo = el.__vlistRowAttrs;
    if (!memo || memo.item !== item || memo.index !== index) {
      const record = fn(item, index);
      const attrs = record?.attrs;
      const names: string[] = [];
      if (attrs) {
        for (const name in attrs) {
          if (RESERVED_ATTRS.has(name)) continue;
          names.push(name);
          const value = attrs[name];
          if (value === null || value === undefined || value === false) {
            el.removeAttribute(name);
          } else {
            el.setAttribute(name, value === true ? "" : String(value));
          }
        }
      }
      if (memo) {
        for (const name of memo.names) {
          if (!names.includes(name)) el.removeAttribute(name);
        }
      }
      memo = { item, index, record, names };
      el.__vlistRowAttrs = memo;
    }
    if (memo.record?.class) {
      el.classList.add(...classNames(memo.record.class));
    }
  };

  /**
   * A data row released and re-acquired as a group header keeps its element
   * (and so its expando) but was never a data row in this frame: drop what a
   * previous data row wrote before the header reuses it.
   */
  const stripHeader = (el: MemoRow<T>): void => {
    const memo = el.__vlistRowAttrs;
    if (!memo) return;
    for (const name of memo.names) el.removeAttribute(name);
    delete el.__vlistRowAttrs;
  };

  const render: TableRendererInstance<T>["render"] = (
    items: T[],
    range: Range,
    selectedIds: Set<string | number>,
    focusedIndex: number,
    origin?: number,
  ): void => {
    base.render(items, range, selectedIds, focusedIndex, origin);
    for (let i = range.start; i <= range.end; i++) {
      const item = items[i - range.start];
      if (!item) continue;
      const el = base.getElement(i) as MemoRow<T> | undefined;
      if (!el) continue;
      if (el.getAttribute("role") === GROUP_HEADER_ROLE) {
        stripHeader(el);
        continue;
      }
      if (el.getAttribute("role") === DATA_ROW_ROLE) {
        decorate(el, i, item);
      }
    }
  };

  return { ...base, render };
}
