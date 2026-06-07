/**
 * vlist — Bounded Logical Scroll Tests (RFC-012)
 *
 * Verifies the bounded scroll model (`scroll: { mode: "bounded" }`):
 *   - the content element is sized to a viewport-multiple runway, not the full
 *     virtual size (so the browser's ~16.7M px element limit is never reached)
 *   - the public scroll position is the absolute logical pixel and reaches the
 *     full range, including the exact end
 *   - items render at `offset - baseOffset`, landing inside the runway
 *   - native scroll near a runway edge rebases (shifts baseOffset + scrollTop)
 *     while preserving the logical position
 *
 * Native mode (the default) is covered by the rest of the suite; here we assert
 * the bounded path's distinct behavior.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";

// =============================================================================
// DOM Setup — viewport reports a fixed 500px main-axis size
// =============================================================================

const VIEWPORT = 500;
const ITEM = 50;
const FACTOR = 2; // BOUNDED_RUNWAY_FACTOR
const RUNWAY = VIEWPORT * FACTOR; // 1000

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  setupDOM();
  origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => VIEWPORT, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});
afterAll(() => {
  if (origClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", origClientHeight);
  if (origClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", origClientWidth);
  teardownDOM();
});

// =============================================================================
// Helpers
// =============================================================================

let container: HTMLElement;
let list: VList<TestItem> | null;

beforeEach(() => {
  container = createContainer({ width: 300, height: VIEWPORT });
  list = null;
});
afterEach(() => {
  list?.destroy();
  container.remove();
});

function getViewport(c: HTMLElement): HTMLElement {
  return c.querySelector<HTMLElement>(".vlist-viewport")!;
}
function getContent(c: HTMLElement): HTMLElement {
  return c.querySelector<HTMLElement>(".vlist-content")!;
}

function simulateScroll(viewport: HTMLElement, scrollTop: number): void {
  Object.defineProperty(viewport, "scrollTop", { value: scrollTop, writable: true, configurable: true });
  viewport.dispatchEvent(new Event("scroll", { bubbles: false }));
}

function makeBounded(itemCount: number): VList<TestItem> {
  return createVList<TestItem>(
    {
      container,
      items: createTestItems(itemCount),
      item: { height: ITEM, template: simpleTemplate },
      scroll: { mode: "bounded" },
    },
    [],
  );
}

function transformPx(el: HTMLElement): number {
  const m = /translateY\(([-\d.]+)px\)/.exec(el.style.transform);
  return m ? parseFloat(m[1]!) : NaN;
}

// =============================================================================
// Runway sizing
// =============================================================================

describe("bounded scroll — runway sizing", () => {
  it("sizes content to the viewport-multiple runway, not the full virtual size", () => {
    // 1M items × 50px = 50,000,000px virtual — far past the ~16.7M browser limit.
    list = makeBounded(1_000_000);
    const content = getContent(container);
    expect(parseInt(content.style.height, 10)).toBe(RUNWAY);
  });

  it("degenerates to native sizing when the list fits within the runway", () => {
    // 15 items × 50px = 750px < 1000px runway → content == full virtual size.
    list = makeBounded(15);
    const content = getContent(container);
    expect(parseInt(content.style.height, 10)).toBe(15 * ITEM);
  });

  it("honors a custom scroll.runway multiple", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(1_000_000),
        item: { height: ITEM, template: simpleTemplate },
        scroll: { mode: "bounded", runway: 5 },
      },
      [],
    );
    // runway 5 × 500px viewport = 2500px content.
    expect(parseInt(getContent(container).style.height, 10)).toBe(VIEWPORT * 5);
  });

  it("clamps scroll.runway up to the minimum floor (1.5)", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(1_000_000),
        item: { height: ITEM, template: simpleTemplate },
        scroll: { mode: "bounded", runway: 1 }, // below floor → clamped to 1.5
      },
      [],
    );
    expect(parseInt(getContent(container).style.height, 10)).toBe(VIEWPORT * 1.5);
  });

  it("honors a small runway multiple above the floor (1.6)", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(1_000_000),
        item: { height: ITEM, template: simpleTemplate },
        scroll: { mode: "bounded", runway: 1.6 }, // above floor → kept as-is
      },
      [],
    );
    expect(parseInt(getContent(container).style.height, 10)).toBe(VIEWPORT * 1.6); // 800
  });

  it("keeps content at the runway when a plugin grows the virtual total", () => {
    // Plugins (autosize, masonry, data, snapshots, search) grow the virtual size
    // via ctx.updateContentSize. Under bounded mode that must resize to the runway,
    // not the full virtual total, or the browser element-size limit is reached.
    let grow: ((size: number) => void) | null = null;
    const grower: VListPlugin<TestItem> = {
      name: "grower",
      priority: 1,
      setup(ctx): void {
        grow = (size: number): void => ctx.updateContentSize(size);
      },
    };

    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(1000),
        item: { height: ITEM, template: simpleTemplate },
        scroll: { mode: "bounded" },
      },
      [grower],
    );

    // Grow to a virtual total far past the browser element-size limit.
    grow!(50_000_000);

    const content = getContent(container);
    // Content stays bounded to the runway; only the logical total grew.
    expect(parseInt(content.style.height, 10)).toBe(RUNWAY);
  });

  it("throws on an invalid scroll.runway", () => {
    expect(() =>
      createVList<TestItem>(
        {
          container,
          items: createTestItems(10),
          item: { height: ITEM, template: simpleTemplate },
          scroll: { mode: "bounded", runway: 0 },
        },
        [],
      ),
    ).toThrow(/scroll\.runway must be a positive number/);
  });
});

// =============================================================================
// Logical position range
// =============================================================================

describe("bounded scroll — logical position", () => {
  it("getScrollPosition is the absolute logical pixel and reaches the exact end", () => {
    list = makeBounded(1_000_000);
    const virtualTotal = 1_000_000 * ITEM;
    const maxLogical = virtualTotal - VIEWPORT;

    list.scrollToIndex(999_999, "start");
    // align=start clamps to the maximum logical position.
    expect(list.getScrollPosition()).toBe(maxLogical);
  });

  it("scrollToIndex lands the target item at the top of the viewport", () => {
    list = makeBounded(1_000_000);
    list.scrollToIndex(500_000, "start");

    const viewport = getViewport(container);
    const el = getContent(container).querySelector<HTMLElement>('[data-index="500000"]');
    expect(el).not.toBeNull();

    // On-screen position = transform - scrollTop must be ~0 for a start-aligned item.
    const onScreen = transformPx(el!) - viewport.scrollTop;
    expect(Math.abs(onScreen)).toBeLessThan(1);
  });

  it("public scroll position equals the absolute offset after a mid-range native scroll", () => {
    list = makeBounded(1_000_000);
    const viewport = getViewport(container);
    // 300 is within the runway (max scrollTop = 500) and below the upper rebase
    // threshold (high = 375), so no rebase: logical == scrollTop.
    simulateScroll(viewport, 300);
    expect(list.getScrollPosition()).toBe(300);
  });
});

// =============================================================================
// Rebasing
// =============================================================================

describe("bounded scroll — rebasing", () => {
  it("rebases near the upper runway edge, preserving the logical position", () => {
    list = makeBounded(1_000_000);
    const viewport = getViewport(container);

    // 450 > high threshold (375). Rebase recenters scrollTop to the runway
    // centre (250) and shifts baseOffset by the same delta — logical stays 450.
    simulateScroll(viewport, 450);

    expect(list.getScrollPosition()).toBe(450);
    expect(viewport.scrollTop).toBe(RUNWAY / 2 - VIEWPORT / 2); // 500 - 250 = 250
  });

  it("a synthetic scroll event from the rebase does not shift the logical position", () => {
    list = makeBounded(1_000_000);
    const viewport = getViewport(container);

    simulateScroll(viewport, 450); // triggers rebase → scrollTop reset to 250
    const afterRebase = list.getScrollPosition();

    // Replay the scroll event the browser would fire for the programmatic
    // scrollTop change. It must be absorbed by the logical-unchanged guard.
    viewport.dispatchEvent(new Event("scroll", { bubbles: false }));
    expect(list.getScrollPosition()).toBe(afterRebase);
  });

  it("does not rebase for small lists (baseOffset stays 0)", () => {
    list = makeBounded(15); // 750px fits the runway → no rebasing possible
    const viewport = getViewport(container);
    simulateScroll(viewport, 200);
    expect(list.getScrollPosition()).toBe(200);
    expect(viewport.scrollTop).toBe(200); // untouched: baseOffset is 0
  });
});
