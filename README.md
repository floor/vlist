# vlist

The virtual list library for every framework. Ultra efficient, batteries-included, and accessible with composable plugins.

**v3.0.0-next.2** (prerelease on the npm `next` tag) — Native scrolling by default, opt-in `vlist/synthetic`, and removal of deprecated scroll configuration and plugin hooks. See the [changelog](https://github.com/floor/vlist/blob/next/CHANGELOG.md).

[![npm version](https://img.shields.io/npm/v/vlist.svg)](https://www.npmjs.com/package/vlist)
[![bundle size](https://img.shields.io/bundlephobia/minzip/vlist)](https://bundlephobia.com/package/vlist)
[![CI](https://github.com/floor/vlist/actions/workflows/ci.yml/badge.svg)](https://github.com/floor/vlist/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

- **Accessible** — `a11y()` or a selection mode adds WAI-ARIA, 2D keyboard navigation, focus recovery, screen-reader DOM ordering
- **Zero dependencies** — framework-agnostic core with tiny adapters for Vue, Svelte, Solid, React
- **9.5 KB gzipped (3.0 prerelease)** — composable plugins with perfect tree-shaking
- **Constant memory** — ~0.1 MB overhead at any scale, from 10K to 1M+ items
- **Tree, grid, masonry, carousel, table, groups, data, selection, search, sortable, transition** — all opt-in
- **Axis-neutral** — vertical and horizontal scrolling through a single code path, all plugins work in both orientations

**18 interactive examples, docs & benchmarks → [vlist.io](https://vlist.io)**

## Why vlist

| | vlist | TanStack Virtual | react-virtuoso | virtua | vue-virtual-scroller |
|---|---|---|---|---|---|
| **A11y** | WAI-ARIA + 2D keyboard, one plugin | None (DIY) | Partial | Minimal | None |
| **Grid + Masonry + Table** | All | Grid only | Grid + Table | Grid only | None |
| **Vue** | 0.6 KB adapter | Yes | — | Yes | 11.8 KB |
| **Svelte** | 0.5 KB adapter | Yes | — | Yes | — |
| **Solid** | 0.5 KB adapter | Yes | — | Yes | — |
| **Vanilla JS** | Native | Yes | — | — | — |
| **Constant memory** | ~0.1 MB at 1M | No | No | No | No |

## Framework Adapters

| Framework | Package | Size |
|-----------|---------|------|
| Vanilla JS | `vlist` | Native — no adapter needed |
| Vue | [`vlist-vue`](https://github.com/floor/vlist-vue) | 0.6 KB gzip |
| Svelte | [`vlist-svelte`](https://github.com/floor/vlist-svelte) | 0.5 KB gzip |
| SolidJS | [`vlist-solidjs`](https://github.com/floor/vlist-solidjs) | 0.5 KB gzip |
| React | [`vlist-react`](https://github.com/floor/vlist-react) | 0.6 KB gzip |

```bash
npm install vlist              # vanilla JS
npm install vlist@next         # 3.0 prerelease; latest stays on 2.8
npm install vlist vlist-vue    # or vlist-svelte / vlist-solidjs / vlist-react
```

Adapters use native scrolling by default. With an adapter that forwards `factory`, select synthetic input explicitly:

```ts
import { useVList } from "vlist-react";
import { createVList } from "vlist/synthetic";

useVList({
  factory: createVList,
  items,
  item: { height: 48, template: item => String(item.id) },
});
```

The same factory option is available to the other adapters. `vlist/config` defaults to native scrolling. The factory is structural configuration: changing it requires recreating the list.

## Quick Start

```typescript
import { createVList } from 'vlist'
import 'vlist/styles'

const list = createVList({
  container: '#my-list',
  items: [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
    { id: 3, name: 'Charlie' },
  ],
  item: {
    height: 48,
    template: (item) => `<div>${item.name}</div>`,
  },
})

list.scrollToIndex(10)
list.setItems(newItems)
list.on('item:click', ({ item }) => console.log(item))
```

## Plugin System

Start with the base, add only what you need:

```typescript
import { createVList, grid, groups, selection } from 'vlist'

const list = createVList({
  container: '#app',
  items: photos,
  item: { height: 200, template: renderPhoto },
}, [
  grid({ columns: 4, gap: 16 }),
  groups({
    getGroupForIndex: (i) => photos[i].category,
    header: { height: 40, template: (cat) => `<h2>${cat}</h2>` },
  }),
  selection({ mode: 'multiple' }),
])
```

## Scroll input

Native scrolling is the default: import `createVList` and plugins from `vlist`. This preserves browser scrollbars, native touch momentum, boundary handoff and native assistive-technology scrolling. Carousel and sortable work with this factory; horizontal RTL lists are rejected by both entries. Carousel supplies its private wrap runway only when the plugin is imported; bounded scrolling is no longer a public mode.

| Entry | Input model | Use |
|---|---|---|
| `vlist` | Native (default) | Browser scrolling and all supported plugins |
| `vlist/synthetic` | Synthetic (opt-in) | Huge lists and application-owned touch motion |
| `vlist/native` | Alias of `vlist` (deprecated) | Compatibility with `3.0.0-next.1`; use `vlist` for new code |

### Synthetic input

Select synthetic input by importing its factory; there is no `scroll.mode` option. Plugins still come from `vlist`.

```typescript
import { createVList } from 'vlist/synthetic'
import { scrollbar } from 'vlist'
import 'vlist/styles'

const list = createVList({
  container: '#my-list',
  items: Array.from({ length: 1000 }, (_, id) => ({ id, name: `Row ${id}` })),
  item: { height: 48, template: item => `<div>${item.name}</div>` },
}, [scrollbar()])
```

`page()` uses native document scrolling through an external source with either entry. Its content must fit the 16,777,216 px document element limit; creation throws above that limit when the size is known, and later growth warns once. A deferred custom renderer whose size is first committed during rendering also warns once. Use `vlist/synthetic` viewport scrolling for larger lists. Default native viewport lists warn once when content exceeds their browser-size safety limit, pointing to that entry.

`carousel()` works with either entry. Synthetic carousel folds preserve touch motion and smooth snapping across whole laps. `page()` and carousel remain incompatible. The shared carousel plugin includes its native wrap handler even when used with synthetic input; the combined size is reported below.

Synthetic input limitations:

- Horizontal RTL lists throw at creation — in this entry and in `vlist`. Vertical lists and tables support `dir="rtl"` in both, including cross-axis wheel movement, aligned table headers and keyboard column navigation.
- Same-axis touch stops at either boundary with no parent handoff, including gestures starting inside an edge-pinned list. Use the native default when boundary gestures must scroll the parent page.
- There is no native main-axis scrollbar. Add `scrollbar()` for an accessible custom scrollbar. The synthetic entry rejects the `"native"` and `"none"` scrollbar strings.
- Inertia initializes its frame clock on the first frame after release, adding up to one frame of release latency.
- Wheel input at an edge is left to the page when it cannot move the list. Native cross-axis scrolling remains available.

Measurement corrections from autosize preserve ongoing synthetic motion. Existing plugin conflicts still apply. See the [scroll input contract](https://vlist.io/docs/rfcs/RFC-014-Scroll-Input-Model).

### Sortable gestures

`sortable()` works with either input entry. Mouse and trackpad dragging still starts after `dragThreshold` (5 px by default). Touch and pen without a handle use `touchDelay`, a 350 ms long press; moving at least `dragThreshold` pixels in any direction before it completes yields to scrolling. This delay separates a deliberate hold from a quick flick. With `handle`, dragging starts at the threshold without waiting; touches elsewhere scroll.

```typescript
sortable({ touchDelay: 350, dragThreshold: 5 })
sortable({ handle: '.drag-handle' })
```

A touch during scrolling catches the motion and does not arm a hold for that contact. Lift and press again once the list is at rest. A second finger or `pointercancel` cancels the pending press or active drag. Edge auto-scroll uses the list's logical position and stops on drop.

The touch-only `.vlist-item--touch-sort` class suppresses selection and callouts on the pressed item. A claimed touch/pen drag adds `.vlist-sort-ghost--touch` to the ghost as a visual cue; override that class in CSS to customize it. Keyboard reordering remains Space to grab/drop, arrows to move and Escape to cancel.

## Migrating to 3.0

`3.0.0-next.1` used synthetic input by default. `3.0.0-next.2` restores the 2.x default. Import `vlist/synthetic` explicitly to retain synthetic behavior across these prereleases. `vlist/native` remains a deprecated compatibility alias; its `NativeScrollConfig` and `NativeCreateVListConfig` types alias the standard `ScrollConfig` and `CreateVListConfig`.

| 2.x option or API | 3.0 replacement |
|---|---|
| `scroll.mode` (all values, both entries) | Omit it. `vlist` provides native scrolling; import `vlist/synthetic` for synthetic input. |
| `scroll.runway` (both entries) | Remove it. For huge lists use `vlist/synthetic`, which needs no native runway. |
| `scroll.scrollbar: "native"` or `"none"` | Retained in default `ScrollConfig`. With synthetic input, omit the string and optionally install `scrollbar()`. |
| `PluginContext.setScrollFns`, `disableDefaultScroll` | Use `setScrollSource` to supply an external position source and commit callback. |
| `scale()` and `ScalePluginConfig` | Remove them; use `vlist/synthetic` for the full logical range. Config no longer installs a scale stub. |

Removed mode/runway options throw a migration error before creating DOM. `vlist/config` wires only what the config asks for: `selection`, the custom scrollbar, `snapshots` and `a11y` are each opt-in, so an adapter list matches a core list built from the same options. It keeps the scrollbar options convenience and its top-level `scrollbar: "none"`; pass `scrollbar: true` for the overlay scrollbar earlier versions added to every list. `baseOffset` stays private engine state; plugins use `ctx.scroll.getRenderOrigin()`. Custom wrap providers now supply their handler factory as the second argument of `ctx.setBoundedWrap`.

## Plugins

| Entry / export | Minified | Gzipped |
|---|---:|---:|
| **Base (`vlist`)** | 25.8 KB | 9.5 KB |
| `vlist/synthetic` | 31.7 KB | 11.7 KB |
| `vlist/native` (alias) | 25.8 KB | 9.5 KB |
| `a11y()` | 29.0 KB | 10.7 KB |
| `selection()` | 35.2 KB | 12.3 KB |
| `data()` | 39.4 KB | 14.3 KB |
| `scrollbar()` | 34.0 KB | 12.3 KB |
| `sortable()` | 37.5 KB | 13.0 KB |
| `groups()` | 41.6 KB | 14.8 KB |
| `page()` | 28.2 KB | 10.3 KB |
| `snapshots()` | 29.1 KB | 10.6 KB |
| `transition()` | 32.5 KB | 11.5 KB |
| `autosize()` | 28.9 KB | 10.5 KB |
| `grid()` | 32.7 KB | 11.9 KB |
| `table()` | 44.2 KB | 15.4 KB |
| `masonry()` | 37.0 KB | 13.6 KB |
| `tree()` | 41.0 KB | 14.5 KB |
| `search()` | 34.9 KB | 12.6 KB |
| `carousel()` | 38.4 KB | 13.9 KB |
| `vlist/synthetic` + `carousel()` | 44.4 KB | 16.1 KB |
| `vlist/synthetic` + `sortable()` | 43.4 KB | 15.3 KB |

Sizes are tree-shaken totals from `bun run size`, not additive plugin costs. Plugin rows include the native default factory plus that plugin. The base is **9,688 bytes gzipped**, below the 9.9 KB target that `bun run size` now enforces — the build fails above it; synthetic input is **11,987 bytes** before plugins. The alias row measures the same source factory; the distributed alias re-exports it without duplicating the implementation.

## Examples

More examples at **[vlist.io](https://vlist.io)**.

### Data Table

```typescript
import { createVList, table, selection } from 'vlist'

const myTable = createVList({
  container: '#my-table',
  items: contacts,
  item: { height: 36, template: () => '' },
}, [
  table({
    columns: [
      { key: 'name',   label: 'Name',   width: 200, sortable: true },
      { key: 'email',  label: 'Email',  width: 260, sortable: true },
      { key: 'role',   label: 'Role',   width: 160, sortable: true },
      { key: 'status', label: 'Status', width: 100, align: 'center' },
    ],
    rowHeight: 36,
    headerHeight: 36,
    resizable: true,
  }),
  selection({ mode: 'single' }),
])

myTable.on('column:sort', ({ key, direction }) => { /* re-sort data */ })
myTable.on('column:resize', ({ key, width }) => { /* persist widths */ })
```

### Grid Layout

```typescript
import { createVList, grid, scrollbar } from 'vlist'

const gallery = createVList({
  container: '#gallery',
  items: photos,
  item: {
    height: 200,
    template: (photo) => `
      <div class="card">
        <img src="${photo.url}" />
        <span>${photo.title}</span>
      </div>
    `,
  },
}, [
  grid({ columns: 4, gap: 16 }),
  scrollbar({ autoHide: true }),
])
```

### Animated Insert & Remove

```typescript
import { createVList, transition, selection } from 'vlist'

const list = createVList({
  container: '#playlist',
  items: tracks,
  item: { height: 64, template: renderTrack },
}, [
  transition({ duration: 200 }),
  selection({ mode: 'multiple' }),
])

// Single item — collapses with fade-out, siblings slide up
list.removeItem(trackId)

// Batch — all items animate simultaneously
list.removeItems(list.getSelected())

// Insert — expands in, siblings slide down
list.insertItem({ id: 42, title: 'New Track' }, 0)
```

### Async Loading

```typescript
import { createVList, data } from 'vlist'

const list = createVList({
  container: '#list',
  item: {
    height: 64,
    template: (item) => item
      ? `<div>${item.name}</div>`
      : `<div class="placeholder">Loading…</div>`,
  },
}, [
  data({
    adapter: {
      read: async ({ offset, limit }) => {
        const res = await fetch(`/api/users?offset=${offset}&limit=${limit}`)
        const data = await res.json()
        return { items: data.items, total: data.total, hasMore: data.hasMore }
      },
    },
  }),
])
```

### Search

```typescript
import { createVList, search } from 'vlist'
import 'vlist/styles/search'

const list = createVList({
  container: '#app',
  items: people,
  item: { height: 48, template: renderPerson },
}, [
  // Zero-config: a search bar at the top, Ctrl/⌘+F to focus, type to filter,
  // matches highlighted with <mark>. Use mode: 'navigate' to jump between
  // matches instead of hiding non-matches.
  search(),
])
```

## Custom scrollbar (3.0 preview)

On `next`, `scrollbar()` remains a plugin. macOS and Android default to thin,
rounded, auto-hiding overlays; Windows defaults to a wider, square, always-visible
bar. Set `gutter: true` to reserve space. The same behavior works horizontally.

```typescript
scrollbar({
  platform: 'windows',        // optional: macos | windows | android
  width: 'thin',              // optional: pixels (number) | auto | thin | none
  radius: 4,                  // optional: thumb radius in pixels
  thumbColor: '#666',         // optional explicit colors
  trackColor: '#eee',
  gutter: true,
})
```

Without explicit overrides, the plugin reads the container's standard
`scrollbar-width` and `scrollbar-color`. `auto` uses the platform width; `thin`
uses 6 px; `none` disables the track, hover target and gutter. Color order is
thumb then track. Numeric `width` and `radius` override the corresponding
`--vlist-custom-scrollbar-width` and `--vlist-custom-scrollbar-radius` variables
on the container; those variables override platform defaults. Without a custom
width variable, the width keywords retain their standard meaning (`none` always
disables the bar). Explicit colors override author standard colors. `autoHide`, `autoHideDelay` and `minThumbSize` remain available.
After changing author CSS, call `list.refreshScrollbar()` (or `refresh()` on a
standalone `Scrollbar` instance). Refresh rereads CSS; platform selection remains
fixed for that instance. Setting `enabled: false` disables the plugin's bar.

The focusable track exposes its controlled viewport, orientation, logical range,
and “Row N of M” value. Arrows move one row along the active axis, PageUp/PageDown
move a viewport, and Home/End reach the bounds. Focus keeps the bar visible.
Forced-color themes use system colors for the track, thumb and focus indicator.
The thumb has a minimum size even for millions of rows; drag positions continue
to use the full logical range. The real screen-reader acceptance pass is still
pending; this is not a completed accessibility sign-off.

### Migrating WebKit scrollbar selectors

**The `::-webkit-scrollbar*` pseudo-elements are not mirrored.** They style
browser-owned scrollbars, not this plugin's DOM. Migrate each rule as follows
(the classes shown use the default `vlist` prefix):

| Existing selector | Plugin replacement |
| --- | --- |
| `::-webkit-scrollbar` | `.vlist-scrollbar`; `--vlist-custom-scrollbar-width` for thickness |
| `::-webkit-scrollbar-track` | `.vlist-scrollbar`; `--vlist-custom-scrollbar-track-color` |
| `::-webkit-scrollbar-thumb` | `.vlist-scrollbar__thumb`; `--vlist-custom-scrollbar-thumb-color`, `--vlist-custom-scrollbar-radius`, `--vlist-custom-scrollbar-min-thumb-size` |
| `::-webkit-scrollbar-thumb:hover` | `.vlist-scrollbar__thumb:hover`; `--vlist-custom-scrollbar-thumb-hover-color` |
| `::-webkit-scrollbar-corner` | No separate corner element. Reserved gutter space uses the `.vlist` background (`--vlist-bg`). A dedicated corner rule has no direct equivalent. |
| `::-webkit-scrollbar-button` | No arrow-button elements or direct styling equivalent. Use the scrollbar's row keys or track paging; custom buttons must be separate controls. |

For width and base thumb/track colors, prefer standard `scrollbar-width` and
`scrollbar-color` on the container, or plugin config. The plugin maps these onto
its custom properties at setup/refresh. Use the plugin classes and remaining
variables for radius, minimum thumb size and hover styling. High-contrast system
colors take priority while forced colors are active.

## Accessibility

Accessibility is a plugin, not a default. Add `a11y()`, or a `selection()` mode
other than `"none"` which brings the same behaviour, and the list follows the
[WAI-ARIA listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/):

- **Arrow keys** move focus between items with a visible focus ring
- **2D navigation** in grids and masonry — Up/Down by row, Left/Right by cell
- **Masonry lane-aware nav** — arrows stay in the same visual column
- **Home/End, PageUp/PageDown, Ctrl+Home/End** — full keyboard coverage
- **Screen-reader DOM ordering** — items reordered on scroll idle for correct reading order
- **Focus recovery** — maintains focus when items are removed

A list created without either stays display-only: `role="list"`, no item roles
and out of the tab order. That is the right shape for log viewers and activity
feeds, and for items carrying their own interactive elements.

## API

```typescript
const list = createVList(config, [plugin1(), plugin2()])
```

### Data

| Method | Description |
|--------|-------------|
| `list.setItems(items)` | Replace all items |
| `list.appendItems(items)` | Add to end (auto-scrolls in reverse mode) |
| `list.prependItems(items)` | Add to start (preserves scroll position) |
| `list.updateItem(id, partial)` | Update a single item by ID |
| `list.insertItem(item, index?)` | Insert at index (animated with `transition`) |
| `list.removeItem(id)` | Remove by ID (animated with `transition`) |
| `list.removeItems(ids)` | Batch remove (simultaneous animations) |
| `list.getItemAt(index)` | Get item at index |
| `list.getIndexById(id)` | Get index by item ID |

### Navigation

| Method | Description |
|--------|-------------|
| `list.scrollToIndex(i, align?)` | Scroll to index (`'start'` \| `'center'` \| `'end'`) |
| `list.scrollToIndex(i, opts?)` | With `{ align, behavior: 'smooth', duration }` |
| `list.getScrollPosition()` | Current scroll offset |

### Selection (with `selection()`)

| Method | Description |
|--------|-------------|
| `list.select(...ids)` | Select item(s) |
| `list.deselect(...ids)` | Deselect item(s) |
| `list.toggleSelect(id)` | Toggle |
| `list.selectAll()` / `list.clearSelection()` | Bulk operations |
| `list.getSelected()` | Array of selected IDs |
| `list.getSelectedItems()` | Array of selected items |

### Events

`list.on()` returns an unsubscribe function. You can also use `list.off(event, handler)`.

```typescript
list.on('scroll', ({ scrollPosition, direction }) => {})
list.on('range:change', ({ range }) => {})
list.on('item:click', ({ item, index, event }) => {})
list.on('item:dblclick', ({ item, index, event }) => {})
list.on('selection:change', ({ selectedIds, selectedItems }) => {})
list.on('load:start', ({ offset, limit }) => {})
list.on('load:end', ({ items, offset, total }) => {})
list.on('load:error', ({ error, offset, limit }) => {})
list.on('sort:end', ({ fromIndex, toIndex }) => {})
list.on('sort:cancel', ({ originalItems }) => {})
```

The `index` on `item:click`, `item:dblclick` and `item:contextmenu` is the data
index — the one `getItemAt`, `scrollToIndex` and `removeItem` take — not the
layout index, which counts group headers and carousel laps.

### Properties

| Property | Description |
|----------|-------------|
| `list.element` | Root DOM element |
| `list.items` | Current items (readonly) |
| `list.total` | Total item count |
| `list.destroy()` | Cleanup and remove from DOM |

## Plugin Configuration

Each plugin's config is fully typed — hover in your IDE for details.

```typescript
grid({ columns: 4, gap: 16 })
masonry({ columns: 4, gap: 16 })
groups({ getGroupForIndex, header: { height, template }, sticky?: true })
selection({ mode: 'single' | 'multiple', initial?: [...ids] })
data({ adapter: { read }, loading?: { cancelThreshold? } })
table({ columns, rowHeight, headerHeight?, resizable? })
autosize()                        // auto-measure items (requires estimatedHeight); list.remeasure(index?) after late content
scrollbar({ autoHide?, autoHideDelay?, minThumbSize? })
transition({ duration?: 200, insert?: timing, remove?: timing })
sortable({ handle?: '.drag-handle' })  // drag-and-drop reordering
page()                            // no config — uses document scroll
snapshots({ autoSave: 'key' })    // automatic sessionStorage save/restore
```

### Autosize

With `autosize()` and `item.estimatedHeight` (or `estimatedWidth` for horizontal lists), call `remeasure(i)` after content changes size without a `load` or `error` event, such as expanding text or changing a font. Call `remeasure()` to discard every cached measurement: visible items are measured again, and offscreen items use estimates until they render. Unknown or unmeasured indices are a no-op.

```javascript
list.remeasure(12); // Re-measure one item after its content changes.
list.remeasure();   // Invalidate all sizes and measure items as they render.
```

Full configuration reference → **[vlist.io](https://vlist.io)**

## Base Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `overscan` | `3` | Extra items rendered outside viewport |
| `ariaLabel` | — | Accessible label for the listbox |
| `orientation` | `'vertical'` | `'vertical'` or `'horizontal'` scroll direction |
| `padding` | `0` | Content inset — number, `[v, h]`, or `[top, right, bottom, left]` |
| `reverse` | `false` | The list reads bottom-up (chat UIs): a view sitting at the end stays there as `appendItems` adds to it, arrow keys invert, and `transition()` animates from the bottom. Item order is yours to supply; the layout itself is not reversed. `masonry()` and `table()` reject it |

## Styling

```typescript
import 'vlist/styles'           // core (always required)
import 'vlist/styles/grid'      // when using grid()
import 'vlist/styles/masonry'   // when using masonry()
import 'vlist/styles/table'     // when using table()
import 'vlist/styles/extras'    // optional (variants, loading states, animations)
```

Dark mode works out of the box via `prefers-color-scheme`, Tailwind's `.dark` class, or `data-theme-mode="dark"`. Override CSS custom properties to match your design system. See [vlist.io/tutorials/styling](https://vlist.io/tutorials/styling) for the full guide.

## Performance

| Dataset Size | After Render | Scroll Delta |
|--------------|-------------|--------------|
| 10K items | 0.07 MB | ~0 MB |
| 100K items | 0.08 MB | ~0 MB |
| 1M items | 0.09 MB | 0.19 MB |

- **Initial render:** ~2ms (constant, regardless of item count)
- **Scroll:** 120 FPS at any scale
- **DOM nodes:** ~26 in document with 100K items (visible + overscan only)

Live benchmarks against 9 competitors → **[vlist.io/benchmarks](https://vlist.io/benchmarks)**

## TypeScript

Fully typed and generic over your item type. An item only needs an `id`, so ordinary
interfaces work:

```typescript
import { createVList, grid, selection, type CreateVListConfig } from 'vlist'

interface Photo { id: number; url: string; title: string }

const config: CreateVListConfig<Photo> = {
  container: '#gallery',
  items: photos,
  item: {
    height: 200,
    template: (photo) => `<img src="${photo.url}" />`,
  },
}

const list = createVList(config, [grid({ columns: 4 }), selection<Photo>({ mode: 'multiple' })])

list.select(photos[0].id)                      // typed: selection is in the array
const chosen: Photo[] = list.getSelectedItems()
// list.expand(1)                              // compile error: no tree plugin here
```

`createVList` infers the methods each plugin adds, so a list exposes exactly what its
plugins provide, and a mistyped call does not compile.

TypeScript does not allow a partial type argument list. Writing
`createVList<Photo>(config, plugins)` supplies the item type and leaves the plugin list on
its default, so plugin methods are not inferred. Type the config as above, or let the item
type come from your data.

## Migrating from v1

v2 is a ground-up rewrite — simpler API, 55% smaller base bundle, zero-allocation scroll path. [Full announcement →](https://vlist.io/blog/v2)

| v1 | v2 |
|----|-----|
| `vlist(config).use(withGrid()).build()` | `createVList(config, [grid()])` |
| `withGrid`, `withSelection`, … | `grid`, `selection`, … |
| `VListFeature` | `VListPlugin` |
| `BuilderContext` | `PluginContext` |
| `.vlist-items` | `.vlist-content` |

The instance API (`setItems`, `scrollToIndex`, `on`, `destroy`) is unchanged.

## Contributing

1. Fork → branch → make changes → add tests → pull request
2. Run `bun test` and `bun run build` before submitting

## License

[MIT](LICENSE)

## Links

- **Docs & Examples:** [vlist.io](https://vlist.io)
- **Staging:** [staging.vlist.io](https://staging.vlist.io)
- **GitHub:** [github.com/floor/vlist](https://github.com/floor/vlist)
- **NPM:** [vlist](https://www.npmjs.com/package/vlist)
- **Issues:** [GitHub Issues](https://github.com/floor/vlist/issues)

---

Built by [FloorIO](https://floor.io)
