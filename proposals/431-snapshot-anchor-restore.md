# Snapshot restore after item sizes change

Status: proposal — not implemented. Owner decision requested: keep the current pixel-first
restore policy, offer an opt-in anchor policy, or change the default. Recommendation:
**Option B, an opt-in policy in a minor release**. No release or public contract change is
approved by this document. Based on `next` at `c73cdef75cbd55d2b0d1861ca2b59b9e016e5f1f`
(3.3.1); the same basic reproduction was run against the `v3.3.0` source tag. This issue-less proposal is tracked by
[draft PR #431](https://github.com/floor/vlist/pull/431); its filename uses that PR number.

## 1. Problem

A saved snapshot contains both a row anchor and a raw pixel coordinate. When the item count
still matches, restore chooses the old pixels even if `remeasureItem()` changed the offsets
of that row. The row the person was reading moves away from the restored viewport.

Minimal reproduction on the base above, with 100 rows initially 40px and a 500px viewport:

```ts
import { createVList, snapshots } from "vlist";
const sizes: number[] = [];
const list = createVList({
  container: "#host",
  items: Array.from({ length: 100 }, (_, id) => ({ id })),
  item: { height: (i: number) => sizes[i] ?? 40, template: item => String(item.id) },
}, [snapshots()]);
list.scrollToIndex(20);
const saved = JSON.parse(JSON.stringify(list.getScrollSnapshot())); // scrollTop: 800
sizes[3] = 90;
list.remeasureItem(3);                        // current anchor is now at 850
list.scrollToIndex(0);
await list.restoreScroll(saved);             // restores 800, first visible index 18
```

The isolated probe quoted in section 3 observed exactly `corrected:850`, `restored:800`,
`restoredIndex:18` on both `next` and `v3.3.0`. The RED case is also retained as a TODO in
[PR #430](https://github.com/floor/vlist/pull/430),
`test/integration/remeasure-item.test.ts` ("an older snapshot follows its anchor after resizing").
That PR's patch fixes do not change snapshot restoration.

The cause is the precedence rule at `src/plugins/snapshots/plugin.ts:187-197`: either the
engine count or the data count matching is enough to choose `snapshot.scrollTop`. Equal
counts establish neither equal sizes nor equal group boundaries nor equal item identities.

## 2. What exists today

The public record is `ScrollSnapshot` at `src/types.ts:274-311`:

| Field | Current meaning and limitation |
| --- | --- |
| `index`, `offsetInItem` | Required ordinal and offset. `index` can be a layout index; it is not an item ID. |
| `dataIndex`, `dataTotal` | Optional data-space ordinal/count, used with layouts such as groups. Ordinals can shift after data insertion/removal. |
| `total` | Optional saved count. It does not identify a geometry revision. |
| `scrollTop` | Optional raw primary-axis pixel position; the name also applies to horizontal lists. |
| `offsetRatio` | Optional within-item fraction. The current resolver uses it whenever present, not only when a layout mode changed. |
| `selectedIds`, `focusedId` | Selection/focus state. `focusedId` is not necessarily the first visible item and cannot substitute for an anchor identity. |
| `scrollRatio` | Declared optional field; none of the probe's freshly captured records contained it. It must not be mistaken for an active compression factor. |

There is no saved anchor item ID, layout signature, size revision or format version in this
record. Capture reads through `scroll.getPixelEquivalent()` and the size cache
(`snapshots/plugin.ts:71-98`), translates grouped layout indices to data ordinals
(`:100-117`) and optionally saves focus (`:121-127`).

Restore currently translates a saved data ordinal into the active layout (`:168-180`),
computes the within-item offset (`:182-185`), then may discard that anchor-derived position
in favor of the raw pixels (`:193-196`). It clamps to the current scroll range (`:199-202`).
It can bootstrap an empty async total (`:140-153`), waits for a current visible-range load
and restores focus (`:211-263`). The built-in `autoSave` reads/writes **sessionStorage**
(`:27-34`, `:274-280`); application persistence in localStorage is a separate caller choice.
The probe explicitly round-tripped records through its own localStorage key.

The existing plugin options are only `restore` and `autoSave` (`:18-21`);
`restoreScroll(snapshot, restoreSelection?: boolean)` retains its boolean second argument
(`:42-46`). That boolean must not silently become an options object.

## 3. Evidence from runs

The complete single-file probe is embedded in Appendix A. Save that code as
`snapshot-anchor-probe.test.ts` in a clean checkout of the stated base, then run:

```text
bun test --max-concurrency=1 ./snapshot-anchor-probe.test.ts
9 pass
0 fail
14 expect() calls
Ran 9 tests across 1 file. [303.00ms]
```

These tests assert the observed **current** behavior, not the proposed behavior. They use
the actual core/plugins with happy-dom geometry stubs, no browser build or full-suite run.
All fixtures are disposed; tests owning the shared geometry/storage key are serial.
The larger probe uses sparse async data rather than allocating half a million item objects.

| Probe | Saved state | After change / desired ordinal position | Observed current restore |
| --- | --- | --- | --- |
| Plain vertical | index 20, raw 800 | Grow row 3 by 50: 850 | 800, first visible index 18 |
| Horizontal | index 20, raw 800 | Same width change: 850 | 800, first visible index 18; viewport.scrollTop stays 0 |
| Groups, ten data rows per group | layout index 23, dataIndex 20, raw 840 | Grow row 3 by 50: 890 | 840, layout index 21 / dataIndex 19 |
| Async placeholder | data ordinal 20, raw 800, placeholder=true | Grow row 3 by 50: 850 | 800, first visible index 18; visible-range load settles |
| Large synthetic list | index 450000, raw 18000000 | Grow row 3 by 50: 18000050 | 18000000, first visible index 449998; native viewport.scrollTop=0, content height="100%" |
| Recreate grouped list, groups of ten to groups of five, same 100 data items | dataIndex 20, raw 840 | Current position for data ordinal 20 is 880 | 840, dataIndex 19; equal data count overrides the translated anchor |
| Remove one item before the saved row | saved index 20 / ID 21 | ID 21 now has index 19 | ordinal 20 / ID 22, raw 800 |
| Remove the saved row | saved index 20 / ID 21 | ID 21 no longer exists | ordinal 20 / ID 22, raw 800 |
| Replace all items, keep count 100 | saved ID 21 | ID 21 no longer exists | ordinal 20 / ID 121, raw 800 |
| Shrink to ten items | saved index 20 | Saved ordinal is outside the new range | Clamped to 0 because the current content fits in the viewport |
| Resize the anchor itself, 40px to 80px | index 20, offsetInItem 10, offsetRatio 0.25, raw 810 | Pixel offset and fractional offset disagree | With raw: 810. Remove only scrollTop: 820 (ratio gives 20px within the row) |

Representative output, quoted directly:

```json
{"kind":"plain","saved":{"index":20,"offsetInItem":0,"total":100,"scrollTop":800,"offsetRatio":0},"placeholder":false,"corrected":850,"restored":800,"restoredIndex":18,"viewportPixel":800,"contentHeight":"4050px"}
{"kind":"regroup","saved":{"index":23,"offsetInItem":0,"total":100,"scrollTop":840,"offsetRatio":0,"dataIndex":20,"dataTotal":100},"currentAnchorPixel":880,"restored":840,"after":{"index":23,"offsetInItem":20,"total":100,"scrollTop":840,"offsetRatio":0.5,"dataIndex":19,"dataTotal":100}}
{"kind":"anchor-ratio","saved":{"index":20,"offsetInItem":10,"total":100,"scrollTop":810,"offsetRatio":0.25},"legacy":810,"anchorOnly":820}
```

The plain probe on an exported `v3.3.0` source tree produced the same first JSON line:
`1 pass`, `8 filtered out`, `0 fail`, exit 0. Comparing the declared ScrollSnapshot block
between that tag and this base returned `identical=True`; `git diff --quiet v3.3.0
origin/next -- src/plugins/snapshots/plugin.ts` exited 0. The unrelated comment change
elsewhere in `src/types.ts` does not change this record.

**The scale/compression terminology.** The current export probe printed
`{"kind":"exports","scaleExport":false}`. The large-list probe uses the existing
up-front `vlist/synthetic` entry (`src/synthetic.ts:1-25`), not a removed scale() plugin.
It demonstrates an 18-million-pixel public coordinate alongside zero native scrollTop and
viewport-sized content. This is model-level evidence; it is not a browser-cap test.
A restore policy must use the active adapter coordinate (`src/core/adapter.ts:155-189`),
without multiplying by a legacy compression ratio or reading native scrollTop directly.
The preferred public configuration's driver-loading path is outside this probe.

## 4. Options and version class

These are compatibility judgments, not release authorizations. The distinction between
compatible additions and changed existing behavior follows
[Semantic Versioning 2.0.0, sections 6-8](https://semver.org/#spec-item-6).

### Option A — anchor-first by default, raw pixels as fallback

Resolve a valid saved anchor before considering raw pixels, even when counts match. Prefer
`dataIndex` when it is available; translate it through the current layout, then apply the
within-item offset. Fall back to finite raw pixels when an anchor cannot be resolved, and
clamp the final position to the current scroll range. Keep async load/focus completion.

This fixes the unchanged-order remeasurement cases without requiring a new field. However,
“the anchor item still exists” has two different meanings:

- **Ordinal exists:** the saved ordinal is inside the current data range. Existing fields
  can establish this. The removal probes show it does not establish the same item ID.
- **Same item exists:** this needs a saved anchor identity plus a reliable lookup. A possible
  optional `anchorId: string | number` would change the public record type. Unloaded async
  data must distinguish “not loaded” from “removed”; a placeholder ID is not durable identity.
  The plugin context currently exposes an index-by-ID setter but no general reader
  (`src/core/types.ts:160-173`); the core public reader is at `src/core/create.ts:1213-1216`.
  Identity support therefore needs an implementation/ownership design, not just one JSON field.

**Version:** conservatively a **major** if it changes the supported existing default
pixel-first contract: the same valid old call and record can restore a different position.
It could be classified as a patch only after the owner explicitly determines that the old
behavior violates the intended public contract and accepts the compatibility consequences;
this proposal does not assume that decision. Ordinal-only A needs no public type change;
identity-aware A adds optional public metadata as well as the default behavior change.

**3.3.x saved records:** parseable with no conversion, but a default ordinal-first reader
can give those exact records different results (800 becomes 850). They cannot prove identity
after removals. A strict identity-only variant falling back to pixels for records without an
ID preserves old records but leaves their original remeasurement problem unresolved.

### Option B — opt-in anchor policy, current behavior by default (recommended)

Proposed shape, not implemented here:

```ts
snapshots({ restorePosition: "anchor" });
// New optional config field:
restorePosition?: "legacy" | "anchor"; // default: "legacy"
```

The setting applies to explicit `restoreScroll()` and creation-time `restore`/autoSave
restoration on that instance. The existing boolean `restoreSelection` argument is unchanged.
No new ScrollSnapshot field, required field, format version or serialized representation is
needed for an **ordinal** anchor policy.

- `legacy` runs today's precedence and offset rules unchanged.
- `anchor` prefers a valid data ordinal and current size-cache offset, then raw pixels as
  fallback. Validate the ordinal before layout conversion, rather than clamping an invalid
  saved ordinal and calling the resulting different row “the saved item.”
- For grouped snapshots, use `dataIndex` and `_dataToLayoutIndex`
  (`src/plugins/groups/plugin.ts:1018-1022`). If layout translation is active but a legacy
  record lacks dataIndex, the source index space is ambiguous; use the raw fallback rather
  than treating an unknown layout ordinal as data. Without a translator, index is the ordinal.
- Preserve the existing ratio-first within-item resolver for this first option: a finite
  offsetRatio uses the current item size; otherwise clamp a finite offsetInItem. The 810/820
  probe is an intentional difference in anchor mode and must be documented. This is not a
  promise to preserve a physical pixel inside an item whose own size changes.
- Invalid/missing anchor values may fall back to finite raw pixels in anchor mode. If neither
  is usable, or no items exist, settle as a no-op without writing NaN or adding a throw.
  Legacy validation must retain its existing outcomes.
- Do not infer item identity from focusedId, equal counts, or an in-range ordinal. This first
  version supports geometry changes while data order is stable. Insertion/removal/reordering
  does not follow an item ID. A durable identity extension is a separate owner decision.

**Version:** **minor**, because the optional configuration adds behavior without changing
calls that omit it. `SnapshotsPluginConfig` gains an optional field; `ScrollSnapshot` and the
restoreScroll method type need no change. No new error is proposed.

**3.3.x saved records:** the default path is unchanged. Opted-in instances can use old JSON's
existing index/offset/dataIndex fields, so old records gain ordinal restoration without a
migration. A caller deliberately opting in accepts the documented position difference.
Newly captured records keep the old shape and remain readable by 3.3.x. A raw-only or
otherwise incomplete untyped legacy record is still handled according to the selected
policy; it does not become a promise that current required fields never mattered.

### Option C — document current behavior and retain it

State plainly that equal counts prefer raw pixels, so restoring after sizes or group
boundaries change may show a different row. Explain that saving after remeasurement works,
and that an application can deliberately remove scrollTop to select today's anchor resolver.
That workaround still uses offsetRatio and still has no item-identity guarantee.

**Version:** documentation-only, suitable for a **patch** documentation update; no public
type, default, JSON format or runtime change. Persisted 3.3.x records behave as before.
The defect remains; the existing capture/restore anchor terminology needs qualification.

## 5. Recommendation and compatibility rules

Choose **B** for a minor release, keep legacy as the default, and describe anchor as an
**ordinal** position policy. It fixes the measured geometry cases using data already in
saved 3.3.x records and permits an explicit compatibility test for every existing restore.
Changing the default, adding durable identity, and choosing pixels instead of fractions
inside a resized item are separate decisions; none should ride an unannounced patch.

| Record/caller | Legacy default under B | Opted-in anchor under B |
| --- | --- | --- |
| Valid 3.3.x plain JSON with raw and anchor | Exact old result | Current ordinal offset; same-ratio within-item position |
| Valid grouped JSON with dataIndex | Exact old result | Translate data ordinal to active layout first |
| Grouped destination, legacy record without dataIndex | Exact old result | Raw fallback; index space cannot be established |
| No scrollTop but valid anchor | Exact old result | Current anchor resolver; no migration required |
| Saved ordinal now outside the data range | Exact old clamping policy | Raw fallback if usable, otherwise no-op |
| Same ordinal now contains another ID | Exact old result | Still that ordinal; no claim to follow the missing ID |
| Async placeholder at a valid ordinal | Exact old load/settle behavior | Address the data ordinal; do not use placeholder identity |
| Empty async destination with saved totals | Existing bootstrap | Bootstrap dataTotal/total, then resolve once data geometry is available |
| Empty non-async destination | Existing no-op | No phantom items; no-op |
| Horizontal or synthetic input | Existing adapter pixels | Same adapter; do not interpret scrollTop as vertical DOM pixels |

For async anchor mode, re-resolve the ordinal once the current visible-range load has
settled if loaded sizes differ. Do not fetch the entire dataset to find an ID or wait
indefinitely for every ResizeObserver measurement. Preserve selection/focus restoration
and promise completion. Later measurement corrections remain the size owner's concern.

## 6. Tests required before implementation approval

1. Enable the snapshot TODO from #430 under anchor mode; retain a separate legacy test
   asserting 800. Vertical, horizontal, groups and table-with-groups must use current offsets.
2. Round-trip actual 3.3.0/3.3.1 JSON through both manual restore and the autoSave path;
   assert legacy results and selection/focus behavior unchanged. Built-in sessionStorage
   and caller-managed localStorage need separate tests; no schema rewrite on read.
3. Recreate grouped lists with changed boundaries and the same data count. Verify translation,
   header pseudo-entries and the explicit fallback for a legacy record missing dataIndex.
4. Exercise unloaded placeholders, post-load size changes, empty-total bootstrap, rejected
   loads and disposal while restore is pending. Every promise must settle.
5. Repeat beyond the native range with the current synthetic adapter, and test both axes.
   Assert the saved coordinate is the logical pixel equivalent, not DOM scrollTop or a ratio.
6. Keep the 810-versus-820 within-item case explicit. Cover zero-size rows, fractional
   offsets, absent/invalid ratios, invalid indices and final-range clamping without NaN writes.
7. Remove items before/at/after the saved ordinal, reorder equal-count data and shrink past
   it. Assert the documented ordinal/fallback rule; do not claim identity preservation.
8. Type tests: optional restorePosition; existing boolean restoreSelection calls unchanged;
   old ScrollSnapshot object literals still compile. No additional required field or throw.
9. Tests own their list/container and clean up in finally; global-geometry/storage tests are
   serial. Run relevant files in both modes, typecheck, docs check and the exact-head CI gates.

## 7. Size cost estimate and decision boundary

This proposal changes **zero runtime bytes** and moves no budget. The bands below are design
estimates, not measurements; no proposed implementation has been bundled. The source-based
reasoning is the existing translation/offset/load machinery in section 2, plus the new
policy branch, validation and fallback in B. Implementation must measure rather than treat
an estimate as permission to move a pin.

| Option | Estimated gzip delta | Where it lands |
| --- | --- | --- |
| A, ordinal-only default change | -40 to +120 bytes | snapshots/full bundles: removes count-precedence work, adds validation/fallback |
| B, opt-in ordinal policy | +60 to +180 bytes | snapshots/full bundles only; keeps legacy branch, adds config policy and guards |
| C, documentation only | 0 | No runtime change |
| Durable identity extension | Not included in those bands; allow an additional 150-350 plugin bytes as an initial planning band | Needs a lookup/ownership design; any core-context plumbing would have a separate base cost and must be estimated after design |

A measured nearby anchor is #430's exact-head CI at `a575822`: snapshots scenario **11926
bytes gzip against 12032**, 106 bytes of room; base **10762 against 10844**. The same run's
selection bundle is exactly **14243 against 14243**. These are measurements of #430, not a
measurement of this proposal or of the current base. Source:
[Test & Build log](https://github.com/floor/vlist/actions/runs/41350633941/job/124979811695),
`✓ snapshots: 11926 bytes gzipped (budget 12032)`.

B's upper band can exceed that snapshots margin. Keep its implementation plugin-local so
plain lists and selection do not pay for it, measure with bun run size, and stop for the
coordinator if any row would exceed its budget. No dependency or budget increase is approved.
A default policy change or durable ID contract also returns to the owner before code lands.

## Appendix A. Reproducible current-behavior probe

This code is evidence, not a proposed runtime implementation. It is intentionally not added
to the permanent test suite: the proposal PR changes only this Markdown file. Extract to
the checkout root at the pinned base before using the command in section 3.

```ts
import { beforeAll, afterAll, expect, it } from "bun:test";
import { setupDOM, teardownDOM } from "./test/helpers/dom";
import { capturePrototypeGeometry } from "./test/helpers/geometry";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "./test/helpers/factory";
import { createVList as native } from "./src/core/create";
import { createVList as synthetic } from "./src/synthetic";
import { snapshots, type SnapshotsMethods } from "./src/plugins/snapshots/plugin";
import { groups } from "./src/plugins/groups/plugin";
import { data, type DataMethods } from "./src/plugins/data/plugin";
import type { VList, VListPlugin } from "./src/core/types";
import type { ScrollSnapshot } from "./src/types";
import * as publicAPI from "./src/index";

let geometry: ReturnType<typeof capturePrototypeGeometry>;
beforeAll(() => {
  setupDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 300 });
});
afterAll(() => { geometry.restore(); teardownDOM(); geometry.assertRestored(); });

type Kind = "plain" | "horizontal" | "groups" | "async" | "large-synthetic";
function fixture(kind: Kind, initialGroupEvery = 10) {
  const async = kind === "async" || kind === "large-synthetic";
  const total = kind === "large-synthetic" ? 500_100 : 100;
  const container = createContainer();
  const sizes: number[] = [];
  const groupEvery = initialGroupEvery;
  const size = (i: number) => sizes[i] ?? 40;
  const plugins: VListPlugin<TestItem>[] = [snapshots()];
  if (kind === "groups") plugins.push(groups({
    getGroupForIndex: i => String(Math.floor(i / groupEvery)),
    header: { height: 20, template: key => key },
  }));
  if (async) plugins.push(data<TestItem>({ total, autoLoad: false, adapter: {
    read: async ({ offset, limit }) => ({
      items: createTestItems(Math.min(limit, total - offset), offset + 1),
      total, hasMore: offset + limit < total,
    }),
  } }));
  const create = kind === "large-synthetic" ? synthetic : native;
  const list = create<TestItem>({
    container,
    ...(async ? {} : { items: createTestItems(total) }),
    orientation: kind === "horizontal" ? "horizontal" : "vertical",
    item: { height: size, width: size, template: simpleTemplate },
  }, plugins) as VList<TestItem> & SnapshotsMethods;
  if (async) (list as VList<TestItem> & SnapshotsMethods & DataMethods).setTotal(total);
  return {
    list, container, sizes,
    dispose() { list.destroy(); container.remove(); localStorage.removeItem("snapshot-proposal-probe"); },
  };
}
function persisted(snapshot: ScrollSnapshot): ScrollSnapshot {
  localStorage.setItem("snapshot-proposal-probe", JSON.stringify(snapshot));
  return JSON.parse(localStorage.getItem("snapshot-proposal-probe")!) as ScrollSnapshot;
}
// Serial: shares the DOM geometry stubs and the probe's localStorage key.
for (const kind of ["plain", "horizontal", "groups", "async", "large-synthetic"] as const) {
  it.serial(kind, async () => {
    const f = fixture(kind);
    try {
      await Promise.resolve();
      const target = kind === "large-synthetic" ? 450_000 : 20;
      f.list.scrollToIndex(target);
      const placeholder = f.list.getItemAt(target)?._isPlaceholder === true;
      const snapshot = persisted(f.list.getScrollSnapshot());
      f.sizes[3] = 90;
      f.list.remeasureItem(3);
      const corrected = f.list.getScrollPosition();
      f.list.scrollToIndex(0);
      await f.list.restoreScroll(snapshot);
      const restored = f.list.getScrollSnapshot();
      console.log(JSON.stringify({ kind, saved: snapshot, placeholder, corrected,
        restored: f.list.getScrollPosition(), restoredIndex: restored.index,
        restoredDataIndex: restored.dataIndex,
        viewportPixel: f.container.querySelector<HTMLElement>(".vlist-viewport")!.scrollTop,
        contentHeight: f.container.querySelector<HTMLElement>(".vlist-content")!.style.height,
      }));
      expect(corrected).toBe(snapshot.scrollTop! + 50);
      expect(f.list.getScrollPosition()).toBe(snapshot.scrollTop!);
    } finally { f.dispose(); }
  });
}
it.serial("groups regroup with unchanged data count", async () => {
  const before = fixture("groups");
  let snapshot: ScrollSnapshot;
  try {
    await Promise.resolve();
    before.list.scrollToIndex(20);
    snapshot = persisted(before.list.getScrollSnapshot());
  } finally { before.dispose(); }
  const after = fixture("groups", 5);
  try {
    await Promise.resolve();
    after.list.scrollToIndex(20);
    const currentAnchorPixel = after.list.getScrollPosition();
    await after.list.restoreScroll(snapshot);
    console.log(JSON.stringify({ kind: "regroup", saved: snapshot, currentAnchorPixel,
      restored: after.list.getScrollPosition(), after: after.list.getScrollSnapshot() }));
    expect(after.list.getScrollPosition()).toBe(snapshot.scrollTop!);
  } finally { after.dispose(); }
});
it.serial("removed items and equal-count replacement", async () => {
  for (const action of ["remove-before", "remove-anchor", "equal-count-replace", "shrink-past-anchor"] as const) {
    const f = fixture("plain");
    try {
      f.list.scrollToIndex(20);
      const snapshot = persisted(f.list.getScrollSnapshot());
      const savedId = f.list.getItemAt(20)!.id;
      if (action === "remove-before") f.list.removeItem(1);
      if (action === "remove-anchor") f.list.removeItem(savedId);
      if (action === "equal-count-replace") f.list.setItems(createTestItems(100, 101));
      if (action === "shrink-past-anchor") f.list.setItems(createTestItems(10));
      await f.list.restoreScroll(snapshot);
      const current = f.list.getScrollSnapshot();
      console.log(JSON.stringify({ kind: action, savedId, saved: snapshot, restored: f.list.getScrollPosition(),
        currentIndex: current.index, currentId: f.list.getItemAt(current.index)?.id,
        savedIdNowAt: f.list.getIndexById(savedId) }));
    } finally { f.dispose(); }
  }
});
it.serial("pixel offset versus ratio inside a resized anchor", async () => {
  const f = fixture("plain");
  try {
    const viewport = f.container.querySelector<HTMLElement>(".vlist-viewport")!;
    viewport.scrollTop = 810;
    viewport.dispatchEvent(new Event("scroll"));
    const snapshot = persisted(f.list.getScrollSnapshot());
    f.sizes[20] = 80;
    f.list.remeasureItem(20);
    await f.list.restoreScroll(snapshot);
    const legacy = f.list.getScrollPosition();
    const anchorOnly = { ...snapshot };
    delete anchorOnly.scrollTop;
    await f.list.restoreScroll(anchorOnly);
    console.log(JSON.stringify({ kind: "anchor-ratio", saved: snapshot, legacy, anchorOnly: f.list.getScrollPosition() }));
    expect(legacy).toBe(810);
    expect(f.list.getScrollPosition()).toBe(820);
  } finally { f.dispose(); }
});
it("scale export inspection", () => {
  console.log(JSON.stringify({ kind: "exports", scaleExport: "scale" in publicAPI }));
  expect("scale" in publicAPI).toBe(false);
});

```
