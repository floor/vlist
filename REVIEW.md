# Reviewing a vlist pull request

What a reviewer looks for, how a finding is written, and when the loop ends.

## What failure looks like in vlist

A change fails when it breaks one of these, even if every existing test passes:

- **A rendered index that lies to assistive tech.** `aria-activedescendant` or
  `data-index` names the wrong item, or the focus ring sits on a different row
  from the one a key press acts on. The index a plugin sees is not always the
  index in the DOM: `groups()` counts header rows, so a render index and an item
  index differ wherever a header sits between items. #380 measured exactly that
  — a click on the row showing "Item 3" reported "Item 4", and the ring and
  `aria-activedescendant` sat one row high — and #363 was the same mistake in
  `autosize()`'s measured heights. Every read across that boundary goes through
  the layout plugin's translators.
- **A size row that lies.** A README size table that disagrees with what
  `bun run size` prints, or a budget in `scripts/size.ts` moved so a change
  fits. The sizes quoted in the READMEs come from a measured run; a budget is a
  fixed number. A change that goes over it is trimmed, or the pin moves to
  measured + 1% on the lead's recorded decision in the pull request.
- **A scroll position that jumps.** Resizing, prepending items, changing the
  item at an index, or `autosize()` settling must not move the row under the
  reader's eye. #372 was one source: after the item at an index changed, the
  row kept the previous occupant's measured height.
- **Allocations on the scroll hot path.** Work that grows with the number of
  visible rows inside a scroll or render pass: a `.map()`, a spread, an object
  or array literal, or `new` per row. Reuse buffers and hoist invariants — a
  loop is fine, allocating in it is not.
- **A public API or throw change in a patch.** An option that is accepted and
  validated but never read (#345); an event declared in the types and never
  emitted (#341); a new `throw` on a path that used to be quiet. However small
  the diff, that is a breaking change.
- **A test that passes with the fix reverted.** Run the new test against the
  commit before the fix, or revert the source change under it, and watch it fail
  for the reason the change claims. A test that passes both ways pins nothing.

## Findings

- Every finding cites a place and the evidence: `path/to/file.ts:42`, plus a
  command and its output, or a quoted line. "This looks risky" is not a
  finding.
- Nits are capped at three per review and marked **nit**. Style preferences are
  nits; correctness is not.
- A bug that predates the pull request is labelled **pre-existing** and filed
  separately. It is not held against this change.
- Flag the class, not one occurrence: if `.map()` on the hot path appears in
  three loops, one finding lists all three lines.

## The loop

- At most three rounds. If the third round still finds the same class of
  problem, stop patching and question the approach instead.
- After round 2, re-review only the new diff. Earlier findings are answered,
  not re-read.
- Never repeat a finding. Once raised, it is fixed or closed with a reason.
- Every finding is answered — fixed, or closed with a reason — before merge.
- A verdict names the exact head commit it applies to. A review of an older
  head does not carry to a new one.
