# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This changelog starts at v1.5.4, the first version published under the `vlist` package name
(April 2026). Earlier versions were published as `@floor/vlist` — see the
[git history](https://github.com/floor/vlist/commits/main) for the full record.

## [Unreleased]

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

[Unreleased]: https://github.com/floor/vlist/compare/v1.7.3...HEAD
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
