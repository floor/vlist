# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This changelog starts at v1.5.4, the first version published under the `vlist` package name
(April 2026). Earlier versions were published as `@floor/vlist` — see the
[git history](https://github.com/floor/vlist/commits/main) for the full record.

## [Unreleased]

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

[Unreleased]: https://github.com/floor/vlist/compare/v1.8.0...HEAD
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
