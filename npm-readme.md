# vlist

The virtual list library for every framework. Ultra efficient, batteries-included, and accessible with composable plugins.

**v3.0.0-next.2** (prerelease on the npm `next` tag) — Native scrolling by default, opt-in `vlist/synthetic`, and removal of deprecated scroll configuration and plugin hooks. See the [changelog](https://github.com/floor/vlist/blob/next/CHANGELOG.md).

[![npm version](https://img.shields.io/npm/v/vlist.svg)](https://www.npmjs.com/package/vlist)
[![bundle size](https://img.shields.io/bundlephobia/minzip/vlist)](https://bundlephobia.com/package/vlist)
[![CI](https://github.com/floor/vlist/actions/workflows/ci.yml/badge.svg)](https://github.com/floor/vlist/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

- **Accessible** — WAI-ARIA, 2D keyboard navigation, focus recovery, screen-reader DOM ordering
- **Zero dependencies** — framework-agnostic core, tiny adapters for Vue, Svelte, Solid, React
- **9.3 KB gzipped (3.0 prerelease)** — composable plugins with perfect tree-shaking
- **Constant memory** — ~0.1 MB overhead at any scale, from 10K to 1M+ items
- **Axis-neutral** — vertical and horizontal scrolling through a single code path, all plugins work in both orientations

## Install

```bash
npm install vlist
npm install vlist@next   # 3.0 prerelease; latest stays on 2.8
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

Native scrolling is the default: import `createVList` and plugins from `vlist`. This preserves browser scrollbars, native touch momentum, boundary handoff and native assistive-technology scrolling. Carousel, sortable and horizontal RTL lists work with this factory. Carousel supplies its private wrap runway only when the plugin is imported; bounded scrolling is no longer a public mode.

| Entry | Input model | Use |
|---|---|---|
| `vlist` | Native (default) | Browser scrolling and all supported plugins |
| `vlist/synthetic` | Synthetic (opt-in) | Huge lists and application-owned touch motion |
| `vlist/native` | Alias of `vlist` (deprecated) | Compatibility with `3.0.0-next.1`; use `vlist` for new code |

### Synthetic input

Select synthetic input by importing its factory; there is no `scroll.mode` option. Plugins still come from `vlist`.

```typescript
import { createVList } from 'vlist/synthetic'
import { scrollbar } from 'vlist'
import 'vlist/styles'

const list = createVList({
  container: '#my-list',
  items: Array.from({ length: 1000 }, (_, id) => ({ id, name: `Row ${id}` })),
  item: { height: 48, template: item => `<div>${item.name}</div>` },
}, [scrollbar()])
```

`page()` uses native document scrolling through an external source with either entry. Its content must fit the 16,777,216 px document element limit; creation throws above that limit when the size is known, and later growth warns once. A deferred custom renderer whose size is first committed during rendering also warns once. Use `vlist/synthetic` viewport scrolling for larger lists. Default native viewport lists warn once when content exceeds their browser-size safety limit, pointing to that entry.

`carousel()` works with either entry. Synthetic carousel folds preserve touch motion and smooth snapping across whole laps. `page()` and carousel remain incompatible. The shared carousel plugin includes its native wrap handler even when used with synthetic input; the combined size is reported below.

Synthetic input limitations:

- Horizontal RTL lists throw with instructions to use `vlist`. Vertical lists and tables support `dir="rtl"`, including cross-axis wheel movement, aligned table headers and keyboard column navigation.
- Same-axis touch stops at either boundary with no parent handoff, including gestures starting inside an edge-pinned list. Use the native default when boundary gestures must scroll the parent page.
- There is no native main-axis scrollbar. Add `scrollbar()` for an accessible custom scrollbar. The synthetic entry rejects the `"native"` and `"none"` scrollbar strings.
- Inertia initializes its frame clock on the first frame after release, adding up to one frame of release latency.
- Wheel input at an edge is left to the page when it cannot move the list. Native cross-axis scrolling remains available.

Measurement corrections from autosize preserve ongoing synthetic motion. Existing plugin conflicts still apply. See the [scroll input contract](https://vlist.io/docs/rfcs/RFC-014-Scroll-Input-Model).

## Migrating to 3.0

`3.0.0-next.1` used synthetic input by default. `3.0.0-next.2` restores the 2.x default. Import `vlist/synthetic` explicitly to retain synthetic behavior across these prereleases. `vlist/native` remains a deprecated compatibility alias; its `NativeScrollConfig` and `NativeCreateVListConfig` types alias the standard `ScrollConfig` and `CreateVListConfig`.

| 2.x option or API | 3.0 replacement |
|---|---|
| `scroll.mode` (all values, both entries) | Omit it. `vlist` provides native scrolling; import `vlist/synthetic` for synthetic input. |
| `scroll.runway` (both entries) | Remove it. For huge lists use `vlist/synthetic`, which needs no native runway. |
| `scroll.scrollbar: "native"` or `"none"` | Retained in default `ScrollConfig`. With synthetic input, omit the string and optionally install `scrollbar()`. |
| `PluginContext.setScrollFns`, `disableDefaultScroll` | Use `setScrollSource` to supply an external position source and commit callback. |
| `scale()` and `ScalePluginConfig` | Remove them; use `vlist/synthetic` for the full logical range. Config no longer installs a scale stub. |

Removed mode/runway options throw a migration error before creating DOM. `vlist/config` retains scrollbar omission/options convenience and its top-level `scrollbar: "none"` option. `baseOffset` stays private engine state; plugins use `ctx.scroll.getRenderOrigin()`. Custom wrap providers now supply their handler factory as the second argument of `ctx.setBoundedWrap`.

## Plugins

| Entry / export | Minified | Gzipped |
|---|---:|---:|
| **Base (`vlist`)** | 25.3 KB | 9.3 KB |
| `vlist/synthetic` | 31.3 KB | 11.5 KB |
| `vlist/native` (alias) | 25.3 KB | 9.3 KB |
| `a11y()` | 28.6 KB | 10.5 KB |
| `selection()` | 34.7 KB | 12.1 KB |
| `data()` | 39.0 KB | 14.1 KB |
| `scrollbar()` | 33.5 KB | 12.2 KB |
| `sortable()` | 37.1 KB | 12.8 KB |
| `groups()` | 41.3 KB | 14.6 KB |
| `page()` | 27.8 KB | 10.2 KB |
| `snapshots()` | 28.6 KB | 10.4 KB |
| `transition()` | 32.0 KB | 11.3 KB |
| `autosize()` | 28.4 KB | 10.3 KB |
| `grid()` | 32.4 KB | 11.8 KB |
| `table()` | 43.8 KB | 15.2 KB |
| `masonry()` | 36.7 KB | 13.4 KB |
| `tree()` | 40.6 KB | 14.3 KB |
| `search()` | 34.4 KB | 12.4 KB |
| `carousel()` | 38.0 KB | 13.7 KB |
| `vlist/synthetic` + `carousel()` | 43.9 KB | 15.9 KB |
| `vlist/synthetic` + `sortable()` | 43.0 KB | 15.1 KB |

Sizes are tree-shaken totals from `bun run size`, not additive plugin costs. Plugin rows include the native default factory plus that plugin. The base is **9,514 bytes gzipped**, below the 9.9 KB target; synthetic input is **11,790 bytes** before plugins. The alias row measures the same source factory; the distributed alias re-exports it without duplicating the implementation.

### Sortable gestures

`sortable()` works with either input entry. Mouse and trackpad dragging still starts after `dragThreshold` (5 px by default). Touch and pen without a handle use `touchDelay`, a 350 ms long press; moving at least `dragThreshold` pixels in any direction before it completes yields to scrolling. This delay separates a deliberate hold from a quick flick. With `handle`, dragging starts at the threshold without waiting; touches elsewhere scroll.

```typescript
sortable({ touchDelay: 350, dragThreshold: 5 })
sortable({ handle: '.drag-handle' })
```

A touch during scrolling catches the motion and does not arm a hold for that contact. Lift and press again once the list is at rest. A second finger or `pointercancel` cancels the pending press or active drag. Edge auto-scroll uses the list's logical position and stops on drop.

The touch-only `.vlist-item--touch-sort` class suppresses selection and callouts on the pressed item. A claimed touch/pen drag adds `.vlist-sort-ghost--touch` to the ghost as a visual cue; override that class in CSS to customize it. Keyboard reordering remains Space to grab/drop, arrows to move and Escape to cancel.

## Framework Adapters

| Framework | Package | Size |
|-----------|---------|------|
| Vue | [`vlist-vue`](https://github.com/floor/vlist-vue) | 0.6 KB |
| Svelte | [`vlist-svelte`](https://github.com/floor/vlist-svelte) | 0.5 KB |
| SolidJS | [`vlist-solidjs`](https://github.com/floor/vlist-solidjs) | 0.5 KB |
| React | [`vlist-react`](https://github.com/floor/vlist-react) | 0.6 KB |

Adapters use native scrolling by default. With an adapter that forwards `factory`, select synthetic input explicitly:

```ts
import { useVList } from "vlist-react";
import { createVList } from "vlist/synthetic";

useVList({
  factory: createVList,
  items,
  item: { height: 48, template: item => String(item.id) },
});
```

The same factory option is available to the other adapters. `vlist/config` defaults to native scrolling. The factory is structural configuration: changing it requires recreating the list.

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
