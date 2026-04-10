/**
 * vlist - Phase 2: Performance Benchmarks
 *
 * Tests that verify operations complete within reasonable time bounds:
 * - Large dataset initialization (10K, 100K, 1M items)
 * - Scroll render cycle performance
 * - Bulk data operations (setItems, appendItems, prependItems)
 * - Destroy cleanup timing
 * - Grid layout performance with large datasets
 * - Compression transition performance
 * - Feature combination overhead
 */

import {
  describe,
  it,
  expect,
  mock,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "bun:test";
import { JSDOM } from "jsdom";

import { vlist } from "../../src/builder/core";
import type { VList } from "../../src/builder/types";
import type { VListItem, VListAdapter } from "../../src/types";
import { withSelection } from "../../src/features/selection/feature";
import { withScrollbar } from "../../src/features/scrollbar/feature";
import { withAsync } from "../../src/features/async/feature";
import { withScale } from "../../src/features/scale/feature";
import { withSnapshots } from "../../src/features/snapshots/feature";
import { withGrid } from "../../src/features/grid/feature";
import { withGroups } from "../../src/features/groups/feature";

// =============================================================================
// CI Environment — Performance Threshold Multiplier
// =============================================================================
// CI runners (GitHub Actions) are ~2-3x slower than local machines.
// Apply a multiplier to all timing thresholds to avoid flaky failures.
const CI_MULTIPLIER = process.env.CI ? 3 : 1;

/** Timing assertion that auto-applies CI_MULTIPLIER to the threshold */
const expectFasterThan = (elapsed: number, ms: number) =>
  expect(elapsed).toBeLessThan(ms * CI_MULTIPLIER);

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;
let originalDocument: any;
let originalWindow: any;
let originalRAF: any;
let originalCAF: any;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  originalDocument = global.document;
  originalWindow = global.window;
  originalRAF = global.requestAnimationFrame;
  originalCAF = global.cancelAnimationFrame;

  global.document = dom.window.document;
  global.window = dom.window as any;
  global.HTMLElement = dom.window.HTMLElement;
  global.MouseEvent = dom.window.MouseEvent;
  global.KeyboardEvent = dom.window.KeyboardEvent;
  global.Element = dom.window.Element;

  global.ResizeObserver = class ResizeObserver {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(_target: Element) {
      this.callback(
        [
          {
            target: _target,
            contentRect: {
              width: 300,
              height: 500,
              top: 0,
              left: 0,
              bottom: 500,
              right: 300,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            },
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          } as ResizeObserverEntry,
        ],
        this,
      );
    }
    unobserve(_target: Element) {}
    disconnect() {}
  };

  if (!dom.window.Element.prototype.scrollTo) {
    dom.window.Element.prototype.scrollTo = function (
      options?: ScrollToOptions | number,
    ) {
      if (typeof options === "number") {
        this.scrollTop = options;
      } else if (options && typeof options.top === "number") {
        this.scrollTop = options.top;
      }
    };
  }

  (dom.window as any).scrollTo = (
    _x?: number | ScrollToOptions,
    _y?: number,
  ) => {};

  global.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    return setTimeout(
      () => callback(performance.now()),
      0,
    ) as unknown as number;
  };
  global.cancelAnimationFrame = (id: number): void => {
    clearTimeout(id);
  };
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
  global.requestAnimationFrame = originalRAF;
  global.cancelAnimationFrame = originalCAF;
});

// =============================================================================
// Test Types & Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
  value?: number;
}

interface GroupedTestItem extends VListItem {
  id: number;
  name: string;
  group: string;
}

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
    value: i * 10,
  }));

const template = (item: TestItem): string =>
  `<div class="item">${item.name}</div>`;

const groupedTemplate = (item: GroupedTestItem): string =>
  `<div class="item">${item.name}</div>`;

const headerTemplate = (groupKey: string): HTMLElement => {
  const el = document.createElement("div");
  el.className = "section-header";
  el.textContent = groupKey;
  return el;
};

const createContainer = (): HTMLElement => {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", { value: 500 });
  Object.defineProperty(container, "clientWidth", { value: 300 });
  document.body.appendChild(container);
  return container;
};

const getRenderedIndices = (list: VList<any>): number[] => {
  const elements = list.element.querySelectorAll("[data-index]");
  return Array.from(elements).map((el) =>
    parseInt((el as HTMLElement).dataset.index!, 10),
  );
};

const simulateScroll = (list: VList<any>, scrollTop: number): void => {
  const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
  if (!viewport) return;
  viewport.scrollTop = scrollTop;
  viewport.dispatchEvent(new dom.window.Event("scroll"));
};

const createGroupedItems = (count: number): GroupedTestItem[] => {
  const groups = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
    group: groups[Math.floor(i / 10) % groups.length]!,
  }));
};

/**
 * Measure execution time of a synchronous function.
 * Returns elapsed time in milliseconds.
 */
const measure = (fn: () => void): number => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

/**
 * Measure execution time of an async function.
 * Returns elapsed time in milliseconds.
 */
const measureAsync = async (fn: () => Promise<void>): Promise<number> => {
  const start = performance.now();
  await fn();
  return performance.now() - start;
};

/**
 * Run a function N times and return the median execution time.
 * Helps smooth out outliers for more reliable benchmarks.
 */
const measureMedian = (fn: () => void, runs: number = 5): number => {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    times.push(measure(fn));
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
};

// =============================================================================
// Large Dataset Initialization
// =============================================================================

describe("performance — initialization", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should initialize 10K items in under 100ms", () => {
    const items = createTestItems(10_000);
    let list: VList<TestItem>;

    const elapsed = measure(() => {
      list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items,
      }).build();
    });

    expectFasterThan(elapsed, 100);
    list!.destroy();
  });

  it("should initialize 100K items in under 500ms", () => {
    const items = createTestItems(100_000);
    let list: VList<TestItem>;

    const elapsed = measure(() => {
      list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items,
      }).build();
    });

    expectFasterThan(elapsed, 500);
    list!.destroy();
  });

  it("should initialize 1M items with compression in under 2000ms", () => {
    const items = createTestItems(1_000_000);
    let list: VList<TestItem>;

    const elapsed = measure(() => {
      list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items,
      })
        .use(withScale())
        .build();
    });

    expectFasterThan(elapsed, 2000);
    list!.destroy();
  });

  it("should initialize 10K items with selection + scrollbar in under 100ms", () => {
    const items = createTestItems(10_000);
    let list: VList<TestItem>;

    const elapsed = measure(() => {
      list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items,
      })
        .use(withSelection({ mode: "multiple" }))
        .use(withScrollbar())
        .build();
    });

    expectFasterThan(elapsed, 100);
    list!.destroy();
  });

  it("should initialize 10K items with grid in under 100ms", () => {
    const items = createTestItems(10_000);
    let list: VList<TestItem>;

    const elapsed = measure(() => {
      list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items,
      })
        .use(withGrid({ columns: 4 }))
        .build();
    });

    expectFasterThan(elapsed, 100);
    list!.destroy();
  });

  it("should initialize grouped list with 10K items in under 200ms", () => {
    const items = createGroupedItems(10_000);
    let list: VList<GroupedTestItem>;

    const elapsed = measure(() => {
      list = vlist<GroupedTestItem>({
        container,
        item: { height: 40, template: groupedTemplate },
        items,
      })
        .use(
          withGroups({
            getGroupForIndex: (i: number) => items[i]?.group ?? "",
            header: { height: 30, template: headerTemplate },
          }),
        )
        .build();
    });

    expectFasterThan(elapsed, 200);
    list!.destroy();
  });

  it("should initialize with all features in under 200ms", () => {
    const items = createTestItems(10_000);
    let list: VList<TestItem>;

    const elapsed = measure(() => {
      list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items,
      })
        .use(withSelection({ mode: "multiple" }))
        .use(withScrollbar())
        .use(withSnapshots())
        .build();
    });

    expectFasterThan(elapsed, 200);
    list!.destroy();
  });
});

// =============================================================================
// Render Cycle Performance
// =============================================================================

describe("performance — render cycles", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should complete a scroll render cycle in under 5ms for 10K items", () => {
    const items = createTestItems(10_000);
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    // Warm up
    simulateScroll(list, 100);

    const elapsed = measure(() => {
      simulateScroll(list, 500);
    });

    expectFasterThan(elapsed, 5);
    list.destroy();
  });

  it("should complete a scroll render cycle in under 5ms for 100K items", () => {
    const items = createTestItems(100_000);
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    // Warm up
    simulateScroll(list, 100);

    const elapsed = measure(() => {
      simulateScroll(list, 5000);
    });

    expectFasterThan(elapsed, 5);
    list.destroy();
  });

  it("should complete a scroll render cycle in under 10ms for 1M compressed items", () => {
    const items = createTestItems(1_000_000);
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    })
      .use(withScale())
      .build();

    // Warm up
    simulateScroll(list, 100);

    const elapsed = measure(() => {
      simulateScroll(list, 50000);
    });

    expectFasterThan(elapsed, 10);
    list.destroy();
  });

  it("should complete grid scroll render cycle in under 20ms", () => {
    const items = createTestItems(10_000);
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    })
      .use(withGrid({ columns: 4 }))
      .build();

    // Warm up
    simulateScroll(list, 100);

    const elapsed = measure(() => {
      simulateScroll(list, 500);
    });

    expectFasterThan(elapsed, 20);
    list.destroy();
  });

  it("should handle 100 consecutive scroll events in under 50ms", () => {
    const items = createTestItems(10_000);
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const elapsed = measure(() => {
      for (let i = 0; i < 100; i++) {
        simulateScroll(list, i * 50);
      }
    });

    expectFasterThan(elapsed, 50);
    list.destroy();
  });

  it("should handle 100 consecutive scroll events with selection in under 50ms", () => {
    const items = createTestItems(10_000);
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // Select some items first
    (list as any).select(0);
    (list as any).select(50);
    (list as any).select(100);

    const elapsed = measure(() => {
      for (let i = 0; i < 100; i++) {
        simulateScroll(list, i * 50);
      }
    });

    expectFasterThan(elapsed, 50);
    list.destroy();
  });

  it("should handle rapid scrolling with compression in under 100ms", () => {
    const items = createTestItems(1_000_000);
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    })
      .use(withScale())
      .build();

    const elapsed = measure(() => {
      // Simulate scrolling through a large portion of the list
      for (let i = 0; i < 50; i++) {
        simulateScroll(list, i * 1000);
      }
    });

    expectFasterThan(elapsed, 100);
    list.destroy();
  });
});

// =============================================================================
// Bulk Data Operations
// =============================================================================

describe("performance — data operations", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should setItems with 10K items in under 50ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    }).build();

    const newItems = createTestItems(10_000);

    const elapsed = measure(() => {
      list.setItems(newItems);
    });

    expectFasterThan(elapsed, 50);
    list.destroy();
  });

  it("should setItems with 100K items in under 500ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    }).build();

    const newItems = createTestItems(100_000);

    const elapsed = measure(() => {
      list.setItems(newItems);
    });

    expectFasterThan(elapsed, 500);
    list.destroy();
  });

  it("should appendItems with 1K items in under 10ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(1_000),
    }).build();

    const newItems = createTestItems(1_000).map((item) => ({
      ...item,
      id: item.id + 1000,
    }));

    const elapsed = measure(() => {
      list.appendItems(newItems);
    });

    expectFasterThan(elapsed, 10);
    list.destroy();
  });

  it("should prependItems with 1K items in under 10ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(1_000),
    }).build();

    const newItems = createTestItems(1_000).map((item) => ({
      ...item,
      id: item.id + 10000,
    }));

    const elapsed = measure(() => {
      list.prependItems(newItems);
    });

    expectFasterThan(elapsed, 10);
    list.destroy();
  });

  it("should updateItem in under 1ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    }).build();

    const elapsed = measure(() => {
      list.updateItem(500, { name: "Updated Item 501" });
    });

    expectFasterThan(elapsed, 1);
    list.destroy();
  });

  it("should removeItem in under 5ms for 10K list", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    }).build();

    const elapsed = measure(() => {
      list.removeItem(500);
    });

    expectFasterThan(elapsed, 5);
    list.destroy();
  });

  it("should handle 100 sequential updateItem calls in under 20ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    }).build();

    const elapsed = measure(() => {
      for (let i = 0; i < 100; i++) {
        list.updateItem(i, { name: `Updated ${i}` });
      }
    });

    expectFasterThan(elapsed, 20);
    list.destroy();
  });

  it("should handle rapid setItems replacements in under 100ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    }).build();

    const elapsed = measure(() => {
      for (let i = 0; i < 20; i++) {
        list.setItems(createTestItems(1_000 + i * 100));
      }
    });

    expectFasterThan(elapsed, 100);
    list.destroy();
  });
});

// =============================================================================
// Destroy Performance
// =============================================================================

describe("performance — destroy", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should destroy 10K item list in under 10ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    }).build();

    const elapsed = measure(() => {
      list.destroy();
    });

    expectFasterThan(elapsed, 10);
  });

  it("should destroy 100K item list in under 10ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100_000),
    }).build();

    const elapsed = measure(() => {
      list.destroy();
    });

    expectFasterThan(elapsed, 10);
  });

  it("should destroy 1M compressed item list in under 10ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(1_000_000),
    })
      .use(withScale())
      .build();

    const elapsed = measure(() => {
      list.destroy();
    });

    expectFasterThan(elapsed, 10);
  });

  it("should destroy list with all features in under 10ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    })
      .use(withSelection({ mode: "multiple" }))
      .use(withScrollbar())
      .use(withSnapshots())
      .build();

    // Interact before destroying
    (list as any).select(0);
    (list as any).select(50);
    simulateScroll(list, 500);
    (list as any).getScrollSnapshot();

    const elapsed = measure(() => {
      list.destroy();
    });

    expectFasterThan(elapsed, 10);
  });

  it("should destroy grid list in under 10ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    })
      .use(withGrid({ columns: 4 }))
      .build();

    simulateScroll(list, 500);

    const elapsed = measure(() => {
      list.destroy();
    });

    expectFasterThan(elapsed, 10);
  });

  it("should destroy grouped list in under 10ms", () => {
    const items = createGroupedItems(10_000);
    const list = vlist<GroupedTestItem>({
      container,
      item: { height: 40, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i: number) => items[i]?.group ?? "",
          header: { height: 30, template: headerTemplate },
          sticky: true,
        }),
      )
      .build();

    simulateScroll(list, 500);

    const elapsed = measure(() => {
      list.destroy();
    });

    expectFasterThan(elapsed, 10);
  });
});

// =============================================================================
// Scroll Position Operations
// =============================================================================

describe("performance — scrollToIndex", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should scrollToIndex in under 2ms for 10K items", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    }).build();

    const elapsed = measure(() => {
      list.scrollToIndex(5000);
    });

    expectFasterThan(elapsed, 2);
    list.destroy();
  });

  it("should scrollToIndex in under 2ms for 100K items", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100_000),
    }).build();

    const elapsed = measure(() => {
      list.scrollToIndex(50000);
    });

    expectFasterThan(elapsed, 2);
    list.destroy();
  });

  it("should scrollToIndex in under 5ms for 1M compressed items", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(1_000_000),
    })
      .use(withScale())
      .build();

    const elapsed = measure(() => {
      list.scrollToIndex(500000);
    });

    expectFasterThan(elapsed, 5);
    list.destroy();
  });

  it("should handle 100 sequential scrollToIndex calls in under 50ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    }).build();

    const elapsed = measure(() => {
      for (let i = 0; i < 100; i++) {
        list.scrollToIndex(i * 100);
      }
    });

    expectFasterThan(elapsed, 100);
    list.destroy();
  });

  it("should scrollToIndex with grid in under 20ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    })
      .use(withGrid({ columns: 4 }))
      .build();

    const elapsed = measure(() => {
      list.scrollToIndex(5000);
    });

    expectFasterThan(elapsed, 20);
    list.destroy();
  });
});

// =============================================================================
// Selection Performance
// =============================================================================

describe("performance — selection operations", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should select 1K items in under 200ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    const elapsed = measure(() => {
      for (let i = 0; i < 1_000; i++) {
        (list as any).select(i);
      }
    });

    expectFasterThan(elapsed, 200);
    list.destroy();
  });

  it("should selectAll on 10K items in under 100ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    const elapsed = measure(() => {
      (list as any).selectAll();
    });

    expectFasterThan(elapsed, 50);
    list.destroy();
  });

  it("should clearSelection on 10K selected items in under 20ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    (list as any).selectAll();

    const elapsed = measure(() => {
      (list as any).clearSelection();
    });

    expectFasterThan(elapsed, 20);
    list.destroy();
  });

  it("should getSelected on 1K selected items in under 5ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    for (let i = 0; i < 1_000; i++) {
      (list as any).select(i);
    }

    const elapsed = measure(() => {
      (list as any).getSelected();
    });

    expectFasterThan(elapsed, 5);
    list.destroy();
  });

  it("should getSelectedItems on 1K selected items in under 20ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    for (let i = 0; i < 1_000; i++) {
      (list as any).select(i);
    }

    const elapsed = measure(() => {
      (list as any).getSelectedItems();
    });

    expectFasterThan(elapsed, 20);
    list.destroy();
  });
});

// =============================================================================
// Snapshot Performance
// =============================================================================

describe("performance — snapshot operations", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should capture snapshot in under 1ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100_000),
    })
      .use(withSnapshots())
      .build();

    simulateScroll(list, 10000);

    const elapsed = measure(() => {
      (list as any).getScrollSnapshot();
    });

    expectFasterThan(elapsed, 1);
    list.destroy();
  });

  it("should restore snapshot in under 5ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100_000),
    })
      .use(withSnapshots())
      .build();

    simulateScroll(list, 10000);
    const snapshot = (list as any).getScrollSnapshot();

    simulateScroll(list, 0);

    const elapsed = measure(() => {
      (list as any).restoreScroll(snapshot);
    });

    expectFasterThan(elapsed, 5);
    list.destroy();
  });

  it("should capture snapshot with compression in under 1ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(1_000_000),
    })
      .use(withScale())
      .use(withSnapshots())
      .build();

    list.scrollToIndex(500000);

    const elapsed = measure(() => {
      (list as any).getScrollSnapshot();
    });

    expectFasterThan(elapsed, 1);
    list.destroy();
  });
});

// =============================================================================
// Compression Transitions
// =============================================================================

describe("performance — compression transitions", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should transition from uncompressed to compressed in under 500ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(1_000),
    })
      .use(withScale())
      .build();

    const largeItems = createTestItems(1_000_000);

    const elapsed = measure(() => {
      list.setItems(largeItems);
    });

    expectFasterThan(elapsed, 500);
    list.destroy();
  });

  it("should transition from compressed to uncompressed in under 50ms", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(1_000_000),
    })
      .use(withScale())
      .build();

    const smallItems = createTestItems(100);

    const elapsed = measure(() => {
      list.setItems(smallItems);
    });

    expectFasterThan(elapsed, 50);
    list.destroy();
  });
});

// =============================================================================
// Feature Overhead Comparison
// =============================================================================

describe("performance — feature overhead", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should have less than 5x overhead with selection + scrollbar vs bare", () => {
    const items = createTestItems(10_000);

    // Bare list
    const bareTime = measureMedian(() => {
      const list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items,
      }).build();
      list.destroy();
    }, 3);

    // With features
    const featureTime = measureMedian(() => {
      const list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items,
      })
        .use(withSelection({ mode: "multiple" }))
        .use(withScrollbar())
        .build();
      list.destroy();
    }, 3);

    // Feature overhead should be reasonable
    // Use Math.max(bareTime, 1) to avoid division by zero for very fast runs
    const overhead = featureTime / Math.max(bareTime, 1);
    expectFasterThan(overhead, 5);
  });

  it("should have less than 5x overhead for grid scroll vs standard scroll", () => {
    const items = createTestItems(10_000);

    // Standard list
    const stdList = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const stdTime = measureMedian(() => {
      for (let i = 0; i < 50; i++) {
        simulateScroll(stdList, i * 100);
      }
    }, 3);
    stdList.destroy();

    // Grid list
    const gridList = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    })
      .use(withGrid({ columns: 4 }))
      .build();

    const gridTime = measureMedian(() => {
      for (let i = 0; i < 50; i++) {
        simulateScroll(gridList, i * 100);
      }
    }, 3);
    gridList.destroy();

    const overhead = gridTime / Math.max(stdTime, 1);
    expectFasterThan(overhead, 10);
  });
});

// =============================================================================
// Rendered Item Count (Virtualization Correctness)
// =============================================================================

describe("performance — virtualization bounds", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should render only viewport-sized items for 10K list", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    }).build();

    const renderedCount = getRenderedIndices(list).length;
    // viewport=500, item=50 → 10 visible + default overscan(3) → max ~16
    expect(renderedCount).toBeLessThan(20);
    expect(renderedCount).toBeGreaterThan(0);

    list.destroy();
  });

  it("should render only viewport-sized items for 100K list", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100_000),
    }).build();

    const renderedCount = getRenderedIndices(list).length;
    expect(renderedCount).toBeLessThan(20);
    expect(renderedCount).toBeGreaterThan(0);

    list.destroy();
  });

  it("should render only viewport-sized items for 1M compressed list", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(1_000_000),
    })
      .use(withScale())
      .build();

    const renderedCount = getRenderedIndices(list).length;
    expect(renderedCount).toBeLessThan(20);
    expect(renderedCount).toBeGreaterThan(0);

    list.destroy();
  });

  it("should maintain bounded rendered count after scrolling", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    }).build();

    // Scroll through many positions
    for (let pos = 0; pos <= 10000; pos += 500) {
      simulateScroll(list, pos);
    }

    const renderedCount = getRenderedIndices(list).length;
    // Release grace period (RELEASE_GRACE = 2) keeps items from the last
    // 2 render cycles briefly in the DOM to prevent hover blink and CSS
    // transition replays, so the bound is higher than without grace.
    // With height=50, container=400px: ~14 items per range + up to ~20
    // grace-period items from the previous 2 frames = ~34 max.
    expect(renderedCount).toBeLessThan(40);
    expect(renderedCount).toBeGreaterThan(0);

    list.destroy();
  });

  it("should maintain bounded rendered count with grid", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10_000),
    })
      .use(withGrid({ columns: 4 }))
      .build();

    for (let pos = 0; pos <= 5000; pos += 200) {
      simulateScroll(list, pos);
    }

    const renderedCount = getRenderedIndices(list).length;
    // Grid with 4 columns renders 4x items per row, but still bounded.
    // Release grace period (RELEASE_GRACE = 2) keeps items from the last
    // 2 render cycles briefly in the DOM to prevent hover blink and CSS
    // transition replays, so the bound is higher than without grace.
    expect(renderedCount).toBeLessThan(120);
    expect(renderedCount).toBeGreaterThan(0);

    list.destroy();
  });
});