# vlist

The virtual list library for every framework. Ultra efficient, batteries-included, and accessible with composable plugins — in 9.7 KB.

**v2.7.1** — [Changelog](https://github.com/floor/vlist/blob/main/CHANGELOG.md) · Grid, table, tree and masonry no longer judder in bounded and synthetic mode: their renderers now follow baseOffset on every step.

[![npm version](https://img.shields.io/npm/v/vlist.svg)](https://www.npmjs.com/package/vlist)
[![bundle size](https://img.shields.io/bundlephobia/minzip/vlist)](https://bundlephobia.com/package/vlist)
[![CI](https://github.com/floor/vlist/actions/workflows/ci.yml/badge.svg)](https://github.com/floor/vlist/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

- **Accessible** — WAI-ARIA, 2D keyboard navigation, focus recovery, screen-reader DOM ordering
- **Zero dependencies** — framework-agnostic core, tiny adapters for Vue, Svelte, Solid, React
- **9.9 KB gzipped** — composable plugins with perfect tree-shaking
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
