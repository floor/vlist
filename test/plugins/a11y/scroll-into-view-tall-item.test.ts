/**
 * vlist — a11y scroll alignment for items taller than the viewport (#31)
 *
 * A non-fitting item used to alternate between bottom- and top-aligned on
 * every focus-in: aligning it to the bottom leaves its top above the viewport,
 * which makes the next focus-in take the top branch, and top alignment leaves
 * its bottom below, which makes the one after take the bottom branch. Tab /
 * Shift+Tab therefore repainted the same item in two positions forever.
 *
 * The fix pins the start (top) alignment for an item that does not fit — the
 * position browsers converge on for a non-fitting scrollIntoView target. These
 * tests pin that choice, the 500/501 boundary (a 500px item in a 500px
 * viewport is stable; 501px used to flip), and an offset case so "top" means
 * the item's own offset, not just scroll 0.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../../helpers/factory";
import type { TestItem } from "../../helpers/factory";
import { createVList } from "../../../src/core/create";
import { a11y } from "../../../src/plugins/a11y";
import { selection } from "../../../src/plugins/selection";

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function createList(itemHeight: number) {
  const container = createContainer({ width: 300, height: 500 });
  const items = createTestItems(20);
  const vlist = createVList<TestItem>(
    { container, items, item: { height: itemHeight, template: simpleTemplate } },
    [selection({ mode: "single" }), a11y()],
  );
  return { vlist, container };
}

function contentOf(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>(".vlist-content")!;
}

function fireKey(content: HTMLElement, key: string): void {
  content.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

/** One Tab-away / Shift+Tab-back cycle: focusout, then focus back in. */
async function focusCycle(content: HTMLElement): Promise<void> {
  content.blur();
  document.body.focus?.();
  content.dispatchEvent(
    new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }),
  );
  await flush();
  content.focus();
  await flush();
}

/** Click a rendered row (the click takes focus, as a user click does). */
async function clickRow(container: HTMLElement, index: number): Promise<void> {
  const row = container.querySelector<HTMLElement>(`[data-index="${index}"]`);
  expect(row).not.toBeNull();
  row!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await flush();
}

describe("a11y — scrollIntoView of a non-fitting item (#31)", () => {
  it("keeps a 600px first item at the viewport start across 4 focus cycles", async () => {
    const { vlist, container } = createList(600);
    await flush();
    await clickRow(container, 0);

    const content = contentOf(container);
    const positions: number[] = [];
    for (let i = 0; i < 4; i++) {
      await focusCycle(content);
      positions.push(vlist.getScrollPosition());
    }

    // Start-aligned, and the same position every time.
    expect(positions).toEqual([0, 0, 0, 0]);

    vlist.destroy();
    container.remove();
  });

  it("keeps a mid-list 600px item's start aligned across 4 focus cycles", async () => {
    const { vlist, container } = createList(600);
    await flush();

    const content = contentOf(container);
    content.focus();
    await flush();
    for (let i = 0; i < 5; i++) fireKey(content, "ArrowDown");
    await flush();
    // Item 5's own offset (5 × 600): top alignment, not scroll 0 and not
    // bottom-aligned (which used to land at 3100).
    expect(vlist.getScrollPosition()).toBe(3000);

    const positions: number[] = [];
    for (let i = 0; i < 4; i++) {
      await focusCycle(content);
      positions.push(vlist.getScrollPosition());
    }
    expect(positions).toEqual([3000, 3000, 3000, 3000]);

    vlist.destroy();
    container.remove();
  });

  it("is stable for an item exactly as tall as the viewport (500px)", async () => {
    const { vlist, container } = createList(500);
    await flush();
    await clickRow(container, 0);

    const content = contentOf(container);
    const positions: number[] = [];
    for (let i = 0; i < 4; i++) {
      await focusCycle(content);
      positions.push(vlist.getScrollPosition());
    }

    expect(positions).toEqual([0, 0, 0, 0]);

    vlist.destroy();
    container.remove();
  });

  it("is stable one pixel over the boundary (501px)", async () => {
    const { vlist, container } = createList(501);
    await flush();
    await clickRow(container, 0);

    const content = contentOf(container);
    const positions: number[] = [];
    for (let i = 0; i < 4; i++) {
      await focusCycle(content);
      positions.push(vlist.getScrollPosition());
    }

    // One pixel taller than the viewport: still a single stable position.
    expect(positions).toEqual([0, 0, 0, 0]);

    vlist.destroy();
    container.remove();
  });
});
