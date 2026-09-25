# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This changelog starts at v1.5.4, the first version published under the `vlist` package name
(April 2026). Earlier versions were published as `@floor/vlist` — see the
[git history](https://github.com/floor/vlist/commits/main) for the full record.

## [Unreleased]

## [3.0.0-next.6] - 2026-09-25

### Fixed

- `sortable()`: Space grabs the row you clicked. With selection's default
  `focusOnClick: false` a click remembers the row but hides the focus ring,
  and the grab only asked for the ring's row, so Space did nothing until an
  arrow had shown the ring — the "press Space twice" of #115. Space now
  takes the focused row whether or not its ring shows, and shows the ring
  with the grab.

- `sortable()`: after a drop, the row at the slot the drag started from no
  longer blanks for a few frames and fades back. The drop suppresses
  transitions with a `vlist--settling` class and removed it on the next
  frame callback — which runs before that frame's style calculation, so the
  class was never computed and the base 150 ms opacity transition animated
  the former drag source from 0. A regression of the April fix for the same
  blink; the drop now forces the calculation while the class is on.

## [3.0.0-next.5] - 2026-09-25

### Fixed

- `sortable()`: the drag ghost lands under the finger on a pinch-zoomed page.
  Measured on an iPhone: zoomed 2.21× and panned by (86, 215), the ghost's
  rect sat exactly (86, 215) from where its inline position said, because
  the ghost was `position: fixed` at the pointer's client coordinates and on
  WebKit fixed positioning and the client space disagree by the visual
  viewport's offset. The ghost is absolute now and placed by feedback — its
  own rect read and corrected against the pointer — so nothing is assumed
  about the containing block, the scroll or the zoom. Unzoomed, nothing
  changes; `sortable` is 41 bytes larger gzipped.

## [3.0.0-next.4] - 2026-09-25

### Changed

- The carousel's index space is three laps instead of 101: the home lap and
  one lap of margin on each side, which is what overscan, a leading peek
  and the shortest-path snap reach into. The large window existed for one
  reason — a fold used to re-create the whole viewport, so it had to be
  rare. A fold now keeps the mounted elements (below), so the position
  folds back into the home lap as soon as it leaves it, in either
  direction. Nothing public changes: `list.total`, ARIA, selection and
  events stay in data space. The fold is symmetric: leaving the home lap
  backwards folds at once, exactly as leaving it forwards does, so the
  carousel never rests in the lap before home, where a leading peek would
  need an index below zero. A smooth scroll in flight folds with the
  position, native and synthetic alike, so a snap that crosses the lap
  does not jump by a lap.

- `GroupsConfig` is generic in the item. `getGroupForIndex` is
  `(index: number, item?: T) => string` — the same `T` as the list — not
  `item?: any`. A callback written for a different item type is a type error
  at `groups()`, `createGroupLayout`, and `createVListFromConfig`. Callers
  that relied on `any` (reading undeclared fields, or passing a callback
  typed for another shape) need to name the item or use `groups<Row>(…)`.

- `createVListFromConfig` types an inline `groups.getGroupForIndex` with the
  inferred item (`items` first, then the template), not `any`. The check also
  applies when `groups` is optional on the input type. When `items` is given it
  is the **only** place the item type comes from: a template or a grouping
  callback annotated for a supertype is accepted — it safely takes every item —
  and does not widen the list to that supertype. The types of `vlist/config`
  use `NoInfer`, so they need TypeScript 5.4 or later; a mismatch is reported
  as "no overload matches this call", on the call rather than on the property. Escape-hatch `plugins`
  are looser than on `createVList`: a plugin explicitly typed for a different
  item, such as `groups<Other>()`, is accepted with no check.
  `GroupLayout.rebuild`, `createGroupLayout`, and `createAsyncGroupBridge`
  take `(index: number) => T | undefined` instead of `any`.

- `carousel()` declares the plugins it cannot be combined with, so six pairs
  that used to build a list now throw at `createVList` with
  `[vlist] Plugin "…" conflicts with "…"`, before any DOM is created. None of
  them worked; what changes is that the failure is now immediate and legible
  instead of a list that renders the wrong thing, or no thing, or none at all.

  `carousel()` with `grid()`, `table()`, `masonry()` or `tree()` is a
  permanent conflict — two plugins owning one list's layout, the same
  category as `grid()` with `masonry()`. All five share priority 10, so
  nothing but the order of your plugin array decided which set up first, and
  the results differed by that order: `[carousel(), grid()]` never returned
  and allocated until the tab or process died, while `[grid(), carousel()]`
  constructed and mounted its nine elements — which made the hang look like a
  mistake in how you ordered the array rather than a pair that cannot work.
  Measured on ten items in a 500px viewport, carousel first: masonry rendered
  nothing, table drew four rows of nine, tree drew three.

  `carousel()` with `search()` or `sortable()` is deliberately *not yet*
  rather than *never*, and the declarations are meant to be removed once the
  two compose. Filter-mode search replaces the item accessors and the total
  that the carousel window owns, and clearing the query did not restore them:
  a 30-item list went to 1 and came back 10, permanently. Sortable reads the
  public `data-index` and then asks the size cache — which the carousel has
  made speak virtual indices — where that row sits, so a drag on ten items
  emitted `sort:end { fromIndex: 2, toIndex: 13 }` and dragging upward was
  impossible. Removing a conflict later breaks nobody; adding one breaks
  everyone who shipped the pair, which is why both land before 3.0.0.

  Not addressed here: the five layout plugins still share priority 10 and
  still have no defined order among themselves. The conflict declarations are
  what keeps that from mattering.

- A template's root element fills the row. `.vlist-item` is a flex
  container, so whatever `item.template` returned became a flex item, and
  flex items do not grow: measured on a live page, a 350 px row held a
  131.7 px template root, and every integration worked around it with
  `width: 100%`. The stylesheet now makes the template's root fill the row;
  the per-integration rule is no longer needed.

- The base size budget is 10.0 KB (10,240 bytes), no longer 9.9. The 3.x
  fix cycle grew the core past 9.9 KB while the size gate was dark behind a
  failing typecheck (the idle pool trim below is 43 bytes of it), and the
  choice was to take the bytes rather than trim merged fixes. Every plugin
  budget was re-measured on the same rule as before: the measured size on
  a 0.1 KB grid with at least 100 bytes of room. `bun run size` and both
  READMEs quote today's numbers; the base is 10,200 bytes gzipped.

### Fixed

- `search()` re-highlights a row whose `item.template` returns an
  `HTMLElement` and returns the same element object again. The stamp that
  keeps an unchanged query from re-walking every visible row rode on the
  row's first child node, on the assumption that rewriting a row replaces
  its child nodes with new objects. A template is free to keep one node per
  row and rewrite it in place, and then the first child — and its stamp —
  outlived the marks it was vouching for: `updateItem` or `setItems` under a
  live query left that row unhighlighted, and scrolling away and back did
  not bring the marks back. Only changing the query did. Renderers now void
  the row's stamp when they write it, so the stamp can no longer outlast the
  content it describes. A commit that only moved the range still re-walks
  nothing.

- `tree()` with `selection()`: the focus ring follows the tree's own key
  moves. ArrowLeft and ArrowRight onto a parent or a child, Home, End and
  type-ahead went through selection as if they were clicks, so with the
  default `focusOnClick: false` the ring disappeared, `aria-activedescendant`
  stayed on the old row, and every further ArrowLeft / ArrowRight was ignored
  until an up or down key revived the focus. A keyboard user lost the focus
  indicator. The ring and the active descendant are now on the same row after
  every key move; a click keeps following `focusOnClick`.

- `sortable()` with `selection()`: the focus ring survives a keyboard sort.
  Space grabbed an item, and the first arrow that moved it took the ring away —
  mid-sort, not after the drop — because the move reached selection as if it
  were a click. With the default `focusOnClick: false` the ring vanished,
  `aria-activedescendant` stayed on the row the item had left, and
  `_getFocusedIndex()` answered -1, so the Space meant to re-grab the item fell
  through to selection and selected it instead. The ring and the active
  descendant now follow the grabbed item through every move, the drop and
  Escape; a pointer drag keeps following `focusOnClick`.

- A wrap-mode coordinate fold (carousel) now re-keys the mounted row
  elements instead of releasing and re-creating them. Folding used to
  miss every `rendered` lookup because virtual indices moved by whole
  laps, so every visible node went back to the pool, was re-templated
  and re-inserted — mid-gesture, with compositor layers dropped. The
  items and their paint positions are the same before and after; only
  the key changed. `id` attributes that carry the virtual index are
  rewritten from the configured `classPrefix` (a prefix containing
  `-content` is not parsed off the content class), and
  `aria-activedescendant` is resolved to the same node after every id
  rewrite. Striped rows keep virtual-index parity when the fold shifts
  by an odd number of items. A fold that shares its frame with a
  scroll still lets rows enter and leave at the window edges; persisting
  rows keep the same `HTMLElement`.

- The element pool no longer drops spares beyond 100. A jump or a data change
  on a view showing more than 100 elements — a tall viewport, a wide grid —
  released them all, kept 100 and dropped the rest, and the next frame cloned
  the difference again. The cap bounded nothing: the pool only holds elements
  it created, and it creates one only when it is empty, so it can never hold
  more than the most that were mounted at once. The core renderer, grid,
  groups, masonry, table and tree are all covered, with no new option, and
  every bundle is a few bytes smaller.

- `selectNext()` and `selectPrevious()` scroll the newly selected item into view:
  nearest edge, no movement when the item is already fully visible, honouring
  start/end padding and layout plugins' `_scrollItemIntoView` (grouped sticky
  headers, grid rows, table). Calling either method used to move the selection
  without revealing it, so a player's Next/Previous control could select a
  track that was neither on screen nor in the DOM. Reveal is a layout-aware
  operation with one owner: a plugin may publish `nav.reveal(index)` (carousel
  snaps in the current virtual lap, no wrap); otherwise `_scrollItemIntoView`
  or nearest-edge scrolling. `nav.navigate` is the keyboard path — these
  methods never call it, and must not skip the reveal because it exists.
  `select(id)` still selects without moving the viewport. The index passed to
  `nav.reveal` is the navigation / focus index that goes with `nav.total`
  (carousel: logical item index; grid: item index), not a size-cache or layout
  index. `NavCapability.get()` always carries a `reveal` property (`null` when
  no owner set one).

- `selectNext()` / `selectPrevious()` cancel an in-flight smooth scroll before
  revealing. `scroll.to()` committed the position while the animation kept
  running, so calling Next during `scrollToIndex({ behavior: "smooth" })`
  selected the first item and then the animation carried the viewport to the
  original target, leaving the selection off-screen — including when the
  selected row was already visible and the reveal itself did not scroll.

- A selection-driven carousel reveal emits `carousel:change` when the index
  changes, with a scroll position that matches the completed reveal.
  `revealInCurrentLap()` used to set `intendedVi` and emit nothing, so
  pagination indicators stayed stale through `selectNext()` /
  `selectPrevious()`. Clamping at either end still emits nothing.

- `sortable()` on Android Chrome: the long-press menu no longer opens over a
  drag that has already started. `blockCallout` only prevented the default
  when the event's target sat inside the dragged item, which is never true
  once a drag is running. Found on a real device during the phone pass.

- `grid()` and `table()` neutralise focusables after writing a row, through
  the same `rowContentWritten` helper the list, tree, groups and masonry
  renderers already call: links and buttons inside those rows get
  `tabindex="-1"`, and the row stamp is cleared so a rewrite is visible.

- `snapshots()`: a restore onto a list that is showing the keyboard focus
  ring moves the ring onto the restored row, and the next arrow steps from
  there. A restore onto a list that was never focused still paints no ring.

- `grid()` no longer asks a height function for an index past the end of the
  data when the size cache is built one slot per item, so a function that
  reads its item does not throw during setup or `updateGrid` and the grid
  stays installed.

- `scrollToIndex({ behavior: "smooth" })` with no duration animates under
  `grid()`, `groups()` and `masonry()`, with the same 300 ms default as a
  plain list, and forwards the easing option. An omitted behavior, or
  `"auto"`, still jumps.

- `search()`: typing into the visible search bar opens search, the same as
  `setQuery()`; Enter, the arrows and Escape work in that field, and the list
  gets `vlist--searching`. Matches inside a `table()` are highlighted —
  filtering already worked, the marks did not — and with `groups()` the
  engine total includes the header rows, so the last group's rows are drawn
  and highlighted.

- `autosize()`: a smooth jump to the end finishes on the last items. The
  jump publishes the content height while rows are still being measured and
  snaps to that end when the animation completes; the second jump to the
  bottom no longer stops short and leaves the viewport empty. A
  `ResizeObserverEntry` without `borderBoxSize` is measured from the
  element's border box instead of throwing.

- `tree()`: the last child of a branch closes the guide with an elbow, and a
  folder that is itself last does not keep that line running through its
  children; a nested guide that does not start at the left edge no longer
  paints the whole gutter. `updateItem` on a node inside a closed folder
  updates the source node, and the new label is there when the folder
  opens. ArrowDown after a click continues from the clicked node instead of
  jumping back to the first, and a tree with `a11y()` or `selection()`
  expands, collapses and type-aheads from the clicked row while the focus
  ring stays hidden — a table or masonry click still paints no ring.

- `a11y()` publishes the focused row and a way to move it, the hooks
  `selection()` already provided, so a tree with `a11y()` and no
  `selection()` can expand, collapse, expand siblings and type-ahead from
  the keyboard again. Moving through a `masonry()` list keeps the focused
  cell on screen — a11y asks the layout that owns the reveal before falling
  back to a running total of item heights — and `aria-activedescendant`
  names that cell.

- `rebuild()`: the hidden new list is pinned to the previous list's width
  and height while it is overlaid. An absolute root inside a static
  container has no height, so a tree skipped its first render and came back
  empty. The scroll position is restored without a `snapshots()` plugin: a
  plain list contributes its position, and the new list applies it again
  once the viewport has a size.

- `masonry()`, `carousel()` and `table()` ignore the teardown of a list they
  were moved from. A scroll-mode switch installs the same plugin instance on
  the new list and then destroys the old one, and the old teardown cleared
  what the new list had just built: the album came back empty, Next threw,
  the data table came back empty.

- `sortable()` under `vlist/synthetic`: edge-scroll moves each row by its
  transform, and clearing the inline transition let an author
  `transition: transform` rule animate that move, so rows lagged and left a
  gap. An origin change now sets the transition to `none`; the reorder
  animation still plays when the list is not scrolling.

- A `createVList` that throws after plugin setup — `page()` with
  `carousel()` is the one case — unwinds the plugins it had set up and
  removes the root it had built. page's `resize` listener on `window` used
  to outlive a list nobody got, and the empty root stayed in the container.

### Removed

- `grid()`: the placeholder `rebuildAsRows` function the plugin was created
  with. Setup installs the real one before anything can call it, so it never
  ran. No behaviour change; the grid bundle is 8 bytes smaller gzipped.

- Three internal cross-plugin hooks that no plugin reads any more. Underscore
  hooks never reach the list instance, so only a plugin calling
  `ctx.hooks.get()` could have seen them: `_scrollbar:setCallback` (its one
  consumer, the scale plugin, went with RFC-012; the scrollbar now calls
  `ctx.scroll.to` directly), and the table's `_updateRenderedItem` and
  `_updateItemClasses` (orphaned since the v2 plugin migration). No behaviour
  change; scrollbar is 30 bytes and table 37 bytes smaller gzipped.

### Performance

- The element pool trims its spare nodes once the list is idle, or on a data
  change outside a scroll, back to the number of rows on screen. During a
  scroll it still keeps a whole window ready for the next jump.

- A carousel lap fold reuses two scratch buffers instead of allocating an
  index array and an element array on every fold. The buffers grow only when
  the mounted window is larger than before.

### Internal

- `next` was red from 2026-09-22 to 09-25 behind five layers that each hid
  the next: a `src` typecheck error, twelve type errors in test files, the
  Happy DOM registration under `bunfig.toml`'s `concurrent = true` (43
  failures and ~440 tests never running), the coverage gate, the size gate.
  The suite now registers one Happy DOM for the process (`test/preload.ts`)
  and clears the document between files; the leaks that had hidden behind
  the per-file DOM are fixed at their source, including the one test that
  built two lists and destroyed one. CI runs every gate even when an earlier
  one is red and a final `Gate` step names the red ones, and the merge rule
  gained the sentence the week was missing: a PR merges only when `next` is
  green at its base.

- `build.ts` recreates `dist/` after cleaning it; four `Bun.build` calls
  write into that directory and only the first used to create it, so one
  build in thirty failed on a later chunk.

- The perf suite asserts the work of `updateItem` — one template call for a
  rendered id, none for an off-screen one — instead of a wall-clock
  millisecond, and takes the median of seven samples for the 5 ms budgets.
  The runway regression tests name the engine (`runway — …`), not the
  bounded-scroll mode that no longer exists.

## [3.0.0-next.3] - 2026-09-17

### Changed

- `createVListFromConfig` — the entry point every framework adapter uses — now
  returns a list typed with the methods its config wires: `selection: {…}` gives
  `select()`, `adapter` gives `reload()`, `layout: "grid"` gives `getGridLayout()`,
  and so on, derived from the same fields `resolvePlugins` reads. It takes one type
  parameter, the config itself, so the item type comes from `items` or the template
  and there is no second slot to fall into: `createVListFromConfig<Row>(…)` no
  longer compiles — drop the type argument. Before, `resolvePlugins` returned a
  homogeneous array, every plugin's method marker was erased, and an adapter list
  was a bare `VList<T>` on every framework. A widened `boolean` field (`snapshots:
  maybe`) yields no methods, since the compiler cannot know; spell it as a literal
  or narrow first.

- Grid rows carry listbox semantics. They carried **no `role` at all**, and no `aria-posinset` or
  `aria-setsize`, while a plain list gave `role="option"` with both and a masonry list gave
  `role="listitem"` with both. Core sets these in its render pipeline, and `grid()` replaces that
  pipeline outright, so nothing reached a grid row.

  A row is now `option` when the list is interactive and `listitem` when it is not, matching core,
  with `aria-posinset` and `aria-setsize` on an interactive list and `aria-setsize` rewritten when
  the total changes.

  What counts as interactive is the marker `ctx.dom.enableListbox()` leaves on the content
  element, because **both** `a11y()` and `selection()` call it. `_getSelectedIds` is only
  published by `selection()`, so keying on that hook would miss an `a11y()`-only list.

- Grouped and masonry rows carry the same listbox semantics as a plain list. `groups()` keyed
  interactivity on `_getSelectedIds`, which only `selection()` publishes — so an `a11y()`-only
  grouped list rendered `role="listitem"` with no `aria-posinset` or `aria-setsize`. `masonry()`
  never passed an interactive flag to its renderer, so every row took the non-interactive branch
  even under `selection()`.

  Both now read the `enableListbox()` marker on the render path (they set up at priority 10,
  ahead of selection and a11y) and give rows `role="option"` with position attributes when the
  list is interactive, and `role="listitem"` without those attributes when it is not. A
  non-interactive masonry row also no longer carries leftover `aria-setsize` / `aria-posinset`.

- `grid()` reports the item count as the list's total. It reported the row count: a hundred items
  in three columns gave `list.total === 34`, while `getItemAt(99)` returned item 100 and
  `items.length` was 100 — the accessor and the array in item space, the total in row space.

  The engine genuinely renders a grid in rows, and that is unchanged: `engineState.totalItems`,
  the size cache and the range math all still count rows. What changed is the answer to a
  different question — how many items a consumer has. `groups()` was corrected the same way and
  `carousel()` was already right, so all three now agree on the contract.

  `grid()` also publishes `_getTotal` now, which it never did. `selection()`, `snapshots()` and
  the ARIA resolvers ask through that hook rather than the public getter, and with no answer from
  the layout plugin they fell back to whatever core held.

  Nothing asserted a grid's public total, which is how it survived; `test/integration/grid-total.test.ts`
  covers it, including under `data()`, where the adapter owns the engine's total.

- A plugin that cannot serve the list's configuration throws again.
  `createVList({ reverse: true }, [table()])` returned a list — half wired, rendering fifteen
  ordinary rows, with nothing to say it was not a table. `table()` rejects reverse mode and
  horizontal orientation, and `masonry()` rejects reverse mode, by throwing; making plugin setup
  errors observable had wrapped every `setup()` in a catch, so those rejections became an `error`
  event fired before `createVList` returns — which no caller can hear.

  Two failures had collapsed into one. A plugin that throws while wiring itself is a fault: it is
  still caught and reported, and the plugins after it still set up, so one bad plugin cannot take
  a list down. A plugin that has already decided it cannot serve this configuration is a
  programming error, and handing back a plausible-looking wrong list is worse than failing.

  Plugins declare the second kind through a new optional `validateConfig(config)`, which runs
  beside the declared-conflict check and outside the setup catch. `table()` and `masonry()` use
  it; a declared conflict such as `table` with `grid` already threw from there, so both kinds of
  "this plugin cannot work here" now fail the same way, in the same place. Third-party plugins
  can use it too.

  The three tests covering these rejections all called `plugin.setup!(ctx)` directly, which is
  why they stayed green while the path every caller uses was broken. They now exercise the hook,
  and `test/core/plugin-validation.test.ts` covers both halves of the boundary through
  `createVList`.

- The render window has a ceiling again. Making the window the authority on capacity fixed the
  truncation of small rows, and removed the only upper bound with it: a size spec reporting `0`
  puts every item at the same offset, so `indexAtOffset` lands on `total - 1` and the window
  becomes the whole dataset. Measured at **20,000 of 20,000 rows rendered**, each one a
  TypedArray slot and a DOM node; at a million rows that is roughly 20 MB of buffers before the
  DOM is counted. An item cannot occupy less than one physical pixel, so no more than
  `containerSize + overscan * 2` rows can ever be visible, and the window is capped there — 406
  rows for a 400px viewport, against the 20,000 it drew before.

  A clamp on its own would have been the same class of defect it replaced: a short list, and
  nothing to say why. So the list emits `error` with context `render:window-ceiling` when the cap
  binds, once rather than once per frame. That report is deferred by a microtask, because the
  first render happens inside `createVList` — the conventional
  `const list = createVList(...); list.on("error", ...)` attaches a tick too late otherwise,
  which is the trap plugin setup errors fell into. A listener added in a later task still misses
  it; plugins, which subscribe during setup, hear it either way.

  The cap is the one that used to sit in the pipeline and was removed as dead code. That removal
  was correct at the time: capacity was the binding constraint, so the cap could never be the
  minimum. Making the window the authority is exactly what revived it.

- `masonry()` renders its items when used with `data()`. It rendered **nothing at all** — an empty list with a full-height scroll area and no error. The layout was fine: placements come from `engineState.totalItems`, so the content measured its proper 2000px and the list scrolled over blank space. Only the lookup failed. `masonry()` caches `items.all()` per render and reads it by index, and `data()` replaces the item accessors without ever filling that array, so every item resolved to `undefined` and the renderer drew an empty frame. It now asks through `_getLoadedItem`, resolved once at render time rather than per item, since `data()` registers the hook in a setup that runs after this plugin's.

  Found while checking whether the same fault reached further than `sortable()`, which had it for keyboard reordering. It did, and worse: there the pointer path still worked, here the list was simply empty. `carousel()` was checked too and does not have this defect — but not for the reason first recorded here, and the claim was written wider than the check. Under an adapter it installs no modulo accessor at all: the engine total is 0 when its setup runs, so the slot path never engages and the wrap that defines a carousel is silently absent. Rendering works; looping does not. That is its own defect, not this one.

- Keyboard reordering works when `sortable()` is used with `data()`. It did nothing at all: Space never grabbed, so no `sort:start` was emitted and the arrows and drop had nothing to act on, while pointer drag kept working and hid the gap. `data()` replaces the item *accessors* — `setGetFn`, `setTotalFn`, `setRemoveFn` and the rest — but never fills the raw array, so `items.all()` is empty under an adapter and the three places that read it by index (the grab, the announcement label, and the focus captured at drag start) each found nothing and returned early. Pointer drag survived because it works off DOM elements. Those three now ask through `_getLoadedItem`, the hook `data()` and `tree()` both publish and `selection()` already consumes, which answers with a real item or nothing — so every guard behaves as before, and `items.at()` was deliberately not used because it hands back a placeholder for an unloaded row.

  `sort:cancel`'s `originalItems` stays a snapshot of what the list holds, which under an adapter is empty: the adapter owns the data, and there is no full array to snapshot. Nothing changes for a list without `data()`.

- Rows no longer stop short at the bottom of a tall list with a size function. Capacity — how many entries the render buffers hold — came from `ceil(containerSize / minItemSize)`, and `minItemSize` is the real item height when the spec is a number but a flat **20px guess** when it is a function. `resizeCapacity` then re-derived demand from that same guess, so it could never discover a shortfall: a 10px size function in a 3050px viewport rendered **219 of the 305 rows that fit**, and the rest of the viewport stayed blank. The render window knows what it needs, and capacity now grows to meet it. Nothing else moves — where the estimate was already ample the buffers are untouched, and a numeric spec was never affected.

  The case had a test, and the test asserted the truncation: it built a state with capacity 5, gave it a viewport needing 55 rows, and checked the window had been cut down to 5. The invariant worth keeping is that the buffers hold the window, and that is what it checks now.

- The tests compile as strictly as the library they test. `tsconfig.test.json` set `strict: false` and switched off `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, so the suite was checked more loosely than `src`, which builds strict. Enabling the three produced **606 errors, every one in `test/` and none in `src/`** — the library was already clean; only its tests were exempt. They are now all fixed and the exemptions are gone.

  What the exemption had been hiding was not noise. `setup?()` and `destroy?()` are optional on `VListPlugin`, and 201 call sites invoked them without asserting — the suite happened to be right, but nothing checked it. `PluginContext<T>` is invariant in `T`, because it both produces `T[]` and consumes `T`, so the several hundred sites passing a `PluginContext<TestItem>` to a plugin built as `PluginContext<VListItem>` were genuinely unsound rather than merely untidy. Twenty-four test files declare their own local `TestItem`, and wherever one met a value typed against the shared helper's richer `TestItem`, the two collided by name alone. Indexed access returning `T | undefined` accounted for another 39, and `exactOptionalPropertyTypes` caught an explicit `{ restore: undefined }` and a `ctrlKey: opts?.ctrlKey` that the declared types do not permit.

  No behaviour changed: 3802 tests pass before and after, and the assertions added erase at runtime. `noUnusedLocals` and `noUnusedParameters` stay off for tests — 120 further errors across 45 files, each fixed by deleting a binding, which is hygiene rather than type safety and a separate decision.

- **Breaking:** `list.total` and `getItemAt` mean the same thing under `groups()` that they mean everywhere else. `groups()` set the public total to its layout entry count, so a grouped list of ten items reported **12** — the headers counted as items — and `getItemAt(10)` and `(11)` returned `undefined`. With `table()` as well, `getItemAt` changed space entirely: `getItemAt(0)` handed back a header pseudo-item, while the same call on the same plugin without `table()` returned the first row.

  The split already existed and was already documented in the code: `engineState.totalItems` is the engine's render count, and `carousel()` states it plainly in its own setup — “Engine needs virtualTotal for rendering at virtual indices. Public API (list.total) returns realTotal.” Every other plugin follows that: `carousel()` reports the real count, `search()` the filtered count, `tree()` the visible nodes. `groups()` was the one reporting entries. It now reports the item count — the number its own `_getTotal` hook already published — and `getItemAt` asks through the layout mapping rather than being handed a layout-indexed accessor. Headers still render and still take space; they are layout entries, and `aria-setsize` had already been corrected to exclude them.

  Three tests asserted the old behaviour, including one written two releases ago to cover a different defect. A test that describes what the code does cannot settle whether the code is right.

- `masonry()` with `groups()` and a fixed item height placed every item at height 0. Masonry resolves item heights from the raw size spec, but only builds that accessor when the spec is a function; with a number it fell back to the size cache — which `groups()` had already replaced with a layout-indexed one. So a data index read a layout entry, and index 0 read the first group header, which measures 0 when sticky. Placement now uses the data-space accessor `groups()` already captures before replacing the cache. Found while making a test helper honest: the mock's `setSizeConfig` was a no-op, so no plugin's replacement of the size config had ever been exercised, and every height came back as the stub's fixed 50.

- The gap is a size-cache parameter, so a plugin that replaces the size config no longer loses it. Every item slot carries the gap that follows it, and the total has to drop the last one, because the space after the final item is spacing rather than content. Core applied that correction by wrapping `getTotalSize` after building the cache — and `setSizeConfig` builds a *fresh* cache and `Object.assign`s it over the old one, preserving only `rebuild`. So `groups()` silently discarded the correction: a ten-item list with `item: { height: 50, gap: 10 }` reported 630 where 620 is right, one gap of phantom space at the bottom.

  `autosize()` and `grid()` had each hit this and re-implemented the same six lines after their own `setSizeConfig` call; `test/core/gap.test.ts` had a fourth copy, written inside the test and then asserted, so those two cases could not fail on anything the library did. `createSizeCache` now takes the gap and subtracts it once, the three copies are gone, and the tests assert the library. `table()` passes no gap, since its row height never had one baked in — its total is unchanged.

- `item:click` fires when `table()` and `groups()` are used together. It was dropped entirely for the first row of every group — two defects with one root.

  `groups()` defers its table-mode wiring to a microtask and never re-rendered afterwards, so the rows kept data-space indices and no header class while core resolves clicks through the layout space: layout index 0 is a header, `layoutToDataIndex` returned −1, and the click was discarded — permanently, because nothing rendered again. It now re-renders once the wiring lands. Behind that sat a second fault, reachable only once the DOM is in layout space: core fetched the item with a data index against the layout-aware accessor `groups()` installs, so a row answered as the header above it. The plugin now publishes that accessor on the method bus and the click path asks by layout index, while `index` stays the data index the event documents.

  The case had a test, and the test passed. It asserted that feeding the reported index back into `getItemAt` returned the same item — but under `table()` with `groups()` `getItemAt` takes layout indices, so both sides read through the same wrong lookup and agreed with each other. It now compares the emitted item against the clicked row's own `data-id`, which is the thing that was broken.

- CI asks whether the heap comes back. The memory suites check DOM, listener, observer and timer teardown — all structural — and a list that is fully detached but still held by one surviving closure passes every one of them, because nothing ever measured the memory. `bun run heap` creates and destroys lists in a loop, forces a full GC at intervals, and watches the *rate* of growth rather than its total: a bounded one-time cost decays, a leak stays flat. On this tree the rate decays to 0.40x over 200 cycles, while a deliberately retained instance holds 0.89x; the gate cuts between them, and the ratio is stable to two decimals across runs. The ratio is only applied above a floor of total growth: where almost nothing accumulates there is no curve to describe, and a profile that retained 89 KB over 200 cycles — twelve times less than one that passed — still reported 1.11x, because its first window was 405 bytes per cycle. A gate that fails hardest when the code is cleanest is measuring itself.

  Two details in that measurement each produce a confident wrong answer if skipped, and both were found by making the mistake first. Pending animation frames must be drained before sampling — under a `setTimeout`-based rAF shim they hold every destroyed instance alive and account for 84% of apparent growth, which reads as a 50 KB-per-cycle leak that does not exist. And the loop must warm up before the baseline is taken, or one-time growth is counted as retention. `bun run heap --self-test` retains every instance on purpose and requires the gate to fail, so a gate that quietly stopped detecting anything cannot pass forever.

- **Breaking:** `PluginContext` is grouped by capability. It had reached 50 members on one flat object — eleven of them `set*Fn` inversion hooks sitting directly beside the methods they replace — and a member's name was the only thing telling a reader which subsystem it belonged to. The members now sit under `ctx.dom`, `ctx.scroll`, `ctx.items`, `ctx.sizes`, `ctx.render`, `ctx.hooks` and `ctx.nav`, while `pool`, `config`, `emitter`, `template` and `getState()` stay at the top level. `ctx.registerMethod` becomes `ctx.hooks.method`, `ctx.forceRender` becomes `ctx.render.force`, `ctx.sizeCache` becomes `ctx.sizes.cache`, `ctx.scrollTo` becomes `ctx.scroll.to`, `ctx.getItems` becomes `ctx.items.all`, and so on for the rest; `ctx.scroll` keeps every `ScrollAdapter` member it already carried, so external scroll sources are unaffected beyond the rename. The type is exported from `vlist`, so anyone who has written a plugin against it must rename — nothing else about the plugin protocol changed, and no behaviour changed with it.

  Grouping turned out to be slightly *smaller* on the wire rather than larger: the base bundle goes from 9674 to 9640 bytes gzipped. Repeated long keys collapse into short ones inside shared namespace objects — `registerMethod` to `method`, `updateContentSize` to `contentSize` — and gzip pays for that more than the nested objects cost.

- Several tests could not fail, which is worse than not having them. Two assertions in the cross-feature suite ran inside `if (element)` guards, so a list that rendered nothing passed in silence; one in the a11y suite dispatched through `?.`, reporting a missing element as a missing selection event.

  The carousel suite wrapped its own import in `try/catch` and put 40 `describe` blocks behind `describe.skip` if it failed — a scaffold from before the plugin existed. It was worse than a stale skip switch: typing the import `any` also suppressed **37 wrong-arity calls** in tests that were running all along, passing no state to `onCommit` and no direction to `onAfterScroll`. Those calls worked at runtime — the hooks ignore both arguments — so this was a type defect the `any` had hidden, not a broken test. They now pass what the signatures declare.

  A table-with-groups click case was a comment claiming it "requires a real browser". The stated reason is wrong — the rows render with `data-index` and are queryable — but the case does fail, for a reason nobody had looked for: `table` writes the row's own index into `data-index` while `groups` maps a header layout index to −1, so the click is dropped for the first row of each group, and no test anywhere had ever asserted `item:click` under a table. The case is now an explicit skip naming the finding rather than a sentence saying it was checked by hand.

- The library no longer writes to the console outside a plugin's own failure. `groups()` logged on every layout sync and every forced render whenever `NODE_ENV` was not `"production"` — so in every consumer's development build and every test run — and `grid()`'s row lookup logged an emoji warning on a defensive branch that was behaving correctly. A library printing to someone else's console by default is noise they did not ask for; the one remaining `console.error` reports a plugin whose `setup()` threw, which is the failure it exists for.

- Dropped an unreachable cap from the render window. It limited the range to `ceil(containerSize / 1) + overscan * 2 + 10`, which sat ten above `state.capacity` — itself `ceil(containerSize / minItemSize) + overscan * 2`, with `minItemSize` never below 1 — so it could never be the binding term. The `/ 1` was left over from a division by row size.

- The browser suites wait for each wheel step to land instead of for a fixed 35 ms. The first pull request checked by the new CI job failed on `19 !== 20` and passed on re-run with no change: one commit missed the deadline on a loaded runner, which is a race in the harness rather than a dropped wheel event. A step that never moves still fails, now through the wait's timeout. A gate that flakes is not a gate.

- **Breaking:** `carousel()` declares a conflict with `groups()`. Both are layout-tier plugins at priority 10, so setup order was array order and the pair failed differently depending on which the caller wrote first: with carousel first, `list.total` reported **1012** for a ten-item list, because groups built its layout over carousel's 1,010 virtual indices plus two headers and overrode the virtual total; with groups first the total was right but the layout was still built over 1,010 entries, and rendering started 750px down with six items drawn. Mechanically, carousel assigns `getTotalSize`, `getOffset`, `getSize` and `indexAtOffset` onto the size cache directly, while `groups()` calls `setSizeConfig`, whose core implementation `Object.assign`s a fresh cache over exactly those four. The documentation had listed the combination as incompatible all along; only the code never enforced it, and carousel had declared no conflicts at all since the removal of the stale `scale` entry.

- **Breaking:** `grid()` declares a conflict with `autosize()`, and `vlist/config` rejects an item estimate together with `layout: "grid"`. The pair combined silently and wrongly: grid indexes its size cache by row while autosize measures items, so with a numeric estimate and no gap — precisely what the config layer produces — grid never installs its own size function and autosize's item-indexed one stays, giving row *n* the measurement of item *n*. Twenty items in two columns with two cells measured at 200px came to 800px where 650px is correct, and every row below the first measured one sat at the wrong offset. With a gap, or a function size spec, the measurements were dropped instead. A row's height is a question about that row's cells, which belongs to whichever plugin owns the layout; grid lists need a fixed `item.height`. The config layer names those fields rather than the plugins, since it wires them itself.

- `selection()` reads the right total for each question it asks. It needs two: how many entries the layout has, for moving focus across them, and how many items exist, for counting. It used the engine's total for both, and the two diverge as soon as a plugin reshapes the list.

  With `carousel()` the engine total is the inflated virtual one — 1,010 for ten items — so Ctrl+A selected all ten and then compared ten against 1,010, never matching, and never clearing; PageUp and PageDown clamped a data-space target against that same number. `carousel()` publishes its real count through `_getTotal`, the hook `data()` already used, and selection asks for it. `snapshots()` benefits for free: it reads `_getTotal` to decide whether a restore still matches, and had been getting `undefined` under carousel instead of a count that stays put across rebases.

  With `groups()` the reverse: Ctrl+A selected eight of ten items, because the walk over layout entries — headers included, then skipped — was bounded by the data count and stopped two entries short. It now uses the layout total, which `groups()` already supplied for focus navigation. `groups()` also publishes `_getTotal` so the item count is right in its table and async paths, where the engine total does become the entry count.

  Neither combination had any test coverage; the groups defect surfaced from the test written for the carousel one.

- **Breaking:** `tree()` declares a conflict with `data()`. The two produced an empty list: `data()` installs six of the seven hooks `tree()` installs — total, item, index-by-id, insert, remove and update — and runs later at priority 20 against 10, so it replaced the tree's entire data-access surface, while the one hook it does not claim, the tree's own renderer, stayed installed and kept reading through the replaced functions. Nothing rendered. The documentation already described this combination as a conflict and pointed at `loadChildren` for async tree data; only the code failed to enforce it. `tree()` already declared conflicts with `groups()`, `grid()`, `masonry()` and `table()`.

- **Breaking:** `search()` declares a conflict with `tree()`. The two silently corrupted each other: search delegates tree filtering to a `filterTree` hook that `tree()` never implemented, so it fell through to flat filtering with indices into the source array while the tree owns the layout index space — a five-node tree reported one match, then zero, then two after the query was cleared. Filtering a tree means preserving the ancestors of each match, which belongs to whichever plugin owns the layout. The unreachable delegation code has been removed rather than left as an affordance that never worked.

- **Breaking:** `search()` declares a conflict with `data()`, so a list built with both throws instead of failing quietly. The combination never worked: matching reads the items the list holds, which an adapter leaves as an empty window, so every query matched nothing and filter mode reduced the list to zero rows — and clearing the query made it permanent, because the restore path reinstates static item and total functions over the ones `data()` installed. Search a remote dataset through the adapter's own query. The plugin's own header had always scoped server-side search out.

- CI runs on `next` as well as `staging` and `main`. The 3.0 work happens on `next`, where no pull request has had a single automated check: every merge so far was gated by hand.

- `bun run size` fails when the base bundle passes its gzip budget, and prints exact byte counts. The README has always quoted bytes and called 9.9 KB the target, but nothing enforced it, so the number could be spent a hundred bytes at a time with only a human reading the table to notice. Base is 9,688 bytes against a 10,137 budget.

- The four browser suites run in CI, and default to an in-repo Chrome launcher (`scripts/browser-driver.mjs`) instead of requiring `VLIST_BROWSER_DRIVER` to point at a module outside the package. The variable still overrides it. `puppeteer-core` joins the devDependencies; it ships no browser, using the one already on the machine. Runtime dependencies remain zero.

- **Breaking:** horizontal lists in an RTL container are rejected at creation by both entries, not just `vlist/synthetic`. `vlist` accepted the combination and then sat on its first page: RTL makes `scrollLeft` negative, the wheel clamp pins it at 0 and items translate the wrong way, so the list rendered once and never moved while the README advertised it as working. Supporting it means signing every DOM scroll boundary and every renderer that writes its own transform; 3.0 refuses out loud instead, and a later implementation would be additive rather than breaking. Vertical RTL lists and RTL tables are unaffected, including cross-axis wheel movement, aligned headers and keyboard column navigation.

- **Breaking:** `item:click`, `item:dblclick` and `item:contextmenu` report the DATA index — the space `getItemAt`, `scrollToIndex` and `removeItem` take. They reported the layout index, so in a grouped list data row 3 arrived as row 5, one off per header above it, and feeding that index straight back to `getItemAt` returned the wrong item. Lists with no index-mapping plugin are unaffected: the two spaces are the same there.

- **Breaking:** `createVList` copies the `items` array it is given. It kept a reference, and `insertItem`, `removeItem` and `removeItems` splice that array in place, so a list rewrote the caller's array from under it — while `setItems` had always copied. Code relying on that aliasing to observe list edits should read `list.items` instead.

- **Breaking:** `vlist/config` — the path every framework adapter goes through — wires only the plugins the config asks for. It used to add `selection({ mode: "none" })`, `snapshots()` and the custom overlay scrollbar to every list, so an adapter list and a core list built from the same options did not behave the same. Selection now follows the `selection` field, `snapshots: true` restores scroll save/restore, and `scrollbar: true` (or an options object) restores the overlay scrollbar; with neither, the browser's native scrollbar stays, as in core.
- **Breaking:** `selection({ mode: "none" })` no longer claims the listbox role. Selection in that mode has no selection semantics, yet the role came with `tabindex="0"` on the list and an option role on every item while the arrow keys did nothing. Through `vlist/config` every adapter list inherited it, accessible in name only.
- **Breaking:** `vlist/config` throws when `layout: "grid"` or `layout: "masonry"` arrives without its options object, instead of quietly resolving to a plain list.
- **Breaking:** a plugin can no longer take a public method name another plugin already registered. `ctx.hooks.method` throws on a duplicate public name, so the collision surfaces instead of the last plugin silently winning. Internal names (a leading underscore) are the cross-plugin protocol and may still be overridden, which is how `groups`, `masonry` and `page` each provide `_scrollItemIntoView`.
- **Breaking:** internal underscore methods are no longer copied onto the list instance. Plugins still reach them through `ctx.hooks.get("_name")`; consumers never could rely on them meaningfully, and 29 of them were public surface.
- `grid`, `groups` and `masonry` no longer shadow the public `scrollToIndex`. They install their layout-aware implementation through `setToIndexFn`, so core keeps ownership of the method, including a scroll requested before the list has a total.
- A plugin whose `setup()` throws now also reports to the console outside production, which costs 58 gzipped bytes in the base bundle and is what makes both this failure and the duplicate-name error observable at all. The `error` event still fires with the same payload, but it fires before `createVList` returns, so no listener could hear it and a half-wired list came back silently.
- **Breaking:** the public types no longer rely on index signatures. `VListItem` requires only an `id`, so an ordinary `interface Row { id: number; name: string }` satisfies it, and `VList` no longer accepts any property name, so a mistyped method is a compile error. Plugins declare the methods they add, and `createVList` infers them from the plugins array: `createVList(config, [selection(), tree()])` types `select()` and `expand()`, while a plain list exposes only the core API. TypeScript does not allow a partial type argument list, so an explicit item type (`createVList<Row>(config, plugins)`) skips plugin inference; type the config instead (`const config: CreateVListConfig<Row> = { ... }`).
- **Breaking:** removed the deprecated `ScrollbarConfig` export, unused since the scrollbar options moved to `scroll.scrollbar` and `ScrollbarPluginConfig`.

### Added

- `vlist/config` accepts `a11y` — `true` or an `A11yPluginConfig` — to wire keyboard navigation and the ARIA listbox roles, and `snapshots: true` for scroll save/restore.

- Export `GridPluginConfig` and `A11yPluginConfig`, which the public config types already referenced, plus the per-plugin method types (`SelectionMethods`, `TreeMethods`, `TableMethods`, `SearchMethods`, `DataMethods`, `GridMethods`, `GroupsMethods`, `MasonryMethods`, `CarouselMethods`, `SnapshotsMethods`, `SortableMethods`, `AutosizeMethods`, `ScrollbarMethods`) and the `PluginMethods` helper.

- Support `sortable()` with `vlist/synthetic`. Both entries use a configurable 350 ms touch/pen long press without a handle; early movement scrolls, while handles retain threshold-based dragging. Claimed drags exclude scrolling and momentum, and a touch-only ghost class provides a visual cue.

- Support `carousel()` with `vlist/synthetic`. Whole-lap folds preserve touch drags, flings, smooth navigation and directional snapping without a native main-axis scroll write.

### Removed

- `createGridRenderer` and `GridRenderer` from `vlist/internals`. No grid list ever
  ran them: `grid()` renders through its own path, which is where the listbox
  semantics (#197, #212) and the groups ordering fix (#228) landed, so the
  published renderer was a second implementation that nothing exercised — 705
  lines and a 1,696-line test of code no list executes. A grid is `grid()`; there
  is no separate renderer to import.

### Fixed

- `page({ scrollPadding })` survives `groups()` and `masonry()`. page() applied the
  caller's band in its own `_scrollItemIntoView` and `setToPosFn`, but both layout
  plugins replace those — they are the only ones that know where an entry sits, and
  they are seated later (priority 10 against page's 5). The band silently vanished,
  so keyboard focus and `scrollToIndex` parked items under the sticky header the
  padding existed to clear.

  page() now publishes the resolved band through a `_getScrollPadding` hook, and
  `groups()` and `masonry()` fold it into their own geometry. The band is read on
  every call, so a function padding that measures a sticky header still re-measures.
  Without page() the hook is absent, it reads zero, and the layout maths is unchanged.

- `search()` with `selection()` selects the item a filtered row actually shows.
  Clicking a match used to select the item that sat at that index **before**
  the filter: the row painted "Item 9", `item:click` reported `id=9`, and
  `selection:change` reported `[1]`. `applyFilter` remaps `getItemFn` and
  never replaces the source array, and `selection()` resolves rows through
  `_getLoadedItem` — a hook only `data()` and `tree()` published. `search()`
  now publishes it via `items.at()`, so click, keyboard, and Ctrl+A on a
  filtered list name the rendered ids.

- `createVList`'s JSDoc says why an explicit item type argument returns a list
  with no plugin methods, and what to do instead. The caveat lived only in a type
  test, while `createVList<Row>(…)` is the first thing a `VListItem` constraint
  error suggests — and it compiles.

- `carousel()` over `data()` is a carousel again. It read the item count once in
  `setup()`, where an adapter's total is still 0, so the virtual window — the
  modulo accessor, the inflated total, the wrapping scroll — was never installed
  and the list rendered flat: `prev()` on the first item did nothing. The window
  is now installed when the total first becomes known and composes with the
  accessor `data()` put in place, and `getItemAt` reads the loaded item rather
  than the raw array an adapter leaves empty.

- `groups()` with `grid()` or `masonry()` no longer depends on plugin array order.
  Both layout plugins sat at priority 10 with groups, so setup was the order the
  caller wrote. Groups resolved `getGridLayout` / `getMasonryLayout` in `setup()`;
  listed first it never saw them, the layout plugin then overwrote render and the
  size cache, and every group header vanished with no error. Groups is now
  priority 11 — after the layout plugins — so it wraps the size cache and takes
  over render in either order. `test/integration/groups-layout-order.test.ts`
  builds both orders for grid and for masonry and asserts identical header and
  row counts.

- A production browser bundle no longer logs plugin `setup()` failures. The guard
  treated a missing `process` as development (`typeof process === "undefined" ||
  NODE_ENV !== "production"`), and the shipped builds never defined `NODE_ENV` —
  only the size-measurement builds did — so the first disjunct was always true in
  a browser and the built library logged in production. The guard now matches the
  emitter (`process.env.NODE_ENV !== "production"`) and the dist builds define
  `NODE_ENV`, so the log is dropped from a production bundle.

- `bun run size` fails when a scenario fails to compile, and budgets every
  published plugin size rather than only the base. A failed `Bun.build`
  used to be logged and skipped, so a broken Base scenario dropped out of
  `results` and the 9.9 KB check never ran. The other twenty-two rows were
  measured and printed with no ceiling, so a plugin that doubled still
  exited 0. Each row now has a gzip budget; a compile failure or an oversize
  plugin fails the command.

- `bun run release` can cut 3.0.0 from `next`. It refused any branch but `staging`,
  which is the frozen 2.x line, and its version split misread a prerelease: from
  `3.0.0-next.N` the default bump gave `3.0.NaN`, and `minor` and `major` gave
  `3.1.0` and `4.0.0`. The source branch is now derived from the version being
  released (`next` for 3.x, `staging` for 2.x) and `--from` confirms it. A
  prerelease is never bumped — its stable release is named, `bun run release
  3.0.0` — and a version not above the current one is refused before anything is
  written.

- `carousel()` and `sortable()` no longer declare a conflict with `scale`, a plugin 3.0 removed. Carousel's only conflict was that one, so it now declares none; sortable keeps grid, masonry, table and tree. Two tests asserted the stale conflicts and had outlived the plugin as well.

- Refresh both READMEs' size tables from a measured run. Every row was stale — the base had moved from 9,514 to 9,688 bytes across the 3.0 merges while the tables still read 9.3 KB.

- 88 file headers across `src/`, `test/` and `scripts/` still said "vlist v2", and CONTRIBUTING.md documented a source tree that no longer exists: the deleted `async/` and `scale/` plugin folders, `core/data.ts` and `core/range.ts`, and `test/builder/` and `test/features/`, which never existed. The a11y, carousel, data, search and tree plugins were missing from it entirely.

- Keep a reverse-mode list pinned to the end when `appendItems` adds to it, which the README has always documented and core never did: `reverse` reached the plugins but core itself never read it, so a chat view held its pixel position while messages piled up below the fold. A list scrolled back through history stays where it is. The README now states what `reverse` does and does not do — it does not reverse the layout — and that `masonry()` and `table()` reject it.

- Drop the `interactive` row from the README's config table. No version of vlist has ever read that option; keyboard navigation comes from `a11y()` or a selection mode.

- Pass the `groups` config through to the plugin from `vlist/config`. The documented `groups.header` shape was dropped on the way, so those configs threw "header.template is required", and a function `headerHeight` was called once with `("", 0)`: every group got the first group's height.

- Correct the accessibility claims in both READMEs. Keyboard navigation and the listbox roles come from `a11y()` or a selection mode, not from every list, and the display-only note pointed at `interactive: false` — a config option no version has ever read.

- Compute `createStats` item counts and progress from unscaled logical positions. Large synthetic lists no longer reach 100% prematurely through the removed scale-compression ratio; native browser-limited positions stay relative to the full declared range.

- Recompute the sortable drop position when a mouse or touch drag returns from edge auto-scroll, so dropping without another pointer move reorders instead of cancelling.

- Correct horizontal sortable drop coordinates that counted native scrolling twice, and position sortable item shifts relative to the renderer origin for synthetic input.

- Keep pending carousel navigation targets in the folded coordinate space, so repeated next/previous calls do not animate through unintended laps before idle.

- Prevent native carousel wrap folds from spiking public scroll velocity or suppressing a scroll event when the folded position equals the previous event position. Wheel folds now commit before emitting the frame.

## [3.0.0-next.2] - 2026-09-15

Prerelease of the revised 3.0 shape, published under the npm `next` dist-tag: native scrolling is the default of `vlist` and synthetic input is the opt-in `vlist/synthetic` entry. Supersedes the synthetic default of 3.0.0-next.1; `latest` stays on 2.8.

### Changed

- Restore native scrolling as the default in `vlist` and `vlist/config`. Synthetic scrolling is the opt-in `vlist/synthetic` entry; adapters select it with `factory`. This supersedes the synthetic default in `3.0.0-next.1`.
- Restore `"native"`/`"none"` scrollbar strings to default `ScrollConfig`. Synthetic rejects those strings, carousel, sortable and horizontal RTL, pointing to `vlist`. `scroll.mode` and `scroll.runway` remain removed in both entries; huge lists use `vlist/synthetic`.
- Carousel supplies its own private wrap handler, so its runway code is excluded from other bundles. The synthetic driver is excluded from the default and plugin scenarios.
- The native content-size warning stays with the default entry and points to `vlist/synthetic`. Base measures 9,523 bytes gzipped; synthetic measures 11,687 bytes.

### Deprecated

- `vlist/native` is now a compatibility alias of `vlist`, retained for `3.0.0-next.1` consumers. Import the default factory and standard config types from `vlist`. `vlist/synthetic` is a first-class opt-in entry and is no longer deprecated.

## [3.0.0-next.1] - 2026-09-15

Prerelease of 3.0, published under the npm `next` dist-tag; `latest` stays on 2.8.

### Added

- Support `page()` under the synthetic entry using native document scrolling, with an initial document-size guard and a one-time warning for later growth.

### Changed

- Synthetic scrolling is now the default in `vlist` and `vlist/config`. Import `createVList` from `vlist/native` for native scrolling, carousel, sortable, or horizontal RTL lists. Config consumers select that entry with `factory`.
- Remove `scroll.mode` and `scroll.runway` from both entries. Legacy values throw before DOM creation. Page scrolling continues to use the external source. Native carousel wrapping retains its private runway engine.
- Route page scrolling through the external-source seam and core scroll commits, honoring configured idle timing and synchronous rendering. `setScrollSource` replaces the removed `setScrollFns`.
- Deprecate `vlist/synthetic` as an alias of the default factory; it remains available in 3.0.

### Removed

- Remove `scale()` and its automatic config stub, plus deprecated `PluginContext.setScrollFns` and `disableDefaultScroll`. Use the default synthetic entry for huge lists and `setScrollSource` for external scrolling.
- Remove native scrollbar string values from core `ScrollConfig`; they remain available from `vlist/native` through `NativeScrollConfig` and `NativeCreateVListConfig`.

### Fixed

- The scrollbar plugin honours a numeric `width` and `radius` again, and a stylesheet's `--vlist-custom-scrollbar-width` and `--vlist-custom-scrollbar-radius` variables are no longer overridden by platform defaults.
- Carousel slots follow container resizes and keep the focal item; they previously stayed at their creation-time size.

### Internal

- Route grid, table, masonry and tree render coordinates through the scroll adapter, with renderer-owned origin guards and an enforced plugin boundary.
- Route transition, groups, carousel and sortable through the scroll adapter; commit native programmatic writes synchronously through the scroll source.
- Complete plugin scroll-adapter adoption for a11y, autosize, selection and snapshots; enforce the page-only scroll-source boundary.
- Isolate the runway handler, native event listeners and native content-size warning behind the native entry. Retain shared external-source commits, animation and the generic render-origin guards.
- Publish prereleases under the npm `next` dist-tag with a GitHub prerelease, and fail the publish job when the tag does not match `package.json`.
- Measure all 19 size scenarios and reject runway implementation leaks into the base bundle. Base size after removals is 11,670 bytes gzipped; optimization toward the 9.9 KB target is deferred.

## [2.8.1] - 2026-09-15

### Fixed

- Carousel slots follow container resizes and keep the focal item; they previously stayed at their creation-time size.

### Documentation

- Correct the 3.0 guidance in the 2.8 deprecation notices. Native scrolling stays the default in 3.0 and synthetic input stays opt-in through `vlist/synthetic`; `scroll.scrollbar: "native"` and `"none"` are no longer deprecated. `scroll.mode`, `scroll.runway`, `scale()`, `setScrollFns` and `disableDefaultScroll` are still removed in 3.0.

### Internal

- The publish workflow sends prerelease versions to the npm `next` dist-tag, creates GitHub prereleases, and fails when the tag does not match `package.json`.

## [2.8.0] - 2026-09-15

### Added

- Add autosize `remeasure(index?)`: manually re-measure one item after a content-size change, or invalidate every cached size for measurement as items render. It shares the automatic load/error pending queue.

- Add `VListConfig.factory` and the `VListFactory` type so framework adapters can select the `vlist/synthetic` factory without adding the driver to the default `vlist/config` bundle. Requesting synthetic mode without a factory reports the required import.

### Fixed

- Stop `vlist/config` and framework adapters from warning about the automatically installed `scale()` compatibility stub. Explicit `scale()` calls still warn once per process.

### Deprecated

- Deprecate `scroll.mode` and `scroll.runway` for 3.0: synthetic input becomes core's only model, bounded is removed, and native scrolling moves to `vlist/native`. Bounded remains supported without runtime warnings in 2.x.
- Deprecate the `"native"` and `"none"` values of `scroll.scrollbar` for 3.0 core; native scrollbar visibility moves to `vlist/native`. The `vlist/config` omission/options convenience remains supported through the scrollbar plugin.
- Announce removal of `PluginContext.setScrollFns` and `disableDefaultScroll` in 3.0 in favor of `setScrollSource`.
- Update the existing `scale()` deprecation to recommend the `vlist/synthetic` entry with synthetic mode, noting that bounded remains available in 2.x. In 3.0, `vlist/config` stops installing scale entirely.

## [2.7.2] - 2026-09-14

### Fixed

- **Tree in bounded mode wrote the full virtual height** — the tree renderer bypassed the bounded content sizing that grid, table and masonry use, so a large tree reintroduced the browser's 16.7M px limit. Content size now routes through the core; native mode unchanged.
- **`scale()` deprecation warning** linked to a page that did not exist; it now points at the RFC-012 page.

### Documentation

- Bounded mode on touch devices: long native flings outrun the runway and stall at its edge (measured 145-226% of a 16x runway on an iPhone SE and a Pixel 8a). Documented in the README with a pointer to synthetic mode for touch-heavy lists.

## [2.7.1] - 2026-09-14

### Fixed

- **Judder in grid, table, tree and masonry layouts in bounded and synthetic mode** — the same family as the 2.6.5 core fix. Grid, table and tree kept their own range-unchanged fast path without the `baseOffset` guard, so rows stood still between row boundaries on wheel and synthetic input (grid moved rows on 7 of 40 frames). Tree also never subtracted `baseOffset`, placing rows at absolute offsets past the first runway in bounded mode. Masonry kept grace-period items with stale transforms, which landed inside the viewport after a jump. All four now follow `baseOffset`; native mode unaffected.

## [2.7.0] - 2026-09-14

### Added

- **Opt-in synthetic scroll input ([RFC-014](https://github.com/floor/vlist/discussions/127))** — import `createVList` from `vlist/synthetic` and set `scroll.mode: "synthetic"` for logical touch, wheel and keyboard input. Measurement corrections preserve ongoing motion. Native remains the default; page, carousel and sortable combinations throw. The README documents the supported plugins, custom-scrollbar requirement and open accessibility gate, touch-boundary policy, wheel behavior and release latency.

- **Synthetic RTL policy** — RTL horizontal lists throw in synthetic mode in this release; use native mode. Vertical lists on RTL pages are supported. RTL support for the synthetic driver is planned as a non-breaking addition.

## [2.6.5] - 2026-09-14

### Fixed

- **Bounded mode judder on wheel** — the render pipeline's range-unchanged fast path skipped the DOM commit whenever the visible range was unchanged, but item transforms depend on `baseOffset`, which carries all the motion mid-list in bounded mode on wheel. Rows stood still until the range crossed a row boundary and then lurched 24-36 px, most visible during a trackpad's deceleration. Phase 2 now runs whenever `baseOffset` moved. Native mode is unaffected.

## [2.6.4] - 2026-09-13

### Fixed

- **Autosize clipped items whose content changed after measurement (#126)** — items were measured once, then unobserved and pinned to that height, so a broken or slow image, a font swap or lazy content grew past the pinned box and was clipped. `load` and `error` events from an item's descendants now re-observe the item; the new size replaces the old one and the scroll position is corrected by the real delta.

## [2.6.3] - 2026-09-07

### Changed

- **Publish workflow** — `npm publish` runs through the workflow's trusted-publisher identity instead of a stored token, which had broken the 2.6.2 publish. No library changes.

## [2.6.2] - 2026-09-07

### Fixed

- **`scrollToIndex` before the list has a length (#122)** — a `scrollToIndex` call made before an async list had received its total was silently dropped. The request is now held and honoured on the first render that has a total; only the last request is kept.

## [2.6.1] - 2026-07-15

### Fixed

- **Grid PageUp/PageDown snapped to the corner (#60)** — in grid mode, PageUp from an item in the first row (and PageDown from the last row) clamped focus to the absolute first/last item, duplicating Home/End behaviour. Page navigation now preserves the column at the top/bottom row (a no-op on a boundary row), in both the `selection` and `a11y` keyboard handlers.

## [2.6.0] - 2026-07-08

### Added

- **`vlist/config` subpath** — a framework-agnostic config layer for the framework adapters (and vanilla users who want it). Exports `VListConfig` (the high-level, declarative config shape), `resolvePlugins(config)` (the convenience-fields → plugin-array translation), and `createVListFromConfig(config)`. Centralises the translation that was previously duplicated across the React, Vue, Svelte, and Solid adapter repos. The main `vlist` entry and its bundle size are unchanged — the resolver is opt-in via the subpath.

### Fixed

- **Adapter config types out of sync (#119)** — `CreateVListConfig` re-declared inline `item`/`scroll` shapes that had drifted from the public `ItemConfig`/`ScrollConfig`, leaving adapter feature fields (`grid`, `selection`, `plugins`, …) untyped. `CreateVListConfig` now composes `ItemConfig`/`ScrollConfig`, and the RFC-012 `mode`/`runway` scroll options are exposed on the public `ScrollConfig`.
- **`scroll.scrollbar: "native"` via the config resolver** — now uses the browser's native scrollbar (skips the custom scrollbar plugin), matching core; previously any value other than `"none"` forced the custom overlay scrollbar.

## [2.5.1] - 2026-06-13

### Added

- **Carousel snap refinements** — direction-aware snapping, configurable snap easing, and snap enforced for the `full` variant.

### Fixed

- **Groups + bounded scroll** — the `groups()` plugin is now bounded-scroll aware: sticky headers and item transforms account for the runway origin (`baseOffset`), so grouped lists position correctly under `scroll: { mode: "bounded" }` (RFC-012).
- **Carousel `snapEasing`** — now forwarded to `smoothScrollTo` as the easing argument, so a custom snap easing is actually applied.
- **Carousel static variant** — repositions its items during smooth scroll instead of leaving them fixed.
- **Async data on idle** — the visible range now reconciles on scroll idle regardless of any pending range request, avoiding a stale window after fast scrolling.
- **Grouped tables** — publish data indices (not layout indices) to the data loader, so the correct rows are fetched in grouped table mode.

## [2.5.0] - 2026-06-09

### Added

- **Carousel stylesheet** (`vlist/styles/carousel`) — optional structural styles for carousel slides: media stabilization (no image "breathing" during transitions), overlay visibility driven by `--vlist-carousel-role-weight`, and text truncation. Uses `vlist-carousel-slide` BEM classes.
- **`--vlist-carousel-focal-width`** CSS variable — constant per preset, the focal slot's pixel width. Locks media to the focal size with centered absolute positioning for a parallax-like pan effect.
- **`--vlist-carousel-radius`** CSS variable — read by `vlist-carousel.css` to set slide border-radius.

### Fixed

- **`selectAll()` with async data** — previously only selected the ~25 loaded items. Now adds placeholder IDs for unloaded items, which are swapped for real IDs when data loads via `claimPlaceholderSelection`. Also applies to shift-click range selection across unloaded items.
- **`selectAll()` placeholder visibility** — unloaded placeholder DOM elements now show the selected class immediately (via `itemStateFn` placeholder ID check), eliminating the brief visual flash before data arrives.
- **Snapshot restore across selection modes** — `_seedSelection` now respects the selection mode. Switching from multiple (563 items selected) to single no longer visually restores the full multi-selection via snapshot.

## [2.4.2] - 2026-06-09

### Added

- **Modular carousel preset registry** — presets are now `SlotConfigResolver` functions stored in a named registry. `registerPreset(name, resolver)` lets users add or override presets at runtime. `getPreset(name)` and `resolvePreset(name, containerSize, peek)` expose the registry for lookup.
- **`SlotConfigResolver` type** — `(containerSize: number, peek: number) => SlotConfig | null`. The `variant` config now accepts a string name, a `SlotConfig` object, or a `SlotConfigResolver` function.
- **Extensible `CarouselVariant` type** — accepts any string via `(string & {})`, not just the built-in names. Custom registered presets get full type support.
- **Exported built-in preset functions** — `full`, `hero`, `heroCenter`, `multi`, `uncontained` are exported as named `SlotConfigResolver` functions for direct use or re-registration as aliases.

### Fixed

- **Carousel multi-aspect left alignment** — multi-aspect variable-width items now left-align per the MD3 uncontained spec instead of centering.
- **Carousel focal offset jump** — eliminated the gap/size discontinuity at the focal boundary by fading the gap proportionally with item size.

## [2.4.1] - 2026-06-07

### Fixed

- **Carousel trackpad scroll** — horizontal two-finger swipe on macOS now scrolls smoothly. The bounded handler was ignoring `deltaX`-dominant wheel events in wrap mode, forcing trackpad scrolling through the limited native runway.
- **Masonry keyboard navigation scroll** — arrowing past the viewport edge now scrolls to keep the focused item visible. The selection plugin skipped scroll-into-view when a custom `navigate` function was present (masonry), even though masonry relies on the selection plugin for scrolling.
- **Custom scrollbar not reaching the end with padding** — dragging the scrollbar thumb to the bottom now reaches the very last items when padding is configured. The scrollbar bounds were missing the main-axis padding, making the max scroll position fall short by `padding.top + padding.bottom` pixels.

## [2.4.0] - 2026-06-07

### Added

- **Bounded logical scroll model (RFC-012)** — opt-in mode `scroll: { mode: "bounded" }` sizes the content element to a viewport-relative runway and rebases a logical origin near the edges, supporting unbounded item counts without coordinate compression. Core grows +0.3 KB gzipped; large-list bundles shrink by ~3 KB vs the old `scale()` plugin.
- **Renderer routing for bounded scroll (RFC-013 Phase A)** — grid, table, and masonry renderers detect bounded mode and apply the base offset to item positions, keeping all layout plugins compatible with the logical scroll model.

### Changed

- **`carousel()` infinite loop now runs through the bounded scroll handler** — the plugin no longer manages its own rebasing or raw `scrollTop` writes; it requests a wrap-capable bounded handler (`ctx.setBoundedWrap`) that folds the logical position back toward the middle cycle by whole laps. Carousel shrank from +2.6 KB to +2.3 KB.

### Deprecated

- **`scale()` plugin** — importing `scale()` still works but logs a deprecation warning and does nothing. Migrate to `scroll: { mode: "bounded" }`. Will be removed in vlist 3.0.

### Removed

- **Compression internals** — deleted the dead legacy rendering/compression modules that the live `src/core/` engine had already superseded. These were reachable only via `vlist/internals`, never on the runtime path, so the main bundle is unaffected.
  - Removed `vlist/internals` exports: `createRenderer`, `createMeasuredSizeCache` (+ `MeasuredSizeCache`), `createViewportState` and the viewport range helpers (`simpleVisibleRange`, `calculateRenderRange`, `calculateTotalSize`, `calculateActualSize`, `calculateItemOffset`, `calculateScrollToIndex`, `clampScrollPosition`, `rangesEqual`, `isInRange`, `getRangeCount`, `diffRanges`), the scale re-exports (`getScaleState`, `getScale`, `needsScaling`, `getMaxItemsWithoutScaling`, `getScaleInfo`, `calculateScaledVisibleRange`, `calculateScaledRenderRange`, `calculateScaledItemPosition`, `calculateScaledScrollToIndex`, `calculateIndexFromScrollPosition`, `ScaleState`), `MAX_VIRTUAL_SIZE` (still exported from `vlist`/constants), and the scroll controller (`createScrollController`, `rafThrottle`, `isAtBottom`, `isAtTop`, `getScrollPercentage`, `isRangeVisible`, `ScrollController`).
  - Removed the `isCompressed`, `compressionRatio`, and `actualSize` fields from `ViewportState`, and `isCompressed` from the error event's viewport snapshot.

## [2.3.0] - 2026-06-05

### Added

- **`search()` plugin** (RFC-008 Phase 1) — a ready-to-use search bar that works with every layout (+3.2 KB gzipped)
  - **filter** mode (default): virtually hides non-matching items (non-destructive — clearing restores)
  - **navigate** mode: keeps all items, scrolls between matches, highlights the current one
  - `<mark>` match highlighting with scoped `highlight.within` selector; `state.search` exposed to templates
  - Keyboard: `Ctrl/Cmd+F` to focus, `Escape` to clear, `Enter`/`↑`/`↓` to navigate; invisible (`position: "none"`) type-ahead mode
  - Match counter, `role="search"` + `aria-live`, methods (`openSearch`/`closeSearch`/`setQuery`/`getQuery`/`nextMatch`/`prevMatch`/`getMatches`), events (`search:open`/`search:close`/`search:change`/`search:match`)
  - Field accessor (`field`), `caseSensitive`, `minLength`, `cancelTimeout` options; delegates to the tree plugin's ancestor-preserving filter when present
  - Stylesheet: `import "vlist/styles/search"`
- **`selection({ keyboard: false })`** — disable the plugin's own keyboard handler while keeping click-selection and the selection model active (for outer hotkey layers)

### Fixed

- **Selection click toggle in single mode** — clicking a selected item no longer deselects it; `doSelect` replaces `doToggle` for single-mode bare clicks
- **Tree + selection click consistency** — tree plugin registers `_getLoadedItem` so selection resolves items from the flat layout; `_focusById` now sets `focusVisible` for proper `--focused` CSS class; tree delegates focus/select to selection on every click (not only `domRebuilt`)
- **Search highlight on keystroke** — `highlightElement` clears stale `<mark>` tags before re-highlighting; fixes partial/broken highlights when the pooled element's innerHTML isn't refreshed by `forceRender`
- **Scale keyboard navigation** — new `_scrollItemIntoView` method uses `calculateCompressedItemPosition` for actual rendered-position checks; `scrollToIndexFn` uses `sizeCache.getTotal()` (row count in grid mode) instead of `engineState.totalItems`
- **Scale + padding** — `getMaxScroll` and scrollbar bounds include `mainAxisPadding * ratio`; scroll-into-view uses `startPadding`/`endPadding` individually; grid row gap subtracted via `_getRowGap`
- **Grid `sizeCache.rebuild` hook** — `installRebuildHook` detects an already-hooked rebuild via `currentHook` guard, preventing infinite recursion on `updateGrid`; uses the mutable `columns` variable instead of the stale initial config
- **Groups `sizeCache.rebuild` hook** — the hook now survives `setSizeConfig` via `_setSizeCacheBase`: the core preserves the hook after `Object.assign` and updates the delegate to the new cache's internal rebuild
- **Groups + masonry keyboard nav** — masonry `navigate()` converts between layout and data index spaces; groups exposes `_getItemLane`/`_getItemY`/`_getItemH` for lane-aware navigation; lane index built lazily after groups computes positions
- **Groups horizontal inline headers** — first group header hidden in horizontal mode when sticky header is active (redundant label)
- **Groups masonry scroll-into-view** — uses `pos.h` from `gridItemPositions` instead of sizeCache fallback; accounts for `startPadding`
- **Groups + table + data** — flaky concurrent test improved with `beforeEach` prototype re-install

## [2.2.0] - 2026-06-02

### Added

- **Table `fillWidth`** — make rows span the full container width when columns don't (`table({ fillWidth })`), default `"spacer"`
  - `"spacer"` (default) — keep every column's exact width and extend rows with empty trailing space, so column widths stay meaningful while backgrounds, row borders, and striping still reach the edge
  - `"stretch"` (or `true`) — grow columns proportionally to their current width (respecting `maxWidth`)
  - `false` — opt out: rows are exactly as wide as the sum of the columns
  - A no-op once columns overflow the container; recomputed on container resize and column-preset changes; `"spacer"` re-absorbs slack after a manual column resize
  - Exposes the `TableFillMode` type
- **Data `loadInitial()`** — load page 1 deterministically regardless of container dimensions (`loadVisibleRange` stays a no-op until the viewport is measured)
- **Data `onResize` hook** — loads the visible range when the container first gains dimensions

### Changed

- **Snapshots `restoreScroll()`** now returns `Promise<void>` that resolves once the visible data has loaded, so callers can `await` the full restore instead of relying on fire-and-forget rAF

### Fixed

- **Click resolution with groups** — `resolveClickedItem` maps the layout index to the data index when the groups plugin is active, fixing clicks resolving to the wrong item past a group header
- **Table placeholder cells** — cells whose template returns an empty string (or whose default accessor has no value yet) no longer render as solid full-width boxes; the renderer injects a `.vlist-table-cell-skeleton` bar so every placeholder cell shows a clean loading skeleton
- **Data reload no longer empties the list** — `reload()` (e.g. on a server-side sort/filter) keeps the last-known total so the list shows placeholders for the full range while reloading, instead of collapsing to an empty list when the refetch is slow or fails
- **Data auto-retry on failed loads** — failed chunk loads now retry the visible range with exponential backoff (2s→30s), replacing placeholders automatically once the network recovers; a `window` `online` event resets the backoff and retries immediately. No longer dependent solely on the `online` event (covers server errors, timeouts, and blocked requests)
- **Sticky group header during all-placeholder reloads** — when a reload (e.g. a server-side sort) leaves the visible range as placeholders, an enabled sticky header now stays displayed but empty instead of leaving a blank band; it fills in with the group label on recovery without a layout shift. The data plugin also rebuilds the size cache on loaded-count change (not just total change), so the grouped layout recomputes correctly after a reload that preserves the total

## [2.1.2] - 2026-06-02

### Added

- **Groups + Masonry integration** — groups plugin renders masonry items with shortest-lane placement
  - Per-item heights from the raw size spec with column-width context (true masonry, not uniform rows)
  - Lane reset at group boundaries
  - Sticky group header support in masonry mode

### Performance

- **Grid hot-path** — eliminated per-frame allocations and redundant work in the render loop: hoisted class strings, cached column width/gap, reused the item-range object, and inlined row/column math
- **Groups masonry content size** — O(1) lookup via precomputed per-group lane bottoms instead of a backward lane scan

### Fixed

- **Groups grid/masonry scroll-to-last** — `scrollToIndex` uses grid-aware offsets and content size; masonry `align: end` now reaches the true content bottom
- **Horizontal sticky group header** — renders as a full-height bar beside the content instead of a collapsed strip overlapping the first column; rotated labels are anchored to the top to match the sticky overlay

## [2.1.1] - 2026-06-01

### Added

- **Groups + Table + Data integration** — groups plugin works natively with table and async data plugins
  - `setGetItemFn` deferred via microtask for correct plugin ordering
  - `sizeCache.rebuild` interceptor with loaded-count guard for snapshots restore race
  - Sticky headers in table mode
- **Groups + Grid integration** — groups plugin renders grid items with correct column layout
  - Binary search on sorted position array for O(log n) visible range lookup
  - Grid-aware header positioning (full width, correct Y offsets)
  - Sticky header uses grid-aware offsets for correct group transitions
  - Padding support (crossAxisPadding, mainAxisPadding, startPadding)
  - Resize handling: rebuilds grid positions on container width change
- **Data plugin `_getItem` method** — returns placeholder objects for unloaded items (vs `_getLoadedItem` which returns undefined)

### Fixed

- **Selection with groups** — all item lookups use `getDataItemAtLayout` which resolves by data index via `getItems()[di]` or `_getLoadedItem(di)`, consistent across table, grid, and list modes
- **Keyboard navigation in table mode** — keydown listener moved from `dom.content` to `dom.root`; selection click handler focuses correct element when content has no tabindex
- **Smooth scroll idle** — `scheduleIdle()` called on final animation frame so data plugin loads visible range after scrollToIndex with smooth behavior
- **Snapshots `_suppressSave`** — removed permanently-blocking flag that prevented all saves after restore with `dataIndex`; pixel-perfect scroll restore via raw `scrollTop` when data total matches
- **Placeholders in table+groups+data** — groups' table-mode `getItemFn` uses `_getItem` (includes placeholders) instead of `_getLoadedItem` (returns undefined)
- **Groups grid content size** — includes `mainAxisPadding` for correct bottom padding
- **Groups scroll-into-view** — uses grid-aware Y positions with padding for keyboard navigation

## [2.1.0] - 2026-05-30

### Added

- **Tree plugin** — virtualized collapsible tree view with WAI-ARIA treeview keyboard navigation (`tree()`)
  - Nested children and flat `parentId` data modes
  - Expand/collapse with preserved state, async `loadChildren` for lazy loading
  - Keyboard: ArrowRight/Left expand/collapse, `*` expand siblings, type-ahead search
  - ARIA: `role="tree"`, `aria-level`, `aria-expanded`, `aria-setsize`/`aria-posinset`
  - Data mutations: `addChild`, `removeNode`, `moveNode` with cycle detection
  - Scale plugin compression support
  - `connectorLines` option with Zed-style indent guides via `vlist-tree.css`
  - `paddingStart` config for base indent
  - `isLastChild` on FlatNode and TreeState
- **`vlist-tree.css`** — opt-in stylesheet for tree indent guides and connector lines
- **`./styles/tree`** export in package.json
- **`setGetIndexByIdFn`** on PluginContext — layout-replacing plugins can override `getIndexById`
- **`_isFollowFocus`** on selection plugin — cross-plugin query for `followFocus` state

### Fixed

- `getItemAt()` now uses `getItemFn` when set (was reading raw items array)
- `getIndexById()` now delegates to plugin override when set
- `resolveClickedItem` uses `getItemFn` for layout-replacing plugins (tree, groups, grid)

### Changed

- Renamed `src/plugins/async/` → `src/plugins/data/` to match public export name
- Renamed `scripts/check-coverage.ts` → `coverage.ts`, `scripts/measure-size.ts` → `size.ts`

## [2.0.5] - 2026-05-29

### Changed

- **Plugin-driven ARIA semantics** — removed `interactive` config option; ARIA roles are now set by `a11y()` or `selection()` plugins via `enableListboxRole()`. Default is `role="list"` / `role="listitem"`; plugins upgrade to `role="listbox"` / `role="option"` with full keyboard navigation

### Added

- **Focusable descendant neutralization** — automatically sets `tabindex="-1"` on `<a href>`, `<button>`, `<input>`, `<select>`, `<textarea>`, and `[tabindex]` inside rendered items, following the WAI-ARIA composite widget pattern

### Fixed

- **Grid/masonry padding** — `padding` config now correctly offsets item positions and reduces column widths in grid and masonry layouts; previously padding was ignored for 2D layout plugins

## [2.0.4] - 2026-05-28

### Added

- **Grid + Scale compression** — grid plugin supports scale plugin compression for 1M+ item grids with compressed range calculation, viewport-relative positioning, and virtual-space smooth scrolling
- **Table + Scale compression** — table plugin supports scale plugin compression for 1M+ row tables with compressed range calculation and viewport-relative row positioning

### Fixed

- **Table item identity** — track items by reference instead of `item.id`, preventing stale renders when items share ids across updates (#91)
- **Render pipeline ordering** — release stale elements after appending new ones, preventing transient blank frames during synchronous renders; table plugin syncs `engineState.totalSize` for correct scrollbar bounds

### Performance

- **Contiguous release fast path** — batch element release when items are contiguous in the release queue, reducing DOM operations during range shifts (RFC-006)

### Refactored

- **Table render pipeline** — align with core pipeline: release-after-create ordering, removed redundant `scrollPos === lastScrollPosition` bail-out and 4 associated state variables

## [2.0.3] - 2026-05-28

### Fixed

- **Grid/masonry item identity** — track items by reference instead of `item.id`, preventing stale renders when items share ids across updates
- **Pipeline multi-instance safety** — removed module-scope release state that could corrupt element recycling when two vlist instances share a frame
- **Autosize scroll anchor** — use `sizeCache.indexAtOffset(scrollPosition)` for true first-visible index instead of `startIndex` which includes overscan, fixing over-compensation during measurements
- **Autosize scroll-to-end with measured items** — `smoothScrollTo` now accepts a dynamic target function re-evaluated each animation frame, so smooth scroll tracks the real maxScroll as ResizeObserver measurements change content size. End-pinning snaps via the ResizeObserver callback instead of onIdle, eliminating the 100ms-delayed chop

### Refactored

- **Removed dead `setVisibleRangeFn`** — no-op stub with no callers removed from PluginContext, types, and exports

## [2.0.2] - 2026-05-28

### Fixed

- **Scrollbar thumb in masonry/horizontal mode** — scrollbar plugin was reading `sizeCache.getTotalSize()` (flat-list total) instead of the layout-computed total, causing the thumb to stop short of the end in masonry horizontal layouts
- **Scroll direction labels for horizontal lists** — horizontal lists now correctly emit `direction: "left" | "right"` instead of `"up" | "down"` in scroll events
- **Snapshots totalSize sync** — `restoreScroll` now syncs `state.totalSize` during bootstrap, preventing stale scroll bounds after restore
- **Snapshots destroy safety** — prevent `TypeError` when list is destroyed during a pending save timer
- **TypeScript declarations** — build now emits `.d.ts` files in the published package

### Refactored

- **Axis-based internal model (RFC-005)** — replaced `horizontal: boolean` on `ResolvedConfig` with `AxisConfig { primary: 'x' | 'y', cross?: 'x' | 'y' }`. All internal code uses `config.axis.primary === "x"` (aliased as `isX`) instead of `horizontal`. New `hasCrossAxis` field replaces the implicit grid detection. `Axis` and `AxisConfig` types are now exported.

### Tests

- Axis-config resolution tests: vertical, horizontal, vertical grid, horizontal grid
- Scrollbar `engineState.totalSize` tests: bounds from engine state, bounds update on change, resize
- Horizontal scroll direction label test
- Coverage threshold tests for masonry, page, selection plugins

## [2.0.0] - 2026-05-27

### Added

- **Scrollbar touch support** — thumb drag and track tap via touch events, enabling scrollbar interaction on touch devices
- **Selection internal methods** — `_getFocusedId`, `_focusById`, `_seedSelection` for cross-plugin coordination (snapshots, sortable)

### Fixed

- **Groups ARIA attributes** — grouped items now receive `id`, `aria-posinset`, and `aria-setsize` when `interactive` is enabled, fixing broken `aria-activedescendant` references
- **Snapshots v1→v2 migration** — aligned auto-save bootstrap, compression mode restore, and `focusedId` save/restore with v1 behavior
- **`scroll.scrollbar` and `scroll.gutter` config** — CSS classes (`vlist-viewport--no-scrollbar`, `vlist-viewport--gutter-stable`) now wired in `createVList`
- **Sortable drag cursor** — force `grabbing` cursor on all descendants during drag, preventing open-hand flicker over handles (fixes #46)
- **Grid async data** — per-item accessor for async data compatibility, in-memory item tracking, deduplicated template apply

### Refactored

- **Grid plugin** — in-memory item tracking and deduplicated template application
- **`async` → `data` plugin rename** — `async()` is a JS reserved word; exported function renamed to `data()`, type renamed to `DataPluginConfig`

### Tests

- Groups plugin coverage: 66% → 87% lines (registered methods, scrollToIndex, horizontal mode, render lifecycle, selection state, placeholder transitions, async boundaries)
- Engine state coverage: 61% → 100% (resizeCapacity, clear)
- Selection internal methods: 6 new tests for `_seedSelection`, `_getFocusedId`, `_focusById`
- Grid async rendering, placeholder transitions, dimension tests
- Concurrent test isolation fixes

## [2.0.0-rc.3] - 2026-05-27

### Added

- **`item:dblclick` and `item:contextmenu` events** — delegated double-click and right-click events on items, matching the existing `item:click` pattern
- **16M content size warning** — emits an `error` event when total content size exceeds the browser's max virtual scroll limit, suggesting the `scale()` plugin
- **ARIA live region announcements** — a11y plugin announces focus changes ("Item 3 of 100") and selection state ("Selected", "Deselected") via a screen-reader-only live region
- **`--scrolling` class on root** — added/removed on scroll start/idle for CSS-driven scroll state styling

### Fixed

- **Config validation** — `createVList` now validates item dimensions, estimated sizes, gap, and overscan at creation time with descriptive error messages
- **Template error handling** — template render errors are caught and emitted as `error` events instead of crashing the render loop
- **Plugin setup resilience** — plugin `setup()` errors are caught and emitted as `error` events, preventing one broken plugin from blocking others
- **Destroy resilience** — `destroy()` continues cleanup even if individual teardown steps throw

### Tests

- **Test-driven hardening** — 13-phase systematic recovery adding ~590 tests (2,633 → 3,223), fixing 29 failing tests, and raising line coverage from 94.30% to 95.99%. Covers core boundary conditions, data ops edge cases, error recovery, plugin integration combos, 2D keyboard navigation, async lifecycle, memory leak detection, and performance benchmarks.

## [2.0.0-rc.2] - 2026-05-26

### Performance

- **Optimized initial render path** — batch DOM insertions via DocumentFragment, `cloneNode(false)` from pre-built template in element pool, defer ResizeObserver and scroll listeners until after first paint, skip plugin sort/conflict check when no plugins used
- **Build: switched from tsc transpile to Bun.build bundle** — 15x faster dev builds (1200ms → 78ms), same output
- **async: maxConcurrent request limiting** — configurable cap on in-flight chunk requests (default: 6) with zero-allocation distance-based eviction of furthest loads
- **async: split onDataChange/onStateChange notifications** — loading-state-only changes no longer trigger the expensive sizeCache rebuild pipeline
- **async: chunk-range dedup in onAfterScroll** — skip redundant `ensureRange()` calls when scroll hasn't crossed a chunk boundary
- **async: in-place findIndex+splice** — replace `.filter()` allocation with single `findIndex` + `splice` for pendingRanges cleanup
- **groups: detached map reuse on boundary changes** — elements are saved by data-id instead of released to pool (which clears innerHTML), then reclaimed in the next render pass. Eliminates image blink on scroll stop.
- **groups: data-id fast path in renderItemContent** — skip template rendering and all DOM writes when element already shows the correct item
- **groups: zero-write scroll frames** — transform/size writes moved to new-element path only (stable per layout index), no `getEntry()` call for existing unchanged elements
- **groups: DocumentFragment batching** — single DOM insertion for all new elements per render pass
- **groups: removed dead `vlist-groups-item` class** — eliminated redundant className and attribute writes

### Added

- Normalized benchmark workflow with tiered item counts (10K, 100K, 1M) and intensity modes

### Fixed

- **async: ensureRange early-return correctness** — when no new chunks are needed but loads are in-flight, await `Promise.all(loadPromises)` instead of returning immediately

## [2.0.0-rc.1] - 2026-05-23

### Performance

- **Precomputed render configuration** — extract stable per-frame string computations (class names, translate prefix, cross-axis properties) into a `RenderConfig` object created once during setup. Eliminates repeated string concatenation on every scroll frame. `phase2Commit()` simplified from 17 parameters to 10.

### Refactored

- Removed unused `range.ts` (`calcVisibleRange` / `applyOverscan` — dead code that also violated hot-path allocation rules)
- Removed unused `data.ts` (`createSimpleDataManager` — 245 lines never imported by core or plugins)
- Fixed stale v1 comments and documentation drift across core modules

## [2.0.0-beta.1] - 2026-05-19

### Changed

- **BREAKING: Plugin architecture** — replaced builder pattern (`vlist(config).use(withX()).build()`) with factory function (`createVList(config, [plugins])`). Plugins are passed as the second argument to `createVList()` and the instance is created immediately — no more `.build()` call.
- **BREAKING: Plugin renames** — all `withX()` plugin functions renamed to bare names: `withGrid` → `grid`, `withSelection` → `selection`, `withScrollbar` → `scrollbar`, `withScale` → `scale`, `withPage` → `page`, `withSnapshots` → `snapshots`, `withTransition` → `transition`, `withAutoSize` → `autosize`, `withTable` → `table`, `withGroups` → `groups`, `withAsync` → `async`, `withMasonry` → `masonry`, `withSortable` → `sortable`.
- **BREAKING: Plugin interface** — `VListFeature` replaced by `VListPlugin`. New interface: `name`, `priority?`, `conflicts?`, `setup(ctx: PluginContext)`, `hooks?: { onCalculate, onCommit, onAfterScroll, onIdle, onResize }`, `destroy?()`. Features no longer use callback arrays — hot-path hooks are compiled into linear arrays at creation time.
- **BREAKING: Context interface** — `BuilderContext` replaced by `PluginContext`. Features register handlers via `registerClickHandler()`, `registerKeydownHandler()`, `registerDestroyHandler()`, and add public methods via `registerMethod()`. The `$` (MRefs) shared mutable state is replaced by `EngineState` TypedArrays.
- **BREAKING: Directory structure** — `src/builder/` → `src/core/`, `src/features/` → `src/plugins/`.
- **BREAKING: DOM structure** — the `.vlist-items` wrapper element is removed. v2 uses a 3-element structure: `root > viewport > content`.
- **Core: 2-phase pipeline** — new render pipeline: Phase 1 (`onCalculate`) fills TypedArrays with visible range and positions, Phase 2 (`onCommit`) reads buffers and updates DOM. Zero allocation per frame.
- **Core: EngineState** — all hot-path state (`visibleIndices`, `visibleOffsets`, `visibleSizes`, `visibleCount`, `scrollPosition`, `containerSize`) lives in TypedArrays on a single `EngineState` singleton.
- **Core: Hook compilation** — plugin hooks are compiled once at creation into frozen linear arrays, iterated with zero dispatch overhead per frame.

### Improved

- **Base bundle** — 11.2 KB → 5.0 KB gzipped (-55%).
- **grid** — 4.1 KB → 1.7 KB (-59%).
- **selection** — 2.7 KB → 1.2 KB (-56%).
- **async** — 4.6 KB → 3.9 KB (-15%).
- **groups** — 4.7 KB → 2.5 KB (-47%).
- **scale** — 3.6 KB → 3.4 KB (-6%).
- **autosize** — 0.9 KB → 0.6 KB (-33%).
- **masonry** — 3.4 KB → 2.9 KB (-15%).
- **sortable** — 2.9 KB → 3.0 KB (+3%, added features).
- **transition** — 2.1 KB → 1.9 KB (-10%).
- **scrollbar** — unchanged at 1.8 KB.
- **table** — unchanged at 5.8 KB.
- **page** — unchanged at 0.7 KB.
- **snapshots** — unchanged at 1.2 KB.

### Migration

See [docs/migration.md](docs/migration.md) for the full v1 → v2 migration guide.

## [1.9.0] - 2026-05-17

### Added

- **transition**: New `withTransition()` feature — FLIP-based enter/exit animations for `insertItem`, `removeItem`, and `removeItems`. Removed items collapse via `scaleY(0)` with fade-out while siblings slide up; inserted items expand in while siblings slide down. Supports per-animation timing config, off-screen awareness, scroll clamp compensation, and CSS transition interference suppression.
- **transition**: Batch `removeItems(ids)` animates all deleted items simultaneously with overlapping FLIP animations — each clone shifts to account for removed siblings above it, and off-screen items below the viewport are pre-captured so they slide into view smoothly.
- **builder**: `removeItems(ids)` base API — falls back to per-item `removeItem` when transition feature is not active.

### Fixed

- **transition**: Suppress CSS `background-color` transition flash when DOM elements are recycled during `forceRender()` — uses `commitStyles()` pattern (transition:none, reflow, restore) to commit styles instantly.
- **transition**: Resolve data manager lazily in `scheduleEnsureRange` to avoid stale reference when `withAsync` replaces the data manager after setup.
- **transition**: Bypass stale base `removeItem`/`insertItem` references when data manager is replaced by `withAsync` or `withGroups`.
- **groups**: Add `insertAt` to async group bridge, wire `wrappedDataManager.insertItem` — fixes animated insert in grouped async mode.
- **groups**: Update bridge before async manager in `insertItem` to prevent data/layout index mismatch.
- **styles**: Suppress focus ring on `.vlist-items` container — focus indication belongs on individual items (`.vlist-item--focused`), not the listbox container.

## [1.8.3] - 2026-05-13

### Fixed

- **selection**: Use data manager `getIndexById` instead of internal `idToIndexMap` — the selection feature maintained its own index map with data-space indices, but `ctx.dataManager.getItem()` expects layout-space indices when `withGroups` wraps the data manager. This caused `selection:change` to emit group headers instead of real items, breaking forms, players, and detail panels.
- **selection**: Skip group headers in range selection and `selectAll` — `selectItemRange`, `selectAll()`, and Ctrl+A used `getAllLoadedItems()` which includes group header pseudo-items, leaking header IDs (e.g. `__group_header_0`) into the selected set and breaking the Ctrl+A select/deselect toggle.

## [1.8.2] - 2026-05-13

### Performance

- **builder**: Lazy-initialize the `idIndex` Map — only allocated on first `getIndexById` or string-based `removeItem` call. Lists that never use id-based lookups have zero Map overhead, fixing the memory regression introduced in 1.8.1 (0.55 MB → 0.06 MB after render).

## [1.8.1] - 2026-05-13

### Fixed

- **builder**: Default data proxy now implements `getIndexById` backed by an O(1) `Map<id, index>` — previously always returned `-1` in non-async mode because the call fell through to an unpopulated `SimpleDataManager`.
- **builder**: `removeItem` with a numeric id now resolves via the id index Map first, falling back to treating the number as a direct array index only if no matching id exists — prevents silent wrong-item deletion when items have numeric ids.

## [1.8.0] - 2026-05-13

### Added

- **table**: Keyboard support for header sort and resize — header cells are navigable with roving tabindex, Enter/Space triggers sort, Ctrl+Arrow resizes columns, Home/End jumps to first/last header, ArrowDown returns focus to grid body.

### Fixed

- **a11y**: Downgrade ARIA roles when `interactive: false` — use `role="list"` / `role="listitem"` instead of `role="listbox"` / `role="option"` so screen readers don't announce items as selectable options in display-only lists. `aria-setsize` and `aria-posinset` are preserved for positional context.

## [1.7.9] - 2026-05-13

### Fixed

- **a11y**: Align `aria-activedescendant` with ARIA role owner — move `tabindex="0"` from `.vlist` root to `.vlist-items` (the `role="listbox"` element) so the focused element and composite widget role are on the same DOM node. `withTable` reverses this when it promotes root to `role="grid"`.
- **a11y**: Unify table row ID format to `${ariaIdPrefix}-item-${index}`, matching selection's `aria-activedescendant` references — fixes broken ARIA in table + selection mode.
- **a11y**: Make visible range announcements opt-in via `accessibility.announceVisibleRange` (default: `false`). Range announcements were noisy during keyboard navigation and touchpad scrolling. Add configurable `accessibility.rangeAnnouncementDebounce` (default: 750ms).

## [1.7.8] - 2026-05-12

### Performance

- **builder**: Optimize base bundle from 11.2 KB to 10.7 KB — NODE_ENV ternaries for error messages, extract `applyItemAria()` to deduplicate ARIA code, inline `claimPlaceholderSelection`, remove lazy-resolve caching in a11y (direct Map.get is O(1)).
- **async**: Reduce async feature bundle by 0.5 KB — merge dual Maps into single tuple Map, extract shared closures, lazy `itemsLoadedCallbacks`, replace `Object.keys()` allocation with boolean flag.
- **groups**: Reduce groups feature bundle by 0.4 KB — share binary search from layout.ts, inline single-use `groupedSizeFn`, trim `bridgeAsLayout` adapter, remove passthrough methods.
- **selection**: Reduce selection feature bundle by 0.2 KB — mutate selected Set in place instead of cloning, unify focus movement into single `moveFocus(delta)`, inline 14 state functions as local closures.
- **scale**: Reduce scale feature bundle by 0.1 KB — cache DOM/state references, inline `calculateCompressedVisibleRange`/`ScrollToIndex`/`ItemPosition`, precompute translate direction string.
- **grid**: Reduce grid feature bundle by 0.1 KB — replace per-call `Set<number>` with integer in row-offset loop, inline `positionElement` wrapper, cache `getCol()` result.
- **masonry**: Reduce masonry feature bundle by 0.1 KB — inline `findShortestLane` into layout loop, fix `getVisibleItemsLinear` to reuse pool instead of allocating.
- **table**: Reduce table feature bundle by 0.1 KB — remove unused `resizeHandles` array, optional chaining, inline sort direction cycling.
- **scrollbar**: Reduce scrollbar feature bundle by 0.1 KB — extract `updateScrollbarBounds` helper, remove redundant null checks and classList guard.
- **sortable**: Reduce sortable feature bundle by 0.1 KB — cache DOM references, precompute class names, extract `setChildTransitions` helper.
- **page**: Reduce page feature bundle by 0.1 KB — cache `window` as local for minification, deduplicate scrollTo target calculation.
- **autosize**: Micro-optimize autosize — cache scrollController/viewportState references, inline temp variables.
- **snapshots**: Micro-optimize snapshots — add `restoreSelection` parameter to avoid object spread, simplify poll loop.

## [1.7.7] - 2026-05-11

### Fixed

- **scrollbar**: Fix `position:relative` on viewport that broke custom scrollbar positioning.
- **scrollbar**: Attach scrollbar DOM to root element instead of viewport to prevent clipping.
- **scrollbar**: Prevent duplicate scrollbar when used with `withScale`.
- **groups**: Skip group headers in PageUp/PageDown keyboard navigation.
- **groups**: Clear restore anchor after first scroll adjustment to prevent position reset on re-render.
- **groups**: Create sticky header container eagerly to prevent visual shift on data load.
- **selection**: Use prefix-sum offsets for compressed scroll-to-focus — fixes keyboard navigation off-by-one with mixed item sizes (group headers + data items).

## [1.7.6] - 2026-05-10

### Added

- **builder**: Prevent DOM flooding when container lacks height constraint.
- **groups**: Compressed scroll space support in sticky headers.

### Performance

- **async**: Eliminate O(n) hot-path bottlenecks in scroll pipeline — `loadRange()` uses direct chunk scan (O(range/chunkSize)) instead of scanning all cached chunks. Reduces per-frame cost from 28-35ms to <1ms on 892K-item lists.
- **async**: Skip redundant `sizeCache.rebuild()` when total hasn't changed — avoids O(n) prefix-sum recomputation on every `isLoading` toggle.
- **scale**: Eliminate double renders and per-frame object allocations — new `triggerScrollFrame()` API bypasses `scrollTo()` in animation loops, cached compression state removes 3+ allocations per frame.

### Fixed

- **groups**: Prevent scroll jump to top when scroll position lands on a group header during header-discovery adjustment.
- **groups**: `aria-setsize` and `aria-posinset` now use data-space values (exclude headers from count).
- **groups**: Use distinct CSS class (`-group-header`) and ARIA role for group header elements.
- **groups**: End key navigates to last item on async grouped lists.
- **groups**: Use sizeCache prefix sums for compressed visible range with mixed item sizes.
- **selection**: Skip group headers after `removeItem`.
- **snapshots**: Fix scroll drift on reload with compressed groups — restore anchor for grouped scroll position.
- **snapshots**: Suppress auto-save during restore and persist anchor across subsequent `onItemsLoaded` calls.
- **snapshots**: Bootstrap with `dataTotal` to prevent total inflation on restore.

## [1.7.5] - 2026-05-08

### Added

- **groups**: `withAsync` + `withGroups` compatibility — async group bridge discovers group boundaries incrementally as pages load, with virtual header insertion, layout/data index mapping, and sticky header support.
- **groups**: Lazy sticky header creation — defers DOM element creation until groups actually exist, avoiding empty elements in async mode.
- **groups**: `removeItem` support in async groups mode — shifts group keys and rebuilds boundaries after item removal.
- **selection**: `select()` now syncs `focusedIndex` so keyboard navigation (ArrowDown/Up) starts from the selected item.

### Fixed

- **groups**: Prevent stale `SizeCache` reference in sticky header after async data loads. Uses `rebuildSizeCache()` (mutates in place) instead of `setSizeConfig()` (creates new instance).
- **groups**: Fix sticky header position update after async data loads.
- **snapshots**: Fix scroll drift on restore with group headers — use offset-based save/restore when compression ratio=1.
- **snapshots**: Debounce auto-save with `requestAnimationFrame` to prevent rapid writes during scroll.

## [1.7.4] - 2026-05-02

### Added

- **snapshots**: Cross-mode scroll restore across layout changes (list ↔ grid ↔ table). Snapshots now include `dataIndex`, `dataTotal`, and `offsetRatio` fields that survive layout mode switches and group structure changes.
- **selection**: Configurable right-click behavior via `contextMenu` option (`'select'` | `'keep'` | `false`). Default `'select'` gives file-explorer semantics.
- **core**: Add `contextMenuHandlers` extension point for features to hook right-click events.

### Fixed

- **build**: Store raw byte counts in size.json for precise delta calculations.

## [1.7.3] - 2026-05-01

### Fixed

- **sortable**: Animate ghost back to origin on Escape cancel
- **sortable**: Smooth drop transition for drag source item
- **sortable**: Prevent neighbor item blink on drop
- **selection**: Seed selection state before first render on snapshot restore

## [1.7.2] - 2026-05-01

### Added

- **sortable**: Add ghostContainer config option with tests

### Changed

- **scrollbar**: Rename clickBehavior 'page' to 'scroll'

### Fixed

- **sortable**: Fix cursor, escape cancel, and drop-at-same-position during drag
- **build**: Preserve spaces around + and - in CSS minifier
- **scrollbar**: Show scrollbar immediately when autoHide is false

## [1.7.1] - 2026-04-30

### Changed

- **sortable**: Use O(log n) binary search in computeDropIndex

### Fixed

- **sortable**: Fix drop index oscillation on direction change
- **sortable**: Refactor drop index calculation and element recycling
- **sortable**: Clear text selection after drop (Safari)

## [1.7.0] - 2026-04-29

### Added

- **sortable**: Add sort:move event, preserve focus across pointer drag
- **sortable**: Add keyboard reordering and ARIA accessibility
- **sortable**: Add withSortable drag-and-drop reordering feature

### Changed

- **sortable**: Reduce bundle size -164 min / -25 gz
- **sortable**: Move ghost visual styles from inline JS to CSS
- **sortable**: Safe hot-path optimizations
- **sortable**: Remove placeholder mode, simplify to live reorder only

### Fixed

- **ci**: Add NPM_TOKEN to publish workflow
- **test**: Fix typecheck error in sortable focus preservation test
- **sortable**: Include keyboard grab in isSorting() return value
- **sortable**: Scroll back to original position on keyboard cancel
- **sortable**: Fix stale focus ring after keyboard cancel/drop
- **sortable**: Fix cancel restore and add sort:cancel event
- **sortable**: Prevent item blink on drop
- **sortable**: Clear shifts when pointer leaves viewport
- **sortable**: Disable shifts when pointer is outside viewport
- **sortable**: Improve edge scroll behavior
- **sortable**: Animate ghost to drop position on release
- **sortable**: Use ghost leading edge for shift threshold

## [1.6.5] - 2026-04-28

### Added

- **snapshots**: Restore focused item after scroll restore

### Changed

- **table**: Restore resize handle hover visibility
- **table**: Hide resize handle line on header hover

### Fixed

- **table**: Remove unused viewport param from createTableHeader
- **snapshots**: Save on focus:change in autoSave mode
- **snapshots**: Emit focus:change from _focusById to update live previews
- **snapshots**: Don't show focus ring until list receives DOM focus
- **snapshots**: Capture focus before focusout clears focusVisible
- **snapshots**: Restore focus for sync lists (no withAsync)
- **table**: Fix custom scrollbar invisible/doubled in table mode
- **snapshots**: RestoreScroll clips last items when withScale is active

## [1.6.4] - 2026-04-27

### Added

- **scrollbar**: Per-side padding support
- **scrollbar**: Make minThumbSize and hoverZoneWidth smarter
- **scrollbar**: Add padding and clickBehavior options
- **scrollbar**: Add padding option to inset track from viewport edges

### Fixed

- **scrollbar**: Use typeof !== 'object' to reliably narrow ScrollbarPadding in resolvePadding
- **scrollbar**: Correct JSDoc for clickBehavior and hoverZoneWidth; add padding-margin click tests
- **scrollbar**: Extend click target into padding margin
- **scrollbar**: Move ScrollbarPadding to src/types so index.ts export resolves
- **ci**: Escape commit message as JSON in staging dispatch payload

## [1.6.3] - 2026-04-26

### Added

- **scrollbar**: Add gutter option to reserve layout space for custom scrollbar
- **a11y**: Add focusOnClick option (#32)

### Changed

- **scrollbar**: Auto-radius — custom scrollbar thumb always pill-shaped
- **scrollbar**: Fix native scrollbar sizing and separate CSS token namespaces
- **styles**: Rename scrollbar CSS tokens and wire native scrollbar to variables

### Fixed

- **scrollbar**: Move gutter class to viewport, pad viewport not items
- **core**: Auto-size horizontal root height to prevent scrollbar cropping on Windows
- **page**: Remove stale targetScroll — use domScroll directly
- **a11y**: Skip scroll-into-view on mouse click (#23)

## [1.6.2] - 2026-04-24

### Added

- **async**: Forward response cursor to AdapterParams on sequential reads

### Fixed

- **page**: Use behavior:'instant' on all window.scrollTo calls
- **a11y**: Prevent erratic scroll on click in window mode (#23)
- **tests**: Add missing getVisibleRange mock to test context factories

## [1.6.1] - 2026-04-20

### Added

- **async**: Per-chunk AbortController, keepBuffer cancellation, signal in AdapterParams
- **grid/table**: Compression-aware visible range and fast path for compressed mode

## [1.6.0] - 2026-04-16

### Added

- Export ItemConfig, GridConfig, MasonryConfig, GroupsConfig, GroupHeaderConfig types

### Fixed

- **core**: Unify wheel handler, add boundary passthrough and sync rendering for horizontal mode

## [1.5.6] - 2026-04-15

### Changed

- **dev**: Cap duplicate ID check at 10K items to avoid O(n) cost on large datasets
- **memory**: Cap content height, reuse event payloads, reduce scroll-path allocations

## [1.5.4] - 2026-04-15

### Added

- **selection**: Implement ARIA multi-select keyboard model with configurable shiftArrowToggle

[Unreleased]: https://github.com/floor/vlist/compare/v2.0.4...HEAD
[2.0.4]: https://github.com/floor/vlist/compare/v2.0.3...v2.0.4
[2.0.3]: https://github.com/floor/vlist/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/floor/vlist/compare/v2.0.0...v2.0.2
[2.0.0-rc.3]: https://github.com/floor/vlist/compare/v2.0.0-rc.2...v2.0.0-rc.3
[2.0.0-rc.2]: https://github.com/floor/vlist/compare/v2.0.0-rc.1...v2.0.0-rc.2
[2.0.0-rc.1]: https://github.com/floor/vlist/compare/v2.0.0...v2.0.0-rc.1
[2.0.0]: https://github.com/floor/vlist/compare/v1.9.0...v2.0.0
[1.9.0]: https://github.com/floor/vlist/compare/v1.8.3...v1.9.0
[1.8.3]: https://github.com/floor/vlist/compare/v1.8.2...v1.8.3
[1.8.2]: https://github.com/floor/vlist/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/floor/vlist/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/floor/vlist/compare/v1.7.9...v1.8.0
[1.7.9]: https://github.com/floor/vlist/compare/v1.7.8...v1.7.9
[1.7.8]: https://github.com/floor/vlist/compare/v1.7.7...v1.7.8
[1.7.7]: https://github.com/floor/vlist/compare/v1.7.6...v1.7.7
[1.7.6]: https://github.com/floor/vlist/compare/v1.7.5...v1.7.6
[1.7.5]: https://github.com/floor/vlist/compare/v1.7.4...v1.7.5
[1.7.4]: https://github.com/floor/vlist/compare/v1.7.3...v1.7.4
[1.7.3]: https://github.com/floor/vlist/compare/v1.7.2...v1.7.3
[1.7.2]: https://github.com/floor/vlist/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/floor/vlist/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/floor/vlist/compare/v1.6.5...v1.7.0
[1.6.5]: https://github.com/floor/vlist/compare/v1.6.4...v1.6.5
[1.6.4]: https://github.com/floor/vlist/compare/v1.6.3...v1.6.4
[1.6.3]: https://github.com/floor/vlist/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/floor/vlist/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/floor/vlist/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/floor/vlist/compare/v1.5.6...v1.6.0
[1.5.6]: https://github.com/floor/vlist/compare/v1.5.4...v1.5.6
[1.5.4]: https://github.com/floor/vlist/compare/v1.5.3...v1.5.4
