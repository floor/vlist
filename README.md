# vlist

Lightweight, high-performance virtual list with zero dependencies and dimension-agnostic architecture.

**v1.3.8** — [Changelog](./changelog.txt)

[![npm version](https://img.shields.io/npm/v/%40floor%2Fvlist.svg)](https://www.npmjs.com/package/@floor/vlist)
[![CI](https://github.com/floor/vlist/actions/workflows/ci.yml/badge.svg)](https://github.com/floor/vlist/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

- **Zero dependencies** — no external libraries
- **Ultra memory efficient** — ~0.1-0.2 MB constant overhead regardless of dataset size
- **~9.9 KB gzipped** — pay only for features you use (vs 20 KB+ monolithic alternatives)
- **Builder API** — composable features with perfect tree-shaking
- **Grid, masonry, table, groups, async, selection, scale** — all opt-in
- **Horizontal & vertical** — semantically correct orientation support
- **Gap & padding** — built-in item spacing and content inset (CSS shorthand convention)
- **Reverse, page-scroll, wrap** — every layout mode
- **Accessible** — WAI-ARIA, keyboard navigation, focus-visible, screen-reader DOM ordering, ARIA live region
- **React, Vue, Svelte** — framework adapters available

**14+ interactive examples → [vlist.dev](https://vlist.dev)**

## Highlights


- **Data table** — virtualized columns with resize, sort, horizontal scroll, and grouped sections via `withTable()`
- **Dimension-agnostic API** — semantically correct terminology for both orientations
- **Performance optimized** — 13-pattern optimization playbook applied across the entire rendering pipeline
- **Horizontal groups** — sticky headers work in horizontal carousels
- **Horizontal grid layouts** — 2D grids work in both orientations
- **Masonry** — shortest-lane placement via `withMasonry()`
- **Keyboard accessible** — focus-visible outlines, arrow/Home/End navigation, Tab support
- **Responsive grid & masonry** — context-injected `columnWidth` auto-recalculates on resize

## Installation

```bash
npm install @floor/vlist
```

## Quick Start

```typescript
import { vlist } from '@floor/vlist'
import '@floor/vlist/styles'

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
import { vlist, withGrid, withGroups, withSelection } from '@floor/vlist'

const list = vlist({
  container: '#app',
  items: photos,
  item: { height: 200, template: renderPhoto },
})
  .use(withGrid({ columns: 4, gap: 16 }))
  .use(withGroups({
    getGroupForIndex: (i) => photos[i].category,
    headerHeight: 40,
    headerTemplate: (cat) => `<h2>${cat}</h2>`,
  }))
  .use(withSelection({ mode: 'multiple' }))
  .build()
```

### Features

| Feature | Size | Description |
|---------|------|-------------|
| **Base** | 9.9 KB | Core virtualization, gap, padding, ARIA live region |
| `withGrid()` | +3.9 KB | 2D grid layout with context injection |
| `withMasonry()` | +2.7 KB | Pinterest-style masonry layout |
| `withGroups()` | +4.2 KB | Grouped lists with sticky/inline headers |
| `withAsync()` | +4.4 KB | Lazy loading with adapters |
| `withSelection()` | +1.7 KB | Single/multiple selection + keyboard nav |
| `withScale()` | +3.0 KB | 1M+ items via scroll compression |
| `withScrollbar()` | +1.1 KB | Custom scrollbar UI |
| `withTable()` | +5.1 KB | Data table with columns, resize, sort, groups |
| `withPage()` | +0.4 KB | Document-level scrolling |
| `withSnapshots()` | +0.6 KB | Scroll save/restore |

## Examples

More examples at **[vlist.dev](https://vlist.dev)**.

### Data Table

```typescript
import { vlist, withTable, withSelection } from '@floor/vlist'

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
import { vlist, withGrid, withScrollbar } from '@floor/vlist'

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

### Sticky Headers

```typescript
import { vlist, withGroups } from '@floor/vlist'

const contacts = vlist({
  container: '#contacts',
  items: sortedContacts,
  item: {
    height: 56,
    template: (contact) => `<div>${contact.name}</div>`,
  },
})
  .use(withGroups({
    getGroupForIndex: (i) => sortedContacts[i].lastName[0].toUpperCase(),
    headerHeight: 36,
    headerTemplate: (letter) => `<div class="header">${letter}</div>`,
    sticky: true,
  }))
  .build()
```

Set `sticky: false` for inline headers (iMessage/WhatsApp style).

### Async Loading

```typescript
import { vlist, withAsync } from '@floor/vlist'

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

### More Patterns

| Pattern | Key options |
|---------|------------|
| **Chat UI** | `reverse: true` + `withGroups({ sticky: false })` |
| **Horizontal carousel** | `orientation: 'horizontal'`, `item.width` |
| **Horizontal groups** | `orientation: 'horizontal'` + `withGroups()` |
| **Horizontal grid** | `orientation: 'horizontal'` + `withGrid()` |
| **Data table** | `withTable({ columns, rowHeight, resizable })` |
| **Grouped table** | `withTable({ columns, rowHeight })` + `withGroups({ ... })` |
| **Item gap** | `item: { height: 48, gap: 8 }` |
| **Content padding** | `padding: 16` or `padding: [16, 12]` or `padding: [16, 12, 20, 8]` |
| **Masonry** | `withMasonry({ columns: 4, gap: 16 })` |
| **Page-level scroll** | `withPage()` |
| **1M+ items** | `withScale()` — auto-compresses scroll space |
| **Wrap navigation** | `scroll: { wrap: true }` |
| **Variable heights** | `item: { height: (index) => heights[index] }` |
| **Zebra striping** | `item: { striped: true }` or `striped: 'even'` / `'odd'` / `'data'` (group-aware) |

See **[vlist.dev](https://vlist.dev)** for live demos of each.

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
| `list.reload({ snapshot })` | Re-fetch and restore scroll position from snapshot |

### Navigation

| Method | Description |
|--------|-------------|
| `list.scrollToIndex(i, align?)` | Scroll to index (`'start'` \| `'center'` \| `'end'`) |
| `list.scrollToIndex(i, opts?)` | With `{ align, behavior: 'smooth', duration }` |
| `list.cancelScroll()` | Cancel smooth scroll animation |
| `list.getScrollPosition()` | Current scroll offset |

### Snapshots (with `withSnapshots()`)

| Method | Description |
|--------|-------------|
| `list.getScrollSnapshot()` | Save scroll state (for SPA navigation) |
| `list.restoreScroll(snapshot)` | Restore saved scroll state |

### Selection (with `withSelection()`)

| Method | Description |
|--------|-------------|
| `list.select(...ids)` | Select item(s) |
| `list.deselect(...ids)` | Deselect item(s) |
| `list.toggleSelect(id)` | Toggle |
| `list.selectAll()` / `list.clearSelection()` | Bulk operations |
| `list.getSelected()` | Array of selected IDs |
| `list.getSelectedItems()` | Array of selected items |

### Grid (with `withGrid()`)

| Method | Description |
|--------|-------------|
| `list.updateGrid({ columns, gap })` | Update grid at runtime |

### Table (with `withTable()`)

| Method | Description |
|--------|-------------|
| `list.setSort(key, direction?)` | Set sort indicator (visual only) |
| `list.getSort()` | Get current `{ key, direction }` |
| `list.updateColumns(columns)` | Replace column definitions at runtime |
| `list.resizeColumn(key, width)` | Resize a column programmatically |
| `list.getColumnWidths()` | Get current widths keyed by column key |

| Event | Payload |
|-------|---------|
| `column:sort` | `{ key, direction, index }` |
| `column:resize` | `{ key, width, previousWidth, index }` |
| `column:click` | `{ key, index, event }` |

### Events

`list.on()` returns an unsubscribe function. You can also use `list.off(event, handler)`.

```typescript
list.on('scroll', ({ scrollPosition, direction }) => {})  // v0.9.0: scrollPosition (was scrollTop)
list.on('range:change', ({ range }) => {})
list.on('item:click', ({ item, index, event }) => {})
list.on('item:dblclick', ({ item, index, event }) => {})
list.on('selection:change', ({ selectedIds, selectedItems }) => {})
list.on('load:start', ({ offset, limit }) => {})
list.on('load:end', ({ items, offset, total }) => {})
list.on('load:error', ({ error, offset, limit }) => {})
list.on('velocity:change', ({ velocity, reliable }) => {})
```

### Statistics (with `createStats()`)

| Method | Description |
|--------|-------------|
| `createStats(list)` | Create a stats tracker for scroll performance metrics |

### Properties

| Property | Description |
|----------|-------------|
| `list.element` | Root DOM element |
| `list.items` | Current items (readonly) |
| `list.total` | Total item count |

### Lifecycle

```typescript
list.destroy()
```

## Feature Configuration

Each feature's config is fully typed — hover in your IDE for details.

```typescript
withGrid({ columns: 4, gap: 16 })
withMasonry({ columns: 4, gap: 16 })
withGroups({ getGroupForIndex, headerHeight, headerTemplate, sticky?: true })
withSelection({ mode: 'single' | 'multiple', initial?: [...ids] })
withAsync({ adapter: { read }, loading?: { cancelThreshold? } })
withTable({ columns, rowHeight, headerHeight?, resizable?, columnBorders?, rowBorders? })
withScale()                           // auto-activates at 16.7M px
withScale({ force: true })            // force compression on any list size
withScrollbar({ autoHide?, autoHideDelay?, minThumbSize? })
withPage()                            // no config — uses document scroll
withSnapshots()                       // included by default
```

Full configuration reference → **[vlist.dev](https://vlist.dev)**

## Framework Adapters

| Framework | Package | Size |
|-----------|---------|------|
| React | [`vlist-react`](https://github.com/floor/vlist-react) | 0.6 KB gzip |
| Vue | [`vlist-vue`](https://github.com/floor/vlist-vue) | 0.6 KB gzip |
| Svelte | [`vlist-svelte`](https://github.com/floor/vlist-svelte) | 0.5 KB gzip |
| SolidJS | [`vlist-solidjs`](https://github.com/floor/vlist-solidjs) | 0.5 KB gzip |

```bash
npm install @floor/vlist vlist-react   # or vlist-vue / vlist-svelte / vlist-solidjs
```

Each adapter README has setup examples and API docs.

## Styling

```typescript
import '@floor/vlist/styles'           // base styles (required)
import '@floor/vlist/styles/extras'    // optional enhancements
```

Override with your own CSS using the `.vlist`, `.vlist-item`, `.vlist-item--selected`, `.vlist-scrollbar` selectors. See [vlist.dev](https://vlist.dev) for theming examples.

### Dark Mode

Dark mode is supported out of the box via three mechanisms (no extra imports needed):

| Method | How it works |
|--------|-------------|
| **OS preference** | `prefers-color-scheme: dark` — automatic |
| **Tailwind `.dark` class** | Add `.dark` to any ancestor element |
| **`data-theme-mode`** | Set `data-theme-mode="dark"` on `<html>` for explicit control |

To force light mode when `prefers-color-scheme` would otherwise activate dark, set `data-theme-mode="light"` on the root element. All dark mode CSS variables and `color-scheme` declarations are handled automatically.

## Architecture

### Dimension-Agnostic Design (v0.9.0)

vlist uses semantically correct terminology that works for both vertical and horizontal orientations:

```typescript
// ✅ Correct: Works for both orientations
sizeCache.getSize(index)       // Returns height OR width
state.scrollPosition           // scrollTop OR scrollLeft
state.containerSize            // height OR width

// Previously (v0.8.2): Semantically wrong in horizontal mode
heightCache.getHeight(index)   // ❌ Returned WIDTH in horizontal!
state.scrollTop                // ❌ Stored scrollLEFT!
```

This makes the codebase clearer and eliminates semantic confusion when working with horizontal lists.

**Migration from v0.8.2:** See [v0.9.0 Migration Guide](https://vlist.dev/docs/refactoring/v0.9.0-migration-guide.md)

## Performance

### Bundle Size

| Configuration | Gzipped |
|---------------|---------|
| Base only | 9.9 KB |
| + Grid | 13.8 KB |
| + Groups | 14.1 KB |
| + Async | 14.3 KB |
| + Table | 15.0 KB |

### Memory Efficiency

vlist uses **constant memory** regardless of dataset size through optimized internal architecture:

| Dataset Size | Memory Usage | Notes |
|--------------|--------------|-------|
| 10K items | ~0.2 MB | Constant baseline |
| 100K items | ~0.2 MB | 10× items, same memory |
| 1M items | ~0.4 MB | 100× items, 2× memory |

**Key advantages:**
- No array copying — uses references for zero-copy performance
- No ID indexing overhead — O(1) memory complexity
- Industry-leading memory efficiency for virtual list libraries

### DOM Efficiency

With 100K items: **~26 DOM nodes** in the document (visible + overscan) instead of 100,000.

### Render Performance

- **Initial render:** ~8ms (constant, regardless of item count)
- **Scroll performance:** 120 FPS (perfect smoothness)
- **1M items:** Same performance as 10K items

## TypeScript

Fully typed. Generic over your item type:

```typescript
import { vlist, withGrid, type VList } from '@floor/vlist'

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

## Changelog

See [CHANGELOG.md](https://vlist.dev/docs/CHANGELOG.md) for the full release history. A simplified [changelog.txt](./changelog.txt) is also available.

## Links

- **Docs & Examples:** [vlist.dev](https://vlist.dev)
- **Migration Guide:** [v0.9.0 Migration](https://vlist.dev/docs/refactoring/v0.9.0-migration-guide.md)
- **GitHub:** [github.com/floor/vlist](https://github.com/floor/vlist)
- **NPM:** [@floor/vlist](https://www.npmjs.com/package/@floor/vlist)
- **Issues:** [GitHub Issues](https://github.com/floor/vlist/issues)

---

Built by [Floor IO](https://floor.io)
