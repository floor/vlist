/**
 * vlist v2 — Performance Integration Tests
 *
 * Tests that critical operations complete within reasonable time bounds.
 * These are not micro-benchmarks — they verify scaling behavior and
 * catch O(n²) regressions that unit tests can't.
 *
 * Timing thresholds are generous (10-50x headroom over typical) to avoid
 * flaky failures in CI while still catching algorithmic regressions.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import { createSizeCache } from "../../src/rendering/sizes";

// =============================================================================
// DOM Setup
// =============================================================================

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  setupDOM();
  origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
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

function measure(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function measureMedian(fn: () => void, runs: number = 5): number {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    times.push(measure(fn));
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

// CI environments are slower — apply multiplier
const CI_MULT = process.env.CI ? 5 : 1;

// =============================================================================
// Initialization performance
// =============================================================================

describe("performance — initialization", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 500 });
  });
  afterEach(() => {
    container.remove();
  });

  it("10K items initializes in under 50ms", () => {
    const items = createTestItems(10_000);
    let list: ReturnType<typeof createVList> | null = null;

    const elapsed = measure(() => {
      list = createVList({
        container,
        items,
        item: { height: 50, template: simpleTemplate },
      }, []);
    });

    expect(elapsed).toBeLessThan(50 * CI_MULT);
    list!.destroy();
  });

  it("100K items initializes in under 200ms", () => {
    const items = createTestItems(100_000);
    let list: ReturnType<typeof createVList> | null = null;

    const elapsed = measure(() => {
      list = createVList({
        container,
        items,
        item: { height: 50, template: simpleTemplate },
      }, []);
    });

    expect(elapsed).toBeLessThan(200 * CI_MULT);
    list!.destroy();
  });
});

// =============================================================================
// Bulk data operations
// =============================================================================

describe("performance — bulk data operations", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 500 });
  });
  afterEach(() => {
    container.remove();
  });

  it("setItems with 10K items completes in under 50ms", () => {
    const list = createVList({
      container,
      items: createTestItems(100),
      item: { height: 50, template: simpleTemplate },
    }, []);

    const newItems = createTestItems(10_000);

    const elapsed = measure(() => {
      list.setItems(newItems);
    });

    expect(elapsed).toBeLessThan(50 * CI_MULT);
    list.destroy();
  });

  it("appendItems with 1K items completes in under 20ms", () => {
    const list = createVList({
      container,
      items: createTestItems(1000),
      item: { height: 50, template: simpleTemplate },
    }, []);

    const moreItems = createTestItems(1000, 1001);

    const elapsed = measure(() => {
      list.appendItems(moreItems);
    });

    expect(elapsed).toBeLessThan(20 * CI_MULT);
    list.destroy();
  });

  it("prependItems with 1K items completes in under 20ms", () => {
    const list = createVList({
      container,
      items: createTestItems(1000, 1001),
      item: { height: 50, template: simpleTemplate },
    }, []);

    const moreItems = createTestItems(1000);

    const elapsed = measure(() => {
      list.prependItems(moreItems);
    });

    expect(elapsed).toBeLessThan(20 * CI_MULT);
    list.destroy();
  });
});

// =============================================================================
// Size cache operations — O(1) and O(log n)
// =============================================================================

describe("performance — size cache operations", () => {
  it("fixed sizeCache: 10K getOffset calls in under 5ms", () => {
    const cache = createSizeCache(50, 100_000);

    const elapsed = measure(() => {
      for (let i = 0; i < 10_000; i++) {
        cache.getOffset((i * 7) % 100_000);
      }
    });

    expect(elapsed).toBeLessThan(5 * CI_MULT);
  });

  it("fixed sizeCache: 10K indexAtOffset calls in under 5ms", () => {
    const cache = createSizeCache(50, 100_000);
    const total = cache.getTotalSize();

    const elapsed = measure(() => {
      for (let i = 0; i < 10_000; i++) {
        cache.indexAtOffset((i * 37) % total);
      }
    });

    expect(elapsed).toBeLessThan(5 * CI_MULT);
  });

  it("variable sizeCache: 1K indexAtOffset calls in under 10ms", () => {
    const sizes = (index: number): number => 30 + (index % 5) * 10;
    const cache = createSizeCache(sizes, 100_000);

    const elapsed = measure(() => {
      for (let i = 0; i < 1_000; i++) {
        const offset = (i * 137) % cache.getTotalSize();
        cache.indexAtOffset(offset);
      }
    });

    expect(elapsed).toBeLessThan(10 * CI_MULT);
  });

  it("sizeCache rebuild: 100K items in under 50ms", () => {
    const cache = createSizeCache(50, 1000);

    const elapsed = measure(() => {
      cache.rebuild(100_000);
    });

    expect(elapsed).toBeLessThan(50 * CI_MULT);
  });
});

// =============================================================================
// Virtualization bounds
// =============================================================================

describe("performance — virtualization bounds", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 500 });
  });
  afterEach(() => {
    container.remove();
  });

  it("rendered DOM count stays bounded regardless of dataset size", () => {
    const sizes = [100, 1_000, 10_000, 100_000];

    for (const size of sizes) {
      const items = createTestItems(size);
      const list = createVList({
        container,
        items,
        item: { height: 50, template: simpleTemplate },
      }, []);

      const contentEl = container.querySelector(".vlist-content");
      const renderedCount = contentEl?.children.length ?? 0;

      // Viewport=500, itemHeight=50 → ~10 visible + overscan
      // Should never render more than ~30 items
      expect(renderedCount).toBeLessThan(40);

      list.destroy();
    }
  });

  it("total property reflects full dataset size", () => {
    const sizes = [100, 10_000, 100_000];

    for (const size of sizes) {
      const items = createTestItems(size);
      const list = createVList({
        container,
        items,
        item: { height: 50, template: simpleTemplate },
      }, []);

      expect(list.total).toBe(size);
      list.destroy();
    }
  });
});

// =============================================================================
// Destroy performance
// =============================================================================

describe("performance — destroy", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 500 });
  });
  afterEach(() => {
    container.remove();
  });

  it("destroy of 10K-item list completes in under 20ms", () => {
    const list = createVList({
      container,
      items: createTestItems(10_000),
      item: { height: 50, template: simpleTemplate },
    }, []);

    const elapsed = measure(() => {
      list.destroy();
    });

    expect(elapsed).toBeLessThan(20 * CI_MULT);
  });

  it("destroy of 100K-item list completes in under 50ms", () => {
    const list = createVList({
      container,
      items: createTestItems(100_000),
      item: { height: 50, template: simpleTemplate },
    }, []);

    const elapsed = measure(() => {
      list.destroy();
    });

    expect(elapsed).toBeLessThan(50 * CI_MULT);
  });
});

// =============================================================================
// scrollToIndex performance
// =============================================================================

describe("performance — scrollToIndex", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 500 });
  });
  afterEach(() => {
    container.remove();
  });

  it("scrollToIndex in 100K list completes in under 10ms", () => {
    const list = createVList({
      container,
      items: createTestItems(100_000),
      item: { height: 50, template: simpleTemplate },
    }, []);

    const elapsed = measureMedian(() => {
      list.scrollToIndex(50_000);
    }, 3);

    expect(elapsed).toBeLessThan(10 * CI_MULT);
    list.destroy();
  });

  it("scrollToIndex with different alignments", () => {
    const list = createVList({
      container,
      items: createTestItems(10_000),
      item: { height: 50, template: simpleTemplate },
    }, []);

    const elapsed = measure(() => {
      list.scrollToIndex(5000, "start");
      list.scrollToIndex(5000, "center");
      list.scrollToIndex(5000, "end");
    });

    expect(elapsed).toBeLessThan(10 * CI_MULT);
    list.destroy();
  });
});

// =============================================================================
// Scaling: no O(n²) regression
// =============================================================================

describe("performance — scaling behavior (no O(n²))", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 500 });
  });
  afterEach(() => {
    container.remove();
  });

  it("10x more items should take less than 10x longer to init", () => {
    const small = createTestItems(1_000);
    const large = createTestItems(10_000);

    const smallTime = measureMedian(() => {
      const list = createVList({
        container,
        items: small,
        item: { height: 50, template: simpleTemplate },
      }, []);
      list.destroy();
    }, 3);

    const largeTime = measureMedian(() => {
      const list = createVList({
        container,
        items: large,
        item: { height: 50, template: simpleTemplate },
      }, []);
      list.destroy();
    }, 3);

    // If O(n), ratio should be ~10. Allow up to 20x to handle constant factors.
    // But NOT 100x which would indicate O(n²).
    const ratio = largeTime / Math.max(smallTime, 0.1);
    expect(ratio).toBeLessThan(20);
  });

  it("setItems scaling: 10x more items < 15x time", () => {
    const list = createVList({
      container,
      items: createTestItems(100),
      item: { height: 50, template: simpleTemplate },
    }, []);

    const small = createTestItems(1_000);
    const large = createTestItems(10_000);

    const smallTime = measureMedian(() => {
      list.setItems(small);
    }, 3);

    const largeTime = measureMedian(() => {
      list.setItems(large);
    }, 3);

    const ratio = largeTime / Math.max(smallTime, 0.1);
    expect(ratio).toBeLessThan(15);

    list.destroy();
  });
});
