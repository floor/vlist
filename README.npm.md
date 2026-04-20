# vlist

The virtual list library for every framework. Accessible by default, batteries-included, with composable features — in 10.5 KB.

[![npm version](https://img.shields.io/npm/v/vlist.svg)](https://www.npmjs.com/package/vlist)
[![CI](https://github.com/floor/vlist/actions/workflows/ci.yml/badge.svg)](https://github.com/floor/vlist/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

- **Zero dependencies** — framework-agnostic core, tiny adapters for Vue, Svelte, Solid, React
- **Accessible** — WAI-ARIA, 2D keyboard navigation, focus recovery, screen-reader DOM ordering
- **10.5 KB gzipped** — composable features, pay only for what you use
- **Constant memory** — ~0.1 MB overhead at any scale, from 10K to 1M+ items

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
| **Base** | 10.5 KB | Virtualization, ARIA, keyboard nav, gap, padding |
| `withGrid()` | +3.8 KB | 2D grid layout |
| `withMasonry()` | +3.3 KB | Pinterest-style masonry with lane-aware keyboard nav |
| `withTable()` | +5.5 KB | Data table with columns, resize, sort |
| `withGroups()` | +2.7 KB | Sticky/inline headers |
| `withAsync()` | +4.5 KB | Lazy loading with velocity-aware fetching |
| `withSelection()` | +2.7 KB | Single/multiple selection with 2D keyboard nav |
| `withScale()` | +3.1 KB | 1M+ items via scroll compression |
| `withAutoSize()` | +0.9 KB | Auto-measure items via ResizeObserver |
| `withScrollbar()` | +1.1 KB | Custom scrollbar UI |
| `withPage()` | +0.4 KB | Window-level scrolling |
| `withSnapshots()` | +0.7 KB | Scroll position save/restore |

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
