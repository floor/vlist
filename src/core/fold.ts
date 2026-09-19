/**
 * Wrap-mode fold: re-key mounted rows and shift the render window.
 *
 * A fold moves every virtual index by whole laps; the nodes and their paint
 * positions are unchanged. Re-keying the map (and the `id` that encodes the
 * virtual index) lets the next commit find them instead of releasing,
 * re-templating and re-inserting the viewport. Lives here — not in pipeline
 * or create — so a native list that never wraps does not import it (runway
 * is pulled by carousel). The synthetic handler imports it because wrap
 * folds for that entry go through commit(), not wrapRebase; putting the
 * import in create.ts would charge every native list.
 *
 * Shifted with the fold: the typed-array window (`shiftWindow`), carousel
 * `intendedVi`, velocity `_lp`, `lastEventScrollPos`, `id` (virtual index),
 * `aria-activedescendant` (resolved to the same node after its id rewrite),
 * `oddClass` when `indexShift` is odd (stripe is virtual-index parity).
 * Fold-invariant: `data-index` / `aria-posinset` (public index), selection
 * `focusedIndex` (data space under `indexMap`), snapshots (`dataIndex`).
 */

import type { EngineState } from "./state";
import type { WrapConfig } from "./runway";

/**
 * Move every `rendered` key by `-indexShift` without touching the DOM tree.
 * `data-index` / `aria-posinset` carry the public index and stay put.
 *
 * `aria-activedescendant` is resolved after every id rewrite: a uniform shift
 * can make two nodes share an id mid-loop, so rewriting the attribute from a
 * reconstructed old id in that window can point at the wrong node.
 */
export function rekeyRendered(
  rendered: Map<number, HTMLElement>,
  indexShift: number,
  prefix: string,
  content: HTMLElement,
  oddClass?: string,
): void {
  if (indexShift === 0 || rendered.size === 0) return;

  const count = rendered.size;
  const indices = new Int32Array(count);
  const elements = new Array<HTMLElement>(count);
  let n = 0;
  for (const [index, el] of rendered) {
    indices[n] = index;
    elements[n] = el;
    n++;
  }
  rendered.clear();

  const idPrefix = prefix + "-item-";
  const active = content.getAttribute("aria-activedescendant");
  let activeEl: HTMLElement | null = null;
  const flipOdd = oddClass && (indexShift & 1);

  for (let i = 0; i < count; i++) {
    const index = indices[i]!;
    const el = elements[i]!;
    const next = index - indexShift;
    rendered.set(next, el);
    if (active !== null && el.id === active) activeEl = el;
    if (el.id === idPrefix + index) el.id = idPrefix + next;
    if (flipOdd) el.classList.toggle(oddClass!);
  }

  if (activeEl !== null) content.setAttribute("aria-activedescendant", activeEl.id);
}

/**
 * Shift the committed render window by whole laps after a wrap fold.
 *
 * Virtual indices and offsets move with the logical origin; shifting them
 * (and `prevBaseOffset`) keeps the range-unchanged fast path honest so the
 * next frame does not treat identical paint as a new window.
 */
export function shiftWindow(state: EngineState, indexShift: number, pixelShift: number): void {
  if (indexShift === 0 && pixelShift === 0) return;
  state.prevRangeStart -= indexShift;
  state.prevRangeEnd -= indexShift;
  state.startIndex -= indexShift;
  state.prevBaseOffset -= pixelShift;
  const count = state.visibleCount;
  for (let i = 0; i < count; i++) {
    state.visibleIndices[i]! -= indexShift;
    state.visibleOffsets[i]! -= pixelShift;
  }
}

/** Re-key mounted rows and shift window state for a wrap fold, before the next render. */
export function applyWrapFold(
  wrap: WrapConfig,
  shift: number,
  state: EngineState,
  content: HTMLElement,
  rendered: Map<number, HTMLElement> | undefined,
  prefix: string,
  oddClass?: string,
): void {
  const lap = wrap.lapSize();
  const perLap = wrap.itemsPerLap();
  const indexShift = lap > 0 ? Math.round(shift / lap) * perLap : 0;
  if (indexShift === 0) return;
  if (rendered) rekeyRendered(rendered, indexShift, prefix, content, oddClass);
  shiftWindow(state, indexShift, shift);
}
