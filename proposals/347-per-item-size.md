# Per-item size updates after creation (#347)

Status: proposal, revision 2 — the round-1 review sets are folded in (the review threads are
on the draft pull request). Not implemented. Target release: 3.2.0 (a minor release: one
additive core method and three internal plugin hooks). Reviewed against `next` at the merge
of #349 (`755b2a9`), the state this proposal is written on; this revision changes no code.

## 1. Problem

A list builds its size cache once from the item configuration. After creation there is no
core way to change one item's size without rebuilding every size:

- `updateItem(id, updates)` merges the new data and re-renders, but never touches the size
  cache (`src/core/create.ts:1069-1078`). A function-based size — a row whose height depends
  on the item's data — keeps the value it returned the last time every size was rebuilt.
- `setItems(items)` replaces the data and rebuilds every size (`src/core/create.ts:1016-1022`).
- `list.remeasure(index)` exists only with `autosize()` (`src/plugins/autosize/plugin.ts:232-246`),
  and `table()`, `masonry()`, `carousel()` and `grid()` now refuse to be combined with that
  plugin: a measured size and a fixed item size are two writers of one size, and #349 made
  the pair a configuration error rather than a silent no-op
  (`src/plugins/table/plugin.ts:253-257`, `src/plugins/grid/plugin.ts:345`).

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

The index space of the public item APIs is the **data item index**. The core documents that
space where it resolves a click: the reported index is "the data index — the space `getItemAt`,
`scrollToIndex` and `removeItem` take" (`src/core/create.ts:901-903`), and `getItemAt` resolves
it through groups' translation rather than the layout-space accessor (`create.ts:1144-1148`).
The new method takes that same space. It is not, however, the size cache's index space — see
the end of 2.2.

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
  (`sizes.ts:198`); `getOffset` is O(1) (`sizes.ts:190-194`); `invalidate(start, end)` re-reads
  the blocks the range touches and then re-runs the block offsets after them — at most 512
  size-function reads plus one addition per later block (`sizes.ts:159-171`,
  `sizes.ts:225-231`).

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
(`create.ts:543-545`); the size passed is the cache total, and `updateContentSize` adds the
main-axis padding itself (`create.ts:664-685`, used this way at
`src/plugins/autosize/plugin.ts:272-274`). `scroll.shiftBy(delta)` shifts the committed
position (`create.ts:466-469`), and `scroll.getPixelEquivalent()` is the committed position
(`src/core/adapter.ts:183-185`, wired to `state.scrollPosition` at `create.ts:428`).

**Index spaces under layout plugins.** The data item index, the layout index and the size
cache index coincide only when no layout plugin is installed:

- `groups()` counts group headers. It registers `_dataToLayoutIndex` and
  `_layoutToDataIndex` (`src/plugins/groups/plugin.ts:1013-1017`) and replaces the size spec
  with one keyed by layout indices: a group header's height, or the original data-space spec
  called with `entry.dataIndex` (`groups/plugin.ts:820-835`). After groups, the cache index is
  a layout index, and the translation above is the exact way into it.
- `grid()` keys the cache by **row**, not by item: "Size cache in ROW space: each row =
  itemHeight + gap" (`src/plugins/grid/plugin.ts:380`), with a row-indexed spec
  (`plugin.ts:393-411`) and no `_dataToLayoutIndex` registration. Its own public
  `scrollToIndex` translates item → row itself (`plugin.ts:514`, `plugin.ts:547`).
- `carousel()` patches the cache into virtual step space — `getTotalSize`, `getOffset` and
  `getSize` together (`src/plugins/carousel/plugin.ts:342-347`) — and folds a virtual index in
  its item accessor (`plugin.ts:336-340`, `plugin.ts:377`).
- `masonry()` reads the cache in item space (`src/plugins/masonry/plugin.ts:320-327`), but its
  placements are a snapshot (`cachedPlacements`, `plugin.ts:344`) that an invalidation does not
  refresh.

A method that invalidates one cache entry therefore has to say which space it translates into,
and has to refuse the spaces it cannot address — invalidating "row 17" for item 17 (or a
virtual step for a data item) is the one outcome the contract must exclude.

**The size writers.** `autosize()` keeps measurements in a `Map` keyed by item id
(`src/plugins/autosize/plugin.ts:67`), read by its size function (`plugin.ts:93-97`) and
written by the ResizeObserver and by `setMeasuredSize` (`plugin.ts:502-507`). The one other
per-item size store after creation is carousel's step cache (`buildStepCache`,
`src/plugins/carousel/plugin.ts:257`, rebuilt in `onResize` at `plugin.ts:903-920` and returned
by its patched `getSize` at `plugin.ts:344-347`). Every other path rebuilds the cache from the
configuration.

### 2.3 Plugin-context surface

A plugin can already do every mechanical step: `ctx.sizes.cache.invalidate` is part of the
cache interface (`sizes.ts:48`; autosize calls it at `plugin.ts:285-289`), and
`ctx.render.contentSize`, `ctx.render.force`, `ctx.scroll.shiftBy` and `ctx.hooks.method`
(`src/core/types.ts:196`) are all plugin-reachable. Cross-plugin facts and translations are
reached per call through `ctx.hooks.get` rather than captured at setup, because a later plugin
may not have registered them yet (autosize does exactly this for the index translators,
`src/plugins/autosize/plugin.ts:80-84`). Autosize demonstrates the full path, including the
scroll correction. What does not exist is a core entry point: a consumer without a plugin has
no call that invalidates one item, updates the content size and applies the scroll correction.

So the missing pieces are:

1. a public method to re-read or set one item's size;
2. the scroll correction outside `autosize()`;
3. for shapes that take an explicit size, a place to record it that survives a plugin's
   `setConfig` and a data change;
4. for a re-read shape, a way for a layout plugin to say whether a data item index can address
   its size model at all, and where a re-read left derived state stale.

## 3. API shapes

All three shapes update one item and leave the rest of the list alone. Each is described by
the same mechanics: index space and bounds, which size source owns the item, size-cache cost,
scroll correction, derived plugin state, and signature/error behaviour. The per-shape size
estimates are in section 6.

### Shape A — core `setItemSize(index, size)`

```ts
setItemSize(index: number, size: number): boolean;
```

**Index space.** Data item index, matching `getItemAt` and `scrollToIndex`. Under `groups()`
the method translates once through `_dataToLayoutIndex` before touching the cache; a group
header has no data index and cannot be addressed. The alternative public key is the item id
(the `updateItem`/`removeItem` keying). An id-keyed store is not expensive per read:
`autosize()` shows the shape — the store is keyed by item id, and its size function resolves
the id from the cache index with `items.at(index).id` (`plugin.ts:93-97`), no reverse index
involved. The real trade-off is the public key (`getIndexById` is a linear scan in the core
when no data plugin is installed, `create.ts:1152-1155`, so an id-first caller pays one scan)
and whether an override follows the item across inserts and removals. Index keying pays the
ambiguity once, at the call; id keying matches `updateItem`/`removeItem` but leaves an entry to
prune when an item leaves (autosize prunes its own, `plugin.ts:120-158`).

**Size-cache mechanics.** This shape needs a persistent override store and a size source that
reads it. The source must sit where the prefix sums read sizes, not only under `getSize`:
offsets come from the cache's internal size function, and patching the returned object's
`getSize` alone would make rendering and offsets disagree (`sizes.ts:147-232`; carousel has to
patch `getSize` and `getOffset` together, `src/plugins/carousel/plugin.ts:342-347`). Because
`sizes.setConfig` replaces the cache in place, the override has to be installed through a
core-side layer that every replacement cache inherits, or rewrapped on every `setConfig`; the
rewrap must also preserve the gap the current cache was built with, which no getter exposes
(section 2.2). A fixed cache has no per-index size (`sizes.ts:62-97`), so the first override
on a fixed-size list must convert it to a variable cache (one O(n) rebuild) or the fixed cache
grows an override branch. After the write, one `invalidate(layoutIndex, layoutIndex)` re-reads
a block and walks the block offsets (`sizes.ts:225-231`).

**Unit of size.** The cache's slot is gap-inclusive — the core bakes the gap into every spec
(`create.ts:252-257`, `create.ts:295`), and `autosize()`'s store holds the slot: its gap test
records `setMeasuredSize(3, 80 + 8)` for a content height of 80 with gap 8
(`test/plugins/autosize/gap.test.ts:149-150`). A caller measures content, so `setItemSize`
should take a **content height** and add `ctx.config.gap` itself before the value reaches any
slot-based store; when it delegates to `setMeasuredSize` (`plugin.ts:502-507`) the added gap is
what keeps the total right. The alternative — take a slot size and document it — matches
`setMeasuredSize` but asks every caller to know the gap. Shape B sidesteps the question
entirely: no size value enters.

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

**The contract.** Ask whichever per-item size source owns the list to re-read item `index`,
then make the list observe the result: content size, scroll anchor, and any plugin state
derived from offsets.

- `false` when nothing was asked: an index that is not an integer or not in `[0, total)`, a
  layout plugin whose size model cannot address a single data item (grid, masonry, carousel),
  or a fixed item spec with no per-item size to re-read.
- `true` when a size source was asked for an in-range data item. `true` does **not** mean the
  size changed: under `autosize()` an unmeasured item is ignored by the plugin
  (`plugin.ts:240-243`), and `isMeasured(index)` reports the measurement state (deliberately
  `false` while a re-measure is queued, `plugin.ts:99-107`). Without autosize the installed
  spec is re-read; if the value is unchanged the method returns without touching content size,
  scroll or render.
- Never throws for an index.

**Bounds first.** Validate in the data space before any translation, against the public total
(`virtualTotalFn ? virtualTotalFn() : items.length`, as `api.total` does at
`src/core/create.ts:1014`) — under `groups()` the engine's total counts headers, and under an
adapter the raw array is empty. Reject `NaN` and non-integers explicitly: `invalidate`'s own
guard skips `NaN` (`sizes.ts:225-227`), but the size read around it does not.
`groups()`' translation does not reject out-of-range input — `findGroupByDataIndex` clamps to
the first or last group (`src/plugins/groups/layout.ts:66-80`, `layout.ts:315-324`) — so the
check must precede the translation.

**Which size source owns the item.** Under `groups()` the cache is always variable, because
the grouped size function wraps headers and data (`groups/plugin.ts:820-835`); testing
`sizeCache.isVariable()` alone would report `true` for a grouped list with `height: 80` and
nothing to change. `rawSpec` has the opposite error: it stays the configuration-time spec
(`types.ts:172-180`), so a table with a function `rowHeight` over a numeric `item.height` would
read as fixed. The fact needed is "the item spec installed before the wrapper layers is a
function". It belongs to the layer that installs the spec:

- `groups()` captures `sizeCache.isVariable()` at setup, immediately before it calls
  `ctx.sizes.setConfig(groupedSizeFn, …)` (the same point where it already captures
  `origGetSize`, `groups/plugin.ts:820-821`), and publishes it as an internal predicate
  `_dataSizeIsVariable(): boolean`.
- The core's default when no predicate is registered is `sizeCache.isVariable()`, which is
  correct for a core list, `table()` (numeric `rowHeight` installs a fixed cache, a function
  installs a variable one, `src/plugins/table/plugin.ts:310-311`), `tree()` (identity index
  space) and autosize's own spec.
- `autosize()` is checked before this predicate: with autosize installed the source is its
  measurement store, which is a function spec by construction, and the delegate path below
  decides.

**Unsupported size models return `false`.** Three current plugins cannot address one data
item in their size model, and must say so rather than let the core invalidate the wrong entry:

- `grid()`: the cache is row space; a row's height comes from its first item
  (`grid/plugin.ts:380-411`). Refreshing "row 17" for item 17 would refresh items 51-53 of a
  three-column list. Per-item size is not representable.
- `masonry()`: the cache is item space, but placements are a snapshot (`plugin.ts:344`);
  invalidating a size leaves the placement stale.
- `carousel()`: the cache is virtual step space (`plugin.ts:342-347`).

Each publishes `_itemRemeasureSupported(): boolean` returning `false` (one line; the name is
an internal protocol name like `_setSizeCacheBase`). The core's default is `true`. The
predicate is checked before the autosize delegate and before the variable predicate, so
`groups()` wrapping any of these three cannot hide it — a separate method name survives the
wrapper.

**Size-cache mechanics.** No store. With the source identified, translate the data index to a
cache index: `_dataToLayoutIndex` when registered (`groups/plugin.ts:1013-1017`; `tree()`
registers the identity, `src/plugins/tree/plugin.ts:796-797`), otherwise the data index. Read
the current slot size from the cache's own offsets (two O(1) `getOffset` reads), read the fresh
value with `getSize(cacheIndex)` (one spec call), and if they are equal return `true` without
invalidating — a no-op call is O(1), where an unconditional invalidation would re-read the
block and walk the later block offsets. Otherwise `invalidate(cacheIndex, cacheIndex)`
(`sizes.ts:225-231`): the function spec sees the updated item data and returns the new size,
and the prefix sums refresh for that block and every later offset. There is no gap problem
(the spec is not replaced), no fixed-to-variable conversion, and no spec getter to add — the
revision adds only the predicates above.

**Autosize delegation.** With autosize installed the cache's size source is its `sizeFn`,
which returns the cached measurement (`plugin.ts:93-97`): invalidating alone would re-read the
same value. So when autosize's public `remeasure` method is registered (`plugin.ts:500`), the
core calls it with the **data index** (its `getItemId` resolves `items.at(index).id`,
`plugin.ts:93`) after the bounds check, and returns `true`. Autosize queues a measured item and
ignores an unmeasured one (`plugin.ts:232-246`); the return says the owner was asked, and
`isMeasured` says whether a measurement exists. The core passes the data index, not the layout
index, because `remeasure` addresses items by data index; the translation to layout indices is
autosize's own (`plugin.ts:80-84`). This keeps one writer: autosize when it is installed, the
configuration's size function otherwise — the same rule #349 established.

**Scroll correction, content size, render.** Read the old size and the first visible cache
index before invalidating. After it, if the item's cache index is above
`indexAtOffset(getPixelEquivalent())` (`plugin.ts:328`), `scroll.shiftBy(newSize - oldSize)`;
then `render.contentSize(cache.getTotalSize())` and `render.force()`. This is autosize's
observer path (`plugin.ts:373-402`) without the measurement. A shrink above the viewport
shifts by the negative delta, keeping the anchored content still.

**Derived plugin state.** `invalidate` moves every later offset, but some plugins cache those
offsets. `groups()`' sticky header snapshots every group header's pixel offset in
`cacheGroups()` (`src/plugins/groups/sticky.ts:101-113`) and refreshes it only when something
calls `stickyHeader.refresh()` — neither `sizeCache.invalidate` nor a force-render does. With
a stale table, header push/swap transitions fire at the wrong scroll positions. So the core
calls an internal `_onItemRemeasure(cacheIndex)` hook after the invalidation (before the
render force); `groups()` registers it and runs the pattern it already uses after a rebuild:

```ts
stickyHeader.refresh();
stickyHeader.update(scroll.getPixelEquivalent());
```

(`groups/plugin.ts:704-708`). The cost is O(#groups) — one `getOffset` per header, each O(1)
— paid only on an explicit per-item call. Groups' own grid/masonry placements are not
refreshed here: those combinations return `false` at the predicate above, so the core never
invalidates under them; if their support is added later, `rebuildGridPositions()` goes in this
same handler.

**Why not invalidate inside `updateItem`.** Considered as the zero-API alternative, and
preferred against for three reasons:

1. The motivating edit is in place. The row's data lives in a side map while an input is
   focused; `updateItem` replaces the item object and force-renders (`create.ts:1069-1078`),
   and the render re-runs the item template whenever the item object changed — it sets
   `innerHTML` to the template's result (`src/core/pipeline.ts:343-357`), so an input the
   template rendered is rebuilt and the live control is lost. The editor needs the size
   re-read without a data write.
2. Every update would pay the block re-read plus the tail walk (`sizes.ts:159-171`,
   `sizes.ts:225-231`) even when the size did not change; an `{ remeasure: true }` option would
   still do so on every opted-in update. The explicit method has the O(1) unchanged guard and
   is opt-in.
3. `updateItem` is implemented by data plugins too (`updateItemByIdFn`, `create.ts:1070-1072`);
   changing its contract changes what every adapter must do, for a size policy the adapter does
   not own.

**Signature, house style, naming.** Returning `boolean` from a mutation is a new style, not a
matching one: the public mutations return `void` when they can no-op and `removeItems` returns
a count (`create.ts:1110-1131`); reads use sentinels. It is additive and defensible — the
return makes the silent no-op detectable — but the text should say "new", not "matching".
`remeasureItem` is deliberately not named `remeasure`: autosize registers a public `remeasure`
through `hooks.method` (`plugin.ts:500`), and plugin methods are assigned onto the instance
after the core's API is built (`create.ts:1263-1269`), while the duplicate check only sees
names already in the plugin methods map (`create.ts:574-578`). A core `remeasure` would be
silently overwritten by `autosize()`, not rejected. The two methods also mean different things
and each deserves one sentence in the docs:

- autosize's `remeasure(index?)`: plugin-owned; without an index it drops every measurement
  and falls back to estimates; with an index it queues a fresh measurement of a **measured**
  item; returns `void`; unknown or unmeasured indices are ignored.
- core's `remeasureItem(index)`: asks whatever per-item size source owns the list to re-read
  that item; returns whether a source was asked.

**The table case.** `rowHeight` already accepts a function (`src/plugins/table/types.ts:126`),
and the table reads the cache each time it renders a row — on creation
(`src/plugins/table/renderer.ts:451-456`) and on every update of an already-mounted row, in
place (`renderer.ts:644-651`, height then transform), as the core pipeline does for plain
lists (`src/core/pipeline.ts:392-402`). So `rowHeight: (index) => heights[index] ?? 40` plus
`remeasureItem(index)` grows the row and moves every later row down without recreating the row
DOM or losing `<textarea>` focus. The scroll correction keeps the viewport anchored if the row
is above it. A table with a numeric `rowHeight` cannot have per-row heights by definition;
moving to a function is one configuration line and is the documented migration.

**Cost.** The method, the bounds and unchanged-size guard, the delegation check, the three
hook lookups and the delta and correction. Estimated 110-170 gzipped bytes in the base
(section 6); the hook registrations land on the `groups`, `grid`, `masonry` and `carousel`
rows, not the base.

### Shape C — an opt-in plugin, `itemSize()`

A plugin that registers `setItemSize`/`clearItemSize`, holds the override store, and wraps the
cache spec through `ctx.sizes.setConfig`. It would be imported only by lists that need it, so
it costs the base bundle nothing and gets its own budget row.

**Index space.** The plugin registers a data-index method and translates through
`_dataToLayoutIndex` at call time — read with `ctx.hooks.get`, not captured at setup, because
`groups()` (priority 11) sets up after a plugin at 5-7; autosize resolves the same hooks per
call (`src/plugins/autosize/plugin.ts:80-84`).

**Size-cache mechanics.** The same override layer as A, with the same gap and unit-of-size
questions, plus composition. Ordering alone does not compose: `table()` calls
`ctx.sizes.setConfig(rowHeight)` in its own setup (`src/plugins/table/plugin.ts:310-311`),
replacing whatever a priority-7 plugin installed, and `grid()` reads `ctx.sizes.rawSpec`
(`src/plugins/grid/plugin.ts:382`), the configuration-time spec, so a plugin-installed layer is
invisible to it. To compose with `table()` the plugin must patch `sizes.setConfig` the way
autosize does (`plugin.ts:202-218`) and re-apply its layer after every replacement; `grid()`'s
`rawSpec` read cannot be reached that way at all. `groups()` is the one layout plugin that
captures the installed `getSize` (`groups/plugin.ts:820`) and therefore composes by priority
alone.

**Interaction with `autosize()`.** Declare a conflict, mirroring #349, or delegate as in A.
A conflict is simpler and keeps one writer, but it means a list cannot have both measured
items and explicit overrides.

**Scroll correction.** The same rule, through `ctx.scroll.shiftBy`.

**Signature and errors.** Same as A, including the content-height unit.

**Cost.** Zero base bytes; an estimated 150-250 bytes on its own scenario row, plus a new
`scripts/size.ts` scenario, a README size row and a budget. That plugin row is its own budget
decision and is not comparable to the issue's 150-250 **base-bytes** guess. The other cost is
discovery and composition: every consumer who hits this issue must find the plugin, import it
and pass it to `createVList`, a table needs `table()` and this plugin together, and the
`table()` combination needs the `setConfig` patch above.

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
3. It is the smallest shape in base bytes and stays inside the issue's 150-250 byte ceiling at
   the low end (110-170, section 6). No override storage, no spec rewrapping, no gap to
   preserve, no fixed-to-variable conversion, and no extra layout-index bookkeeping. The
   price is three internal hooks, all underscore-only protocol names and untyped in
   `PluginContext`, registered by groups (two) and by grid, masonry and carousel (one).
4. It covers the motivating table case with the table's existing function `rowHeight`
   (`table/types.ts:126`) and its per-render cache reads (`table/renderer.ts:451-456`,
   `renderer.ts:644-651`).
5. Shape A's real advantage is passing a measured pixel height the spec cannot compute. That
   is a second feature (an override store) with a second writer to reconcile, and it should be
   proposed on its own if users need sizes that item data cannot express. Shape C moves the
   cost off the base bundle but asks every user to discover a plugin for a core operation,
   inherits A's storage and unit traps, and cannot compose with `grid()` at all and with
   `table()` only through a `setConfig` patch.

What this revision settles, for the round-2 review:

- **Grid is out of scope, with a defined return.** `grid()` publishes
  `_itemRemeasureSupported` as `false`; `remeasureItem` returns `false` there and never
  invalidates a row by item number. A row's height comes from the row's first item, so a
  per-item refresh is not expressible; a future grid API would translate item → row
  (`layout.getRow`, `grid/plugin.ts:547`) and refresh the row.
- **Masonry and carousel are out of scope the same way** (snapshot placements, virtual step
  space), with the same predicate.
- **Fixed-spec detection happens below `groups()`**, through `_dataSizeIsVariable`, captured
  before the grouped wrapper is installed.
- **Bounds are checked first, in the data space, against the public total**, so the answer does
  not depend on which plugins are installed.
- **Groups' derived offsets are refreshed** through `_onItemRemeasure`.
- **The boolean means "a size source was asked"**, and the unmeasured-autosize case is written
  down as such.

## 5. Migration and version

- **Additive.** One method on `VList` (`src/core/types.ts:321`) and three internal protocol
  names reached through `ctx.hooks.get`. No existing signature or behaviour changes. This is
  3.2.0 material, a minor release.
- **Coverage.** Core lists, `tree()`, `groups()` and `table()` (numeric or function
  `rowHeight`); with `autosize()` the method delegates to its owner. `grid()`, `masonry()` and
  `carousel()` return `false` — the documented return for a size model that cannot address a
  single item. Their combinations under `groups()` are excluded by the same predicates.
- **No plugin conflicts.** `table()`, `masonry()`, `carousel()` and `grid()` keep their #349
  declarations. The method gives `table()` the per-row update path that `autosize()` used to
  pretend to offer.
- **Documented limits.** A fixed-size spec has no per-item size to re-read; the method returns
  `false`, and the docs name the function-spec alternative. A layout plugin that snapshots
  sizes or placements at setup needs the hook described in section 3.2; the three current ones
  opt out for 3.2.0.
- **Size budget.** The base measured 10,539 bytes gzipped against a 10,547-byte budget when
  this was written (README size table). The first byte of a core method exceeds 8 bytes of
  room, so the implementing change moves the base pin by the repository's own rule (measured
  overrun moves the pin to measured + 1%, a recorded decision in that pull request). This
  proposal moves nothing.
- **Docs.** The `VList` API reference and the README item-update text gain the method and the
  two `remeasure`-family sentences from section 3.2; the CHANGELOG entry rides the release
  that ships it, not this proposal.

## 6. Size cost estimate

All numbers are gzipped bytes in the **base** (`createVList`) bundle unless stated. They are
estimates for a proposal, not measurements; the implementing pull request measures with
`bun run size` before moving any pin.

| Shape | Estimate (base) | What the bytes buy | Against the issue's 150-250 guess |
| --- | --- | --- | --- |
| A — `setItemSize(index, size)` | 200-320 | Override store, cache layer and `setConfig` plumbing, unit handling, method, scroll correction | Above it |
| B — `remeasureItem(index)` | 110-170 | Method, bounds and unchanged-size guard, delegation check, three hook lookups, delta and correction | Inside the ceiling, at the low end |
| C — `itemSize()` plugin | 0 base; 150-250 on its own row | A's machinery, opt-in; new scenario and README row | Not comparable — a plugin row, not base bytes |

Two measured anchors from the repository: `scroll.mode` cost the core 301 bytes
(`scripts/size.ts:159-163`), and pruning autosize's measured cache cost 242 bytes
(`scripts/size.ts:191-193`). Shape B's previous band (90-160) was anchored below both; the
revision adds two hook lookups and the unchanged-size guard, so it moves to 110-170 — still
the same order as the smaller anchor. The issue's estimate is plausible for Shape B; it
undercounts Shape A once the override layer is included.

Shape B's plugin-side additions do not touch the base: groups (the `_dataSizeIsVariable`
capture and predicate, plus the `_onItemRemeasure` handler and its sticky refresh) and one
predicate line each in grid, masonry and carousel. Those land on the `groups`, `grid`,
`masonry` and `carousel` rows of the size table; `index.js` had ~627 bytes of headroom
(23,173 against 23,800) when this was written.

The base has 8 bytes of room today (10,539 measured against 10,547, README size table), so
every shape needs a base-budget decision: measured + 1% by the repository's rule, recorded in
the implementing pull request. For Shape B that is roughly one 0.1 kB step; for Shape A,
roughly two.

## 7. Round-1 review resolutions

Each finding from the two round-1 sets, and where this revision answers it.

| Finding | Resolution |
| --- | --- |
| Grid keys the cache by row; an item index would invalidate the wrong row (both reviewers, medium) | Section 2.2 names all three index spaces; section 3.2 excludes grid with `_itemRemeasureSupported` and a defined `false`, and qualifies the "data index" sentence to the public APIs |
| `sizeCache.isVariable()` is always true under `groups()`; `rawSpec` is stale under `table()` (both, medium) | `_dataSizeIsVariable`, captured by groups before its wrapper (`groups/plugin.ts:820-821`), with `sizeCache.isVariable()` as the core default; section 3.2 "Which size source owns the item" |
| Bounds must precede the groups translation; reject `NaN` and non-integers; use the public total (return contract, medium) | Section 3.2 "Bounds first", against `api.total` (`create.ts:1014`); `create.ts:1146`'s translation path cited with `layout.ts:66-80` |
| Groups' sticky header offsets go stale after `invalidate` (group index space, medium) | `_onItemRemeasure`; groups runs the `refresh()` + `update()` pattern it already uses (`groups/plugin.ts:704-708`); cost stated |
| Return contract: out-of-range flipped under autosize; "queued" vs "asked"; unmeasured item (return contract, medium/low) | Section 3.2 "The contract": bounds first, then the meaning of `true` (a source was asked; `isMeasured` is the state), with `plugin.ts:240-243` and `plugin.ts:99-107` |
| Boolean is new house style; `remeasure` vs `remeasureItem` (low) | Section 3.2 "Signature, house style, naming", including the plugin-method overwrite at `create.ts:1263-1269` |
| Shape C does not compose with `table()`/`grid()` (shape comparison, medium) | Section 3.1 C: `setConfig` replacement (`table/plugin.ts:310-311`), `rawSpec` read (`grid/plugin.ts:382`), the `setConfig` patch autosize uses, and the budget wording |
| Shape A's id-keying rejection is a straw man (low) | Section 3.1 A: autosize's O(1) id→item resolution (`plugin.ts:93-97`); the real trade-off is stated |
| Shape A does not define its size unit (low) | Section 3.1 A "Unit of size": content height in, gap added before any slot store; `gap.test.ts:149-150` |
| `updateItem` should invalidate (low) | Section 3.2 "Why not invalidate inside `updateItem`" |
| Size wording: "room to spare", Shape C row (low) | Section 4 point 3 and the section 6 table |
| `#349` list omits `grid()` (low) | Section 1 adds it (`grid/plugin.ts:345`) |
| "Nothing else stores a per-item size" overlooks carousel (low) | Section 2.2 "The size writers" excepts carousel's step cache |
| Citations a few lines wide; carousel patches `getOffset` too (low) | `create.ts:664-685`, `create.ts:466-469`; the carousel example now says `getSize` and `getOffset` together; the table case cites the mounted-row path (`renderer.ts:644-651`) |

## Out of scope

- Header sizes under `groups()`: headers are not data items and have no data index. A header
  size update needs its own API and keying.
- `grid()`: its cache is row space and a row's height comes from its first item; the method
  returns `false` (section 3.2).
- `masonry()` (snapshot placements) and `carousel()` (virtual step space): the method returns
  `false`; a future refresh would use `_onItemRemeasure`.
- An override API for sizes item data cannot express (Shape A as a future proposal, if the
  need is demonstrated).
