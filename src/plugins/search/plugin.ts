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
 */

import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";
import type { EngineState } from "../../core/state";
import type { ItemState } from "../../types";
import { makeGetText, textMatches, highlightElement, type FieldAccessor } from "./match";
import { createSearchBar, type SearchBar } from "./searchbar";

export interface SearchPluginConfig<T extends VListItem = VListItem> {
  /** Hide non-matching items ("filter") or jump between matches ("navigate"). Default "filter". */
  mode?: "filter" | "navigate";
  /** Where to place the search bar. "none" = invisible, keyboard-only. Default "top". */
  position?: "top" | "bottom" | "none";
  /** Input placeholder. Default "Search…". */
  placeholder?: string;
  /** Field(s) to search — a property key, accessor, or (default) all string values. */
  field?: FieldAccessor<T>;
  /** Case-sensitive matching. Default false. */
  caseSensitive?: boolean;
  /** Wrap matched text in `<mark>`. Default true. */
  highlight?: boolean;
  /** Minimum query length to trigger search. Default 1. */
  minLength?: number;
  /** Auto-close the search bar after N ms of inactivity (0 = never). Default 0. */
  cancelTimeout?: number;
}

export interface SearchPluginInstance<T extends VListItem = VListItem> extends VListPlugin<T> {}

export function search<T extends VListItem = VListItem>(
  config: SearchPluginConfig<T> = {},
): SearchPluginInstance<T> {
  const mode = config.mode ?? "filter";
  const position = config.position ?? "top";
  const placeholder = config.placeholder ?? "Search…";
  const caseSensitive = config.caseSensitive ?? false;
  const doHighlight = config.highlight !== false;
  const minLength = config.minLength ?? 1;
  const cancelTimeout = config.cancelTimeout ?? 0;
  const getText = makeGetText<T>(config.field);

  let ctx: PluginContext<T>;
  let engineState: EngineState;
  let classPrefix: string;
  let matchClass: string;
  let currentClass: string;

  let bar: SearchBar | null = null;
  let open = false;
  let query = "";
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
  let filterTreeFn: ((predicate: (item: T) => boolean) => void) | null = null;
  let clearFilterTreeFn: (() => void) | null = null;

  const resolveOnce = (): void => {
    if (resolved) return;
    resolved = true;
    scrollToIndexFn = (ctx.getMethod("scrollToIndex") as typeof scrollToIndexFn) ?? null;
    filterTreeFn = (ctx.getMethod("filterTree") as typeof filterTreeFn) ?? null;
    clearFilterTreeFn = (ctx.getMethod("clearTreeFilter") as typeof clearFilterTreeFn) ?? null;
  };

  // ── Matching ────────────────────────────────────────────────────────────

  const computeMatches = (): void => {
    matches = [];
    matchSet.clear();
    if (query.length < minLength) return;
    const needle = caseSensitive ? query : query.toLowerCase();
    const items = ctx.getItems();
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
    // Delegate to the tree plugin (ancestor-preserving filter) when present.
    if (filterTreeFn) {
      const needle = caseSensitive ? query : query.toLowerCase();
      filterTreeFn((item) => textMatches(getText(item), needle, caseSensitive));
      filtered = true;
      return;
    }
    const base = ctx.getItems();
    const idx = matches;
    ctx.setGetItemFn((i: number): T | undefined => base[idx[i]!]);
    ctx.setVirtualTotalFn(() => idx.length);
    engineState.totalItems = idx.length;
    ctx.rebuildSizeCache();
    ctx.updateContentSize(ctx.sizeCache.getTotalSize());
    filtered = true;
  };

  const restoreItems = (): void => {
    if (!filtered) return;
    filtered = false;
    if (clearFilterTreeFn) {
      clearFilterTreeFn();
      return;
    }
    ctx.setGetItemFn((i: number): T | undefined => ctx.getItems()[i]);
    ctx.setVirtualTotalFn(() => ctx.getItems().length);
    engineState.totalItems = ctx.getItems().length;
    ctx.rebuildSizeCache();
    ctx.updateContentSize(ctx.sizeCache.getTotalSize());
  };

  // ── Navigate mode ─────────────────────────────────────────────────────────

  const scrollToMatch = (): void => {
    resolveOnce();
    const original = matches[current];
    if (original === undefined) return;
    if (scrollToIndexFn) scrollToIndexFn(original, "center");
    else ctx.scrollTo(Math.max(0, ctx.sizeCache.getOffset(original) - ctx.getState().containerSize / 2));
    const item = ctx.getItem(original);
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
      bar.setCounter("No results");
    } else if (mode === "navigate") {
      bar.setCounter(`${current + 1} of ${matches.length}`);
    } else {
      bar.setCounter(`${matches.length} result${matches.length === 1 ? "" : "s"}`);
    }
  };

  const setSearchingClass = (): void => {
    const active = open && query.length >= minLength;
    ctx.dom.root.classList.toggle(`${classPrefix}--searching`, active);
  };

  // ── Query application ───────────────────────────────────────────────────────

  const applyQuery = (next: string): void => {
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
    ctx.forceRender(); // fresh innerHTML so highlight re-applies for the new query

    if (mode === "navigate" && matches.length > 0) scrollToMatch();

    ctx.emitter.emit("search:change", {
      query,
      matches: matches.length,
      total: ctx.getItems().length,
    });
    armCancelTimer();
  };

  // ── Open / close ────────────────────────────────────────────────────────────

  const openSearch = (): void => {
    if (!open) {
      open = true;
      ctx.dom.root.classList.add(`${classPrefix}--search-open`);
      ctx.emitter.emit("search:open", undefined);
    }
    bar?.focus();
    armCancelTimer();
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
      ctx.forceRender(); // re-evaluate the --current mark
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

  const highlightVisible = (state: EngineState): void => {
    if (!doHighlight || query.length < minLength) return;
    const start = state.startIndex;
    const end = start + Math.max(0, state.visibleCount - 1);
    const currentOriginal = mode === "navigate" ? matches[current] : -1;
    for (let i = start; i <= end; i++) {
      const el = ctx.getRenderedElement(i);
      if (!el) continue;
      highlightElement(el, query, caseSensitive, matchClass);
      if (mode === "navigate") {
        // Toggle the current-match class on this row's marks.
        const isCurrentRow = i === currentOriginal;
        const marks = el.querySelectorAll(`.${matchClass}`);
        for (let m = 0; m < marks.length; m++) {
          marks[m]!.classList.toggle(currentClass, isCurrentRow);
        }
      }
    }
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
    priority: 25,

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
          placeholder,
          listId,
          {
            onInput: (value) => applyQuery(value),
            onPrev: () => step(-1),
            onNext: () => step(1),
            onClose: () => closeSearch(),
            onKeydown: onBarKeydown,
          },
        );
        bar.showNav(mode === "navigate");
      }

      // Compose search state into the template state.
      const prevStateFn = ctx.getItemStateFn();
      ctx.setItemStateFn((index: number, is: ItemState): void => {
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

      // Public methods.
      ctx.registerMethod("openSearch", openSearch);
      ctx.registerMethod("closeSearch", closeSearch);
      ctx.registerMethod("setQuery", (q: string) => {
        if (!open) openSearch();
        applyQuery(q);
      });
      ctx.registerMethod("getQuery", () => query);
      ctx.registerMethod("nextMatch", () => step(1));
      ctx.registerMethod("prevMatch", () => step(-1));
      ctx.registerMethod("getMatches", () => matches.slice());

      ctx.registerKeydownHandler(onKeydown);

      ctx.registerDestroyHandler(() => {
        clearCancelTimer();
        restoreItems();
        bar?.destroy();
        bar = null;
        ctx.dom.root.classList.remove(`${classPrefix}--search-open`, `${classPrefix}--searching`);
      });
    },

    hooks: {
      onCommit(state: EngineState): void {
        highlightVisible(state);
      },
    },
  };
}
