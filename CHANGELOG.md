# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This changelog starts at v1.5.4, the first version published under the `vlist` package name
(April 2026). Earlier versions were published as `@floor/vlist` — see the
[git history](https://github.com/floor/vlist/commits/main) for the full record.

## [Unreleased]

### Added

- **Table `fillWidth`** — make rows span the full container width when columns don't (`table({ fillWidth })`)
  - `"stretch"` (or `true`) — grow columns proportionally to their current width (respecting `maxWidth`)
  - `"spacer"` — keep every column's exact width and extend rows with empty trailing space, so column widths stay meaningful while backgrounds, row borders, and striping still reach the edge
  - A no-op once columns overflow the container; recomputed on container resize and column-preset changes; `"spacer"` re-absorbs slack after a manual column resize
  - Exposes the `TableFillMode` type
- **Data `loadInitial()`** — load page 1 deterministically regardless of container dimensions (`loadVisibleRange` stays a no-op until the viewport is measured)
- **Data `onResize` hook** — loads the visible range when the container first gains dimensions

### Changed

- **Snapshots `restoreScroll()`** now returns `Promise<void>` that resolves once the visible data has loaded, so callers can `await` the full restore instead of relying on fire-and-forget rAF

### Fixed

- **Click resolution with groups** — `resolveClickedItem` maps the layout index to the data index when the groups plugin is active, fixing clicks resolving to the wrong item past a group header
- **Table placeholder cells** — cells whose template returns an empty string (or whose default accessor has no value yet) no longer render as solid full-width boxes; the renderer injects a `.vlist-table-cell-skeleton` bar so every placeholder cell shows a clean loading skeleton
- **Data reload no longer empties the list** — `reload()` (e.g. on a server-side sort/filter) keeps the last-known total so the list shows placeholders for the full range while reloading, instead of collapsing to an empty list when the refetch is slow or fails
- **Data auto-retry on failed loads** — failed chunk loads now retry the visible range with exponential backoff (2s→30s), replacing placeholders automatically once the network recovers; a `window` `online` event resets the backoff and retries immediately. No longer dependent solely on the `online` event (covers server errors, timeouts, and blocked requests)
- **Sticky group header during all-placeholder reloads** — when a reload (e.g. a server-side sort) leaves the visible range as placeholders, an enabled sticky header now stays displayed but empty instead of leaving a blank band; it fills in with the group label on recovery without a layout shift. The data plugin also rebuilds the size cache on loaded-count change (not just total change), so the grouped layout recomputes correctly after a reload that preserves the total

## [2.1.2] - 2026-06-02

### Added

- **Groups + Masonry integration** — groups plugin renders masonry items with shortest-lane placement
  - Per-item heights from the raw size spec with column-width context (true masonry, not uniform rows)
  - Lane reset at group boundaries
  - Sticky group header support in masonry mode

### Performance

- **Grid hot-path** — eliminated per-frame allocations and redundant work in the render loop: hoisted class strings, cached column width/gap, reused the item-range object, and inlined row/column math
- **Groups masonry content size** — O(1) lookup via precomputed per-group lane bottoms instead of a backward lane scan

### Fixed

- **Groups grid/masonry scroll-to-last** — `scrollToIndex` uses grid-aware offsets and content size; masonry `align: end` now reaches the true content bottom
- **Horizontal sticky group header** — renders as a full-height bar beside the content instead of a collapsed strip overlapping the first column; rotated labels are anchored to the top to match the sticky overlay

## [2.1.1] - 2026-06-01

### Added

- **Groups + Table + Data integration** — groups plugin works natively with table and async data plugins
  - `setGetItemFn` deferred via microtask for correct plugin ordering
  - `sizeCache.rebuild` interceptor with loaded-count guard for snapshots restore race
  - Sticky headers in table mode
- **Groups + Grid integration** — groups plugin renders grid items with correct column layout
  - Binary search on sorted position array for O(log n) visible range lookup
  - Grid-aware header positioning (full width, correct Y offsets)
  - Sticky header uses grid-aware offsets for correct group transitions
  - Padding support (crossAxisPadding, mainAxisPadding, startPadding)
  - Resize handling: rebuilds grid positions on container width change
- **Data plugin `_getItem` method** — returns placeholder objects for unloaded items (vs `_getLoadedItem` which returns undefined)

### Fixed

- **Selection with groups** — all item lookups use `getDataItemAtLayout` which resolves by data index via `getItems()[di]` or `_getLoadedItem(di)`, consistent across table, grid, and list modes
- **Keyboard navigation in table mode** — keydown listener moved from `dom.content` to `dom.root`; selection click handler focuses correct element when content has no tabindex
- **Smooth scroll idle** — `scheduleIdle()` called on final animation frame so data plugin loads visible range after scrollToIndex with smooth behavior
- **Snapshots `_suppressSave`** — removed permanently-blocking flag that prevented all saves after restore with `dataIndex`; pixel-perfect scroll restore via raw `scrollTop` when data total matches
- **Placeholders in table+groups+data** — groups' table-mode `getItemFn` uses `_getItem` (includes placeholders) instead of `_getLoadedItem` (returns undefined)
- **Groups grid content size** — includes `mainAxisPadding` for correct bottom padding
- **Groups scroll-into-view** — uses grid-aware Y positions with padding for keyboard navigation

## [2.1.0] - 2026-05-30

### Added

- **Tree plugin** — virtualized collapsible tree view with WAI-ARIA treeview keyboard navigation (`tree()`)
  - Nested children and flat `parentId` data modes
  - Expand/collapse with preserved state, async `loadChildren` for lazy loading
  - Keyboard: ArrowRight/Left expand/collapse, `*` expand siblings, type-ahead search
  - ARIA: `role="tree"`, `aria-level`, `aria-expanded`, `aria-setsize`/`aria-posinset`
  - Data mutations: `addChild`, `removeNode`, `moveNode` with cycle detection
  - Scale plugin compression support
  - `connectorLines` option with Zed-style indent guides via `vlist-tree.css`
  - `paddingStart` config for base indent
  - `isLastChild` on FlatNode and TreeState
- **`vlist-tree.css`** — opt-in stylesheet for tree indent guides and connector lines
- **`./styles/tree`** export in package.json
- **`setGetIndexByIdFn`** on PluginContext — layout-replacing plugins can override `getIndexById`
- **`_isFollowFocus`** on selection plugin — cross-plugin query for `followFocus` state

### Fixed

- `getItemAt()` now uses `getItemFn` when set (was reading raw items array)
- `getIndexById()` now delegates to plugin override when set
- `resolveClickedItem` uses `getItemFn` for layout-replacing plugins (tree, groups, grid)

### Changed

- Renamed `src/plugins/async/` → `src/plugins/data/` to match public export name
- Renamed `scripts/check-coverage.ts` → `coverage.ts`, `scripts/measure-size.ts` → `size.ts`

## [2.0.5] - 2026-05-29

### Changed

- **Plugin-driven ARIA semantics** — removed `interactive` config option; ARIA roles are now set by `a11y()` or `selection()` plugins via `enableListboxRole()`. Default is `role="list"` / `role="listitem"`; plugins upgrade to `role="listbox"` / `role="option"` with full keyboard navigation

### Added

- **Focusable descendant neutralization** — automatically sets `tabindex="-1"` on `<a href>`, `<button>`, `<input>`, `<select>`, `<textarea>`, and `[tabindex]` inside rendered items, following the WAI-ARIA composite widget pattern

### Fixed

- **Grid/masonry padding** — `padding` config now correctly offsets item positions and reduces column widths in grid and masonry layouts; previously padding was ignored for 2D layout plugins

## [2.0.4] - 2026-05-28

### Added

- **Grid + Scale compression** — grid plugin supports scale plugin compression for 1M+ item grids with compressed range calculation, viewport-relative positioning, and virtual-space smooth scrolling
- **Table + Scale compression** — table plugin supports scale plugin compression for 1M+ row tables with compressed range calculation and viewport-relative row positioning

### Fixed

- **Table item identity** — track items by reference instead of `item.id`, preventing stale renders when items share ids across updates (#91)
- **Render pipeline ordering** — release stale elements after appending new ones, preventing transient blank frames during synchronous renders; table plugin syncs `engineState.totalSize` for correct scrollbar bounds

### Performance

- **Contiguous release fast path** — batch element release when items are contiguous in the release queue, reducing DOM operations during range shifts (RFC-006)

### Refactored

- **Table render pipeline** — align with core pipeline: release-after-create ordering, removed redundant `scrollPos === lastScrollPosition` bail-out and 4 associated state variables

## [2.0.3] - 2026-05-28

### Fixed

- **Grid/masonry item identity** — track items by reference instead of `item.id`, preventing stale renders when items share ids across updates
- **Pipeline multi-instance safety** — removed module-scope release state that could corrupt element recycling when two vlist instances share a frame
- **Autosize scroll anchor** — use `sizeCache.indexAtOffset(scrollPosition)` for true first-visible index instead of `startIndex` which includes overscan, fixing over-compensation during measurements
- **Autosize scroll-to-end with measured items** — `smoothScrollTo` now accepts a dynamic target function re-evaluated each animation frame, so smooth scroll tracks the real maxScroll as ResizeObserver measurements change content size. End-pinning snaps via the ResizeObserver callback instead of onIdle, eliminating the 100ms-delayed chop

### Refactored

- **Removed dead `setVisibleRangeFn`** — no-op stub with no callers removed from PluginContext, types, and exports

## [2.0.2] - 2026-05-28

### Fixed

- **Scrollbar thumb in masonry/horizontal mode** — scrollbar plugin was reading `sizeCache.getTotalSize()` (flat-list total) instead of the layout-computed total, causing the thumb to stop short of the end in masonry horizontal layouts
- **Scroll direction labels for horizontal lists** — horizontal lists now correctly emit `direction: "left" | "right"` instead of `"up" | "down"` in scroll events
- **Snapshots totalSize sync** — `restoreScroll` now syncs `state.totalSize` during bootstrap, preventing stale scroll bounds after restore
- **Snapshots destroy safety** — prevent `TypeError` when list is destroyed during a pending save timer
- **TypeScript declarations** — build now emits `.d.ts` files in the published package

### Refactored

- **Axis-based internal model (RFC-005)** — replaced `horizontal: boolean` on `ResolvedConfig` with `AxisConfig { primary: 'x' | 'y', cross?: 'x' | 'y' }`. All internal code uses `config.axis.primary === "x"` (aliased as `isX`) instead of `horizontal`. New `hasCrossAxis` field replaces the implicit grid detection. `Axis` and `AxisConfig` types are now exported.

### Tests

- Axis-config resolution tests: vertical, horizontal, vertical grid, horizontal grid
- Scrollbar `engineState.totalSize` tests: bounds from engine state, bounds update on change, resize
- Horizontal scroll direction label test
- Coverage threshold tests for masonry, page, selection plugins

## [2.0.0] - 2026-05-27

### Added

- **Scrollbar touch support** — thumb drag and track tap via touch events, enabling scrollbar interaction on touch devices
- **Selection internal methods** — `_getFocusedId`, `_focusById`, `_seedSelection` for cross-plugin coordination (snapshots, sortable)

### Fixed

- **Groups ARIA attributes** — grouped items now receive `id`, `aria-posinset`, and `aria-setsize` when `interactive` is enabled, fixing broken `aria-activedescendant` references
- **Snapshots v1→v2 migration** — aligned auto-save bootstrap, compression mode restore, and `focusedId` save/restore with v1 behavior
- **`scroll.scrollbar` and `scroll.gutter` config** — CSS classes (`vlist-viewport--no-scrollbar`, `vlist-viewport--gutter-stable`) now wired in `createVList`
- **Sortable drag cursor** — force `grabbing` cursor on all descendants during drag, preventing open-hand flicker over handles (fixes #46)
- **Grid async data** — per-item accessor for async data compatibility, in-memory item tracking, deduplicated template apply

### Refactored

- **Grid plugin** — in-memory item tracking and deduplicated template application
- **`async` → `data` plugin rename** — `async()` is a JS reserved word; exported function renamed to `data()`, type renamed to `DataPluginConfig`

### Tests

- Groups plugin coverage: 66% → 87% lines (registered methods, scrollToIndex, horizontal mode, render lifecycle, selection state, placeholder transitions, async boundaries)
- Engine state coverage: 61% → 100% (resizeCapacity, clear)
- Selection internal methods: 6 new tests for `_seedSelection`, `_getFocusedId`, `_focusById`
- Grid async rendering, placeholder transitions, dimension tests
- Concurrent test isolation fixes

## [2.0.0-rc.3] - 2026-05-27

### Added

- **`item:dblclick` and `item:contextmenu` events** — delegated double-click and right-click events on items, matching the existing `item:click` pattern
- **16M content size warning** — emits an `error` event when total content size exceeds the browser's max virtual scroll limit, suggesting the `scale()` plugin
- **ARIA live region announcements** — a11y plugin announces focus changes ("Item 3 of 100") and selection state ("Selected", "Deselected") via a screen-reader-only live region
- **`--scrolling` class on root** — added/removed on scroll start/idle for CSS-driven scroll state styling

### Fixed

- **Config validation** — `createVList` now validates item dimensions, estimated sizes, gap, and overscan at creation time with descriptive error messages
- **Template error handling** — template render errors are caught and emitted as `error` events instead of crashing the render loop
- **Plugin setup resilience** — plugin `setup()` errors are caught and emitted as `error` events, preventing one broken plugin from blocking others
- **Destroy resilience** — `destroy()` continues cleanup even if individual teardown steps throw

### Tests

- **Test-driven hardening** — 13-phase systematic recovery adding ~590 tests (2,633 → 3,223), fixing 29 failing tests, and raising line coverage from 94.30% to 95.99%. Covers core boundary conditions, data ops edge cases, error recovery, plugin integration combos, 2D keyboard navigation, async lifecycle, memory leak detection, and performance benchmarks.

## [2.0.0-rc.2] - 2026-05-26

### Performance

- **Optimized initial render path** — batch DOM insertions via DocumentFragment, `cloneNode(false)` from pre-built template in element pool, defer ResizeObserver and scroll listeners until after first paint, skip plugin sort/conflict check when no plugins used
- **Build: switched from tsc transpile to Bun.build bundle** — 15x faster dev builds (1200ms → 78ms), same output
- **async: maxConcurrent request limiting** — configurable cap on in-flight chunk requests (default: 6) with zero-allocation distance-based eviction of furthest loads
- **async: split onDataChange/onStateChange notifications** — loading-state-only changes no longer trigger the expensive sizeCache rebuild pipeline
- **async: chunk-range dedup in onAfterScroll** — skip redundant `ensureRange()` calls when scroll hasn't crossed a chunk boundary
- **async: in-place findIndex+splice** — replace `.filter()` allocation with single `findIndex` + `splice` for pendingRanges cleanup
- **groups: detached map reuse on boundary changes** — elements are saved by data-id instead of released to pool (which clears innerHTML), then reclaimed in the next render pass. Eliminates image blink on scroll stop.
- **groups: data-id fast path in renderItemContent** — skip template rendering and all DOM writes when element already shows the correct item
- **groups: zero-write scroll frames** — transform/size writes moved to new-element path only (stable per layout index), no `getEntry()` call for existing unchanged elements
- **groups: DocumentFragment batching** — single DOM insertion for all new elements per render pass
- **groups: removed dead `vlist-groups-item` class** — eliminated redundant className and attribute writes

### Added

- Normalized benchmark workflow with tiered item counts (10K, 100K, 1M) and intensity modes

### Fixed

- **async: ensureRange early-return correctness** — when no new chunks are needed but loads are in-flight, await `Promise.all(loadPromises)` instead of returning immediately

## [2.0.0-rc.1] - 2026-05-23

### Performance

- **Precomputed render configuration** — extract stable per-frame string computations (class names, translate prefix, cross-axis properties) into a `RenderConfig` object created once during setup. Eliminates repeated string concatenation on every scroll frame. `phase2Commit()` simplified from 17 parameters to 10.

### Refactored

- Removed unused `range.ts` (`calcVisibleRange` / `applyOverscan` — dead code that also violated hot-path allocation rules)
- Removed unused `data.ts` (`createSimpleDataManager` — 245 lines never imported by core or plugins)
- Fixed stale v1 comments and documentation drift across core modules

## [2.0.0-beta.1] - 2026-05-19

### Changed

- **BREAKING: Plugin architecture** — replaced builder pattern (`vlist(config).use(withX()).build()`) with factory function (`createVList(config, [plugins])`). Plugins are passed as the second argument to `createVList()` and the instance is created immediately — no more `.build()` call.
- **BREAKING: Plugin renames** — all `withX()` plugin functions renamed to bare names: `withGrid` → `grid`, `withSelection` → `selection`, `withScrollbar` → `scrollbar`, `withScale` → `scale`, `withPage` → `page`, `withSnapshots` → `snapshots`, `withTransition` → `transition`, `withAutoSize` → `autosize`, `withTable` → `table`, `withGroups` → `groups`, `withAsync` → `async`, `withMasonry` → `masonry`, `withSortable` → `sortable`.
- **BREAKING: Plugin interface** — `VListFeature` replaced by `VListPlugin`. New interface: `name`, `priority?`, `conflicts?`, `setup(ctx: PluginContext)`, `hooks?: { onCalculate, onCommit, onAfterScroll, onIdle, onResize }`, `destroy?()`. Features no longer use callback arrays — hot-path hooks are compiled into linear arrays at creation time.
- **BREAKING: Context interface** — `BuilderContext` replaced by `PluginContext`. Features register handlers via `registerClickHandler()`, `registerKeydownHandler()`, `registerDestroyHandler()`, and add public methods via `registerMethod()`. The `$` (MRefs) shared mutable state is replaced by `EngineState` TypedArrays.
- **BREAKING: Directory structure** — `src/builder/` → `src/core/`, `src/features/` → `src/plugins/`.
- **BREAKING: DOM structure** — the `.vlist-items` wrapper element is removed. v2 uses a 3-element structure: `root > viewport > content`.
- **Core: 2-phase pipeline** — new render pipeline: Phase 1 (`onCalculate`) fills TypedArrays with visible range and positions, Phase 2 (`onCommit`) reads buffers and updates DOM. Zero allocation per frame.
- **Core: EngineState** — all hot-path state (`visibleIndices`, `visibleOffsets`, `visibleSizes`, `visibleCount`, `scrollPosition`, `containerSize`) lives in TypedArrays on a single `EngineState` singleton.
- **Core: Hook compilation** — plugin hooks are compiled once at creation into frozen linear arrays, iterated with zero dispatch overhead per frame.

### Improved

- **Base bundle** — 11.2 KB → 5.0 KB gzipped (-55%).
- **grid** — 4.1 KB → 1.7 KB (-59%).
- **selection** — 2.7 KB → 1.2 KB (-56%).
- **async** — 4.6 KB → 3.9 KB (-15%).
- **groups** — 4.7 KB → 2.5 KB (-47%).
- **scale** — 3.6 KB → 3.4 KB (-6%).
- **autosize** — 0.9 KB → 0.6 KB (-33%).
- **masonry** — 3.4 KB → 2.9 KB (-15%).
- **sortable** — 2.9 KB → 3.0 KB (+3%, added features).
- **transition** — 2.1 KB → 1.9 KB (-10%).
- **scrollbar** — unchanged at 1.8 KB.
- **table** — unchanged at 5.8 KB.
- **page** — unchanged at 0.7 KB.
- **snapshots** — unchanged at 1.2 KB.

### Migration

See [docs/migration.md](docs/migration.md) for the full v1 → v2 migration guide.

## [1.9.0] - 2026-05-17

### Added

- **transition**: New `withTransition()` feature — FLIP-based enter/exit animations for `insertItem`, `removeItem`, and `removeItems`. Removed items collapse via `scaleY(0)` with fade-out while siblings slide up; inserted items expand in while siblings slide down. Supports per-animation timing config, off-screen awareness, scroll clamp compensation, and CSS transition interference suppression.
- **transition**: Batch `removeItems(ids)` animates all deleted items simultaneously with overlapping FLIP animations — each clone shifts to account for removed siblings above it, and off-screen items below the viewport are pre-captured so they slide into view smoothly.
- **builder**: `removeItems(ids)` base API — falls back to per-item `removeItem` when transition feature is not active.

### Fixed

- **transition**: Suppress CSS `background-color` transition flash when DOM elements are recycled during `forceRender()` — uses `commitStyles()` pattern (transition:none, reflow, restore) to commit styles instantly.
- **transition**: Resolve data manager lazily in `scheduleEnsureRange` to avoid stale reference when `withAsync` replaces the data manager after setup.
- **transition**: Bypass stale base `removeItem`/`insertItem` references when data manager is replaced by `withAsync` or `withGroups`.
- **groups**: Add `insertAt` to async group bridge, wire `wrappedDataManager.insertItem` — fixes animated insert in grouped async mode.
- **groups**: Update bridge before async manager in `insertItem` to prevent data/layout index mismatch.
- **styles**: Suppress focus ring on `.vlist-items` container — focus indication belongs on individual items (`.vlist-item--focused`), not the listbox container.

## [1.8.3] - 2026-05-13

### Fixed

- **selection**: Use data manager `getIndexById` instead of internal `idToIndexMap` — the selection feature maintained its own index map with data-space indices, but `ctx.dataManager.getItem()` expects layout-space indices when `withGroups` wraps the data manager. This caused `selection:change` to emit group headers instead of real items, breaking forms, players, and detail panels.
- **selection**: Skip group headers in range selection and `selectAll` — `selectItemRange`, `selectAll()`, and Ctrl+A used `getAllLoadedItems()` which includes group header pseudo-items, leaking header IDs (e.g. `__group_header_0`) into the selected set and breaking the Ctrl+A select/deselect toggle.

## [1.8.2] - 2026-05-13

### Performance

- **builder**: Lazy-initialize the `idIndex` Map — only allocated on first `getIndexById` or string-based `removeItem` call. Lists that never use id-based lookups have zero Map overhead, fixing the memory regression introduced in 1.8.1 (0.55 MB → 0.06 MB after render).

## [1.8.1] - 2026-05-13

### Fixed

- **builder**: Default data proxy now implements `getIndexById` backed by an O(1) `Map<id, index>` — previously always returned `-1` in non-async mode because the call fell through to an unpopulated `SimpleDataManager`.
- **builder**: `removeItem` with a numeric id now resolves via the id index Map first, falling back to treating the number as a direct array index only if no matching id exists — prevents silent wrong-item deletion when items have numeric ids.

## [1.8.0] - 2026-05-13

### Added

- **table**: Keyboard support for header sort and resize — header cells are navigable with roving tabindex, Enter/Space triggers sort, Ctrl+Arrow resizes columns, Home/End jumps to first/last header, ArrowDown returns focus to grid body.

### Fixed

- **a11y**: Downgrade ARIA roles when `interactive: false` — use `role="list"` / `role="listitem"` instead of `role="listbox"` / `role="option"` so screen readers don't announce items as selectable options in display-only lists. `aria-setsize` and `aria-posinset` are preserved for positional context.

## [1.7.9] - 2026-05-13

### Fixed

- **a11y**: Align `aria-activedescendant` with ARIA role owner — move `tabindex="0"` from `.vlist` root to `.vlist-items` (the `role="listbox"` element) so the focused element and composite widget role are on the same DOM node. `withTable` reverses this when it promotes root to `role="grid"`.
- **a11y**: Unify table row ID format to `${ariaIdPrefix}-item-${index}`, matching selection's `aria-activedescendant` references — fixes broken ARIA in table + selection mode.
- **a11y**: Make visible range announcements opt-in via `accessibility.announceVisibleRange` (default: `false`). Range announcements were noisy during keyboard navigation and touchpad scrolling. Add configurable `accessibility.rangeAnnouncementDebounce` (default: 750ms).

## [1.7.8] - 2026-05-12

### Performance

- **builder**: Optimize base bundle from 11.2 KB to 10.7 KB — NODE_ENV ternaries for error messages, extract `applyItemAria()` to deduplicate ARIA code, inline `claimPlaceholderSelection`, remove lazy-resolve caching in a11y (direct Map.get is O(1)).
- **async**: Reduce async feature bundle by 0.5 KB — merge dual Maps into single tuple Map, extract shared closures, lazy `itemsLoadedCallbacks`, replace `Object.keys()` allocation with boolean flag.
- **groups**: Reduce groups feature bundle by 0.4 KB — share binary search from layout.ts, inline single-use `groupedSizeFn`, trim `bridgeAsLayout` adapter, remove passthrough methods.
- **selection**: Reduce selection feature bundle by 0.2 KB — mutate selected Set in place instead of cloning, unify focus movement into single `moveFocus(delta)`, inline 14 state functions as local closures.
- **scale**: Reduce scale feature bundle by 0.1 KB — cache DOM/state references, inline `calculateCompressedVisibleRange`/`ScrollToIndex`/`ItemPosition`, precompute translate direction string.
- **grid**: Reduce grid feature bundle by 0.1 KB — replace per-call `Set<number>` with integer in row-offset loop, inline `positionElement` wrapper, cache `getCol()` result.
- **masonry**: Reduce masonry feature bundle by 0.1 KB — inline `findShortestLane` into layout loop, fix `getVisibleItemsLinear` to reuse pool instead of allocating.
- **table**: Reduce table feature bundle by 0.1 KB — remove unused `resizeHandles` array, optional chaining, inline sort direction cycling.
- **scrollbar**: Reduce scrollbar feature bundle by 0.1 KB — extract `updateScrollbarBounds` helper, remove redundant null checks and classList guard.
- **sortable**: Reduce sortable feature bundle by 0.1 KB — cache DOM references, precompute class names, extract `setChildTransitions` helper.
- **page**: Reduce page feature bundle by 0.1 KB — cache `window` as local for minification, deduplicate scrollTo target calculation.
- **autosize**: Micro-optimize autosize — cache scrollController/viewportState references, inline temp variables.
- **snapshots**: Micro-optimize snapshots — add `restoreSelection` parameter to avoid object spread, simplify poll loop.

## [1.7.7] - 2026-05-11

### Fixed

- **scrollbar**: Fix `position:relative` on viewport that broke custom scrollbar positioning.
- **scrollbar**: Attach scrollbar DOM to root element instead of viewport to prevent clipping.
- **scrollbar**: Prevent duplicate scrollbar when used with `withScale`.
- **groups**: Skip group headers in PageUp/PageDown keyboard navigation.
- **groups**: Clear restore anchor after first scroll adjustment to prevent position reset on re-render.
- **groups**: Create sticky header container eagerly to prevent visual shift on data load.
- **selection**: Use prefix-sum offsets for compressed scroll-to-focus — fixes keyboard navigation off-by-one with mixed item sizes (group headers + data items).

## [1.7.6] - 2026-05-10

### Added

- **builder**: Prevent DOM flooding when container lacks height constraint.
- **groups**: Compressed scroll space support in sticky headers.

### Performance

- **async**: Eliminate O(n) hot-path bottlenecks in scroll pipeline — `loadRange()` uses direct chunk scan (O(range/chunkSize)) instead of scanning all cached chunks. Reduces per-frame cost from 28-35ms to <1ms on 892K-item lists.
- **async**: Skip redundant `sizeCache.rebuild()` when total hasn't changed — avoids O(n) prefix-sum recomputation on every `isLoading` toggle.
- **scale**: Eliminate double renders and per-frame object allocations — new `triggerScrollFrame()` API bypasses `scrollTo()` in animation loops, cached compression state removes 3+ allocations per frame.

### Fixed

- **groups**: Prevent scroll jump to top when scroll position lands on a group header during header-discovery adjustment.
- **groups**: `aria-setsize` and `aria-posinset` now use data-space values (exclude headers from count).
- **groups**: Use distinct CSS class (`-group-header`) and ARIA role for group header elements.
- **groups**: End key navigates to last item on async grouped lists.
- **groups**: Use sizeCache prefix sums for compressed visible range with mixed item sizes.
- **selection**: Skip group headers after `removeItem`.
- **snapshots**: Fix scroll drift on reload with compressed groups — restore anchor for grouped scroll position.
- **snapshots**: Suppress auto-save during restore and persist anchor across subsequent `onItemsLoaded` calls.
- **snapshots**: Bootstrap with `dataTotal` to prevent total inflation on restore.

## [1.7.5] - 2026-05-08

### Added

- **groups**: `withAsync` + `withGroups` compatibility — async group bridge discovers group boundaries incrementally as pages load, with virtual header insertion, layout/data index mapping, and sticky header support.
- **groups**: Lazy sticky header creation — defers DOM element creation until groups actually exist, avoiding empty elements in async mode.
- **groups**: `removeItem` support in async groups mode — shifts group keys and rebuilds boundaries after item removal.
- **selection**: `select()` now syncs `focusedIndex` so keyboard navigation (ArrowDown/Up) starts from the selected item.

### Fixed

- **groups**: Prevent stale `SizeCache` reference in sticky header after async data loads. Uses `rebuildSizeCache()` (mutates in place) instead of `setSizeConfig()` (creates new instance).
- **groups**: Fix sticky header position update after async data loads.
- **snapshots**: Fix scroll drift on restore with group headers — use offset-based save/restore when compression ratio=1.
- **snapshots**: Debounce auto-save with `requestAnimationFrame` to prevent rapid writes during scroll.

## [1.7.4] - 2026-05-02

### Added

- **snapshots**: Cross-mode scroll restore across layout changes (list ↔ grid ↔ table). Snapshots now include `dataIndex`, `dataTotal`, and `offsetRatio` fields that survive layout mode switches and group structure changes.
- **selection**: Configurable right-click behavior via `contextMenu` option (`'select'` | `'keep'` | `false`). Default `'select'` gives file-explorer semantics.
- **core**: Add `contextMenuHandlers` extension point for features to hook right-click events.

### Fixed

- **build**: Store raw byte counts in size.json for precise delta calculations.

## [1.7.3] - 2026-05-01

### Fixed

- **sortable**: Animate ghost back to origin on Escape cancel
- **sortable**: Smooth drop transition for drag source item
- **sortable**: Prevent neighbor item blink on drop
- **selection**: Seed selection state before first render on snapshot restore

## [1.7.2] - 2026-05-01

### Added

- **sortable**: Add ghostContainer config option with tests

### Changed

- **scrollbar**: Rename clickBehavior 'page' to 'scroll'

### Fixed

- **sortable**: Fix cursor, escape cancel, and drop-at-same-position during drag
- **build**: Preserve spaces around + and - in CSS minifier
- **scrollbar**: Show scrollbar immediately when autoHide is false

## [1.7.1] - 2026-04-30

### Changed

- **sortable**: Use O(log n) binary search in computeDropIndex

### Fixed

- **sortable**: Fix drop index oscillation on direction change
- **sortable**: Refactor drop index calculation and element recycling
- **sortable**: Clear text selection after drop (Safari)

## [1.7.0] - 2026-04-29

### Added

- **sortable**: Add sort:move event, preserve focus across pointer drag
- **sortable**: Add keyboard reordering and ARIA accessibility
- **sortable**: Add withSortable drag-and-drop reordering feature

### Changed

- **sortable**: Reduce bundle size -164 min / -25 gz
- **sortable**: Move ghost visual styles from inline JS to CSS
- **sortable**: Safe hot-path optimizations
- **sortable**: Remove placeholder mode, simplify to live reorder only

### Fixed

- **ci**: Add NPM_TOKEN to publish workflow
- **test**: Fix typecheck error in sortable focus preservation test
- **sortable**: Include keyboard grab in isSorting() return value
- **sortable**: Scroll back to original position on keyboard cancel
- **sortable**: Fix stale focus ring after keyboard cancel/drop
- **sortable**: Fix cancel restore and add sort:cancel event
- **sortable**: Prevent item blink on drop
- **sortable**: Clear shifts when pointer leaves viewport
- **sortable**: Disable shifts when pointer is outside viewport
- **sortable**: Improve edge scroll behavior
- **sortable**: Animate ghost to drop position on release
- **sortable**: Use ghost leading edge for shift threshold

## [1.6.5] - 2026-04-28

### Added

- **snapshots**: Restore focused item after scroll restore

### Changed

- **table**: Restore resize handle hover visibility
- **table**: Hide resize handle line on header hover

### Fixed

- **table**: Remove unused viewport param from createTableHeader
- **snapshots**: Save on focus:change in autoSave mode
- **snapshots**: Emit focus:change from _focusById to update live previews
- **snapshots**: Don't show focus ring until list receives DOM focus
- **snapshots**: Capture focus before focusout clears focusVisible
- **snapshots**: Restore focus for sync lists (no withAsync)
- **table**: Fix custom scrollbar invisible/doubled in table mode
- **snapshots**: RestoreScroll clips last items when withScale is active

## [1.6.4] - 2026-04-27

### Added

- **scrollbar**: Per-side padding support
- **scrollbar**: Make minThumbSize and hoverZoneWidth smarter
- **scrollbar**: Add padding and clickBehavior options
- **scrollbar**: Add padding option to inset track from viewport edges

### Fixed

- **scrollbar**: Use typeof !== 'object' to reliably narrow ScrollbarPadding in resolvePadding
- **scrollbar**: Correct JSDoc for clickBehavior and hoverZoneWidth; add padding-margin click tests
- **scrollbar**: Extend click target into padding margin
- **scrollbar**: Move ScrollbarPadding to src/types so index.ts export resolves
- **ci**: Escape commit message as JSON in staging dispatch payload

## [1.6.3] - 2026-04-26

### Added

- **scrollbar**: Add gutter option to reserve layout space for custom scrollbar
- **a11y**: Add focusOnClick option (#32)

### Changed

- **scrollbar**: Auto-radius — custom scrollbar thumb always pill-shaped
- **scrollbar**: Fix native scrollbar sizing and separate CSS token namespaces
- **styles**: Rename scrollbar CSS tokens and wire native scrollbar to variables

### Fixed

- **scrollbar**: Move gutter class to viewport, pad viewport not items
- **core**: Auto-size horizontal root height to prevent scrollbar cropping on Windows
- **page**: Remove stale targetScroll — use domScroll directly
- **a11y**: Skip scroll-into-view on mouse click (#23)

## [1.6.2] - 2026-04-24

### Added

- **async**: Forward response cursor to AdapterParams on sequential reads

### Fixed

- **page**: Use behavior:'instant' on all window.scrollTo calls
- **a11y**: Prevent erratic scroll on click in window mode (#23)
- **tests**: Add missing getVisibleRange mock to test context factories

## [1.6.1] - 2026-04-20

### Added

- **async**: Per-chunk AbortController, keepBuffer cancellation, signal in AdapterParams
- **grid/table**: Compression-aware visible range and fast path for compressed mode

## [1.6.0] - 2026-04-16

### Added

- Export ItemConfig, GridConfig, MasonryConfig, GroupsConfig, GroupHeaderConfig types

### Fixed

- **core**: Unify wheel handler, add boundary passthrough and sync rendering for horizontal mode

## [1.5.6] - 2026-04-15

### Changed

- **dev**: Cap duplicate ID check at 10K items to avoid O(n) cost on large datasets
- **memory**: Cap content height, reuse event payloads, reduce scroll-path allocations

## [1.5.4] - 2026-04-15

### Added

- **selection**: Implement ARIA multi-select keyboard model with configurable shiftArrowToggle

[Unreleased]: https://github.com/floor/vlist/compare/v2.0.4...HEAD
[2.0.4]: https://github.com/floor/vlist/compare/v2.0.3...v2.0.4
[2.0.3]: https://github.com/floor/vlist/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/floor/vlist/compare/v2.0.0...v2.0.2
[2.0.0-rc.3]: https://github.com/floor/vlist/compare/v2.0.0-rc.2...v2.0.0-rc.3
[2.0.0-rc.2]: https://github.com/floor/vlist/compare/v2.0.0-rc.1...v2.0.0-rc.2
[2.0.0-rc.1]: https://github.com/floor/vlist/compare/v2.0.0...v2.0.0-rc.1
[2.0.0]: https://github.com/floor/vlist/compare/v1.9.0...v2.0.0
[1.9.0]: https://github.com/floor/vlist/compare/v1.8.3...v1.9.0
[1.8.3]: https://github.com/floor/vlist/compare/v1.8.2...v1.8.3
[1.8.2]: https://github.com/floor/vlist/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/floor/vlist/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/floor/vlist/compare/v1.7.9...v1.8.0
[1.7.9]: https://github.com/floor/vlist/compare/v1.7.8...v1.7.9
[1.7.8]: https://github.com/floor/vlist/compare/v1.7.7...v1.7.8
[1.7.7]: https://github.com/floor/vlist/compare/v1.7.6...v1.7.7
[1.7.6]: https://github.com/floor/vlist/compare/v1.7.5...v1.7.6
[1.7.5]: https://github.com/floor/vlist/compare/v1.7.4...v1.7.5
[1.7.4]: https://github.com/floor/vlist/compare/v1.7.3...v1.7.4
[1.7.3]: https://github.com/floor/vlist/compare/v1.7.2...v1.7.3
[1.7.2]: https://github.com/floor/vlist/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/floor/vlist/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/floor/vlist/compare/v1.6.5...v1.7.0
[1.6.5]: https://github.com/floor/vlist/compare/v1.6.4...v1.6.5
[1.6.4]: https://github.com/floor/vlist/compare/v1.6.3...v1.6.4
[1.6.3]: https://github.com/floor/vlist/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/floor/vlist/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/floor/vlist/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/floor/vlist/compare/v1.5.6...v1.6.0
[1.5.6]: https://github.com/floor/vlist/compare/v1.5.4...v1.5.6
[1.5.4]: https://github.com/floor/vlist/compare/v1.5.3...v1.5.4
