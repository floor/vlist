# vlist

The virtual list library for every framework. Ultra efficient, batteries-included, and accessible with composable plugins — in 7.7 KB.

**v2.0.2** — [Changelog](./CHANGELOG.md) · **v2 is a ground-up rewrite** with a new plugin API. Coming from v1? See [Migration Guide](https://vlist.io/docs/migration).

[![npm version](https://img.shields.io/npm/v/vlist.svg)](https://www.npmjs.com/package/vlist)
[![bundle size](https://img.shields.io/bundlephobia/minzip/vlist)](https://bundlephobia.com/package/vlist)
[![CI](https://github.com/floor/vlist/actions/workflows/ci.yml/badge.svg)](https://github.com/floor/vlist/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

- **Accessible** — WAI-ARIA, 2D keyboard navigation, focus recovery, screen-reader DOM ordering
- **Zero dependencies** — framework-agnostic core with tiny adapters for Vue, Svelte, Solid, React
- **7.7 KB gzipped** — composable plugins with perfect tree-shaking
- **Constant memory** — ~0.1 MB overhead at any scale, from 10K to 1M+ items
- **Grid, masonry, table, groups, data, selection, sortable, transition, scale** — all opt-in
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

### Plugins

| Plugin | Size | Description |
|--------|------|-------------|
| **Base** | 7.7 KB | Virtualization, ARIA, keyboard nav, gap, padding |
| `data()` | +4.7 KB | Lazy loading with velocity-aware fetching |
| `selection()` | +2.4 KB | Single/multiple selection with 2D keyboard nav |
| `scale()` | +3.9 KB | 1M+ items via scroll compression |
| `groups()` | +3.7 KB | Sticky/inline headers with async group discovery |
| `autosize()` | +0.7 KB | Auto-measure items via ResizeObserver |
| `scrollbar()` | +2.0 KB | Custom scrollbar UI |
| `grid()` | +2.1 KB | 2D grid layout |
| `masonry()` | +3.5 KB | Pinterest-style masonry with lane-aware keyboard nav |
| `table()` | +5.8 KB | Data table with columns, resize, sort |
| `page()` | +0.7 KB | Window-level scrolling |
| `sortable()` | +2.9 KB | Drag-and-drop reordering with auto-scroll |
| `snapshots()` | +1.3 KB | Scroll position save/restore |
| `transition()` | +1.8 KB | FLIP-based enter/exit animations for insert & remove |

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
autosize()                        // auto-measure items (requires estimatedHeight)
scale()                           // auto-activates at 16.7M px
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
