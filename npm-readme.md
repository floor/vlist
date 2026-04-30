# vlist

The virtual list library for every framework. Accessible by default, batteries-included, with composable features — in 10.6 KB.

[![npm version](https://img.shields.io/npm/v/vlist.svg)](https://www.npmjs.com/package/vlist)
[![CI](https://github.com/floor/vlist/actions/workflows/ci.yml/badge.svg)](https://github.com/floor/vlist/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

- **New: `withSortable()`** — drag-and-drop reordering with auto-scroll, keyboard support, and ARIA announcements
- **Zero dependencies** — framework-agnostic core, tiny adapters for Vue, Svelte, Solid, React
- **Accessible** — WAI-ARIA, 2D keyboard navigation, focus recovery, screen-reader DOM ordering
- **10.6 KB gzipped** — composable features with perfect tree-shaking
- **Constant memory** — ~0.1 MB overhead at any scale, from 10K to 1M+ items
- **Vertical & horizontal** — single axis-neutral code path, every feature works in both orientations

## Install

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
```

Add features with the builder pattern:

```typescript
import { vlist, withGrid, withSelection } from 'vlist'

const list = vlist({ container: '#app', items, item: { height: 200, template: render } })
  .use(withGrid({ columns: 4, gap: 16 }))
  .use(withSelection({ mode: 'multiple' }))
  .build()
```

## Features

| Feature | Size | Description |
|---------|------|-------------|
| **Base** | 10.6 KB | Virtualization, ARIA, keyboard nav, gap, padding |
| `withAsync()` | +4.6 KB | Lazy loading with velocity-aware fetching |
| `withSelection()` | +2.9 KB | Single/multiple selection with 2D keyboard nav |
| `withScale()` | +3.7 KB | 1M+ items via scroll compression |
| `withGroups()` | +2.7 KB | Sticky/inline headers |
| `withAutoSize()` | +0.9 KB | Auto-measure items via ResizeObserver |
| `withScrollbar()` | +1.7 KB | Custom scrollbar UI |
| `withGrid()` | +3.9 KB | 2D grid layout |
| `withMasonry()` | +3.4 KB | Pinterest-style masonry with lane-aware keyboard nav |
| `withTable()` | +5.5 KB | Data table with columns, resize, sort |
| `withPage()` | +0.8 KB | Window-level scrolling |
| `withSortable()` | +2.9 KB | Drag-and-drop reordering with auto-scroll |
| `withSnapshots()` | +0.8 KB | Scroll position save/restore |

## Framework Adapters

| Framework | Package | Size |
|-----------|---------|------|
| Vue | [`vlist-vue`](https://github.com/floor/vlist-vue) | 0.6 KB |
| Svelte | [`vlist-svelte`](https://github.com/floor/vlist-svelte) | 0.5 KB |
| SolidJS | [`vlist-solidjs`](https://github.com/floor/vlist-solidjs) | 0.5 KB |
| React | [`vlist-react`](https://github.com/floor/vlist-react) | 0.6 KB |

## Docs & Examples

**18 interactive examples, full API reference, tutorials, and live benchmarks → [vlist.io](https://vlist.io)**

## License

[MIT](LICENSE) — Built by [Floor IO](https://floor.io)
