# vlist

The virtual list library for every framework. Ultra efficient, batteries-included, and accessible with composable plugins.

**v3.0.0-next.1** (prerelease on the npm `next` tag) — Synthetic input by default, native input through `vlist/native`, and removal of the deprecated scroll configuration and plugin hooks. See the [changelog](https://github.com/floor/vlist/blob/next/CHANGELOG.md).

[![npm version](https://img.shields.io/npm/v/vlist.svg)](https://www.npmjs.com/package/vlist)
[![bundle size](https://img.shields.io/bundlephobia/minzip/vlist)](https://bundlephobia.com/package/vlist)
[![CI](https://github.com/floor/vlist/actions/workflows/ci.yml/badge.svg)](https://github.com/floor/vlist/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

- **Accessible** — WAI-ARIA, 2D keyboard navigation, focus recovery, screen-reader DOM ordering
- **Zero dependencies** — framework-agnostic core, tiny adapters for Vue, Svelte, Solid, React
- **11.4 KB gzipped (3.0 development)** — composable plugins with perfect tree-shaking
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

## Scroll input

Synthetic scrolling is the default in 3.0. Import `createVList` and plugins from `vlist`; there is no `scroll.mode` option. The deprecated `vlist/synthetic` entry remains an alias of the same factory.

```typescript
import { createVList, scrollbar } from 'vlist'
import 'vlist/styles'

const list = createVList({
  container: '#my-list',
  items: Array.from({ length: 1000 }, (_, id) => ({ id, name: `Row ${id}` })),
  item: { height: 48, template: item => `<div>${item.name}</div>` },
}, [scrollbar()])
```

For native scrolling, import the factory from `vlist/native` and plugins from `vlist`. Native scrolling is required for `carousel()`, `sortable()`, and horizontal RTL lists; configuring these with the default entry throws. The native entry preserves carousel wrapping through a private runway implementation. Bounded scrolling is no longer a public mode.

```typescript
import { createVList } from 'vlist/native'
import { carousel } from 'vlist'

const list = createVList({
  container: '#slides',
  orientation: 'horizontal',
  items: slides,
  item: { width: 320, template: renderSlide },
}, [carousel()])
```

`page()` uses native document scrolling through an external source with either entry. Its content must fit the 16,777,216 px document element limit; creation throws above that limit when the size is known, and later growth warns once. A deferred custom renderer whose size is first committed during rendering also warns once. Use default viewport scrolling for larger lists. Native viewport lists warn once when content exceeds their browser-size safety limit.

Known limitations:

- Horizontal RTL lists require `vlist/native`. Vertical lists and tables support `dir="rtl"` on the container, including cross-axis wheel movement, aligned table headers and keyboard column navigation.
- Same-axis touch stops at either boundary with no parent handoff, including gestures starting inside an edge-pinned list. Use `vlist/native` when boundary gestures must scroll the parent page.
- The default entry has no native main-axis scrollbar. Add `scrollbar()` for an accessible custom scrollbar; native visibility options belong to `vlist/native`.
- Inertia initializes its frame clock on the first frame after release, adding up to one frame of release latency.
- Wheel input at an edge is left to the page when it cannot move the list. Native cross-axis scrolling remains available.

Measurement corrections from autosize preserve ongoing motion. Existing plugin conflicts still apply. See the [scroll input contract](https://vlist.io/docs/rfcs/RFC-014-Scroll-Input-Model).

## Migrating to 3.0

| Removed public API | Replacement |
|---|---|
| `scroll.mode` (all values, both entries) | Omit it. `vlist` provides synthetic input; import `vlist/native` for native scrolling. |
| `scroll.runway` (both entries) | Remove it. Default synthetic scrolling supports huge lists without a native runway. |
| Core `scroll.scrollbar: "native"` or `"none"` | Use `scrollbar()` with `vlist`, or select `vlist/native` to retain either string. Native types are exported as `NativeScrollConfig` and `NativeCreateVListConfig`. |
| `PluginContext.setScrollFns`, `disableDefaultScroll` | Use `setScrollSource` to supply an external position source and commit callback. |
| `scale()` and `ScalePluginConfig` | Remove it; the default entry supports the full logical range. `vlist/config` no longer installs a scale stub. |

Removed scroll options throw a migration error before creating DOM. `vlist/config` retains its scrollbar omission/options convenience and its top-level `scrollbar: "none"` option; native visibility strings require an injected native factory. `baseOffset` remains private engine state for input providers; plugins continue to use `ctx.scroll.getRenderOrigin()`. No other public plugin hooks or adapter methods are removed.

## Plugins

| Entry / export | Minified | Gzipped |
|---|---:|---:|
| **Base (`vlist`)** | 31.1 KB | 11.4 KB |
| `vlist/synthetic` (alias) | 31.1 KB | 11.4 KB |
| `vlist/native` | 28.1 KB | 10.2 KB |
| `a11y()` | 34.4 KB | 12.6 KB |
| `selection()` | 40.5 KB | 14.2 KB |
| `data()` | 44.8 KB | 16.2 KB |
| `scrollbar()` | 39.3 KB | 14.2 KB |
| `sortable()` | 40.6 KB | 14.3 KB |
| `groups()` | 47.1 KB | 16.7 KB |
| `page()` | 33.6 KB | 12.3 KB |
| `snapshots()` | 34.4 KB | 12.5 KB |
| `transition()` | 37.8 KB | 13.3 KB |
| `autosize()` | 34.2 KB | 12.4 KB |
| `grid()` | 38.2 KB | 13.8 KB |
| `table()` | 49.5 KB | 17.2 KB |
| `masonry()` | 42.5 KB | 15.5 KB |
| `tree()` | 46.4 KB | 16.4 KB |
| `search()` | 40.2 KB | 14.5 KB |
| `carousel()` | 41.0 KB | 14.9 KB |

Sizes are tree-shaken totals from `bun run size`, not additive plugin costs. Plugin rows measure the base factory plus that export for comparison across revisions; `carousel()` and `sortable()` must be used with the native factory at runtime. The base is **11,670 bytes gzipped** in this 3.0 work-in-progress build. The 9.9 KB target is not yet met; size optimization is deferred.

## Framework Adapters

| Framework | Package | Size |
|-----------|---------|------|
| Vue | [`vlist-vue`](https://github.com/floor/vlist-vue) | 0.6 KB |
| Svelte | [`vlist-svelte`](https://github.com/floor/vlist-svelte) | 0.5 KB |
| SolidJS | [`vlist-solidjs`](https://github.com/floor/vlist-solidjs) | 0.5 KB |
| React | [`vlist-react`](https://github.com/floor/vlist-react) | 0.6 KB |

Adapters use synthetic input by default. With an adapter that forwards `factory`, select native input explicitly:

```ts
import { useVList } from "vlist-react";
import { createVList } from "vlist/native";

useVList({
  factory: createVList,
  items,
  item: { height: 48, template: item => String(item.id) },
});
```

The same factory option is available to the other adapters. `vlist/config` defaults to synthetic input. The factory is structural configuration: changing it requires recreating the list.

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
