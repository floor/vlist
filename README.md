# vlist

The virtual list library for every framework. Accessible by default, batteries-included, with composable features — in 10.5 KB.

**v1.6.2** — [Changelog](./changelog.txt)

[![npm version](https://img.shields.io/npm/v/vlist.svg)](https://www.npmjs.com/package/vlist)
[![CI](https://github.com/floor/vlist/actions/workflows/ci.yml/badge.svg)](https://github.com/floor/vlist/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

- **Accessible** — WAI-ARIA, 2D keyboard navigation, focus recovery, screen-reader DOM ordering, ARIA live region
- **Zero dependencies** — framework-agnostic core with tiny adapters for Vue, Svelte, Solid, React
- **10.5 KB gzipped** — composable features with perfect tree-shaking
- **Constant memory** — ~0.1 MB overhead at any scale, from 10K to 1M+ items
- **Grid, masonry, table, groups, async, selection, scale** — all opt-in
- **Vertical & horizontal** — dimension-agnostic API, every layout mode works in both orientations

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
import { vlist } from 'vlist'
import 'vlist/styles'

const list = vlist({
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
}).build()

list.scrollToIndex(10)
list.setItems(newItems)
list.on('item:click', ({ item }) => console.log(item))
```

## Builder Pattern

Start with the base, add only what you need:

```typescript
import { vlist, withGrid, withGroups, withSelection } from 'vlist'

const list = vlist({
  container: '#app',
  items: photos,
  item: { height: 200, template: renderPhoto },
})
  .use(withGrid({ columns: 4, gap: 16 }))
  .use(withGroups({
    getGroupForIndex: (i) => photos[i].category,
    header: { height: 40, template: (cat) => `<h2>${cat}</h2>` },
  }))
  .use(withSelection({ mode: 'multiple' }))
  .build()
```

### Features

| Feature | Size | Description |
|---------|------|-------------|
| **Base** | 10.5 KB | Core virtualization, gap, padding, ARIA live region, baseline keyboard nav |
| `withGrid()` | +3.8 KB | 2D grid layout with context injection |
| `withMasonry()` | +3.3 KB | Pinterest-style masonry layout with lane-aware nav |
| `withGroups()` | +2.7 KB | Grouped lists with sticky/inline headers |
| `withAsync()` | +4.5 KB | Lazy loading with adapters |
| `withSelection()` | +2.7 KB | Single/multiple selection + 2D keyboard nav |
| `withScale()` | +3.1 KB | 1M+ items via scroll compression |
| `withScrollbar()` | +1.1 KB | Custom scrollbar UI |
| `withTable()` | +5.5 KB | Data table with columns, resize, sort, groups |
| `withAutoSize()` | +0.9 KB | Auto-measure items via ResizeObserver |
| `withPage()` | +0.9 KB | Document-level scrolling |
| `withSnapshots()` | +0.7 KB | Scroll save/restore with autoSave |

## Examples

More examples at **[vlist.io](https://vlist.io)**.

### Data Table

```typescript
import { vlist, withTable, withSelection } from 'vlist'

const table = vlist({
  container: '#my-table',
  items: contacts,
  item: { height: 36, template: () => '' },
})
  .use(withTable({
    columns: [
      { key: 'name',   label: 'Name',   width: 200, sortable: true },
      { key: 'email',  label: 'Email',  width: 260, sortable: true },
      { key: 'role',   label: 'Role',   width: 160, sortable: true },
      { key: 'status', label: 'Status', width: 100, align: 'center' },
    ],
    rowHeight: 36,
    headerHeight: 36,
    resizable: true,
  }))
  .use(withSelection({ mode: 'single' }))
  .build()

table.on('column:sort', ({ key, direction }) => { /* re-sort data */ })
table.on('column:resize', ({ key, width }) => { /* persist widths */ })
```

### Grid Layout

```typescript
import { vlist, withGrid, withScrollbar } from 'vlist'

const gallery = vlist({
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
})
  .use(withGrid({ columns: 4, gap: 16 }))
  .use(withScrollbar({ autoHide: true }))
  .build()
```

### Async Loading

```typescript
import { vlist, withAsync } from 'vlist'

const list = vlist({
  container: '#list',
  item: {
    height: 64,
    template: (item) => item
      ? `<div>${item.name}</div>`
      : `<div class="placeholder">Loading…</div>`,
  },
})
  .use(withAsync({
    adapter: {
      read: async ({ offset, limit }) => {
        const res = await fetch(`/api/users?offset=${offset}&limit=${limit}`)
        const data = await res.json()
        return { items: data.items, total: data.total, hasMore: data.hasMore }
      },
    },
  }))
  .build()
```

## Accessibility

Every vlist is accessible by default following the [WAI-ARIA listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/):

- **Arrow keys** move focus between items with a visible focus ring
- **2D navigation** in grids and masonry — Up/Down by row, Left/Right by cell
- **Masonry lane-aware nav** — arrows stay in the same visual column
- **Home/End, PageUp/PageDown, Ctrl+Home/End** — full keyboard coverage
- **Screen-reader DOM ordering** — items reordered on scroll idle for correct reading order
- **ARIA live region** — announces loading state changes
- **Focus recovery** — maintains focus when items are removed

Set `interactive: false` for display-only lists (log viewers, activity feeds) where items contain their own interactive elements.

## API

```typescript
const list = vlist(config).use(...features).build()
```

### Data

| Method | Description |
|--------|-------------|
| `list.setItems(items)` | Replace all items |
| `list.appendItems(items)` | Add to end (auto-scrolls in reverse mode) |
| `list.prependItems(items)` | Add to start (preserves scroll position) |
| `list.updateItem(index, partial)` | Update a single item by index |
| `list.removeItem(index)` | Remove by index |
| `list.getItemAt(index)` | Get item at index |
| `list.getIndexById(id)` | Get index by item ID |
| `list.reload()` | Re-fetch from adapter (async) |

### Navigation

| Method | Description |
|--------|-------------|
| `list.scrollToIndex(i, align?)` | Scroll to index (`'start'` \| `'center'` \| `'end'`) |
| `list.scrollToIndex(i, opts?)` | With `{ align, behavior: 'smooth', duration }` |
| `list.cancelScroll()` | Cancel smooth scroll animation |
| `list.getScrollPosition()` | Current scroll offset |

### Selection (with `withSelection()`)

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
```

### Properties

| Property | Description |
|----------|-------------|
| `list.element` | Root DOM element |
| `list.items` | Current items (readonly) |
| `list.total` | Total item count |
| `list.destroy()` | Cleanup and remove from DOM |

## Feature Configuration

Each feature's config is fully typed — hover in your IDE for details.

```typescript
withGrid({ columns: 4, gap: 16 })
withMasonry({ columns: 4, gap: 16 })
withGroups({ getGroupForIndex, header: { height, template }, sticky?: true })
withSelection({ mode: 'single' | 'multiple', initial?: [...ids] })
withAsync({ adapter: { read }, loading?: { cancelThreshold? } })
withTable({ columns, rowHeight, headerHeight?, resizable? })
withAutoSize()                        // auto-measure items (requires estimatedHeight)
withScale()                           // auto-activates at 16.7M px
withScrollbar({ autoHide?, autoHideDelay?, minThumbSize? })
withPage()                            // no config — uses document scroll
withSnapshots({ autoSave: 'key' })    // automatic sessionStorage save/restore
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
| `scroll.wrap` | `false` | Wrap focus around at boundaries |

## Styling

```typescript
import 'vlist/styles'           // core (always required)
import 'vlist/styles/grid'      // when using withGrid()
import 'vlist/styles/masonry'   // when using withMasonry()
import 'vlist/styles/table'     // when using withTable()
import 'vlist/styles/extras'    // optional (variants, loading states, animations)
```

Dark mode works out of the box via `prefers-color-scheme`, Tailwind's `.dark` class, or `data-theme-mode="dark"`. Override CSS custom properties to match your design system. See [vlist.io/tutorials/styling](https://vlist.io/tutorials/styling) for the full guide.

## Performance

| Dataset Size | After Render | Scroll Delta |
|--------------|-------------|--------------|
| 10K items | 0.07 MB | ~0 MB |
| 100K items | 0.08 MB | ~0 MB |
| 1M items | 0.09 MB | 0.19 MB |

- **Initial render:** ~8ms (constant, regardless of item count)
- **Scroll:** 120 FPS at any scale
- **DOM nodes:** ~26 in document with 100K items (visible + overscan only)

Live benchmarks against 9 competitors → **[vlist.io/benchmarks](https://vlist.io/benchmarks)**

## TypeScript

Fully typed. Generic over your item type:

```typescript
import { vlist, withGrid, type VList } from 'vlist'

interface Photo { id: number; url: string; title: string }

const list: VList<Photo> = vlist<Photo>({
  container: '#gallery',
  items: photos,
  item: {
    height: 200,
    template: (photo) => `<img src="${photo.url}" />`,
  },
})
  .use(withGrid({ columns: 4 }))
  .build()
```

## Contributing

1. Fork → branch → make changes → add tests → pull request
2. Run `bun test` and `bun run build` before submitting

## License

[MIT](LICENSE)

## Links

- **Docs & Examples:** [vlist.io](https://vlist.io)
- **GitHub:** [github.com/floor/vlist](https://github.com/floor/vlist)
- **NPM:** [vlist](https://www.npmjs.com/package/vlist)
- **Issues:** [GitHub Issues](https://github.com/floor/vlist/issues)

---

Built by [Floor IO](https://floor.io)
