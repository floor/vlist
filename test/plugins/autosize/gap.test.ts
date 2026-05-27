/**
 * vlist v2 — Autosize Gap Handling Tests
 *
 * Verifies that the autosize plugin correctly handles gap configuration:
 * gap added to estimatedSize, gap added to measured sizes, gap subtracted
 * from getTotalSize, and scroll compensation delta includes gap.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";

import { autosize } from "../../../src/plugins/autosize/plugin";
import type { VListItem } from "../../../src/types";
import { createPluginMockContext } from "../../helpers/plugin-context";
import { setupDOM, teardownDOM } from "../../helpers/dom";

// =============================================================================
// DOM Setup
// =============================================================================

let roInstances: Array<{
  callback: ResizeObserverCallback;
  observed: Map<Element, number>;
}> = [];

beforeAll(() => {
  setupDOM({ immediateResize: false });

  // Custom ResizeObserver that lets us control when callbacks fire
  (global as any).ResizeObserver = class {
    callback: ResizeObserverCallback;
    observed: Map<Element, number>;

    constructor(cb: ResizeObserverCallback) {
      this.callback = cb;
      this.observed = new Map();
      roInstances.push({ callback: cb, observed: this.observed });
    }

    observe(target: Element): void {
      const el = target as HTMLElement;
      const idx = parseInt(el.dataset?.index ?? "-1", 10);
      this.observed.set(target, idx);
    }

    unobserve(target: Element): void {
      this.observed.delete(target);
    }

    disconnect(): void {
      this.observed.clear();
    }
  };
});

afterAll(() => teardownDOM());

// =============================================================================
// Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Item ${i}` }));

function fireRO(
  el: HTMLElement,
  blockSize: number,
  inlineSize: number = blockSize,
): void {
  const entry: ResizeObserverEntry = {
    target: el,
    contentRect: {
      width: inlineSize,
      height: blockSize,
      top: 0, left: 0, bottom: blockSize, right: inlineSize,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRectReadOnly,
    borderBoxSize: [{ blockSize, inlineSize } as ResizeObserverSize],
    contentBoxSize: [{ blockSize, inlineSize } as ResizeObserverSize],
    devicePixelContentBoxSize: [],
  };

  for (const inst of roInstances) {
    if (inst.observed.has(el)) {
      inst.callback([entry], {} as ResizeObserver);
    }
  }
}

// =============================================================================
// Gap config application
// =============================================================================

describe("autosize — gap config", () => {
  let mockCtx: ReturnType<typeof createPluginMockContext<TestItem>>;

  beforeEach(() => {
    roInstances = [];
    mockCtx = createPluginMockContext(createTestItems(10), {
      itemSize: 50,
      containerWidth: 300,
      containerHeight: 500,
    });
  });

  afterEach(() => {
    mockCtx.cleanup();
  });

  it("sizeFn returns estimatedSize + gap for unmeasured items", () => {
    let registeredSizeFn: ((index: number) => number) | null = null;
    mockCtx.ctx.setSizeConfig = (fn: number | ((index: number) => number)) => {
      if (typeof fn === "function") registeredSizeFn = fn;
    };

    const plugin = autosize({ gap: 8 });
    plugin.setup(mockCtx.ctx);

    // estimatedSize = rawSizeSpec (50) + gap (8) = 58
    expect(registeredSizeFn).not.toBeNull();
    expect(registeredSizeFn!(0)).toBe(58);
    expect(registeredSizeFn!(5)).toBe(58);

    plugin.destroy!();
  });

  it("sizeFn returns measured size + gap after measurement", () => {
    let registeredSizeFn: ((index: number) => number) | null = null;
    mockCtx.ctx.setSizeConfig = (fn: number | ((index: number) => number)) => {
      if (typeof fn === "function") registeredSizeFn = fn;
    };

    const plugin = autosize({ gap: 8 });
    plugin.setup(mockCtx.ctx);

    // Manually set a measured size
    const setMeasuredSize = mockCtx.methods.get("setMeasuredSize") as (i: number, s: number) => void;
    setMeasuredSize(3, 80 + 8); // stored as sizeWithGap

    expect(registeredSizeFn!(3)).toBe(88); // measured value returned as-is
    expect(registeredSizeFn!(4)).toBe(58); // still unmeasured

    plugin.destroy!();
  });

  it("falls back to ctx.config.gap when plugin gap is 0", () => {
    let registeredSizeFn: ((index: number) => number) | null = null;
    mockCtx.ctx.setSizeConfig = (fn: number | ((index: number) => number)) => {
      if (typeof fn === "function") registeredSizeFn = fn;
    };

    // Set gap on the resolved config
    (mockCtx.ctx.config as any).gap = 12;

    const plugin = autosize(); // no explicit gap
    plugin.setup(mockCtx.ctx);

    // estimatedSize = rawSizeSpec (50) + gap (12) = 62
    expect(registeredSizeFn!(0)).toBe(62);

    plugin.destroy!();
  });

  it("getTotalSize is adjusted by subtracting gap when gap > 0", () => {
    const plugin = autosize({ gap: 8 });
    plugin.setup(mockCtx.ctx);

    // The plugin wraps sizeCache.getTotalSize to subtract gap
    const totalSize = mockCtx.ctx.sizeCache.getTotalSize();
    const rawTotal = 10 * 50; // 10 items × 50px
    // Adjusted: rawTotal - gap = 500 - 8 = 492
    expect(totalSize).toBe(rawTotal - 8);

    plugin.destroy!();
  });

  it("getTotalSize is not adjusted when gap is 0", () => {
    const plugin = autosize({ gap: 0 });
    plugin.setup(mockCtx.ctx);

    const totalSize = mockCtx.ctx.sizeCache.getTotalSize();
    const rawTotal = 10 * 50;
    expect(totalSize).toBe(rawTotal);

    plugin.destroy!();
  });
});

// =============================================================================
// ResizeObserver measurement with gap
// =============================================================================

describe("autosize — measurement with gap", () => {
  let mockCtx: ReturnType<typeof createPluginMockContext<TestItem>>;

  beforeEach(() => {
    roInstances = [];
    mockCtx = createPluginMockContext(createTestItems(10), {
      itemSize: 50,
      containerWidth: 300,
      containerHeight: 500,
    });
  });

  afterEach(() => {
    mockCtx.cleanup();
  });

  it("ResizeObserver stores measured size + gap in measuredSizes", () => {
    let registeredSizeFn: ((index: number) => number) | null = null;
    mockCtx.ctx.setSizeConfig = (fn: number | ((index: number) => number)) => {
      if (typeof fn === "function") registeredSizeFn = fn;
    };

    const plugin = autosize({ gap: 8 });
    plugin.setup(mockCtx.ctx);

    // Simulate rendering and observation
    const el = document.createElement("div");
    el.setAttribute("data-index", "2");
    mockCtx.dom.content.appendChild(el);

    mockCtx.engineState.visibleCount = 1;
    mockCtx.engineState.visibleIndices[0] = 2;
    mockCtx.ctx.getRenderedElement = (idx: number) => (idx === 2 ? el : null);

    plugin.hooks!.onCommit!(mockCtx.engineState);

    // Fire RO with a measured height of 72px
    fireRO(el, 72);

    // Stored as: 72 + 8 = 80
    const isMeasured = mockCtx.methods.get("isMeasured") as (i: number) => boolean;
    expect(isMeasured(2)).toBe(true);
    expect(registeredSizeFn!(2)).toBe(80);

    plugin.destroy!();
  });

  it("scroll compensation delta includes gap", () => {
    let registeredSizeFn: ((index: number) => number) | null = null;
    mockCtx.ctx.setSizeConfig = (fn: number | ((index: number) => number)) => {
      if (typeof fn === "function") registeredSizeFn = fn;
    };

    const plugin = autosize({ gap: 8 });
    plugin.setup(mockCtx.ctx);

    // Position viewport at index 5 (items 0-4 are above)
    mockCtx.engineState.startIndex = 5;
    mockCtx.engineState.scrollPosition = 290; // 5 * 58 = 290

    // Simulate rendering item at index 2 (above viewport)
    const el = document.createElement("div");
    el.setAttribute("data-index", "2");
    mockCtx.dom.content.appendChild(el);

    mockCtx.engineState.visibleCount = 1;
    mockCtx.engineState.visibleIndices[0] = 2;
    mockCtx.ctx.getRenderedElement = (idx: number) => (idx === 2 ? el : null);

    plugin.hooks!.onCommit!(mockCtx.engineState);

    // Fire RO with measured height of 80px (larger than estimated 50)
    // sizeWithGap = 80 + 8 = 88, estimatedSize = 58
    // delta = 88 - 58 = 30
    fireRO(el, 80);

    // scrollTo should have been called with scrollPosition + 30
    expect(mockCtx.scrollCalls.length).toBeGreaterThan(0);
    expect(mockCtx.scrollCalls[0]).toBe(290 + 30);

    plugin.destroy!();
  });

  it("no scroll compensation for items at or after viewport start", () => {
    let registeredSizeFn: ((index: number) => number) | null = null;
    mockCtx.ctx.setSizeConfig = (fn: number | ((index: number) => number)) => {
      if (typeof fn === "function") registeredSizeFn = fn;
    };

    const plugin = autosize({ gap: 8 });
    plugin.setup(mockCtx.ctx);

    // Position viewport at index 2
    mockCtx.engineState.startIndex = 2;
    mockCtx.engineState.scrollPosition = 116; // 2 * 58

    // Measure item at index 3 (at or after viewport start)
    const el = document.createElement("div");
    el.setAttribute("data-index", "3");
    mockCtx.dom.content.appendChild(el);

    mockCtx.engineState.visibleCount = 1;
    mockCtx.engineState.visibleIndices[0] = 3;
    mockCtx.ctx.getRenderedElement = (idx: number) => (idx === 3 ? el : null);

    plugin.hooks!.onCommit!(mockCtx.engineState);

    // Fire RO with different size — no scroll compensation expected
    fireRO(el, 80);

    // scrollTo may be called but not for compensation (only if atBottom snap)
    // Check that no scroll delta was applied relative to current position
    const compensationCalls = mockCtx.scrollCalls.filter(
      (pos) => pos !== mockCtx.engineState.scrollPosition,
    );
    // If there are scroll calls, they should NOT include compensation delta
    // (item at index 3 >= startIndex 2, so no delta)
    for (const pos of compensationCalls) {
      expect(pos).not.toBe(116 + 30); // no compensation of 30px
    }

    plugin.destroy!();
  });
});
