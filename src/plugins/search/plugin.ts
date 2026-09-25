/**
 * vlist — Search Plugin (RFC-008, Phase 1)
 *
 * A ready-to-use search bar with client-side filtering, match navigation, and
 * `<mark>` highlighting. Operates at the data layer (no `setRenderFn`), so it
 * composes with any layout.
 *
 * - **filter** mode (default): virtually hides non-matching items via
 *   `setGetItemFn` + `setVirtualTotalFn` (non-destructive — clear restores).
 * - **navigate** mode: keeps all items, scrolls between matches, highlights
 *   the current one.
 *
 * Phase 2 (server-side search via `data()`, column-aware, fuzzy, query syntax)
 * is out of scope here.
 *
 * Restrictions:
 * - Cannot be combined with `data()`. Filtering is client-side over the items
 *   the list holds, and with an adapter those are only the loaded window.
 *   Query the remote dataset through the adapter instead.
 * - Cannot be combined with `tree()`. Filtering a tree means preserving the
 *   ancestors of each match, which belongs to the plugin that owns the layout;
 *   `tree()` provides no such hook.
 * - Cannot *yet* be combined with `carousel()`. Filter mode replaces the item
 *   accessors and the total that the carousel window owns, and clearing the
 *   query does not give them back. Fixable — see `conflicts` below.
 */

import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import type { EngineState } from "../../core/state";
import type { StampableRow } from "../../core/dom";
import type { ItemState } from "../../types";
import {
  makeGetText,
  textMatches,
  highlightElement,
  clearHighlights,
  type FieldAccessor,
} from "./match";
import { createSearchBar, type SearchBar } from "./searchbar";

/**
 * Consumer-facing UI text for the search bar (RFC-010 — Externalized UI Text).
 * This is the plugin's entire human-language surface: static accessible names
 * plus the dynamic counter formatters. All fields are optional; unset fields
 * fall back to {@link DEFAULT_SEARCH_TEXT} (English). Consumers localizing for a
 * non-English document should override these *and* set `lang` on the page.
 */
export interface SearchText {
  /** Input placeholder + accessible name. */
  placeholder?: string;
  /** Accessible name for the clear (×) button. */
  clear?: string;
  /** Accessible name for the previous-match button (navigate mode). */
  previous?: string;
  /** Accessible name for the next-match button (navigate mode). */
  next?: string;
  /** Counter text when there are no matches. */
  noResults?: string;
  /** Counter text in filter mode — total match count. */
  results?: (count: number) => string;
  /** Counter text in navigate mode — current position within matches. */
  position?: (current: number, total: number) => string;
  /** Accessible name for the `role="search"` landmark. Unnamed when omitted. */
  region?: string;
}

/**
 * Default English UI text for the search plugin. The single, documented,
 * fully-overridable language surface (RFC-010): the only place human-readable
 * strings live in the library.
 */
export const DEFAULT_SEARCH_TEXT: Required<SearchText> = {
  placeholder: "Search…",
  clear: "Clear search",
  previous: "Previous match",
  next: "Next match",
  noResults: "No results",
  results: (count) => `${count} result${count === 1 ? "" : "s"}`,
  position: (current, total) => `${current} of ${total}`,
  region: "",
};

export interface SearchPluginConfig<T extends VListItem = VListItem> {
  /** Hide non-matching items ("filter") or jump between matches ("navigate"). Default "filter". */
  mode?: "filter" | "navigate";
  /** Where to place the search bar. "none" = invisible, keyboard-only. Default "top". */
  position?: "top" | "bottom" | "none";
  /** Field(s) to search — a property key, accessor, or (default) all string values. */
  field?: FieldAccessor<T>;
  /** Case-sensitive matching. Default false. */
  caseSensitive?: boolean;
  /**
   * Highlight matched substrings in rendered rows by wrapping them in
   * `<mark class="{prefix}-search-match">`. Default `true`.
   *
   * - `false` — disable highlighting.
   * - `{ within }` — restrict highlighting to descendants matching the CSS
   *   selector (e.g. `".person__name"`) instead of the whole row. Useful when
   *   the query can coincidentally appear in fields you didn't search.
   */
  highlight?: boolean | { within?: string };
  /** Minimum query length to trigger search. Default 1. */
  minLength?: number;
  /** Auto-close the search bar after N ms of inactivity (0 = never). Default 0. */
  cancelTimeout?: number;
  /** Visual style of the search bar. `"md3"` applies a Material Design 3 pill
   *  (requires the search stylesheet). Default `"default"`. */
  variant?: "default" | "md3";
  /** Consumer-supplied UI text / localization. Falls back to {@link DEFAULT_SEARCH_TEXT}. */
  text?: SearchText;
}

/** Methods the search plugin adds to the list instance. */
export interface SearchMethods {
  /** Show the search bar. */
  openSearch(): void;
  /** Hide the search bar and clear the query. */
  closeSearch(): void;
  /** Set the query, opening the bar when needed. */
  setQuery(query: string): void;
  /** The current query. */
  getQuery(): string;
  /** Move to the next match. */
  nextMatch(): void;
  /** Move to the previous match. */
  prevMatch(): void;
  /** Indices of the matching items. */
  getMatches(): number[];
}

export interface SearchPluginInstance<T extends VListItem = VListItem> extends VListPlugin<T, SearchMethods> {}

export function search<T extends VListItem = VListItem>(
  config: SearchPluginConfig<T> = {},
): SearchPluginInstance<T> {
  const mode = config.mode ?? "filter";
  const position = config.position ?? "top";
  const text: Required<SearchText> = { ...DEFAULT_SEARCH_TEXT, ...config.text };
  const caseSensitive = config.caseSensitive ?? false;
  const doHighlight = config.highlight !== false;
  // Optional CSS selector that scopes highlighting to matching descendants.
  const highlightWithin =
    typeof config.highlight === "object" && config.highlight !== null
      ? config.highlight.within
      : undefined;
  const minLength = config.minLength ?? 1;
  const cancelTimeout = config.cancelTimeout ?? 0;
  const variant = config.variant ?? "default";
  const getText = makeGetText<T>(config.field);

  let ctx: PluginContext<T>;
  let engineState: EngineState;
  let classPrefix: string;
  let matchClass: string;
  let currentClass: string;

  let bar: SearchBar | null = null;
  let open = false;
  let query = "";
  /** Bumped on every query change. Rows stamped with an older value re-highlight.
   *  Starts at 1: 0 is the row stamp a renderer voids when it rewrites a row. */
  let queryVersion = 1;
  /** Whether any rendered row may still carry marks — gates the clearing pass. */
  let marksPresent = false;
  /** Original-index list of matching items. */
  let matches: number[] = [];
  let matchSet = new Set<number>();
  /** Position within `matches` of the focused match (navigate mode). */
  let current = 0;
  /** Whether a virtual filter is currently applied (filter mode). */
  let filtered = false;
  let cancelTimer: ReturnType<typeof setTimeout> | null = null;

  // Lazily-resolved cross-plugin methods.
  let resolved = false;
  let scrollToIndexFn: ((index: number, align?: string) => void) | null = null;
  let d2lFn: ((dataIndex: number) => number) | null = null;
  let l2dFn: ((layoutIndex: number) => number) | null = null;

  const resolveOnce = (): void => {
    if (resolved) return;
    resolved = true;
    scrollToIndexFn = (ctx.hooks.get("scrollToIndex") as typeof scrollToIndexFn) ?? null;
    d2lFn = (ctx.hooks.get("_dataToLayoutIndex") as typeof d2lFn) ?? null;
    l2dFn = (ctx.hooks.get("_layoutToDataIndex") as typeof l2dFn) ?? null;
  };

  // ── Matching ────────────────────────────────────────────────────────────

  const computeMatches = (): void => {
    matches = [];
    matchSet.clear();
    if (query.length < minLength) return;
    const needle = caseSensitive ? query : query.toLowerCase();
    const items = ctx.items.all();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item !== undefined && textMatches(getText(item), needle, caseSensitive)) {
        matches.push(i);
        matchSet.add(i);
      }
    }
  };

  // ── Filter mode (virtual filter) ──────────────────────────────────────────

  const applyFilter = (): void => {
    resolveOnce();
    const base = ctx.items.all();
    const idx = matches;
    ctx.items.setGetFn((i: number): T | undefined => base[idx[i]!]);
    ctx.items.setTotalFn(() => idx.length);
    engineState.totalItems = idx.length;
    ctx.sizes.rebuild();
    ctx.render.contentSize(ctx.sizes.cache.getTotalSize());
    filtered = true;
  };

  const restoreItems = (): void => {
    if (!filtered) return;
    filtered = false;
    ctx.items.setGetFn((i: number): T | undefined => ctx.items.all()[i]);
    ctx.items.setTotalFn(() => ctx.items.all().length);
    engineState.totalItems = ctx.items.all().length;
    ctx.sizes.rebuild();
    ctx.render.contentSize(ctx.sizes.cache.getTotalSize());
  };

  // ── Navigate mode ─────────────────────────────────────────────────────────

  const scrollToMatch = (): void => {
    resolveOnce();
    const original = matches[current];
    if (original === undefined) return;
    if (scrollToIndexFn) scrollToIndexFn(original, "center");
    else ctx.scroll.to(Math.max(0, ctx.sizes.cache.getOffset(original) - ctx.getState().containerSize / 2));
    const item = ctx.items.at(original);
    ctx.emitter.emit("search:match", {
      index: original,
      item,
      matchIndex: current,
      matches: matches.length,
    });
  };

  // ── Counter + state class ──────────────────────────────────────────────────

  const updateCounter = (): void => {
    if (!bar) return;
    if (query.length < minLength) {
      bar.setCounter("");
    } else if (matches.length === 0) {
      bar.setCounter(text.noResults);
    } else if (mode === "navigate") {
      bar.setCounter(text.position(current + 1, matches.length));
    } else {
      bar.setCounter(text.results(matches.length));
    }
  };

  const setSearchingClass = (): void => {
    const active = open && query.length >= minLength;
    ctx.dom.root.classList.toggle(`${classPrefix}--searching`, active);
  };

  // ── Query application ───────────────────────────────────────────────────────

  const applyQuery = (next: string): void => {
    if (next !== query) queryVersion++;
    query = next;
    bar?.setValue(query);
    computeMatches();
    current = 0;

    if (mode === "filter") {
      if (query.length >= minLength) applyFilter();
      else restoreItems();
    }

    setSearchingClass();
    updateCounter();
    ctx.render.force(); // fresh innerHTML so highlight re-applies for the new query

    if (mode === "navigate" && matches.length > 0) scrollToMatch();

    ctx.emitter.emit("search:change", {
      query,
      matches: matches.length,
      total: ctx.items.all().length,
    });
    armCancelTimer();
  };

  // ── Open / close ────────────────────────────────────────────────────────────

  // Opens without moving the caret. openSearch() also selects the field,
  // which would replace what the user just typed on the next key.
  const markOpen = (): void => {
    if (!open) {
      open = true;
      ctx.dom.root.classList.add(`${classPrefix}--search-open`);
      ctx.emitter.emit("search:open", undefined);
    }
    armCancelTimer();
  };

  const openSearch = (): void => {
    markOpen();
    bar?.focus();
  };

  const closeSearch = (): void => {
    clearCancelTimer();
    const wasOpen = open || query.length > 0;
    open = false;
    if (query.length > 0) applyQuery("");
    ctx.dom.root.classList.remove(`${classPrefix}--search-open`);
    setSearchingClass();
    if (wasOpen) ctx.emitter.emit("search:close", undefined);
  };

  // ── Match navigation ────────────────────────────────────────────────────────

  const step = (delta: number): void => {
    if (matches.length === 0) return;
    current = (current + delta + matches.length) % matches.length;
    updateCounter();
    if (mode === "navigate") {
      scrollToMatch();
      ctx.render.force(); // re-evaluate the --current mark
    }
  };

  // ── Cancel timer (invisible / inactivity auto-close) ─────────────────────────

  const clearCancelTimer = (): void => {
    if (cancelTimer !== null) {
      clearTimeout(cancelTimer);
      cancelTimer = null;
    }
  };
  const armCancelTimer = (): void => {
    clearCancelTimer();
    if (cancelTimeout > 0 && open) {
      cancelTimer = setTimeout(() => {
        cancelTimer = null;
        closeSearch();
      }, cancelTimeout);
    }
  };

  // ── Highlight pass (after each commit) ────────────────────────────────────────

  /**
   * A row's marks stay valid until either the query changes or the row's
   * content is rewritten, and a commit that merely moved the range does
   * neither. The stamp therefore rides on the row element's `_stamp` slot and
   * holds the `queryVersion` the marks were built for: every renderer voids
   * that slot when it writes the row, which is the only sound signal there is.
   * Node identity is not one — `item.template` may return an `HTMLElement` and
   * hand back that same object on a later call, so the row's first child
   * outlives a rewrite that emptied it.
   */
  interface StampedRow extends StampableRow {
    /** Whether this row currently carries the `--current` class (navigate). */
    _searchMarkCurrent?: boolean;
  }

  const highlightRow = (el: HTMLElement): void => {
    if (highlightWithin) {
      // Scope marking to the matching descendants only.
      const scoped = el.querySelectorAll<HTMLElement>(highlightWithin);
      for (let s = 0; s < scoped.length; s++) {
        highlightElement(scoped[s]!, query, caseSensitive, matchClass);
      }
    } else {
      highlightElement(el, query, caseSensitive, matchClass);
    }
  };

  const clearRow = (el: HTMLElement): void => {
    if (highlightWithin) {
      const scoped = el.querySelectorAll<HTMLElement>(highlightWithin);
      for (let s = 0; s < scoped.length; s++) {
        clearHighlights(scoped[s]!, matchClass);
      }
    } else {
      clearHighlights(el, matchClass);
    }
  };

  const highlightVisible = (state: EngineState): void => {
    if (!doHighlight) return;
    // No query and no marks left over from one: every commit of every list
    // that merely has search() installed lands here, so it costs one compare.
    const active = query.length >= minLength;
    if (!active && !marksPresent) return;
    resolveOnce();
    const start = state.startIndex;
    const end = start + Math.max(0, state.visibleCount - 1);
    const currentOriginal = mode === "navigate" ? matches[current] : -1;
    // startIndex/visibleCount are data-space (groups fills them that way so
    // loaders request items, not headers). renderedElement is layout-space —
    // headers occupy indices — so look up through the mapping groups publishes.
    for (let dataIndex = start; dataIndex <= end; dataIndex++) {
      const layoutIndex = d2lFn !== null ? d2lFn(dataIndex) : dataIndex;
      if (l2dFn !== null && l2dFn(layoutIndex) < 0) continue;
      const el = ctx.dom.renderedElement(layoutIndex);
      if (!el) continue;

      const row = el as StampedRow;
      if (row._stamp !== queryVersion) {
        // Newly rendered, rewritten, or built for an older query.
        if (active) {
          highlightRow(el);
          marksPresent = true;
          row._stamp = queryVersion;
          row._searchMarkCurrent = false;
        } else if (row._stamp) {
          // Marks built for a query that is no longer active. A row the
          // renderer has written since carries 0 and costs nothing.
          clearRow(el);
          row._stamp = 0;
        }
      }

      if (active && mode === "navigate") {
        // Cheap by construction: only the row entering or leaving the current
        // match touches the DOM — the rest compare one property and move on.
        const isCurrentRow = dataIndex === currentOriginal;
        if (row._searchMarkCurrent !== isCurrentRow) {
          const marks = el.querySelectorAll(`.${matchClass}`);
          for (let m = 0; m < marks.length; m++) {
            marks[m]!.classList.toggle(currentClass, isCurrentRow);
          }
          row._searchMarkCurrent = isCurrentRow;
        }
      }
    }
    // The pass above visited every rendered row, so nothing is marked now.
    if (!active) marksPresent = false;
  };

  // ── Keyboard ─────────────────────────────────────────────────────────────────

  const isPrintable = (e: KeyboardEvent): boolean =>
    e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

  const onKeydown = (e: KeyboardEvent): void => {
    // Ctrl/Cmd+F opens regardless of state.
    if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
      e.preventDefault();
      openSearch();
      return;
    }
    if (!open) {
      // Invisible mode: a printable key starts type-ahead search.
      if (position === "none" && isPrintable(e)) {
        e.preventDefault();
        openSearch();
        applyQuery(query + e.key);
      }
      return;
    }
    // Open: handle navigation/close keys. (Printable input in visible mode is
    // handled by the input element's own `input` event.)
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        closeSearch();
        break;
      case "Enter":
        e.preventDefault();
        step(e.shiftKey ? -1 : 1);
        break;
      case "ArrowDown":
        e.preventDefault();
        step(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        step(-1);
        break;
      default:
        if (position === "none") {
          if (e.key === "Backspace") {
            e.preventDefault();
            applyQuery(query.slice(0, -1));
            if (query.length === 0) closeSearch();
          } else if (isPrintable(e)) {
            e.preventDefault();
            applyQuery(query + e.key);
          }
        }
    }
  };

  // ── Bar input callbacks ─────────────────────────────────────────────────────

  const onBarKeydown = (e: KeyboardEvent): void => {
    // The input is focused; route nav/close keys, let text input through.
    if (e.key === "Escape" || e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
      onKeydown(e);
    }
  };

  return {
    name: "search",
    // Filtering is client-side over the items the list holds. Under data() those
    // are a sliding window of loaded rows, so a query could only ever match what
    // happened to be loaded — and clearing a filter is worse than useless there:
    // restoreItems() reinstates static getItem/virtualTotal functions over the
    // ones data() installed, so the list keeps the empty total for good.
    // Searching a remote dataset belongs to the adapter's own query.
    //
    // tree() owns the layout index space, and never implemented the filterTree
    // hook this plugin was written to call. Filtering therefore fell through to
    // flat indices into the source array: the total was corrupted, children
    // were never matched, and clearing left the list a size it had never been.
    //
    // carousel is "not yet", not "never". A searchable carousel is a
    // reasonable thing to want, and the reason it does not work is fixable:
    // filter mode replaces setGetFn, setTotalFn and engineState.totalItems,
    // which is exactly the window carousel installs over the data, and
    // installWindow runs once. Measured on 30 items: the engine total went
    // 30 → 1 on a query and came back 10, never 30, because restoreItems
    // writes identity accessors over carousel's; painted slides went
    // 12 → 0 → 3. Clearing the query does not recover the list. Whoever
    // teaches the two to compose — a filter that maps through the window
    // instead of replacing it — can delete this entry, which is safe to do
    // in a way that adding one is not.
    conflicts: ["data", "tree", "carousel"],
    // Run after selection (50) so its item-state fn is captured and composed
    // (state.search alongside state.selected), and so a filter override is the
    // outermost item transform.
    priority: 55,

    setup(context: PluginContext<T>): void {
      ctx = context;
      engineState = ctx.getState();
      classPrefix = ctx.config.classPrefix;
      matchClass = `${classPrefix}-search-match`;
      currentClass = `${classPrefix}-search-match--current`;

      if (position !== "none") {
        const listId = ctx.dom.root.id || undefined;
        bar = createSearchBar(
          ctx.dom.root,
          ctx.dom.viewport,
          classPrefix,
          position,
          {
            placeholder: text.placeholder,
            clear: text.clear,
            previous: text.previous,
            next: text.next,
            region: text.region,
          },
          listId,
          {
            onInput: (value) => {
              markOpen();
              applyQuery(value);
            },
            onClear: () => applyQuery(""),
            onPrev: () => step(-1),
            onNext: () => step(1),
            onKeydown: onBarKeydown,
          },
        );
        bar.showNav(mode === "navigate");
        if (variant !== "default") {
          bar.root.classList.add(`${classPrefix}-search--${variant}`);
        }
        // Lay the root out as a column so the bar reserves space and the
        // viewport fills the rest (any bar height) instead of overflowing.
        ctx.dom.root.classList.add(`${classPrefix}--has-search`);
      }

      // Compose search state into the template state.
      const prevStateFn = ctx.render.getStateFn();
      ctx.render.setStateFn((index: number, is: ItemState): void => {
        if (prevStateFn) prevStateFn(index, is);
        if (query.length < minLength) {
          delete is.search;
          return;
        }
        if (mode === "filter") {
          // index is the filtered (virtual) position — all visible rows match.
          is.search = { matched: true, query, matchIndex: index, isCurrent: false };
        } else {
          const matchIndex = matches.indexOf(index);
          is.search = {
            matched: matchSet.has(index),
            query,
            matchIndex,
            isCurrent: matchIndex !== -1 && matchIndex === current,
          };
        }
      });

      // Filter remaps getItemFn, not the source array. selection() (and
      // masonry, sortable) resolve rows through this hook; without it they
      // read items.all()[i] and select the unfiltered occupant of a
      // filtered row.
      ctx.hooks.method("_getLoadedItem", (index: number): T | undefined => ctx.items.at(index));

      // Public methods.
      ctx.hooks.method("openSearch", openSearch);
      ctx.hooks.method("closeSearch", closeSearch);
      ctx.hooks.method("setQuery", (q: string) => {
        if (!open) openSearch();
        applyQuery(q);
      });
      ctx.hooks.method("getQuery", () => query);
      ctx.hooks.method("nextMatch", () => step(1));
      ctx.hooks.method("prevMatch", () => step(-1));
      ctx.hooks.method("getMatches", () => matches.slice());

      ctx.hooks.onKeydown(onKeydown);

      ctx.hooks.onDestroy(() => {
        clearCancelTimer();
        restoreItems();
        bar?.destroy();
        bar = null;
        ctx.dom.root.classList.remove(
          `${classPrefix}--search-open`,
          `${classPrefix}--searching`,
          `${classPrefix}--has-search`,
        );
      });
    },

    hooks: {
      onCommit(state: EngineState): void {
        highlightVisible(state);
      },
    },
  };
}
