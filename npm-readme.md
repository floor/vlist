# vlist

The virtual list library for every framework. Accessible by default, batteries-included, with composable plugins — in 5.0 KB.

**v2.0.0** — [Changelog](https://github.com/floor/vlist/blob/main/CHANGELOG.md)

[![npm version](https://img.shields.io/npm/v/vlist.svg)](https://www.npmjs.com/package/vlist)
[![bundle size](https://img.shields.io/bundlephobia/minzip/vlist)](https://bundlephobia.com/package/vlist)
[![CI](https://github.com/floor/vlist/actions/workflows/ci.yml/badge.svg)](https://github.com/floor/vlist/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

- **Accessible** — WAI-ARIA, 2D keyboard navigation, focus recovery, screen-reader DOM ordering
- **Zero dependencies** — framework-agnostic core, tiny adapters for Vue, Svelte, Solid, React
- **5.0 KB gzipped** — composable plugins with perfect tree-shaking
- **Constant memory** — ~0.1 MB overhead at any scale, from 10K to 1M+ items
- **Vertical & horizontal** — single axis-neutral code path, every plugin works in both orientations

## Install

```bash
npm install vlist
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
```

Add plugins as the second argument:

```typescript
import { createVList, grid, selection } from 'vlist'

const list = createVList({ container: '#app', items, item: { height: 200, template: render } }, [
  grid({ columns: 4, gap: 16 }),
  selection({ mode: 'multiple' }),
])
```

## Plugins

| Plugin | Size | Description |
|--------|------|-------------|
| **Base** | 5.0 KB | Virtualization, ARIA, keyboard nav, gap, padding |
| `async()` | +3.9 KB | Lazy loading with velocity-aware fetching |
| `selection()` | +1.2 KB | Single/multiple selection with 2D keyboard nav |
| `scale()` | +3.4 KB | 1M+ items via scroll compression |
| `groups()` | +2.5 KB | Sticky/inline headers with async group discovery |
| `autosize()` | +0.6 KB | Auto-measure items via ResizeObserver |
| `scrollbar()` | +1.8 KB | Custom scrollbar UI |
| `grid()` | +1.7 KB | 2D grid layout |
| `masonry()` | +2.9 KB | Pinterest-style masonry with lane-aware keyboard nav |
| `table()` | +5.8 KB | Data table with columns, resize, sort |
| `page()` | +0.7 KB | Window-level scrolling |
| `sortable()` | +3.0 KB | Drag-and-drop reordering with auto-scroll |
| `snapshots()` | +1.2 KB | Scroll position save/restore |
| `transition()` | +1.9 KB | FLIP-based enter/exit animations for insert & remove |

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

## Acknowledgments

Thanks to Alexander Klaiber for graciously transferring the `vlist` package name on npm.
