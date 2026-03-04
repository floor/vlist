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
 * Used by: core renderer, grid renderer, masonry renderer, and core.ts
 * inlined render path.
 */

/**
 * Reorder DOM children so they follow logical data-index order.
 *
 * @param container  - The items container element
 * @param keys       - The rendered Map's keys (item indices)
 * @param getElement - Lookup function: index → HTMLElement
 */
export const sortRenderedDOM = (
  container: HTMLElement,
  keys: IterableIterator<number>,
  getElement: (index: number) => HTMLElement | undefined,
): void => {
  // Extract and sort numeric keys (avoids parseInt on DOM attributes)
  const sorted = Array.from(keys).sort((a, b) => a - b);
  if (sorted.length <= 1) return;

  // Fast bail-out: check if DOM order already matches
  let node = container.firstChild;
  let inOrder = true;
  for (let i = 0; i < sorted.length; i++) {
    if (getElement(sorted[i]!) !== node) { inOrder = false; break; }
    node = node!.nextSibling;
  }
  if (inOrder) return;

  // Re-append in order (single reflow, no geometry change)
  for (let i = 0; i < sorted.length; i++) {
    const el = getElement(sorted[i]!);
    if (el) container.appendChild(el);
  }
};