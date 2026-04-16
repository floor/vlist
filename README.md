# vlist

Lightweight, high-performance virtual list with zero dependencies and dimension-agnostic architecture.

**v1.6.0** — [Changelog](./changelog.txt)

[![npm version](https://img.shields.io/npm/v/vlist.svg)](https://www.npmjs.com/package/vlist)
[![CI](https://github.com/floor/vlist/actions/workflows/ci.yml/badge.svg)](https://github.com/floor/vlist/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

- **Zero dependencies** — no external libraries
- **Ultra memory efficient** — ~0.1-0.2 MB constant overhead regardless of dataset size
- **~10.3 KB gzipped** — pay only for features you use (vs 20 KB+ monolithic alternatives)
- **Builder API** — composable features with perfect tree-shaking
- **Grid, masonry, table, groups, async, selection, scale** — all opt-in
- **Horizontal & vertical** — semantically correct orientation support
- **Gap & padding** — built-in item spacing and content inset (CSS shorthand convention)
- **Reverse, page-scroll, wrap** — every layout mode
- **Accessible** — WAI-ARIA, keyboard navigation, focus-visible, screen-reader DOM ordering, ARIA live region
- **React, Vue, Svelte, SolidJS** — framework adapters available

**14+ interactive examples → [vlist.io](https://vlist.io)**

## Highlights

- **WAI-ARIA Grid keyboard navigation** — grids and masonry layouts support full 2D arrow-key navigation (Up/Down by row, Left/Right by cell), row-scoped Home/End, Ctrl+Home/End, PageUp/Down. Horizontal orientation swaps axes correctly.
- **Masonry lane-aware navigation** — ArrowUp/Down stay in the same visual column, ArrowLeft/Right move to the nearest item in the adjacent lane. O(1) same-lane / O(log k) adjacent-lane via pre-built per-lane index arrays.
- **Data table** — virtualized columns with resize, sort, horizontal scroll, and grouped sections via `withTable()`
- **Dimension-agnostic API** — semantically correct terminology for both orientations
- **Performance optimized** — 13-pattern optimization playbook applied across the entire rendering pipeline
- **Horizontal groups** — sticky headers work in horizontal carousels
- **Horizontal grid layouts** — 2D grids work in both orientations
- **Masonry** — shortest-lane placement via `withMasonry()`
- **Keyboard accessible** — focus-visible outlines, full 2D keyboard navigation, smart edge-scroll, Tab support
- **Responsive grid & masonry** — context-injected `columnWidth` auto-recalculates on resize
- **Modular CSS** — core (7.4 KB) + opt-in grid, masonry, table, and extras stylesheets. Import only what you use.
- **Composable dark mode** — three strategies (`prefers-color-scheme`, `.dark` class, `data-theme-mode` attribute) with rgba state colors for clear visual hierarchy

## Installation

```bash
npm install vlist
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
| **Base** | 10.4 KB | Core virtualization, gap, padding, ARIA live region, baseline keyboard nav |
| `withGrid()` | +3.9 KB | 2D grid layout with context injection |
| `withMasonry()` | +3.3 KB | Pinterest-style masonry layout with lane-aware nav |
| `withGroups()` | +2.7 KB | Grouped lists with sticky/inline headers |
| `withAsync()` | +4.4 KB | Lazy loading with adapters |
| `withSelection()` | +2.7 KB | Single/multiple selection + 2D keyboard nav |
| `withScale()` | +3.1 KB | 1M+ items via scroll compression |
| `withScrollbar()` | +1.1 KB | Custom scrollbar UI |
| `withTable()` | +5.5 KB | Data table with columns, resize, sort, groups |
| `withAutoSize()` | +0.9 KB | Auto-measure items via ResizeObserver |
| `withPage()` | +0.4 KB | Document-level scrolling |
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

### Sticky Headers

```typescript
import { vlist, withGroups } from 'vlist'

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
    header: {
      height: 36,
      template: (letter) => `<div class="header">${letter}</div>`,
    },
    sticky: true,
  }))
  .build()
```

Set `sticky: false` for inline headers (iMessage/WhatsApp style).

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
| **Auto-measured sizes** | `item: { estimatedHeight: 120 }` + `withAutoSize()` |
| **Zebra striping** | `item: { striped: true }` or `striped: 'even'` / `'odd'` / `'data'` (group-aware) |

See **[vlist.io](https://vlist.io)** for live demos of each.

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
| `withSnapshots({ autoSave: 'key' })` | Automatic save/restore via sessionStorage |
| `list.getScrollSnapshot()` | Save scroll state (for manual patterns) |
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
withGroups({ getGroupForIndex, header: { height, template }, sticky?: true })
withSelection({ mode: 'single' | 'multiple', initial?: [...ids], shiftArrowToggle?: 'origin' | 'destination' })
withAsync({ adapter: { read }, loading?: { cancelThreshold? } })
withTable({ columns, rowHeight, headerHeight?, resizable?, columnBorders?, rowBorders? })
withAutoSize()                        // auto-measure items (requires estimatedHeight)
withScale()                           // auto-activates at 16.7M px
withScale({ force: true })            // force compression on any list size
withScrollbar({ autoHide?, autoHideDelay?, minThumbSize? })
withPage()                            // no config — uses document scroll
withSnapshots({ autoSave: 'key' })    // automatic sessionStorage save/restore
withSnapshots({ restore: snapshot })  // manual restore from saved snapshot
```

Full configuration reference → **[vlist.io](https://vlist.io)**

## Base Configuration

The `vlist()` factory accepts these base options alongside `container`, `items`, and `item`:

| Option | Default | Description |
|--------|---------|-------------|
| `overscan` | `3` | Extra items rendered outside viewport |
| `classPrefix` | `'vlist'` | CSS class prefix for all generated elements |
| `ariaLabel` | — | Accessible label for the listbox (`aria-label`) |
| `orientation` | `'vertical'` | `'vertical'` or `'horizontal'` scroll direction |
| `padding` | `0` | Content inset — number, `[v, h]`, or `[top, right, bottom, left]` |
| `interactive` | `true` | Enable built-in keyboard navigation (see below) |
| `reverse` | `false` | Reverse mode for chat UIs (new items appear at bottom) |
| `scroll.wheel` | `true` | Enable mouse wheel scrolling |
| `scroll.wrap` | `false` | Wrap focus around at boundaries |
| `scroll.gutter` | `'auto'` | Scrollbar gutter: `'auto'` or `'stable'` |
| `scroll.idleTimeout` | `150` | Scroll idle detection timeout (ms) |

### `interactive` — Baseline Keyboard Navigation

By default, every vlist is keyboard-navigable following the [WAI-ARIA listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/):

- **Arrow keys** move focus between items (with a visible focus ring)
- **Space / Enter** selects the focused item
- **Home / End** jump to first / last item
- **Click** selects + focuses the clicked item

This works **without** `withSelection()` — it's built into the base. The `withSelection()` feature adds multi-select, Shift+Arrow toggle, Shift+Space range select, Ctrl+A, and other advanced selection APIs on top — following the [WAI-ARIA APG recommended listbox model](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/).

Set `interactive: false` to disable all built-in keyboard handling:

```typescript
const feed = vlist({
  container: '#feed',
  items: posts,
  item: { height: 120, template: renderPost },
  interactive: false,  // no item-level keyboard nav or focus ring
}).build()
```

Use this when:
- The list is **display-only** (log viewer, activity feed, chat history)
- Your app provides its **own keyboard navigation**
- Items contain **interactive elements** (inputs, buttons) that need to own focus

## Framework Adapters

| Framework | Package | Size |
|-----------|---------|------|
| React | [`vlist-react`](https://github.com/floor/vlist-react) | 0.6 KB gzip |
| Vue | [`vlist-vue`](https://github.com/floor/vlist-vue) | 0.6 KB gzip |
| Svelte | [`vlist-svelte`](https://github.com/floor/vlist-svelte) | 0.5 KB gzip |
| SolidJS | [`vlist-solidjs`](https://github.com/floor/vlist-solidjs) | 0.5 KB gzip |

```bash
npm install vlist vlist-react   # or vlist-vue / vlist-svelte / vlist-solidjs
```

Each adapter README has setup examples and API docs.

## Styling

```typescript
import 'vlist/styles'           // core (always required)
import 'vlist/styles/grid'      // when using withGrid()
import 'vlist/styles/masonry'   // when using withMasonry()
import 'vlist/styles/table'     // when using withTable()
import 'vlist/styles/extras'    // optional (variants, loading states, animations)
```

| Import | Size | Contents |
|--------|------|----------|
| `vlist/styles` | 7.4 KB | Tokens, base list, item states, scrollbar, groups, horizontal mode |
| `vlist/styles/grid` | 1.2 KB | Grid layout |
| `vlist/styles/masonry` | 1.3 KB | Masonry layout |
| `vlist/styles/table` | 7.2 KB | Table layout (header, rows, cells, resize) |
| `vlist/styles/extras` | 1.1 KB | Variants, loading/empty states, enter animation |

Override tokens to match your design system. See [vlist.io/tutorials/styling](https://vlist.io/tutorials/styling) for the full guide.

### Dark Mode

Dark mode is supported out of the box via three mechanisms (no extra imports needed):

| Method | How it works |
|--------|-------------|
| **OS preference** | `prefers-color-scheme: dark` — automatic |
| **Tailwind `.dark` class** | Add `.dark` to any ancestor element |
| **`data-theme-mode`** | Set `data-theme-mode="dark"` on `<html>` for explicit control |

To force light mode when `prefers-color-scheme` would otherwise activate dark, set `data-theme-mode="light"` on the root element.

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

**Migration from v0.8.2:** See [v0.9.0 Migration Guide](https://vlist.io/docs/refactoring/v0.9.0-migration-guide.md)

## Performance

### Bundle Size

| Configuration | Gzipped |
|---------------|---------|
| Base only | 10.5 KB |
| + Grid | 14.3 KB |
| + Groups | 13.2 KB |
| + Async | 14.8 KB |
| + Table | 15.9 KB |

### Memory Efficiency

vlist uses **constant memory** regardless of dataset size through optimized internal architecture:

| Dataset Size | After Render | Scroll Delta | Notes |
|--------------|-------------|--------------|-------|
| 10K items | 0.07 MB | ~0 MB | Constant baseline |
| 100K items | 0.08 MB | ~0 MB | 10× items, same memory |
| 1M items | 0.09 MB | 0.19 MB | 100× items, near-zero scroll overhead |

**Key advantages:**
- No array copying — uses references for zero-copy performance
- No ID indexing overhead — O(1) memory complexity
- Reusable event payloads — zero per-frame object allocation on scroll
- Content height cap at 16M px — avoids browser overhead for extremely large lists

### DOM Efficiency

With 100K items: **~26 DOM nodes** in the document (visible + overscan) instead of 100,000.

### Render Performance

- **Initial render:** ~8ms (constant, regardless of item count)
- **Scroll performance:** 120 FPS (perfect smoothness)
- **1M items:** Same performance as 10K items

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

## Changelog

See [CHANGELOG.md](https://vlist.io/docs/CHANGELOG.md) for the full release history. A simplified [changelog.txt](./changelog.txt) is also available.

## Links

- **Docs & Examples:** [vlist.io](https://vlist.io)
- **Migration Guide:** [v0.9.0 Migration](https://vlist.io/docs/refactoring/v0.9.0-migration-guide.md)
- **GitHub:** [github.com/floor/vlist](https://github.com/floor/vlist)
- **NPM:** [vlist](https://www.npmjs.com/package/vlist)
- **Issues:** [GitHub Issues](https://github.com/floor/vlist/issues)

---

Built by [Floor IO](https://floor.io)
