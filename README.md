# vlist

The virtual list library for every framework. Ultra efficient, batteries-included, and accessible with composable plugins — in 9.7 KB.

**v2.7.2** — [Changelog](./CHANGELOG.md) · Tree keeps the bounded runway for large trees; the scale() deprecation link works; bounded-mode touch limitation documented.

[![npm version](https://img.shields.io/npm/v/vlist.svg)](https://www.npmjs.com/package/vlist)
[![bundle size](https://img.shields.io/bundlephobia/minzip/vlist)](https://bundlephobia.com/package/vlist)
[![CI](https://github.com/floor/vlist/actions/workflows/ci.yml/badge.svg)](https://github.com/floor/vlist/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

- **Accessible** — WAI-ARIA, 2D keyboard navigation, focus recovery, screen-reader DOM ordering
- **Zero dependencies** — framework-agnostic core with tiny adapters for Vue, Svelte, Solid, React
- **9.9 KB gzipped** — composable plugins with perfect tree-shaking
- **Constant memory** — ~0.1 MB overhead at any scale, from 10K to 1M+ items
- **Tree, grid, masonry, carousel, table, groups, data, selection, search, sortable, transition** — all opt-in
- **Axis-neutral** — vertical and horizontal scrolling through a single code path, all plugins work in both orientations

**18 interactive examples, docs & benchmarks → [vlist.io](https://vlist.io)**

## Why vlist

| | vlist | TanStack Virtual | react-virtuoso | virtua | vue-virtual-scroller |
|---|---|---|---|---|---|
| **A11y built-in** | WAI-ARIA + 2D keyboard | None (DIY) | Partial | Minimal | None |
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
npm install vlist vlist-vue    # or vlist-svelte / vlist-solidjs / vlist-react
```

With vlist 2.8 and an adapter that forwards the `factory` option, opt into synthetic input explicitly:

```ts
import { useVList } from "vlist-react";
import { createVList } from "vlist/synthetic";

useVList({
  factory: createVList,
  scroll: { mode: "synthetic" },
  items,
  item: { height: 48, template: item => String(item.id) },
});
```

The same factory option is available to the other adapters. `vlist/config` keeps the synthetic driver out of its default bundle; importing the factory opts in. The factory is structural configuration: changing it requires recreating the list.

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

## Synthetic scroll input

The opt-in `vlist/synthetic` entry adds `scroll.mode: 'synthetic'` alongside native and bounded modes. Native remains the default. Import the factory from this entry and plugins from `vlist`:
Bounded mode note: on touch devices a long native fling can outrun the 2x runway and stall at its edge (measured at 145-226% of a 16x runway on an iPhone SE and a Pixel 8a). Prefer synthetic mode for touch-heavy lists; bounded remains the right choice for wheel and keyboard driven lists.


```typescript
import { createVList } from 'vlist/synthetic'
import { scrollbar } from 'vlist'
import 'vlist/styles'

const list = createVList({
  container: '#my-list',
  items: Array.from({ length: 1000 }, (_, id) => ({ id, name: `Row ${id}` })),
  item: { height: 48, template: item => `<div>${item.name}</div>` },
  scroll: { mode: 'synthetic' },
}, [scrollbar()])
```

Supported plugins are **table, groups, snapshots, scrollbar, autosize, transition, selection and a11y**. Existing plugin conflicts still apply; this list does not imply that all eight can be combined. `page()`, `carousel()` and `sortable()` throw when configured with synthetic mode. Carousel uses wrap scrolling, which this release does not support with synthetic input.

Known limitations:

- RTL horizontal lists throw in synthetic mode in this release; use native mode. Vertical lists on RTL pages are supported. RTL support for the synthetic driver is planned as a non-breaking addition.
- Same-axis touch stops at either boundary with no parent handoff, including gestures that start inside an edge-pinned list. Use native mode when touch gestures must scroll the parent page at a boundary.
- The native main-axis scrollbar is absent. Provide a custom scrollbar, such as `scrollbar()` above. Its accessibility release gate remains open; synthetic mode is not a completed scrollbar-accessibility sign-off.
- Inertia initializes its frame clock on the first frame after release, adding up to one frame of release latency.
- Wheel input at an edge is left to the page when it cannot move the list. Native cross-axis scrolling remains available.

Measurement corrections from autosize preserve ongoing motion. Synthetic input adds **2.6 KB gzipped** over the base entry (**12.5 KB** total before plugins); ordinary `vlist` imports exclude this driver. See [RFC-014](https://github.com/floor/vlist/discussions/127).

## Deprecated in 2.8, removed in 3.0

These notices prepare the 3.0 migration; 2.x behavior and defaults stay unchanged. `vlist/native` and `setScrollSource` are 3.0 replacements, not 2.8 APIs. Bounded mode remains supported in 2.x, including carousel and sortable; it emits no deprecation warning.

| Option or API | Replacement | Since |
|---|---|---|
| `scroll.mode` | In 3.0, synthetic input in core; import `vlist/native` for native scrolling. Bounded is removed. | 2.8 |
| `scroll.runway` | Remove it when moving to 3.0 synthetic core. | 2.8 |
| `scroll.scrollbar: "native"` | In 3.0 use `vlist/native` for a browser scrollbar, or `scrollbar()` in synthetic core. | 2.8 |
| `scroll.scrollbar: "none"` | In 3.0 synthetic core has no native main-axis scrollbar to hide; native hiding belongs to `vlist/native`. | 2.8 |
| `PluginContext.setScrollFns`, `disableDefaultScroll` | Use `setScrollSource` when upgrading to 3.0. | 2.8 |
| `scale()` | Use `scroll: { mode: "synthetic" }` from `vlist/synthetic`; bounded remains available in 2.x. | 2.4; guidance updated in 2.8 |

Only explicit `scale()` calls warn, once per process. The `vlist/config` compatibility stub is silent in 2.x and will no longer be installed in 3.0. Its scrollbar omission/options convenience remains supported and maps to `scrollbar()`; only the two string values above are deprecated. See the [RFC-014 migration contract](https://vlist.io/docs/rfcs/RFC-014-Scroll-Input-Model).

## Plugins

| Plugin | Size | Description |
|--------|------|-------------|
| **Base** | 9.9 KB | Virtualization, ARIA, keyboard nav, gap, padding, bounded scroll (1M+ items) |
| `vlist/synthetic` entry | +2.6 KB | Opt-in synthetic scroll input (12.5 KB total before plugins) |
| `data()` | +4.8 KB | Lazy loading with velocity-aware fetching |
| `selection()` | +2.8 KB | Single/multiple selection with 2D keyboard nav |
| `search()` | +3.2 KB | Search bar: filter/navigate modes, match highlighting |
| `groups()` | +5.3 KB | Sticky/inline headers with grid + masonry + table + data integration |
| `autosize()` | +1.0 KB | Auto-measure items via ResizeObserver |
| `scrollbar()` | +2.0 KB | Custom scrollbar UI |
| `grid()` | +2.5 KB | 2D grid layout |
| `masonry()` | +4.1 KB | Pinterest-style masonry with lane-aware keyboard nav |
| `carousel()` | +3.5 KB | Paged horizontal carousel with snap and keyboard nav |
| `table()` | +5.8 KB | Data table with columns, resize, sort |
| `tree()` | +5.0 KB | Collapsible tree with async loading and indent guides |
| `page()` | +0.8 KB | Window-level scrolling |
| `sortable()` | +3.0 KB | Drag-and-drop reordering with auto-scroll |
| `snapshots()` | +1.1 KB | Scroll position save/restore |
| `transition()` | +2.0 KB | FLIP-based enter/exit animations for insert & remove |

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

## Accessibility

Every vlist is accessible by default following the [WAI-ARIA listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/):

- **Arrow keys** move focus between items with a visible focus ring
- **2D navigation** in grids and masonry — Up/Down by row, Left/Right by cell
- **Masonry lane-aware nav** — arrows stay in the same visual column
- **Home/End, PageUp/PageDown, Ctrl+Home/End** — full keyboard coverage
- **Screen-reader DOM ordering** — items reordered on scroll idle for correct reading order
- **Focus recovery** — maintains focus when items are removed

Set `interactive: false` for display-only lists (log viewers, activity feeds) where items contain their own interactive elements.

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

Full configuration reference → **[vlist.io](https://vlist.io)**

## Base Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `overscan` | `3` | Extra items rendered outside viewport |
| `ariaLabel` | — | Accessible label for the listbox |
| `orientation` | `'vertical'` | `'vertical'` or `'horizontal'` scroll direction |
| `padding` | `0` | Content inset — number, `[v, h]`, or `[top, right, bottom, left]` |
| `interactive` | `true` | Enable built-in keyboard navigation |
| `reverse` | `false` | Reverse mode for chat UIs |

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

Fully typed. Generic over your item type:

```typescript
import { createVList, grid, type VList } from 'vlist'

interface Photo { id: number; url: string; title: string }

const list: VList<Photo> = createVList<Photo>({
  container: '#gallery',
  items: photos,
  item: {
    height: 200,
    template: (photo) => `<img src="${photo.url}" />`,
  },
}, [grid({ columns: 4 })])
```

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
