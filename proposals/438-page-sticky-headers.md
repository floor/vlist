# Page-mode sticky header stacking (#438)

Status: proposal for a minor release; not implemented. No new public option or type is proposed.

## Evidence and scope

The [table/page sweep (#437)](https://github.com/floor/vlist/pull/437) reproduced two failures
in Chrome 156.0.8078.76 on both the published 3.3.2 source and the fixed sweep source:
`page() + groups()` lets the group header leave the window, and `page() + table()` lets the
column header leave it. With the test list scrolled to item 60, their header top coordinates
were -2,460 px and -2,440 px respectively. Both remain named TODOs in that PR.

The sweep's passing padding probes also matter: groups and masonry retain start/end/center
padding deltas of -60/+40/-10 px, and keyboard navigation respects the configured bands.
Header stickiness must preserve those behaviors. Giving both headers `top: 0` would overlap
them; making a table header sticky alone would cover a row that `scrollToIndex()` currently
places at the window edge.

This proposal covers page-mode table and group headers, including their combination,
existing dynamic `page({ scrollPadding })`, list boundaries and multiple page-mode lists.
It does not add pinned columns or change a viewport-scrolled list.

## One stack per list

Use logical coordinates along the list's scroll axis. Let:

- `P` be the resolved start padding supplied to `page()`.
- `T` be the table header's actual height, or zero without a table.
- `G` be the active sticky group header's height, or zero when grouping is absent or
  `groups({ sticky: false })` is configured.
- `E` be the window extent minus the resolved end padding.

While a list intersects the window's usable region, its pinned header order is:

| Element | Logical start coordinate |
| --- | --- |
| Consumer's reserved page band | `0` through `P` |
| Table column header | `P` |
| Active group header | `P + T` |
| First unobscured data position | `P + T + G` |

The usable data interval is therefore `[P + T + G, E]`. With either header absent its
height is zero, so the same rule handles the simpler combinations. For horizontal grouped
lists, use left/right padding and header widths. Tables retain their existing prohibition
on horizontal list orientation; horizontal overflow within a vertical table is separate.

Keep each original header in its existing DOM order and accessibility tree. Pin a wrapper
or the existing group container within that list's root; do not clone labels, controls,
roles, IDs or tab stops. The table header paints above the group header during a transition,
and both paint above body rows. Scope that stacking order to the owning list.

Before the list reaches the reserved page band, headers stay in normal flow. At the list's
end they release within its root instead of floating over following content. Two page-mode
lists independently obey those bounds; their headers do not form one global stack.
An empty list has no active group header. A table may retain its ordinary column header.

## Share geometry with navigation

`page()` owns document-to-list coordinates and the configured page band. `table()` owns
`T`; `groups()` owns the current `G`, including variable header sizes and `sticky: false`.
Publish those sizes through private capabilities resolved after plugin setup. Do not infer
them from plugin order or query the DOM separately from selection/a11y.

Use one effective safe-start calculation for `scrollToIndex()` (instant and smooth),
keyboard reveal, and remeasurement anchoring. The existing page padding hook can carry
`P + T` to layout owners; groups already accounts for its own sticky header and should add
`G` exactly once. Do not add a header height to the item's data index, duplicate a layout
header offset, or reserve the same flow height again in document coordinates.

Resolve padding functions and changed header sizes on initialization and relevant layout
changes. Update positioning and navigation together when the window resizes, columns change,
a group changes, or padding changes. Keep the scroll path allocation-free and use cached
sizes. Native writes must still read back the actual document position after clamping.

Preserve the existing owner of horizontal table scrolling and its header/body alignment.
Pinning the header must not introduce another cross-axis offset or clip columns differently
from their body cells. Header keyboard controls and the grid body's active descendant retain
their existing owners.

## Acceptance and decisions before implementation

Use paired browser geometry checks with content above and below the list. Cover table only,
groups only, both together, `sticky: false`, variable group heights, horizontal groups,
dynamic start/end padding, two lists, empty/refilled data, and the start/end of each root.
Assert header bounds and visible row bounds after instant/smooth navigation, keyboard reveal,
remeasurement and resize. Keep the existing padding-delta tests, header controls, focus rings,
active descendants, column resize/reorder, cross-axis alignment and destroy cleanup green.

Two details need an explicit decision with the implementation review:

1. When `P + T + G >= E`, define a deterministic clipped stack and reveal behavior without
   a new throw or oscillating scroll correction. This proposal does not choose an arbitrary
   minimum data height.
2. Confirm the behavior when a padding function changes without a resize or navigation
   request; avoid promising immediate updates without an existing invalidation signal.

Implement in the owning plugins and styles after this rule is accepted. Measure page, table
and groups independently and together. At #437's measured head, page has 75 B of its existing
budget left, table 81 B, selection 0 B and tree 5 B. This proposal authorizes no budget change,
public API addition or core growth. The implementation needs its own RED regressions,
mutations, exact-head CI and reviewed browser captures.
