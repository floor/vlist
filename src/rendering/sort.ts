// src/rendering/sort.ts
/**
 * Shared DOM sort utility for accessibility.
 *
 * Virtual list renderers append new elements at the end of the container
 * for performance (batched DocumentFragment insertion). After scrolling,
 * DOM order diverges from logical item order. Screen readers traverse
 * DOM order, so items are encountered in a nonsensical sequence.
 *
 * This utility reorders DOM children to match logical index order.
 * Called on scroll idle — zero cost during scroll, single lightweight
 * reflow when idle (items are position:absolute, no geometry change).
 *
 * **Minimal-move approach**: walks sorted elements and current DOM children
 * in parallel.  Elements already at the correct position are never touched
 * — preserving browser :hover state and avoiding CSS transition replays
 * on elements under the cursor.
 *
 * Used by: core renderer, grid renderer, masonry renderer, and core.ts
 * inlined render path.
 */

/**
 * Reorder DOM children so they follow logical data-index order.
 *
 * Only elements that are out of position are moved via `insertBefore`.
 * Elements already in the correct spot are skipped entirely (no DOM
 * mutation), which preserves :hover state and CSS transitions.
 *
 * @param container  - The DOM element that holds rendered items
 * @param keys       - The rendered Map's keys (item indices)
 * @param getElement - Lookup function: index → HTMLElement | undefined
 */
export const sortRenderedDOM = (
  container: HTMLElement,
  keys: IterableIterator<number>,
  getElement: (index: number) => HTMLElement | undefined,
): void => {
  // Collect and sort logical indices
  const sorted = Array.from(keys).sort((a, b) => a - b);
  if (sorted.length <= 1) return;

  // Resolve to elements in target (sorted) order, skip undefined
  const elements: HTMLElement[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const el = getElement(sorted[i]!);
    if (el) elements.push(el);
  }
  if (elements.length <= 1) return;

  // Walk sorted elements against current DOM children in parallel.
  // `cursor` tracks our position in the DOM child list.
  // For each target element:
  //   - if it matches the cursor → already in place, advance cursor
  //   - if not → insertBefore(cursor) to put it in the right spot
  let cursor = container.firstChild;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]!;

    if (el === cursor) {
      // Already in the correct position — skip, no DOM mutation
      cursor = cursor.nextSibling;
    } else {
      // Out of place — move it before the current cursor position.
      // insertBefore(el, null) is equivalent to appendChild.
      container.insertBefore(el, cursor);
    }
  }
};