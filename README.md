# vlist

Lightweight, high-performance virtual list with zero dependencies and dimension-agnostic architecture.

[![npm version](https://img.shields.io/npm/v/%40floor%2Fvlist.svg)](https://www.npmjs.com/package/@floor/vlist)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@floor/vlist)](https://bundlephobia.com/package/@floor/vlist)
[![tests](https://img.shields.io/badge/tests-1181%20passing-brightgreen)](https://github.com/floor/vlist)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

- **Zero dependencies** — no external libraries
- **Ultra memory efficient** — ~0.1-0.2 MB constant overhead regardless of dataset size
- **8–12 KB gzipped** — pay only for features you use (vs 20 KB+ monolithic alternatives)
- **Builder API** — composable plugins with perfect tree-shaking
- **Grid, sections, async, selection, scale** — all opt-in
- **Horizontal & vertical** — semantically correct orientation support
- **Reverse, page-scroll, wrap** — every layout mode
- **Accessible** — WAI-ARIA, keyboard navigation, screen-reader friendly
- **React, Vue, Svelte** — framework adapters available

**30+ interactive examples → [vlist.dev](https://vlist.dev)**

## v0.9.0 Highlights

- ✨ **Dimension-agnostic API** — semantically correct terminology for both orientations
- 🎯 **Horizontal sections** — sticky headers work in horizontal carousels
- 🎨 **Horizontal grid layouts** — 2D grids work in both orientations
- 📐 **`orientation` not `direction`** — clearer, more intuitive configuration

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
import { vlist, withGrid, withSections, withSelection } from '@floor/vlist'

const list = vlist({
  container: '#app',
  items: photos,
  item: { height: 200, template: renderPhoto },
})
  .use(withGrid({ columns: 4, gap: 16 }))
  .use(withSections({
    getGroupForIndex: (i) => photos[i].category,
    headerHeight: 40,
    headerTemplate: (cat) => `<h2>${cat}</h2>`,
  }))
  .use(withSelection({ mode: 'multiple' }))
  .build()
```

### Plugins

| Plugin | Size | Description |
|--------|------|-------------|
| **Base** | 7.7 KB | Core virtualization |
| `withGrid()` | +4.0 KB | 2D grid layout |
| `withSections()` | +4.6 KB | Grouped lists with sticky/inline headers |
| `withAsync()` | +5.3 KB | Lazy loading with adapters |
| `withSelection()` | +2.3 KB | Single/multiple selection + keyboard nav |
| `withScale()` | +2.2 KB | 1M+ items via scroll compression |
| `withScrollbar()` | +1.0 KB | Custom scrollbar UI |
| `withPage()` | +0.9 KB | Document-level scrolling |
| `withSnapshots()` | included | Scroll save/restore |

## Examples

More examples at **[vlist.dev](https://vlist.dev)**.

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
import { vlist, withSections } from '@floor/vlist'

const contacts = vlist({
  container: '#contacts',
  items: sortedContacts,
  item: {
    height: 56,
    template: (contact) => `<div>${contact.name}</div>`,
  },
})
  .use(withSections({
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
| **Chat UI** | `reverse: true` + `withSections({ sticky: false })` |
| **Horizontal carousel** | `orientation: 'horizontal'`, `item.width` |
| **Horizontal sections** | `orientation: 'horizontal'` + `withSections()` |
| **Horizontal grid** | `orientation: 'horizontal'` + `withGrid()` |
| **Page-level scroll** | `withPage()` |
| **1M+ items** | `withScale()` — auto-compresses scroll space |
| **Wrap navigation** | `scroll: { wrap: true }` |
| **Variable heights** | `item: { height: (index) => heights[index] }` |

See **[vlist.dev](https://vlist.dev)** for live demos of each.

## API

```typescript
const list = vlist(config).use(...plugins).build()
```

### Data

| Method | Description |
|--------|-------------|
| `list.setItems(items)` | Replace all items |
| `list.appendItems(items)` | Add to end (auto-scrolls in reverse mode) |
| `list.prependItems(items)` | Add to start (preserves scroll position) |
| `list.updateItem(index, partial)` | Update a single item by index |
| `list.removeItem(index)` | Remove by index |
| `list.reload()` | Re-fetch from adapter (async) |

### Navigation

| Method | Description |
|--------|-------------|
| `list.scrollToIndex(i, align?)` | Scroll to index (`'start'` \| `'center'` \| `'end'`) |
| `list.scrollToIndex(i, opts?)` | With `{ align, behavior: 'smooth', duration }` |
| `list.cancelScroll()` | Cancel smooth scroll animation |
| `list.getScrollPosition()` | Current scroll offset |
| `list.getVisibleRange()` | `{ start, end }` of visible indices |
| `list.getScrollSnapshot()` | Save scroll state (for SPA navigation) |
| `list.restoreScroll(snapshot)` | Restore saved scroll state |

### Selection (with `withSelection()`)

| Method | Description |
|--------|-------------|
| `list.selectItem(id)` | Select item |
| `list.deselectItem(id)` | Deselect item |
| `list.toggleSelection(id)` | Toggle |
| `list.selectAll()` / `list.clearSelection()` | Bulk operations |
| `list.getSelectedIds()` | Array of selected IDs |
| `list.getSelectedItems()` | Array of selected items |

### Grid (with `withGrid()`)

| Method | Description |
|--------|-------------|
| `list.updateGrid({ columns, gap })` | Update grid at runtime |

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

## Plugin Configuration

Each plugin's config is fully typed — hover in your IDE for details.

```typescript
withGrid({ columns: 4, gap: 16 })
withSections({ getGroupForIndex, headerHeight, headerTemplate, sticky?: true })
withSelection({ mode: 'single' | 'multiple', initial?: [...ids] })
withAsync({ adapter: { read }, loading?: { cancelThreshold? } })
withScale()                           // no config — auto-activates at 16.7M px
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

```bash
npm install @floor/vlist vlist-react   # or vlist-vue / vlist-svelte
```

Each adapter README has setup examples and API docs.

## Styling

```typescript
import '@floor/vlist/styles'           // base styles (required)
import '@floor/vlist/styles/extras'    // optional enhancements
```

Override with your own CSS using the `.vlist`, `.vlist-item`, `.vlist-item--selected`, `.vlist-scrollbar` selectors. See [vlist.dev](https://vlist.dev) for theming examples.

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
| Base only | 7.7 KB |
| + Grid | 11.7 KB |
| + Sections | 12.3 KB |
| + Async | 13.5 KB |
| All plugins | ~16 KB |

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
2. Run `bun test` (1739 tests) and `bun run build` before submitting

## License

[MIT](LICENSE)

## Changelog

### v0.9.0 (January 2025)

**Breaking Changes:**
- Renamed `direction` → `orientation` for semantic clarity
- Renamed `HeightCache` → `SizeCache` and all related APIs
- Renamed `scrollTop` → `scrollPosition` in ViewportState and events
- See [Migration Guide](https://vlist.dev/docs/refactoring/v0.9.0-migration-guide.md)

**New Features:**
- Horizontal orientation support for grid and sections plugins
- Complete dimension-agnostic architecture
- Proper axis swapping for horizontal 2D grids

## Links

- **Docs & Examples:** [vlist.dev](https://vlist.dev)
- **Migration Guide:** [v0.9.0 Migration](https://vlist.dev/docs/refactoring/v0.9.0-migration-guide.md)
- **GitHub:** [github.com/floor/vlist](https://github.com/floor/vlist)
- **NPM:** [@floor/vlist](https://www.npmjs.com/package/@floor/vlist)
- **Issues:** [GitHub Issues](https://github.com/floor/vlist/issues)

---

Built by [Floor IO](https://floor.io)