# Per-item size updates after creation (#347)

Status: proposal, not implemented. Target release: 3.2.0 (a minor release: one additive
method). Reviewed against `next` at the merge of #349, which is the state this proposal was
written on.

## 1. Problem

A list builds its size cache once from the item configuration. After creation there is no
core way to change one item's size without rebuilding every size:

- `updateItem(id, updates)` merges the new data and re-renders, but never touches the size
  cache (`src/core/create.ts:1069-1078`). A function-based size — a row whose height depends
  on the item's data — keeps the value it returned the last time every size was rebuilt.
- `setItems(items)` replaces the data and rebuilds every size (`src/core/create.ts:1016-1022`).
- `list.remeasure(index)` exists only with `autosize()` (`src/plugins/autosize/plugin.ts:232-246`),
  and `table()`, `masonry()` and `carousel()` now refuse to be combined with that plugin:
  a measured size and a fixed item size are two writers of one size, and #349 made the pair
  a configuration error rather than a silent no-op (`src/plugins/table/plugin.ts:253-257`).

The user story from the issue: a table row grows while it is being edited, then shrinks back.
The row's content height is not known at creation; it changes while the list lives. Today the
only ways to make the list observe the new height are to recreate it — losing scroll position,
focus, selection and any in-flight interaction — or to call `setItems`, which re-reads every
size in the list and re-renders the whole range. Neither is acceptable for an editor on a
large table.

The #349 change matters here: `table()` has no measurement path at all now, by design, so the
fix cannot be "use `autosize()` with the table". The core has to offer the one-item update
itself. (The issue writes `updateItem(index, item)`; the method the code exposes is
`updateItem(id, updates)` — `src/core/types.ts:329` — which is why the keying question below
matters.)

## 2. What exists today

### 2.1 Public surface

`VList` is declared at `src/core/types.ts:321-350`, implemented in `src/core/create.ts`.

| API | What it does | Touches the size cache? |
| --- | --- | --- |
| `setItems(items)` (`types.ts:326`, `create.ts:1016-1022`) | Replaces the data, then `sizeCache.rebuild(total)`, syncs content size, force-renders | Yes — every size, O(n) |
| `updateItem(id, updates)` (`types.ts:329`, `create.ts:1069-1078`) | Merges the update into the item (or delegates to the data plugin), then force-renders | No |
| `getItemAt(index)` (`types.ts:333`, `create.ts:1133`) | Reads an item by index | No |
| `getIndexById(id)` (`types.ts:334`, `create.ts:1152`) | Reads an index by item id | No |
| `scrollToIndex(index, …)` (`types.ts:336`) | Scrolls to a data index | No |

The index space of the item APIs is the **data item index**. The core documents that space
where it resolves a click: the reported index is "the data index — the space `getItemAt`,
`scrollToIndex` and `removeItem` take" (`src/core/create.ts:901-903`). A layout index counts
group headers, and the two differ only under `groups()` (#380, #396).

With `autosize()`, the list additionally has `isMeasured`, `remeasure(index?)`,
`setMeasuredSize(index, size)` and `getMeasuredCount` (`src/plugins/autosize/plugin.ts:36-45`).
No public API takes a size, and `remeasure` is unavailable wherever a fixed-size layout plugin
is installed.

### 2.2 Internals

**The size cache.** `SizeCache` is declared at `src/rendering/sizes.ts:18-52`. There are two
implementations:

- Fixed (`sizes.ts:62-97`): every item has one size, `getOffset` is a multiplication, and
  `invalidate` is a no-op (`sizes.ts:93`) because nothing can go stale.
- Variable (`sizes.ts:147-232`): two-level prefix sums, 512 items per block
  (`sizes.ts:104-110`). `getSize(index)` calls the current size function
  (`sizes.ts:198`); `getOffset` is O(1); `invalidate(start, end)` re-reads the blocks the
  range touches and then recomputes the block offsets after them — O(n / 512)
  (`sizes.ts:142-145`, `sizes.ts:225-231`).

One-item invalidation is therefore already cheap: 512 size-function reads plus one addition
per block, independent of list length for the reads. No Fenwick tree is needed, and no full
rebuild. `rebuild(total)` is the O(n) path every data change uses.

**The spec behind the cache.** The core bakes the configured gap into its spec and passes the
same gap to the cache (`src/core/create.ts:252-257`, `create.ts:295`). `sizes.setConfig`
(`create.ts:525-538`) replaces the cache's methods in place with `Object.assign`, preserves a
layout plugin's rebuild hook through `_setSizeCacheBase`, and takes an optional gap for the
new spec (`src/core/types.ts:172-180`). There is no getter for the spec a plugin installed
after creation, and none for the cache's gap: `rawSpec` is the configuration-time spec
(`types.ts:174`). Any shape that rewraps the installed spec must preserve that gap, or
the content total loses one gap's worth.

**Content size, render, scroll.** Plugins reach `render.contentSize(size)` and `render.force()`
(`create.ts:543-545`); the size passed is the cache total without main-axis padding
(`create.ts:660-677`, used this way at `src/plugins/autosize/plugin.ts:272-274`).
`scroll.shiftBy(delta)` shifts the committed position (`create.ts:466-470`), and
`scroll.getPixelEquivalent()` is the committed position (`src/core/adapter.ts:183-185`, wired
to `state.scrollPosition` at `create.ts:428`).

**Index spaces under `groups()`.** `groups()` registers `_dataToLayoutIndex` and
`_layoutToDataIndex` (`src/plugins/groups/plugin.ts:1013-1017`) and replaces the size spec
with one keyed by layout indices: a group header's height, or the original data-space spec
called with `entry.dataIndex` (`groups/plugin.ts:820-835`). After groups, the cache index is a
layout index; the data-space spec is still called with a data index. Layout plugins that
replace the renderer (`table()`, `grid()`, `masonry()`) read the cache through this same cache
object.

**The only per-item size writer.** `autosize()` keeps measurements in a `Map` keyed by item id
(`src/plugins/autosize/plugin.ts:67`), read by its size function (`plugin.ts:95-97`) and
written by the ResizeObserver and by `setMeasuredSize` (`plugin.ts:502-507`). Nothing else in
the tree stores a per-item size after creation; every other path rebuilds the cache from the
configuration.

### 2.3 Plugin-context surface

A plugin can already do every mechanical step: `ctx.sizes.cache.invalidate` is part of the
cache interface (`sizes.ts:48`; autosize calls it at `plugin.ts:285-289`), and
`ctx.render.contentSize`, `ctx.render.force`, `ctx.scroll.shiftBy` and `ctx.hooks.method`
(`src/core/types.ts:196`) are all plugin-reachable. Autosize demonstrates the full path,
including the scroll correction. What does not exist is a core entry point: a consumer without
a plugin has no call that invalidates one item, updates the content size and applies the
scroll correction.

So the missing pieces are:

1. a public method to re-read or set one item's size;
2. the scroll correction outside `autosize()`;
3. for shapes that take an explicit size, a place to record it that survives a plugin's
   `setConfig` and a data change.

## 3. API shapes

All three shapes update one item and leave the rest of the list alone. Each is described by
the same five mechanics: index space, size-cache cost, autosize interplay, scroll correction,
and signature/error behaviour. The per-shape size estimates are in section 6.

### Shape A — core `setItemSize(index, size)`

```ts
setItemSize(index: number, size: number): boolean;
```

**Index space.** Data item index, matching `getItemAt` and `scrollToIndex`. Under `groups()`
the method translates once through `_dataToLayoutIndex` before touching the cache; a group
header has no data index and cannot be addressed. The alternative public key is the item id
(the `updateItem`/`removeItem` keying). Id keying moves the ambiguity to the cache read path:
`getSize` is called with a cache index, so an id-keyed store needs either a reverse lookup on
every read (too hot: `getIndexById` is a linear `findIndex` in the core,
`create.ts:1152-1155`) or a layout-index map re-keyed on every rebuild. Index keying pays the
ambiguity once, at the call.

**Size-cache mechanics.** This shape needs a persistent override store (keyed by item id, so
it follows an item across inserts and removals) and a size source that reads it. The source
must sit where the prefix sums read sizes, not only under `getSize`: offsets come from the
cache's internal size function, and patching the returned object's `getSize` alone would make
rendering and offsets disagree (`sizes.ts:147-232`; carousel's `sizeCache.getSize` patch at
`src/plugins/carousel/plugin.ts:344` returns step sizes while offsets come from the cache's
own sums). Because `sizes.setConfig` replaces the cache in place, the override has to be
installed through a core-side layer that every replacement cache inherits, or rewrapped on
every `setConfig`; the rewrap must also preserve the gap the current cache was built with,
which no getter exposes (section 2.2). A fixed cache has no per-index size
(`sizes.ts:62-97`), so the first override on a fixed-size list must convert it to a variable
cache (one O(n) rebuild) or the fixed cache grows an override branch. After the write, one
`invalidate(layoutIndex, layoutIndex)` re-reads a block and walks the block offsets
(`sizes.ts:225-231`).

**Interaction with `autosize()`.** Two writers of one size. Either the method delegates to
autosize's existing `setMeasuredSize` (`plugin.ts:502-507`) when that method is registered, so
there is one store, or the pair needs a declared conflict. Delegation keeps the API working
with autosize but blurs ownership: `isMeasured(index)` becomes true, and a later `load`/`error`
re-measurement can overwrite the explicit size. That precedence must be written down and
tested.

**Scroll correction.** Same rule `autosize()` uses: if the item's layout index is above the
first visible one (`indexAtOffset(getPixelEquivalent())`, `plugin.ts:328`), shift the scroll
by the size delta (`scroll.shiftBy`, `plugin.ts:399-402`). Update the content size and force a
render. A shrink above the viewport shifts by the negative delta, keeping the anchored content
still.

**Signature and errors.** Return `boolean`: `false` for an out-of-range index, which matches
the silent-ignore style of `updateItem` and `removeItem` but makes the no-op detectable. A
size must be a finite number `>= 0`; anything else is a caller error and should throw
`[vlist] setItemSize: size must be a finite number >= 0`. A size of 0 is allowed (a collapsed
row).

**Cost.** An override store, the cache layer and its `setConfig` plumbing, the method and the
correction. Estimated 200-320 gzipped bytes in the base (section 6).

### Shape B — core `remeasureItem(index)`

```ts
remeasureItem(index: number): boolean;
```

**Index space.** Data item index; the same one-time translation to a layout index under
`groups()`.

**Size-cache mechanics.** No store. Re-read the installed size source for one item:
`invalidate(layoutIndex, layoutIndex)` (`sizes.ts:225-231`). The function spec sees the
updated item data and returns the new size; the prefix sums refresh for that block and every
later offset moves. A fixed spec has nothing to re-read, so the method returns `false`; the
remedy is a function spec or `autosize()`, both documented. There is no gap problem (the spec
is not replaced), no fixed-to-variable conversion, and no spec getter to add.

**Interaction with `autosize()`.** With autosize installed, the cache's size source is
autosize's `sizeFn`, which returns the cached measurement (`plugin.ts:95-97`): invalidating
alone would re-read the same value. So when autosize's public `remeasure` method is registered
(`plugin.ts:500`), the method delegates to it (`plugin.ts:232-246`): a measured item is queued
for a fresh measurement and corrected by the real delta, and an unmeasured item is ignored by
the plugin. That keeps one writer: autosize when it is installed, the configuration's size
function otherwise. It is the same rule #349 established for size ownership.

**Scroll correction.** Read the old size and the first visible layout index before
invalidating; after it, compare the item's layout index with that first-visible index and, if
it is above the viewport, `scroll.shiftBy(newSize - oldSize)`. Update the content size and
force a render. This is autosize's observer path (`plugin.ts:328`, `plugin.ts:373-402`)
without the measurement.

**Signature and errors.** Return `boolean`: `false` for an out-of-range index or a fixed-size
spec — the two cases where no size source handled the call. No size value enters, so there is
nothing to validate. Under autosize the return says the call reached the plugin; whether the
item was measured is autosize's state (`isMeasured(index)`).

**Cost.** The method, the delta and correction, and the delegation check. Estimated 90-160
gzipped bytes in the base (section 6).

**The table case.** `rowHeight` already accepts a function (`src/plugins/table/types.ts:126`),
and the table reads the cache each time it renders a row (`src/plugins/table/renderer.ts:393-397`,
`renderer.ts:451-456`), so `rowHeight: (index) => heights[index] ?? 40` plus `updateItem` on
the row and `remeasureItem(index)` grows the row and moves every later row down. The scroll
correction keeps the viewport anchored if the row is above it. A table with a numeric
`rowHeight` cannot have per-row heights by definition; moving to a function is one
configuration line and is the documented migration.

### Shape C — an opt-in plugin, `itemSize()`

A plugin that registers `setItemSize`/`clearItemSize`, holds the override store, and wraps the
cache spec through `ctx.sizes.setConfig`. It would be imported only by lists that need it, so
it costs the base bundle nothing and gets its own budget row.

**Index space.** The plugin registers a data-index method and translates through
`_dataToLayoutIndex` at call time, like A.

**Size-cache mechanics.** The same override layer as A, with the same gap problem, plus
ordering: the plugin must run after `autosize()` (priority 5) and before the layout plugins
(10/11) so that a layout plugin's captured `sizeCache.getSize` includes the overrides
(`groups/plugin.ts:820`). That ordering is a contract future plugins can break.

**Interaction with `autosize()`.** Declare a conflict, mirroring #349, or delegate as in A.
A conflict is simpler and keeps one writer, but it means a list cannot have both measured
items and explicit overrides.

**Scroll correction.** The same rule, through `ctx.scroll.shiftBy`.

**Signature and errors.** Same as A.

**Cost.** Zero base bytes; an estimated 150-250 bytes on its own scenario row, plus a new
`scripts/size.ts` scenario, a README size row and a budget. The cost is discovery and
composition: every consumer who hits this issue must find the plugin, import it and pass it to
`createVList`, and a table needs `table()` and this plugin together.

## 4. Recommendation

**Shape B, `remeasureItem(index): boolean`, in the core.**

1. It fixes the defect the issue states — a function-based size goes stale after
   `updateItem` — using the mechanism the issue names: invalidate one cache entry, update the
   content size, render, and apply autosize's scroll correction. It does not invent a second
   size source.
2. It preserves the one-writer rule #349 established. With autosize, the plugin stays the
   owner and receives the call; without it, the configuration's size function is re-read.
   There is no precedence table to maintain and no second store to keep in sync when the data
   changes.
3. It is the smallest shape: no override storage, no spec rewrapping, no gap to preserve, no
   fixed-to-variable conversion, and no extra layout-index bookkeeping. It is the only shape
   that fits inside the issue's 150-250 byte estimate with room to spare.
4. It covers the motivating table case with the table's existing function `rowHeight`
   (`table/types.ts:126`) and its per-render cache reads (`table/renderer.ts:393-397`).
5. Shape A's real advantage is passing a measured pixel height the spec cannot compute. That
   is a second feature (an override store) with a second writer to reconcile, and it should be
   proposed on its own if users need sizes that item data cannot express. Shape C moves the
   cost off the base bundle but asks every user to discover a plugin for a core operation and
   inherits A's storage traps.

Two points this shape leaves to review:

- The return contract: I recommend `false` for an out-of-range index and for a fixed-size
  spec, matching the silent-ignore style of the existing mutation methods while making it
  detectable. The alternative — throw on an out-of-range index — would be the first runtime
  method to do so.
- The autosize delegation: I recommend testing for the registered `remeasure` method at call
  time (the plugin method registry is the same presence test the core already uses for
  `_dataToLayoutIndex` and friends), so the method composes with autosize without a static
  dependency on the plugin.

## 5. Migration and version

- **Additive.** One method on `VList` (`src/core/types.ts:321`). No existing signature or
  behaviour changes. This is 3.2.0 material, a minor release.
- **No plugin changes.** `table()`, `masonry()` and `carousel()` keep their #349 declarations.
  The method gives `table()` the per-row update path that `autosize()` used to pretend to
  offer.
- **Documented limits.** A fixed-size spec has no per-item size to re-read; the method returns
  `false`, and the docs name the function-spec alternative. Layout plugins that snapshot sizes
  at setup rather than reading the cache per render are out of scope for 3.2.0: carousel
  builds its step sizes once (`src/plugins/carousel/plugin.ts:201`, `plugin.ts:258`,
  `plugin.ts:344`) and would need its own refresh. Core lists, `groups()` and `table()` are
  covered.
- **Size budget.** The base measured 10,539 bytes gzipped against a 10,547-byte budget when
  this was written (README size table). The first byte of a core method exceeds 8 bytes of
  room, so the implementing change moves the base pin by the repository's own rule (measured
  overrun moves the pin to measured + 1%, a recorded decision in that pull request). This
  proposal moves nothing.
- **Docs.** The `VList` API reference and the README item-update text gain the method; the
  CHANGELOG entry rides the release that ships it, not this proposal.

## 6. Size cost estimate

All numbers are gzipped bytes in the **base** (`createVList`) bundle unless stated. They are
estimates for a proposal, not measurements; the implementing pull request measures with
`bun run size` before moving any pin.

| Shape | Estimate (base) | What the bytes buy | Against the issue's 150-250 guess |
| --- | --- | --- | --- |
| A — `setItemSize(index, size)` | 200-320 | Override store, cache layer and `setConfig` plumbing, method, scroll correction | Above it |
| B — `remeasureItem(index)` | 90-160 | Method, delta and correction, delegation check | Inside it, low end |
| C — `itemSize()` plugin | 0 base; 150-250 on its own row | A's machinery, opt-in; new scenario and README row | Inside it, but on a new budget |

Two measured anchors from the repository: `scroll.mode` cost the core 301 bytes
(`scripts/size.ts:159-163`), and pruning autosize's measured cache cost 242 bytes
(`scripts/size.ts:191-193`). A method carrying the invalidation, delta, content-size and
force-render path is the same order as the smaller of those. The issue's estimate is plausible
for Shape B's method body; it undercounts Shape A once the override layer is included.

The base has 8 bytes of room today (10,539 measured against 10,547, README size table), so
every shape needs a base-budget decision: measured + 1% by the repository's rule, recorded in
the implementing pull request. For Shape B that is roughly one 0.1 kB step; for Shape A,
roughly two.

## Out of scope

- Header sizes under `groups()`: headers are not data items and have no data index. A header
  size update needs its own API and keying.
- A refresh hook for layout plugins that snapshot sizes or placements at setup (carousel,
  and masonry's cached placements).
- An override API for sizes item data cannot express (Shape A as a future proposal, if the
  need is demonstrated).
