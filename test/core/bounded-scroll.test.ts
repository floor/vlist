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

// =============================================================================
// Wrap mode (infinite loop — carousel uses this via ctx.setBoundedWrap)
// =============================================================================

/**
 * Minimal infinite-loop plugin mirroring how the carousel wires the bounded
 * handler: it inflates the virtual window to `realTotal × cycles`, maps virtual
 * indices to real items via modulo, and requests wrap mode. Configurable cycle
 * geometry keeps the fold threshold small enough to exercise in a test.
 */
function wrapPlugin(
  realTotal: number,
  opts: { cycles: number; middle: number; threshold: number; step?: number },
): VListPlugin<TestItem> {
  const step = opts.step ?? ITEM;
  const virtualTotal = realTotal * opts.cycles;
  const lapSize = step * realTotal;
  const mod = (i: number): number => ((i % realTotal) + realTotal) % realTotal;
  return {
    name: "wrap-test",
    priority: 10,
    setup(ctx): void {
      const es = ctx.getState();
      ctx.setGetItemFn((i) => ctx.getItems()[mod(i)]);
      ctx.sizeCache.getTotalSize = (): number => virtualTotal * step;
      ctx.sizeCache.getOffset = (index): number => index * step;
      ctx.sizeCache.getSize = (): number => step;
      ctx.sizeCache.indexAtOffset = (off): number =>
        Math.max(0, Math.min(Math.floor(off / step), virtualTotal - 1));
      ctx.sizeCache.getTotal = (): number => virtualTotal;
      es.totalItems = virtualTotal;
      ctx.setVirtualTotalFn(() => realTotal);
      ctx.setIndexMapFn(mod);
      ctx.setBoundedWrap({
        lapSize: () => lapSize,
        home: () => opts.middle * lapSize,
        thresholdLaps: opts.middle - opts.threshold,
      });
      ctx.registerMethod("jump", (px: number) => ctx.scrollTo(px));
    },
  };
}

// A multiset of (rendered item, paint offset) pairs. Real items repeat across
// laps, so the data index alone is ambiguous — identity is the content paired
// with its transform. A seamless fold leaves this multiset unchanged.
function renderSnapshot(c: HTMLElement): string[] {
  const snap: string[] = [];
  for (const el of getContent(c).querySelectorAll<HTMLElement>("[data-index]")) {
    if (el.style.display === "none") continue;
    snap.push(`${el.textContent}@${transformPx(el)}`);
  }
  return snap.sort();
}

describe("bounded scroll — wrap mode", () => {
  it("sizes content to the full runway even when the real list fits within it", () => {
    // 5 items × 50px = 250px — would degenerate to native sizing in non-wrap mode,
    // but the loop is infinite so the runway is always used in full.
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(5),
        item: { height: ITEM, template: simpleTemplate },
      },
      [wrapPlugin(5, { cycles: 101, middle: 50, threshold: 10 })],
    );
    expect(parseInt(getContent(container).style.height, 10)).toBe(RUNWAY);
  });

  it("never clamps the logical position; baseOffset absorbs the overflow", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(5),
        item: { height: ITEM, template: simpleTemplate },
      },
      [wrapPlugin(5, { cycles: 101, middle: 50, threshold: 10 })],
    );
    const lapSize = 5 * ITEM; // 250
    const home = 50 * lapSize; // 62500 — far past maxLogical of a non-wrap runway
    (list as unknown as { jump(px: number): void }).jump(home);
    // Logical is preserved exactly (no clamp to virtualTotal - viewport).
    expect(list.getScrollPosition()).toBe(home);
    const viewport = getViewport(container);
    // scrollTop pinned to the runway centre; baseOffset carries the rest.
    expect(viewport.scrollTop).toBe((RUNWAY - VIEWPORT) / 2); // 250
  });

  it("folds back toward home by whole laps once drift crosses the threshold", () => {
    // Small cycle geometry: thresholdLaps = middle - threshold = 5 - 2 = 3 laps.
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(5),
        item: { height: ITEM, template: simpleTemplate },
      },
      [wrapPlugin(5, { cycles: 11, middle: 5, threshold: 2 })],
    );
    const viewport = getViewport(container);
    const lapSize = 5 * ITEM; // 250
    const home = 5 * lapSize; // 1250
    (list as unknown as { jump(px: number): void }).jump(home);

    const before = renderSnapshot(container);
    expect(list.getScrollPosition()).toBe(home);
    const scrollTopBefore = viewport.scrollTop;

    // Each native scroll to the runway edge advances the logical position by one
    // lap (the rebase recenters scrollTop after every event). After three laps
    // the drift hits the threshold and the handler folds back to home.
    simulateScroll(viewport, RUNWAY - VIEWPORT); // lap 1
    simulateScroll(viewport, RUNWAY - VIEWPORT); // lap 2
    simulateScroll(viewport, RUNWAY - VIEWPORT); // lap 3 → fold

    // Logical position folded exactly back to home and scrollTop is unchanged.
    expect(list.getScrollPosition()).toBe(home);
    expect(viewport.scrollTop).toBe(scrollTopBefore);

    // The rendered frame is visually identical to the start: same real items at
    // the same transforms — the loop returned seamlessly.
    const after = renderSnapshot(container);
    expect(after).toEqual(before);
  });

  it("does not fold while drift stays within the threshold", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(5),
        item: { height: ITEM, template: simpleTemplate },
      },
      [wrapPlugin(5, { cycles: 11, middle: 5, threshold: 2 })],
    );
    const viewport = getViewport(container);
    const lapSize = 5 * ITEM;
    const home = 5 * lapSize;
    (list as unknown as { jump(px: number): void }).jump(home);

    simulateScroll(viewport, RUNWAY - VIEWPORT); // lap 1
    simulateScroll(viewport, RUNWAY - VIEWPORT); // lap 2, still < threshold (3)

    // Drifted two laps forward, not folded.
    expect(list.getScrollPosition()).toBe(home + 2 * lapSize);
  });
});
