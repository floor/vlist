# vlist

The virtual list library for every framework. Ultra efficient, batteries-included, and accessible with composable plugins.

**v3.1.0-next.2** (prerelease on the npm `next` tag) — `scroll.mode` on the one `vlist` entry: the default, `"auto"`, scrolls natively and hands a list past the browser's size limit to synthetic input, which draws its own scrollbar; carousels honour `"synthetic"`; `vlist/synthetic` is deprecated. See the [changelog](https://github.com/floor/vlist/blob/next/CHANGELOG.md).

[![npm version](https://img.shields.io/npm/v/vlist.svg)](https://www.npmjs.com/package/vlist)
[![bundle size](https://img.shields.io/bundlephobia/minzip/vlist)](https://bundlephobia.com/package/vlist)
[![CI](https://github.com/floor/vlist/actions/workflows/ci.yml/badge.svg)](https://github.com/floor/vlist/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

- **Accessible** — `a11y()` or a selection mode adds WAI-ARIA, 2D keyboard navigation, focus recovery, screen-reader DOM ordering
- **Zero dependencies** — framework-agnostic core, with Vue, Svelte, Solid and React entries in the same package
- **10.3 KB gzipped** — composable plugins with perfect tree-shaking
- **Constant memory** — ~0.1 MB overhead at any scale, from 10K to 1M+ items
- **Axis-neutral** — vertical and horizontal scrolling through a single code path, all plugins work in both orientations

## Install

```bash
npm install vlist
npm install vlist@2      # the 2.x line, still maintained
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

`scroll.mode` chooses who owns scroll input, on the one `vlist` entry. Plugins come from `vlist` in every mode.

| `scroll.mode` | Input | Use |
|---|---|---|
| `"auto"` (default) | Native; past the browser's element size limit (16,000,000 px of content) the list hands itself to synthetic input in place, and takes native input back below 12,000,000 px | Every list: nothing to choose, however large it grows |
| `"native"` | Always native | Browser scrolling only; past the limit the last rows are out of reach, and `content:size:overflow` says so |
| `"synthetic"` | vlist owns wheel, touch and keys from the start | Application-owned touch motion |

Native input keeps browser scrollbars, native touch momentum, boundary handoff and native assistive-technology scrolling. The synthetic driver is a separate file, `synthetic-driver.js`, downloaded the first time a list needs it; until it arrives the list scrolls natively. Each handoff emits `scroll:mode`.

```typescript
import { createVList } from 'vlist'
import 'vlist/styles'

const list = createVList({
  container: '#my-list',
  items: Array.from({ length: 1000 }, (_, id) => ({ id, name: `Row ${id}` })),
  item: { height: 48, template: item => `<div>${item.name}</div>` },
  scroll: { mode: 'synthetic' },
})
```

| Entry | Use |
|---|---|
| `vlist` | Every list; input chosen by `scroll.mode` |
| `vlist/synthetic` | Deprecated: `scroll: { mode: "synthetic" }`. Kept through 3.x; it bundles the driver instead of loading it |
| `vlist/native` | Deprecated alias of `vlist` |

### Synthetic input

A synthetic list draws its own scrollbar, since the browser draws none for content the size of its viewport: the `scrollbar()` plugin's, loaded with the driver. `scroll.scrollbar` options configure it, `"none"` skips it, and a list with `scrollbar()` keeps that one. `scroll.scrollbar: "native"` asks for the browser's scrollbar, so `mode: "synthetic"` rejects it.

`page()` scrolls the document natively in every mode. Its content must fit the 16,777,216 px document element limit; creation throws above that limit when the size is known, and later growth warns once. A deferred custom renderer whose size is first committed during rendering also warns once. Use viewport scrolling (`"auto"` or `"synthetic"`) for larger lists.

`carousel()` runs on its own wrap runway with `"auto"` and `"native"`, and on the synthetic handler with `"synthetic"`: folds preserve touch motion and smooth snapping across whole laps. The first carousel on a page starts on its runway and switches in place once the driver loads and the carousel is idle. `page()` and carousel remain incompatible.

Synthetic input limitations:

- Horizontal RTL lists throw at creation, in every mode. Vertical lists and tables support `dir="rtl"`, including cross-axis wheel movement, aligned table headers and keyboard column navigation.
- Same-axis touch stops at either boundary with no parent handoff, including gestures starting inside an edge-pinned list. Use `"native"` when boundary gestures must scroll the parent page.
- Inertia initializes its frame clock on the first frame after release, adding up to one frame of release latency.
- Wheel input at an edge is left to the page when it cannot move the list. Native cross-axis scrolling remains available.

Measurement corrections from autosize preserve ongoing synthetic motion. Existing plugin conflicts still apply. See the [scroll input contract](https://vlist.io/docs/rfcs/RFC-014-Scroll-Input-Model) and [RFC-015](https://vlist.io/docs/rfcs/RFC-015-Overflow-Handoff).

### Sortable gestures

`sortable()` works in every scroll mode. Mouse and trackpad dragging still starts after `dragThreshold` (5 px by default). Touch and pen without a handle use `touchDelay`, a 350 ms long press; moving at least `dragThreshold` pixels in any direction before it completes yields to scrolling. This delay separates a deliberate hold from a quick flick. With `handle`, dragging starts at the threshold without waiting; touches elsewhere scroll.

```typescript
sortable({ touchDelay: 350, dragThreshold: 5 })
sortable({ handle: '.drag-handle' })
```

A touch during scrolling catches the motion and does not arm a hold for that contact. Lift and press again once the list is at rest. A second finger or `pointercancel` cancels the pending press or active drag. Edge auto-scroll uses the list's logical position and stops on drop.

The touch-only `.vlist-item--touch-sort` class suppresses selection and callouts on the pressed item. A claimed touch/pen drag adds `.vlist-sort-ghost--touch` to the ghost as a visual cue; override that class in CSS to customize it. Keyboard reordering remains Space to grab/drop, arrows to move and Escape to cancel.

## Migrating to 3.0

3.0 scrolls natively by default, as 2.x did. Since 3.1, `scroll.mode` chooses the input on the one `vlist` entry, and its default, `"auto"`, hands huge lists to synthetic input by itself. `vlist/synthetic` and `vlist/native` are deprecated aliases; `vlist/native` its `NativeScrollConfig` and `NativeCreateVListConfig` types alias the standard `ScrollConfig` and `CreateVListConfig`.

| 2.x option or API | 3.0 replacement |
|---|---|
| `scroll.mode` | Since 3.1: `"auto"` (default), `"native"` or `"synthetic"`. The 2.x `"bounded"` is refused. |
| `scroll.runway` | Remove it. Huge lists need nothing: the default `scroll.mode`, `"auto"`, hands them to synthetic input. |
| `scroll.scrollbar: "native"` or `"none"` | Retained. `"native"` needs native input; a synthetic list draws its own scrollbar, which `"none"` skips. |
| `PluginContext.setScrollFns`, `disableDefaultScroll` | Use `setScrollSource` to supply an external position source and commit callback. |
| `scale()` and `ScalePluginConfig` | Remove them; the default `scroll.mode` covers the full logical range. Config no longer installs a scale stub. |

`scroll.runway` and the bounded mode throw a migration error before creating DOM. `vlist/config` wires only what the config asks for: `selection`, the custom scrollbar, `snapshots` and `a11y` are each opt-in, so an adapter list matches a core list built from the same options. It keeps the scrollbar options convenience and its top-level `scrollbar: "none"`; pass `scrollbar: true` for the overlay scrollbar earlier versions added to every list. `baseOffset` stays private engine state; plugins use `ctx.scroll.getRenderOrigin()`. Custom wrap providers supply their handler factory as the second argument of `ctx.scroll.setWrap` (named `setBoundedWrap` in 3.0.0, still accepted).

## Plugins

| Entry / export | Minified | Gzipped |
|---|---:|---:|
| **Base (`vlist`)** | 27.3 KB | 10.3 KB |
| `vlist/synthetic` (deprecated) | 34.2 KB | 12.9 KB |
| `vlist/native` (alias) | 27.3 KB | 10.3 KB |
| `a11y()` | 31.2 KB | 11.7 KB |
| `selection()` | 36.9 KB | 13.2 KB |
| `data()` | 41.0 KB | 15.1 KB |
| `scrollbar()` | 35.5 KB | 13.2 KB |
| `sortable()` | 39.2 KB | 13.9 KB |
| `groups()` | 43.4 KB | 15.7 KB |
| `page()` | 29.9 KB | 11.2 KB |
| `snapshots()` | 30.6 KB | 11.4 KB |
| `transition()` | 34.1 KB | 12.3 KB |
| `autosize()` | 30.6 KB | 11.5 KB |
| `grid()` | 34.8 KB | 12.9 KB |
| `table()` | 45.8 KB | 16.2 KB |
| `masonry()` | 39.4 KB | 14.7 KB |
| `tree()` | 43.6 KB | 15.7 KB |
| `search()` | 36.9 KB | 13.6 KB |
| `carousel()` | 43.1 KB | 15.7 KB |
| `vlist/synthetic` + `carousel()` | 49.2 KB | 18.0 KB |
| `vlist/synthetic` + `sortable()` | 46.1 KB | 16.5 KB |
| `vlist/vue` `useVList` | 27.7 KB | 10.5 KB |
| `vlist/svelte` `vlist` | 27.5 KB | 10.4 KB |
| `vlist/solid` `createVList` | 27.6 KB | 10.4 KB |
| `vlist/react` `useVList` | 27.8 KB | 10.5 KB |
| `vlist/react` + `grid()` | 35.2 KB | 13.1 KB |

Sizes are tree-shaken totals from `bun run size`, not additive plugin costs. Plugin rows include the native default factory plus that plugin; framework rows add the entry, with the framework itself external. The base is **10,541 bytes gzipped**, within the 10.3 KB budget (10,547 bytes). `bun run size` fails if a scenario fails to build, an unused plugin leaks into a bundle, or any published size exceeds its gzip budget. Synthetic input is **13,183 bytes** before plugins; with `scroll.mode`, a `vlist` list downloads the driver and its scrollbar as `synthetic-driver.js` (6.2 KB gzipped) only when it goes synthetic. The alias row measures the same source factory; the distributed alias re-exports it without duplicating the implementation.

## Frameworks

Vue, Svelte, Solid and React each have an entry in the `vlist` package itself. Like the vanilla builder, they are feature-first: you pass plugins from `vlist`, so an app only bundles the features it uses. Every entry imports the core from `vlist`, and none carries a copy of its own.

| Framework | Import | Entry size |
|-----------|--------|------------|
| Vue 3 | `vlist/vue` | 0.4 KB gzip |
| Svelte 4 and 5 | `vlist/svelte` | 0.3 KB gzip |
| SolidJS | `vlist/solid` | 0.3 KB gzip |
| Vanilla JS | `vlist` | — |
| React 17+ | `vlist/react` | 0.4 KB gzip |

```bash
npm install vlist
```

Frameworks are optional peer dependencies, so install only the one you use.

**Vue**

```vue
<script setup lang="ts">
import { useVList } from "vlist/vue";
import { grid } from "vlist";

const { containerRef, instance } = useVList(
  { items, item: { height: 200, template: renderPhoto } },
  [grid({ columns: 4, gap: 16 })],
);
</script>

<template><div ref="containerRef" style="height: 600px" /></template>
```

If you pass a `ref` as the config, the list updates when its `items` change. `useVListEvent(instance, "item:click", handler)` subscribes to an event for the component's lifetime.

**Svelte**

```svelte
<script>
  import { vlist } from "vlist/svelte";
  import { grid } from "vlist";
</script>

<div
  style="height: 600px"
  use:vlist={{
    config: { items, item: { height: 200, template: renderPhoto } },
    plugins: [grid({ columns: 4, gap: 16 })],
    onInstance: (list) => (instance = list),
  }}
/>
```

**Solid**

```tsx
import { createVList } from "vlist/solid";
import { grid } from "vlist";

const { setRef, instance } = createVList(
  () => ({ items: items(), item: { height: 200, template: renderPhoto } }),
  [grid({ columns: 4, gap: 16 })],
);

return <div ref={setRef} style={{ height: "600px" }} />;
```

`createVList` keeps the Solid primitive idiom. In a file that also uses the core builder, alias one of the two: `import { createVList as createSolidVList } from "vlist/solid"`.

**React**

```tsx
import { useVList, useVListEvent } from "vlist/react";
import { grid } from "vlist";

function Photos({ items }) {
  const { containerRef, instanceRef } = useVList(
    { items, item: { height: 200, template: renderPhoto } },
    [grid({ columns: 4, gap: 16 })],
  );
  useVListEvent(instanceRef, "item:click", ({ item }) => open(item));
  return <div ref={containerRef} style={{ height: 600 }} />;
}
```

Plugins are read once, at mount; changing them means remounting the list (in React, with a `key`). An `items` change updates the list in place. `scroll.mode` and other structural options also take effect only at mount.

The `vlist-vue`, `vlist-svelte`, `vlist-solidjs` and `vlist-react` packages are deprecated in favour of these entries. Their last release forwards to them, so existing config-based code keeps working while you migrate.

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
