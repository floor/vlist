/**
 * vlist v2 — Live Region Announcement Tests
 *
 * Verifies that the a11y plugin announces focus and selection changes
 * via the ARIA live region for screen reader users.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import { a11y } from "../../src/plugins/a11y";

// =============================================================================
// DOM Setup
// =============================================================================

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

// =============================================================================
// Helpers
// =============================================================================

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function createList(count = 20) {
  const container = createContainer({ width: 300, height: 500 });
  const items = createTestItems(count);
  const vlist = createVList<TestItem>(
    { container, items, item: { height: 50, template: simpleTemplate } },
    [a11y()],
  );
  return { vlist, container };
}

function getContent(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>(".vlist-content")!;
}

function getLiveRegion(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>(".vlist-live")!;
}

function fireKey(content: HTMLElement, key: string): void {
  content.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true }),
  );
}

// =============================================================================
// Live region creation
// =============================================================================

describe("live region — DOM structure", () => {
  it("should create a live region element", () => {
    const { vlist, container } = createList();

    const liveRegion = getLiveRegion(container);
    expect(liveRegion).toBeDefined();
    expect(liveRegion).not.toBeNull();

    vlist.destroy();
    container.remove();
  });

  it("should have aria-live=polite", () => {
    const { vlist, container } = createList();

    const liveRegion = getLiveRegion(container);
    expect(liveRegion.getAttribute("aria-live")).toBe("polite");

    vlist.destroy();
    container.remove();
  });

  it("should have aria-atomic=true", () => {
    const { vlist, container } = createList();

    const liveRegion = getLiveRegion(container);
    expect(liveRegion.getAttribute("aria-atomic")).toBe("true");

    vlist.destroy();
    container.remove();
  });

  it("should have role=status", () => {
    const { vlist, container } = createList();

    const liveRegion = getLiveRegion(container);
    expect(liveRegion.getAttribute("role")).toBe("status");

    vlist.destroy();
    container.remove();
  });

  it("should be visually hidden (sr-only pattern)", () => {
    const { vlist, container } = createList();

    const liveRegion = getLiveRegion(container);
    expect(liveRegion.style.cssText).toContain("clip: rect(0");
    expect(liveRegion.style.cssText).toContain("width: 1px");

    vlist.destroy();
    container.remove();
  });
});

// =============================================================================
// Focus announcements
// =============================================================================

describe("live region — focus announcements", () => {
  it("should announce position on ArrowDown", async () => {
    const { vlist, container } = createList();
    await flush();

    const content = getContent(container);
    const liveRegion = getLiveRegion(container);

    fireKey(content, "ArrowDown");
    await flush();

    expect(liveRegion.textContent).toBe("Item 1 of 20");

    vlist.destroy();
    container.remove();
  });

  it("should announce updated position on subsequent navigation", async () => {
    const { vlist, container } = createList();
    await flush();

    const content = getContent(container);
    const liveRegion = getLiveRegion(container);

    fireKey(content, "ArrowDown"); // → 0
    fireKey(content, "ArrowDown"); // → 1
    fireKey(content, "ArrowDown"); // → 2
    await flush();

    expect(liveRegion.textContent).toBe("Item 3 of 20");

    vlist.destroy();
    container.remove();
  });

  it("should announce correct total after End key", async () => {
    const { vlist, container } = createList(10);
    await flush();

    const content = getContent(container);
    const liveRegion = getLiveRegion(container);

    fireKey(content, "End");
    await flush();

    expect(liveRegion.textContent).toBe("Item 10 of 10");

    vlist.destroy();
    container.remove();
  });

  it("should announce Home position", async () => {
    const { vlist, container } = createList(10);
    await flush();

    const content = getContent(container);
    const liveRegion = getLiveRegion(container);

    fireKey(content, "End"); // → 9
    fireKey(content, "Home"); // → 0
    await flush();

    expect(liveRegion.textContent).toBe("Item 1 of 10");

    vlist.destroy();
    container.remove();
  });
});

// =============================================================================
// Selection announcements
// =============================================================================

describe("live region — selection announcements", () => {
  it("should announce 'Selected' on Space", async () => {
    const { vlist, container } = createList();
    await flush();

    const content = getContent(container);
    const liveRegion = getLiveRegion(container);

    fireKey(content, "ArrowDown"); // focus → 0
    fireKey(content, " ");          // select
    await flush();

    expect(liveRegion.textContent).toBe("Selected, item 1 of 20");

    vlist.destroy();
    container.remove();
  });

  it("should announce 'Deselected' on second Space", async () => {
    const { vlist, container } = createList();
    await flush();

    const content = getContent(container);
    const liveRegion = getLiveRegion(container);

    fireKey(content, "ArrowDown"); // focus → 0
    fireKey(content, " ");          // select
    fireKey(content, " ");          // deselect
    await flush();

    expect(liveRegion.textContent).toBe("Deselected");

    vlist.destroy();
    container.remove();
  });

  it("should announce selection on Enter", async () => {
    const { vlist, container } = createList();
    await flush();

    const content = getContent(container);
    const liveRegion = getLiveRegion(container);

    fireKey(content, "ArrowDown"); // focus → 0
    fireKey(content, "Enter");      // select
    await flush();

    expect(liveRegion.textContent).toBe("Selected, item 1 of 20");

    vlist.destroy();
    container.remove();
  });
});
