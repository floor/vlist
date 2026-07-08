# vlist

The virtual list library for every framework. Ultra efficient, batteries-included, and accessible with composable plugins — in 9.7 KB.

**v2.6.0** — [Changelog](https://github.com/floor/vlist/blob/main/CHANGELOG.md) · New `vlist/config` resolver shared by the framework adapters (fixes #119); adapter feature-field types realigned, and `scroll.scrollbar: "native"` honored in the config layer.

[![npm version](https://img.shields.io/npm/v/vlist.svg)](https://www.npmjs.com/package/vlist)
[![bundle size](https://img.shields.io/bundlephobia/minzip/vlist)](https://bundlephobia.com/package/vlist)
[![CI](https://github.com/floor/vlist/actions/workflows/ci.yml/badge.svg)](https://github.com/floor/vlist/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

- **Accessible** — WAI-ARIA, 2D keyboard navigation, focus recovery, screen-reader DOM ordering
- **Zero dependencies** — framework-agnostic core, tiny adapters for Vue, Svelte, Solid, React
- **9.7 KB gzipped** — composable plugins with perfect tree-shaking
- **Constant memory** — ~0.1 MB overhead at any scale, from 10K to 1M+ items
- **Axis-neutral** — vertical and horizontal scrolling through a single code path, all plugins work in both orientations

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
| **Base** | 9.7 KB | Virtualization, ARIA, keyboard nav, gap, padding, bounded scroll (1M+ items) |
| `data()` | +4.8 KB | Lazy loading with velocity-aware fetching |
| `selection()` | +2.7 KB | Single/multiple selection with 2D keyboard nav |
| `search()` | +3.2 KB | Search bar: filter/navigate modes, match highlighting |
| `groups()` | +5.3 KB | Sticky/inline headers with grid + masonry + table + data integration |
| `autosize()` | +0.8 KB | Auto-measure items via ResizeObserver |
| `scrollbar()` | +2.0 KB | Custom scrollbar UI |
| `grid()` | +2.4 KB | 2D grid layout |
| `masonry()` | +4.0 KB | Pinterest-style masonry with lane-aware keyboard nav |
| `carousel()` | +3.4 KB | Paged horizontal carousel with snap and keyboard nav |
| `table()` | +5.8 KB | Data table with columns, resize, sort |
| `tree()` | +5.0 KB | Collapsible tree with async loading and indent guides |
| `page()` | +0.8 KB | Window-level scrolling |
| `sortable()` | +3.0 KB | Drag-and-drop reordering with auto-scroll |
| `snapshots()` | +1.1 KB | Scroll position save/restore |
| `transition()` | +1.8 KB | FLIP-based enter/exit animations for insert & remove |

## Framework Adapters

| Framework | Package | Size |
|-----------|---------|------|
| Vue | [`vlist-vue`](https://github.com/floor/vlist-vue) | 0.6 KB |
| Svelte | [`vlist-svelte`](https://github.com/floor/vlist-svelte) | 0.5 KB |
| SolidJS | [`vlist-solidjs`](https://github.com/floor/vlist-solidjs) | 0.5 KB |
| React | [`vlist-react`](https://github.com/floor/vlist-react) | 0.6 KB |

## Docs & Examples

**18 interactive examples, full API reference, tutorials, and live benchmarks → [vlist.io](https://vlist.io)**

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

## License

[MIT](LICENSE) — Built by [Floor IO](https://floor.io)

## Acknowledgments

Thanks to Alexander Klaiber for graciously transferring the `vlist` package name on npm.
