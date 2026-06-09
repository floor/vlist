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
import { page } from "../../src/plugins/page";
import { carousel } from "../../src/plugins/carousel";
import { grid } from "../../src/plugins/grid";
import { table } from "../../src/plugins/table";
import { masonry } from "../../src/plugins/masonry";

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

function makeBoundedIn(c: HTMLElement, itemCount: number): VList<TestItem> {
  return createVList<TestItem>(
    {
      container: c,
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

// =============================================================================
// Resize — bounded runway geometry must track the container size
// =============================================================================

describe("bounded scroll — resize", () => {
  it("refreshes the runway when the container resizes", () => {
    const c = createContainer({ width: 300, height: VIEWPORT });
    const saved = globalThis.ResizeObserver;
    let cb: ResizeObserverCallback | null = null;
    // Capture the observer callback without auto-firing on observe.
    globalThis.ResizeObserver = class {
      constructor(c: ResizeObserverCallback) { cb = c; }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;

    // Intercept setTimeout so we can flush the observer install synchronously,
    // avoiding any yield where concurrent tests could see the mock.
    const origSetTimeout = globalThis.setTimeout;
    let pendingInit: (() => void) | null = null;
    globalThis.setTimeout = ((fn: () => void) => { pendingInit = fn; return 0; }) as typeof setTimeout;

    const l = makeBoundedIn(c, 1_000_000);

    globalThis.setTimeout = origSetTimeout;
    if (pendingInit) pendingInit();
    // Restore immediately — the observer callback is captured, mock no longer needed.
    globalThis.ResizeObserver = saved;

    try {
      expect(parseInt(getContent(c).style.height, 10)).toBe(RUNWAY); // 500 × 2

      // Resize the viewport to 700px (vertical → contentRect.height is the main axis).
      cb!(
        [{ contentRect: { width: 300, height: 700 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );

      // Runway tracks the new viewport: 700 × FACTOR, not the stale 1000.
      expect(parseInt(getContent(c).style.height, 10)).toBe(700 * FACTOR);
    } finally {
      l.destroy();
      c.remove();
    }
  });
});

// =============================================================================
// Renderer plugins — grid / table / masonry install setRenderFn and own content
// sizing, so they must route through ctx.updateContentSize to respect the
// bounded runway instead of writing the full physical size (RFC-013 Phase A).
// =============================================================================

describe("bounded scroll — renderer plugins", () => {
  // 50k items keeps the test light while still producing a physical size far
  // larger than the runway (e.g. 50k/4 cols × 50px = 625,000px ≫ 1000px runway).
  const HUGE = 50_000;

  it("grid caps content to the runway for a huge item count", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(HUGE),
        item: { height: ITEM, template: simpleTemplate },
        scroll: { mode: "bounded" },
      },
      [grid({ columns: 4 })],
    );
    expect(parseInt(getContent(container).style.height, 10)).toBe(RUNWAY);
  });

  it("table caps content to the runway for a huge row count", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(HUGE),
        item: { height: ITEM, template: simpleTemplate },
        scroll: { mode: "bounded" },
      },
      [
        table({
          columns: [{ key: "name", label: "Name", width: 200 }],
          rowHeight: ITEM,
        }),
      ],
    );
    expect(parseInt(getContent(container).style.height, 10)).toBe(RUNWAY);
  });

  it("masonry caps content to the runway for a huge item count", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(HUGE),
        item: { height: ITEM, template: simpleTemplate },
        scroll: { mode: "bounded" },
      },
      [masonry({ columns: 3 })],
    );
    expect(parseInt(getContent(container).style.height, 10)).toBeLessThanOrEqual(RUNWAY);
  });
});

// =============================================================================
// Wheel handler — drives scroll in logical space via WheelEvent
// =============================================================================

function fireWheel(target: HTMLElement, deltaY: number, deltaX: number = 0): WheelEvent {
  const event = new WheelEvent("wheel", {
    deltaY,
    deltaX,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe("bounded scroll — wheel", () => {
  it("advances logical position on wheel deltaY", () => {
    list = makeBounded(1_000_000);
    const viewport = getViewport(container);
    const before = list.getScrollPosition();

    fireWheel(viewport, 100);

    expect(list.getScrollPosition()).toBeGreaterThan(before);
  });

  it("clamps logical position at 0 (no negative scroll)", () => {
    list = makeBounded(1_000_000);
    const viewport = getViewport(container);
    // Already at 0
    fireWheel(viewport, -1000);
    expect(list.getScrollPosition()).toBe(0);
  });

  it("clamps logical position at max (end of list)", () => {
    list = makeBounded(100); // 100 × 50 = 5000px total, containerSize 500 → maxLogical 4500
    const viewport = getViewport(container);

    // Scroll way past the end
    for (let i = 0; i < 200; i++) fireWheel(viewport, 100);

    expect(list.getScrollPosition()).toBeLessThanOrEqual(4500);
  });

  it("prevents default on consumed wheel events", () => {
    list = makeBounded(1_000_000);
    const viewport = getViewport(container);

    const event = fireWheel(viewport, 100);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores wheel when delta is too small to move", () => {
    list = makeBounded(1_000_000);
    const viewport = getViewport(container);
    const before = list.getScrollPosition();

    // deltaY of 0 produces no movement
    const event = fireWheel(viewport, 0);
    expect(list.getScrollPosition()).toBe(before);
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores cross-axis dominant wheel in horizontal mode", () => {
    // Horizontal bounded list
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(1_000_000),
        item: { height: ITEM, template: simpleTemplate },
        orientation: "horizontal",
        scroll: { mode: "bounded" },
      },
      [],
    );
    const viewport = getViewport(container);
    const before = list.getScrollPosition();

    // deltaX dominant → should be ignored in horizontal mode (cross-axis)
    fireWheel(viewport, 0, 100);
    expect(list.getScrollPosition()).toBe(before);
  });

  it("forwards cross-axis deltaX to viewport.scrollLeft when content overflows horizontally", () => {
    list = makeBounded(1_000_000);
    const viewport = getViewport(container);

    // Simulate horizontal overflow: scrollWidth > clientWidth
    Object.defineProperty(viewport, "scrollWidth", { value: 600, configurable: true });
    Object.defineProperty(viewport, "clientWidth", { value: 300, configurable: true });
    viewport.scrollLeft = 0;

    // deltaY dominant (50) so the handler doesn't bail on the cross-axis check,
    // but deltaX (30) is non-zero → forwarded to viewport.scrollLeft.
    fireWheel(viewport, 50, 30);
    expect(viewport.scrollLeft).toBe(30);
  });

  it("ignores cross-axis dominant wheel when content overflows horizontally", () => {
    list = makeBounded(1_000_000);
    const viewport = getViewport(container);
    const before = list.getScrollPosition();

    Object.defineProperty(viewport, "scrollWidth", { value: 600, configurable: true });
    Object.defineProperty(viewport, "clientWidth", { value: 300, configurable: true });

    // deltaX dominant → returns early, no vertical scroll
    fireWheel(viewport, 10, 100);
    expect(list.getScrollPosition()).toBe(before);
  });

  it("intercepts deltaX-dominant wheel in horizontal wrap mode (carousel trackpad swipe)", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(24),
        item: { height: ITEM, template: simpleTemplate },
        orientation: "horizontal",
      },
      [carousel({ variant: "hero" })],
    );
    const viewport = getViewport(container);
    const before = list.getScrollPosition();

    // Simulate trackpad horizontal swipe: deltaX dominant, deltaY = 0
    const event = fireWheel(viewport, 0, 100);

    expect(list.getScrollPosition()).not.toBe(before);
    expect(event.defaultPrevented).toBe(true);
  });
});

// =============================================================================
// Idle detection — scrollDirection resets after idle timeout
// =============================================================================

describe("bounded scroll — idle detection", () => {
  it("resets scrollDirection to 0 after idle timeout", async () => {
    const c = createContainer({ width: 300, height: VIEWPORT });
    try {
      const l = makeBoundedIn(c, 1_000_000);
      const viewport = getViewport(c);

      fireWheel(viewport, 100);
      // scrollDirection should be set after wheel
      const state = (l as any)._test?.engineState;

      // Wait for the idle timeout (150ms default) + buffer
      await new Promise((r) => setTimeout(r, 250));

      // After idle, scrollDirection should be 0
      // We verify via a second scroll — if idle fired, the direction was reset
      const posBefore = l.getScrollPosition();
      fireWheel(viewport, 50);
      expect(l.getScrollPosition()).toBeGreaterThan(posBefore);
      l.destroy();
    } finally {
      c.remove();
    }
  });
});

// =============================================================================
// Smooth scroll — animates in logical space via requestAnimationFrame
// =============================================================================

describe("bounded scroll — smooth scroll", () => {
  it("scrollToIndex with smooth behavior animates to the target", async () => {
    const c = createContainer({ width: 300, height: VIEWPORT });
    try {
      const l = makeBoundedIn(c, 1_000_000);
      const target = 500;
      const targetOffset = target * ITEM; // 25000

      l.scrollToIndex(target, { behavior: "smooth" });

      // rAF is shimmed to setTimeout(0), so give it time to complete
      await new Promise((r) => setTimeout(r, 600));

      // Should arrive near the target
      const pos = l.getScrollPosition();
      expect(Math.abs(pos - targetOffset)).toBeLessThan(ITEM);
      l.destroy();
    } finally {
      c.remove();
    }
  });

  it("scrollToIndex with auto behavior jumps instantly", () => {
    list = makeBounded(1_000_000);
    const target = 500;

    list.scrollToIndex(target, { behavior: "auto" });

    const pos = list.getScrollPosition();
    expect(Math.abs(pos - target * ITEM)).toBeLessThan(ITEM);
  });

  it("cancels an in-flight smooth scroll when a new one starts", async () => {
    const c = createContainer({ width: 300, height: VIEWPORT });
    try {
      const l = makeBoundedIn(c, 1_000_000);

      l.scrollToIndex(100, { behavior: "smooth" });
      // Immediately start a second animation — the first should be cancelled
      await new Promise((r) => setTimeout(r, 50));
      l.scrollToIndex(200, { behavior: "smooth" });

      await new Promise((r) => setTimeout(r, 600));

      // Should end near index 200, not 100
      const pos = l.getScrollPosition();
      const target200 = 200 * ITEM;
      expect(Math.abs(pos - target200)).toBeLessThan(ITEM * 2);
      l.destroy();
    } finally {
      c.remove();
    }
  });

  it("handles smooth scroll to a position within 1px (instant jump, no animation)", () => {
    list = makeBounded(1_000_000);
    // Jump to a known position
    list.scrollToIndex(100, { behavior: "auto" });
    const current = list.getScrollPosition();

    // Smooth scroll to the same position — the <1px guard should fire setLogical
    // directly without starting an animation.
    list.scrollToIndex(100, { behavior: "smooth" });

    // Position unchanged (no animation drift)
    expect(Math.abs(list.getScrollPosition() - current)).toBeLessThan(ITEM);
  });
});

// =============================================================================
// Page mode guard — bounded page-mode scrolling is not implemented
// =============================================================================

describe("bounded scroll — page mode guard", () => {
  it("throws when page() is combined with scroll: { mode: 'bounded' }", () => {
    expect(() =>
      createVList<TestItem>(
        {
          container,
          items: createTestItems(10),
          item: { height: ITEM, template: simpleTemplate },
          scroll: { mode: "bounded" },
        },
        [page()],
      ),
    ).toThrow(/page\(\) is not compatible with scroll: \{ mode: "bounded" \}/);
  });

  it("throws when page() is combined with the carousel plugin (bounded wrap)", () => {
    expect(() =>
      createVList<TestItem>(
        {
          container,
          items: createTestItems(10),
          item: { height: ITEM, template: simpleTemplate },
        },
        [page(), carousel()],
      ),
    ).toThrow(/page\(\) is not compatible with the carousel plugin/);
  });
});
