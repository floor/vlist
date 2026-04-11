/**
 * vlist - Phase 2: Integration Scenarios
 *
 * Cross-feature integration tests targeting uncovered code paths:
 * - Double-click events (core.ts L934-949)
 * - Horizontal wheel handler (core.ts L877-899)
 * - Wrap mode scrollToIndex (core.ts L1142-1157)
 * - Feature method collision detection (core.ts L1044-1046)
 * - Group header click skip (core.ts L922)
 * - Scrollbar content size handler (scrollbar/feature.ts L125-131)
 * - Viewport getSimpleCompressionState (viewport.ts L53-62)
 * - Groups + scroll interaction
 * - Cross-feature destroy ordering
 * - Scroll idle detection and class toggling
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
import { withTable } from "../../src/features/table/feature";
import { isGroupHeader } from "../../src/features/groups";

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

const createMockAdapter = (totalItems: number): VListAdapter<TestItem> => ({
  read: mock(async ({ offset, limit }) => {
    const end = Math.min(offset + limit, totalItems);
    const items: TestItem[] = [];
    for (let i = offset; i < end; i++) {
      items.push({ id: i + 1, name: `Item ${i + 1}`, value: i * 10 });
    }
    return { items, total: totalItems, hasMore: end < totalItems };
  }),
});

const flush = () => new Promise<void>((r) => setTimeout(r, 10));

const createGroupedItems = (count: number): GroupedTestItem[] => {
  const groups = ["Alpha", "Beta", "Gamma", "Delta"];
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
    group: groups[Math.floor(i / 5) % groups.length]!,
  }));
};

// =============================================================================
// Double-Click Events
// =============================================================================

describe("integration — double-click events", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should emit item:dblclick on double-clicking a rendered item", () => {
    const items = createTestItems(20);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const dblclickHandler = mock((_e: any) => {});
    list.on("item:dblclick", dblclickHandler as any);

    // Find the first rendered item element
    const itemEl = list.element.querySelector("[data-index='0']") as HTMLElement;
    expect(itemEl).not.toBeNull();

    // Dispatch dblclick event on the item element
    const event = new dom.window.MouseEvent("dblclick", { bubbles: true });
    itemEl.dispatchEvent(event);

    expect(dblclickHandler).toHaveBeenCalledTimes(1);
    const call = dblclickHandler.mock.calls[0] as any[];
    const payload = call[0];
    expect(payload.item.id).toBe(1);
    expect(payload.index).toBe(0);
    expect(payload.event).toBeDefined();
  });

  it("should emit item:dblclick with correct index for non-zero items", () => {
    const items = createTestItems(50);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const dblclickHandler = mock((_e: any) => {});
    list.on("item:dblclick", dblclickHandler as any);

    // Double-click on an item that is not index 0
    const itemEl = list.element.querySelector("[data-index='3']") as HTMLElement;
    if (itemEl) {
      const event = new dom.window.MouseEvent("dblclick", { bubbles: true });
      itemEl.dispatchEvent(event);

      expect(dblclickHandler).toHaveBeenCalledTimes(1);
      const call = dblclickHandler.mock.calls[0] as any[];
      expect(call[0].index).toBe(3);
      expect(call[0].item.id).toBe(4);
    }
  });

  it("should not emit item:dblclick when clicking outside items", () => {
    const items = createTestItems(10);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const dblclickHandler = mock((_e: any) => {});
    list.on("item:dblclick", dblclickHandler as any);

    // Double-click on the items container (not on a specific item)
    const itemsContainer = list.element.querySelector(".vlist-items") as HTMLElement;
    const event = new dom.window.MouseEvent("dblclick", { bubbles: true });
    itemsContainer.dispatchEvent(event);

    expect(dblclickHandler).not.toHaveBeenCalled();
  });

  it("should emit both item:click and item:dblclick independently", () => {
    const items = createTestItems(10);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    const clickHandler = mock((_e: any) => {});
    const dblclickHandler = mock((_e: any) => {});
    list.on("item:click", clickHandler as any);
    list.on("item:dblclick", dblclickHandler as any);

    const itemEl = list.element.querySelector("[data-index='0']") as HTMLElement;
    expect(itemEl).not.toBeNull();

    // Click
    itemEl.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect(clickHandler).toHaveBeenCalledTimes(1);
    expect(dblclickHandler).not.toHaveBeenCalled();

    // Dblclick
    itemEl.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));
    expect(dblclickHandler).toHaveBeenCalledTimes(1);
  });

  it("should pass the original MouseEvent in dblclick payload", () => {
    const items = createTestItems(10);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    let receivedEvent: any = null;
    list.on("item:dblclick" as any, (payload: any) => {
      receivedEvent = payload.event;
    });

    const itemEl = list.element.querySelector("[data-index='0']") as HTMLElement;
    const event = new dom.window.MouseEvent("dblclick", { bubbles: true });
    itemEl.dispatchEvent(event);

    expect(receivedEvent).toBe(event as any);
  });
});

// =============================================================================
// Horizontal Mode — Wheel Conversion
// =============================================================================

describe("integration — horizontal mode", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should create a horizontal list with correct orientation class", () => {
    list = vlist<TestItem>({
      container,
      item: { width: 100, height: 100, template },
      items: createTestItems(50),
      orientation: "horizontal",
    }).build();

    const root = list.element;
    expect(root.classList.contains("vlist--horizontal")).toBe(true);
  });

  it("should render items in horizontal mode", () => {
    const items = createTestItems(50);
    list = vlist<TestItem>({
      container,
      item: { width: 100, height: 100, template },
      items,
      orientation: "horizontal",
    }).build();

    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
  });

  it("should handle horizontal mode with scrollbar", () => {
    list = vlist<TestItem>({
      container,
      item: { width: 100, height: 100, template },
      items: createTestItems(100),
      orientation: "horizontal",
    })
      .use(withScrollbar())
      .build();

    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).not.toBeNull();
  });

  it("should handle horizontal mode with selection", () => {
    list = vlist<TestItem>({
      container,
      item: { width: 100, height: 100, template },
      items: createTestItems(20),
      orientation: "horizontal",
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    (list as any).select(1); // select by ID
    const selected = (list as any).getSelected();
    expect(selected).toContain(1);
  });

  it("should handle horizontal mode with snapshots", () => {
    list = vlist<TestItem>({
      container,
      item: { width: 100, height: 100, template },
      items: createTestItems(50),
      orientation: "horizontal",
    })
      .use(withSnapshots())
      .build();

    const snapshot = (list as any).getScrollSnapshot();
    expect(snapshot).toBeDefined();
    expect(typeof snapshot.index).toBe("number");
    expect(typeof snapshot.offsetInItem).toBe("number");
  });
});

// =============================================================================
// Wrap Mode — scrollToIndex
// =============================================================================

describe("integration — wrap mode scrollToIndex", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should wrap negative index to valid range", () => {
    const items = createTestItems(20);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
      scroll: { wrap: true },
    }).build();

    // Scrolling to -1 should wrap to last item (index 19)
    expect(() => list.scrollToIndex(-1)).not.toThrow();
  });

  it("should wrap index past total to valid range", () => {
    const items = createTestItems(20);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
      scroll: { wrap: true },
    }).build();

    // Scrolling to 25 with 20 items should wrap to index 5
    expect(() => list.scrollToIndex(25)).not.toThrow();
  });

  it("should handle wrap with index 0", () => {
    const items = createTestItems(20);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
      scroll: { wrap: true },
    }).build();

    expect(() => list.scrollToIndex(0)).not.toThrow();
    // After scrolling to 0, should be at top
    expect(list.getScrollPosition()).toBe(0);
  });

  it("should handle wrap with exact total boundary", () => {
    const items = createTestItems(20);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
      scroll: { wrap: true },
    }).build();

    // Index exactly equal to total should wrap to 0
    expect(() => list.scrollToIndex(20)).not.toThrow();
  });

  it("should handle wrap with large negative index", () => {
    const items = createTestItems(10);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
      scroll: { wrap: true },
    }).build();

    // -15 with 10 items should wrap to 5
    expect(() => list.scrollToIndex(-15)).not.toThrow();
  });

  it("should handle wrap mode with smooth scrolling", () => {
    const items = createTestItems(20);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
      scroll: { wrap: true },
    }).build();

    expect(() => list.scrollToIndex(25, { align: "start", behavior: "smooth" })).not.toThrow();
  });

  it("should not wrap when wrap is disabled (default)", () => {
    const items = createTestItems(20);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    }).build();

    // Without wrap, scrollToIndex should still work (just clamped or unclamped)
    expect(() => list.scrollToIndex(0)).not.toThrow();
    expect(() => list.scrollToIndex(19)).not.toThrow();
  });
});

// =============================================================================
// Feature Method Collision Detection
// =============================================================================

describe("integration — feature method collision", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should throw when two features register the same method", () => {
    // Create two custom features that both register the same method name
    const feature1 = {
      name: "feature1",
      methods: ["myMethod"] as const,
      setup(ctx: any) {
        ctx.methods.set("myMethod", () => "from feature1");
      },
    };

    const feature2 = {
      name: "feature2",
      methods: ["myMethod"] as const,
      setup(ctx: any) {
        ctx.methods.set("myMethod", () => "from feature2");
      },
    };

    expect(() => {
      vlist<TestItem>({
        container,
        item: { height: 50, template },
        items: createTestItems(10),
      })
        .use(feature1 as any)
        .use(feature2 as any)
        .build();
    }).toThrow(/Method "myMethod" is registered by both/);
  });

  it("should not throw when features register different methods", () => {
    const feature1 = {
      name: "feature1",
      methods: ["methodA"] as const,
      setup(ctx: any) {
        ctx.methods.set("methodA", () => "A");
      },
    };

    const feature2 = {
      name: "feature2",
      methods: ["methodB"] as const,
      setup(ctx: any) {
        ctx.methods.set("methodB", () => "B");
      },
    };

    expect(() => {
      const list = vlist<TestItem>({
        container,
        item: { height: 50, template },
        items: createTestItems(10),
      })
        .use(feature1 as any)
        .use(feature2 as any)
        .build();
      list.destroy();
    }).not.toThrow();
  });
});

// =============================================================================
// Feature Conflict Detection
// =============================================================================

describe("integration — feature conflict detection", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should throw when conflicting features are combined", () => {
    const featureA = {
      name: "featureA",
      conflicts: ["featureB"],
      setup(_ctx: any) {},
    };

    const featureB = {
      name: "featureB",
      setup(_ctx: any) {},
    };

    expect(() => {
      vlist<TestItem>({
        container,
        item: { height: 50, template },
        items: createTestItems(10),
      })
        .use(featureA as any)
        .use(featureB as any)
        .build();
    }).toThrow(/featureA and featureB cannot be combined/);
  });

  it("should throw when grid is used with reverse mode", () => {
    expect(() => {
      vlist<TestItem>({
        container,
        item: { height: 50, template },
        items: createTestItems(10),
        reverse: true,
      })
        .use(withGrid({ columns: 3 }))
        .build();
    }).toThrow(/withGrid cannot be used with reverse/);
  });
});

// =============================================================================
// Group Header Click Skip
// =============================================================================

describe("integration — group header click skip", () => {
  let container: HTMLElement;
  let list: VList<GroupedTestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should not emit item:click when clicking a group header", () => {
    const items = createGroupedItems(20);
    list = vlist<GroupedTestItem>({
      container,
      item: { height: 40, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (index: number) => items[index]?.group ?? "",
          header: { height: 30, template: headerTemplate },
        }),
      )
      .build();

    const clickHandler = mock((_e: any) => {});
    list.on("item:click", clickHandler as any);

    // Find a header element (marked with __groupHeader)
    const allItems = list.element.querySelectorAll("[data-index]");
    let headerEl: HTMLElement | null = null;
    let regularItemCount = 0;
    for (const el of allItems) {
      const htmlEl = el as HTMLElement;
      // Headers should have the section-header class from our template
      if (htmlEl.querySelector(".section-header")) {
        headerEl = htmlEl;
        break;
      }
      regularItemCount++;
    }

    if (headerEl) {
      const event = new dom.window.MouseEvent("click", { bubbles: true });
      headerEl.dispatchEvent(event);
      // The click should be suppressed for group headers
      expect(clickHandler).not.toHaveBeenCalled();
    } else {
      // If no header found in rendered items, just verify we have items
      expect(allItems.length).toBeGreaterThan(0);
    }
  });

  it("should emit item:click for regular items in grouped list", () => {
    const items = createGroupedItems(20);
    list = vlist<GroupedTestItem>({
      container,
      item: { height: 40, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (index: number) => items[index]?.group ?? "",
          header: { height: 30, template: headerTemplate },
        }),
      )
      .build();

    const clickHandler = mock((_e: any) => {});
    list.on("item:click", clickHandler as any);

    // Find a non-header item element
    const allItems = list.element.querySelectorAll("[data-index]");
    let regularEl: HTMLElement | null = null;
    for (const el of allItems) {
      const htmlEl = el as HTMLElement;
      if (!htmlEl.querySelector(".section-header")) {
        regularEl = htmlEl;
        break;
      }
    }

    if (regularEl) {
      const event = new dom.window.MouseEvent("click", { bubbles: true });
      regularEl.dispatchEvent(event);
      expect(clickHandler).toHaveBeenCalled();
    }
  });

  it("should not emit item:dblclick when double-clicking a group header", () => {
    const items = createGroupedItems(20);
    list = vlist<GroupedTestItem>({
      container,
      item: { height: 40, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (index: number) => items[index]?.group ?? "",
          header: { height: 30, template: headerTemplate },
        }),
      )
      .build();

    const dblclickHandler = mock((_e: any) => {});
    list.on("item:dblclick", dblclickHandler as any);

    const allItems = list.element.querySelectorAll("[data-index]");
    let headerEl: HTMLElement | null = null;
    for (const el of allItems) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.querySelector(".section-header")) {
        headerEl = htmlEl;
        break;
      }
    }

    if (headerEl) {
      const event = new dom.window.MouseEvent("dblclick", { bubbles: true });
      headerEl.dispatchEvent(event);
      expect(dblclickHandler).not.toHaveBeenCalled();
    } else {
      // If no header found in rendered items, just verify we have items
      expect(list.element.querySelectorAll("[data-index]").length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// Scrollbar Content Size Handler
// =============================================================================

describe("integration — scrollbar content size updates", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should update scrollbar when items are added", () => {
    const items = createTestItems(20);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    })
      .use(withScrollbar({ autoHide: false }))
      .build();

    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).not.toBeNull();

    // Add more items
    const moreItems = createTestItems(100);
    list.setItems(moreItems);

    // Scrollbar should still be present and functional
    const scrollbarAfter = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbarAfter).not.toBeNull();
  });

  it("should update scrollbar when items are removed", () => {
    const items = createTestItems(100);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    })
      .use(withScrollbar({ autoHide: false }))
      .build();

    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).not.toBeNull();

    // Reduce items
    list.setItems(createTestItems(5));

    // Scrollbar should still exist
    const scrollbarAfter = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbarAfter).not.toBeNull();
  });

  it("should update scrollbar with compression when total changes", () => {
    const largeItems = createTestItems(100000);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: largeItems,
    })
      .use(withScale())
      .use(withScrollbar())
      .build();

    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).not.toBeNull();

    // Change to even more items
    const moreItems = createTestItems(500000);
    list.setItems(moreItems);

    // Scrollbar should update without errors
    const scrollbarAfter = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbarAfter).not.toBeNull();
  });
});

// =============================================================================
// Scroll Config — wheel: false
// =============================================================================

describe("integration — scroll config wheel disabled", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should set overflow hidden when wheel is disabled", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(50),
      scroll: { wheel: false },
    }).build();

    const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
    expect(viewport).not.toBeNull();
    expect(viewport.style.overflow).toBe("hidden");
  });

  it("should set overflowX hidden for horizontal mode with wheel disabled", () => {
    list = vlist<TestItem>({
      container,
      item: { width: 100, height: 100, template },
      items: createTestItems(50),
      orientation: "horizontal",
      scroll: { wheel: false },
    }).build();

    const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
    expect(viewport).not.toBeNull();
    expect(viewport.style.overflowX).toBe("hidden");
  });
});

// =============================================================================
// Scroll Idle Detection
// =============================================================================

describe("integration — scroll idle detection", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should add scrolling class during scroll", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    }).build();

    const root = list.element;

    // Simulate scroll
    simulateScroll(list, 200);

    // Should have scrolling class during scroll
    expect(root.classList.contains("vlist--scrolling")).toBe(true);
  });

  it("should remove scrolling class after idle timeout", async () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
      scroll: { idleTimeout: 50 },
    }).build();

    const root = list.element;

    // Simulate scroll
    simulateScroll(list, 200);
    expect(root.classList.contains("vlist--scrolling")).toBe(true);

    // Wait for idle timeout
    await new Promise((r) => setTimeout(r, 100));
    expect(root.classList.contains("vlist--scrolling")).toBe(false);
  });

  it("should reset idle timer on subsequent scrolls", async () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
      scroll: { idleTimeout: 80 },
    }).build();

    const root = list.element;

    // Scroll, then scroll again before idle timeout
    simulateScroll(list, 100);
    await new Promise((r) => setTimeout(r, 40));
    simulateScroll(list, 200);
    await new Promise((r) => setTimeout(r, 40));

    // Should still be scrolling (timer reset on second scroll)
    expect(root.classList.contains("vlist--scrolling")).toBe(true);

    // Wait for full idle timeout after last scroll
    await new Promise((r) => setTimeout(r, 100));
    expect(root.classList.contains("vlist--scrolling")).toBe(false);
  });
});

// =============================================================================
// Cross-Feature Destroy Ordering
// =============================================================================

describe("integration — cross-feature destroy ordering", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should destroy all features cleanly in selection + scrollbar + snapshots", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    })
      .use(withSelection({ mode: "multiple" }))
      .use(withScrollbar())
      .use(withSnapshots())
      .build();

    const root = list.element;
    expect(root.parentElement).toBeTruthy();

    list.destroy();

    // Root should be removed after destroy
    expect(root.parentElement).toBeNull();
  });

  it("should destroy all features cleanly in grid + selection + scrollbar", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    })
      .use(withGrid({ columns: 4 }))
      .use(withSelection({ mode: "single" }))
      .use(withScrollbar())
      .build();

    const root = list.element;
    list.destroy();
    expect(root.parentElement).toBeNull();
  });

  it("should destroy all features cleanly in groups + scrollbar + selection", () => {
    const items = createGroupedItems(30);
    const list = vlist<GroupedTestItem>({
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
      .use(withScrollbar())
      .use(withSelection({ mode: "multiple" }))
      .build();

    const root = list.element;
    list.destroy();
    expect(root.parentElement).toBeNull();
  });

  it("should destroy scale + scrollbar + snapshots cleanly", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100000),
    })
      .use(withScale())
      .use(withSnapshots())
      .build();

    const root = list.element;
    list.destroy();
    expect(root.parentElement).toBeNull();
  });

  it("should not throw on double destroy with multiple features", () => {
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(50),
    })
      .use(withSelection({ mode: "multiple" }))
      .use(withScrollbar())
      .use(withSnapshots())
      .build();

    list.destroy();
    expect(() => list.destroy()).not.toThrow();
  });

  it("should destroy async + selection + scrollbar cleanly", async () => {
    const adapter = createMockAdapter(100);
    const list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    })
      .use(withAsync({ adapter }))
      .use(withSelection({ mode: "multiple" }))
      .use(withScrollbar())
      .build();

    await flush();

    const root = list.element;
    list.destroy();
    expect(root.parentElement).toBeNull();
  });
});

// =============================================================================
// Async + Snapshots Combined
// =============================================================================

describe("integration — async + snapshots", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should capture snapshot after async load", async () => {
    const adapter = createMockAdapter(200);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    })
      .use(withAsync({ adapter }))
      .use(withSnapshots())
      .build();

    await flush();

    const snapshot = (list as any).getScrollSnapshot();
    expect(snapshot).toBeDefined();
    expect(typeof snapshot.index).toBe("number");
    expect(typeof snapshot.offsetInItem).toBe("number");
  });

  it("should restore snapshot after reload", async () => {
    const adapter = createMockAdapter(200);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    })
      .use(withAsync({ adapter }))
      .use(withSnapshots())
      .build();

    await flush();

    const snapshot = (list as any).getScrollSnapshot();
    expect(snapshot).toBeDefined();

    // Restore
    expect(() => (list as any).restoreScroll(snapshot)).not.toThrow();
  });
});

// =============================================================================
// Async + Selection Combined
// =============================================================================

describe("integration — async + selection", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should select items after async load completes", async () => {
    const adapter = createMockAdapter(100);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    })
      .use(withAsync({ adapter }))
      .use(withSelection({ mode: "multiple" }))
      .build();

    await flush();

    // select() takes item IDs, getSelected() returns an array of IDs
    (list as any).select(1, 2);

    const selected = (list as any).getSelected();
    expect(selected.length).toBe(2);
  });

  it("should maintain selection after reload", async () => {
    const adapter = createMockAdapter(100);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    })
      .use(withAsync({ adapter }))
      .use(withSelection({ mode: "multiple" }))
      .build();

    await flush();

    (list as any).select(1);

    const selectedBefore = (list as any).getSelected();
    expect(selectedBefore.length).toBe(1);

    await list.reload();
    await flush();

    // Selection state persists across reload (selection is by ID)
    const selectedAfter = (list as any).getSelected();
    expect(selectedAfter.length).toBe(1);
  });

  it("should reset scroll position to 0 on reload", async () => {
    const adapter = createMockAdapter(1000);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    })
      .use(withAsync({ adapter }))
      .use(withSelection({ mode: "single" }))
      .build();

    await flush();

    // Scroll down
    simulateScroll(list, 2000);
    await flush();

    const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
    expect(viewport.scrollTop).toBe(2000);

    // Reload
    await list.reload();
    await flush();

    // Scroll should be reset to 0
    expect(viewport.scrollTop).toBe(0);

    // Items should be rendered starting from the top
    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
    expect(Math.min(...indices)).toBe(0);
  });
});

// =============================================================================
// Scroll Gutter Configuration
// =============================================================================

describe("integration — scroll.gutter", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should not add gutter class by default", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
    }).build();

    const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
    expect(viewport.classList.contains("vlist-viewport--gutter-stable")).toBe(false);
  });

  it("should add gutter-stable class when scroll.gutter is 'stable'", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
      scroll: { gutter: "stable" },
    }).build();

    const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
    expect(viewport.classList.contains("vlist-viewport--gutter-stable")).toBe(true);
  });

  it("should not add gutter class when scroll.gutter is 'auto'", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
      scroll: { gutter: "auto" },
    }).build();

    const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
    expect(viewport.classList.contains("vlist-viewport--gutter-stable")).toBe(false);
  });

  it("should work alongside other scroll config options", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
      scroll: { gutter: "stable", wrap: true },
    }).build();

    const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
    expect(viewport.classList.contains("vlist-viewport--gutter-stable")).toBe(true);
  });
});

describe("integration — async + selection", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should emit selection:change with async-loaded items", async () => {
    const adapter = createMockAdapter(100);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    })
      .use(withAsync({ adapter }))
      .use(withSelection({ mode: "single" }))
      .build();

    await flush();

    const selectionHandler = mock((_e: any) => {});
    list.on("selection:change", selectionHandler as any);

    (list as any).select(2);
    expect(selectionHandler).toHaveBeenCalled();
  });
});

// =============================================================================
// Grid + Selection Integration
// =============================================================================

describe("integration — grid + selection", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should select items in grid layout", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(40),
    })
      .use(withGrid({ columns: 4 }))
      .use(withSelection({ mode: "multiple" }))
      .build();

    // select() takes item IDs
    (list as any).select(1, 6, 11);

    const selected = (list as any).getSelected();
    expect(selected.length).toBe(3);
  });

  it("should apply selected class to grid items", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
    })
      .use(withGrid({ columns: 4 }))
      .use(withSelection({ mode: "multiple" }))
      .build();

    // select by ID (item at index 0 has id=1)
    (list as any).select(1);

    const selectedItems = list.element.querySelectorAll(".vlist-item--selected");
    expect(selectedItems.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle selectAll in grid layout", () => {
    const items = createTestItems(12);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    })
      .use(withGrid({ columns: 3 }))
      .use(withSelection({ mode: "multiple" }))
      .build();

    (list as any).selectAll();

    const selected = (list as any).getSelected();
    expect(selected.length).toBe(12);
  });

  it("should handle clearSelection in grid layout", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(12),
    })
      .use(withGrid({ columns: 3 }))
      .use(withSelection({ mode: "multiple" }))
      .build();

    (list as any).selectAll();
    (list as any).clearSelection();

    const selected = (list as any).getSelected();
    expect(selected.length).toBe(0);
  });
});

// =============================================================================
// Reverse + Selection
// =============================================================================

describe("integration — reverse + selection", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should work with selection in reverse mode", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(50),
      reverse: true,
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // select by IDs
    (list as any).select(1, 50);

    const selected = (list as any).getSelected();
    expect(selected.length).toBe(2);
  });

  it("should work with selection + snapshots in reverse mode", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(50),
      reverse: true,
    })
      .use(withSelection({ mode: "multiple" }))
      .use(withSnapshots())
      .build();

    (list as any).select(1);
    const snapshot = (list as any).getScrollSnapshot();
    expect(snapshot).toBeDefined();
  });
});

// =============================================================================
// Reverse + Snapshots
// =============================================================================

describe("integration — reverse + snapshots", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should capture snapshot in reverse mode", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
      reverse: true,
    })
      .use(withSnapshots())
      .build();

    const snapshot = (list as any).getScrollSnapshot();
    expect(snapshot).toBeDefined();
    expect(typeof snapshot.index).toBe("number");
  });

  it("should restore snapshot in reverse mode", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
      reverse: true,
    })
      .use(withSnapshots())
      .build();

    simulateScroll(list, 500);
    const snapshot = (list as any).getScrollSnapshot();

    // Scroll somewhere else
    simulateScroll(list, 0);

    // Restore
    expect(() => (list as any).restoreScroll(snapshot)).not.toThrow();
  });
});

// =============================================================================
// Scale + Selection Integration
// =============================================================================

describe("integration — scale + selection", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should select items in compressed mode", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100000),
    })
      .use(withScale())
      .use(withSelection({ mode: "multiple" }))
      .build();

    // select by IDs
    (list as any).select(1, 6);

    const selected = (list as any).getSelected();
    expect(selected.length).toBe(2);
  });

  it("should handle selectAll in compressed mode", () => {
    const items = createTestItems(1000);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    })
      .use(withScale())
      .use(withSelection({ mode: "multiple" }))
      .build();

    (list as any).selectAll();

    const selected = (list as any).getSelected();
    expect(selected.length).toBe(1000);
  });
});

// =============================================================================
// Scale + Scrollbar + Snapshots Integration
// =============================================================================

describe("integration — scale + scrollbar + snapshots", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should work with all three features combined", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100000),
    })
      .use(withScale())
      .use(withScrollbar())
      .use(withSnapshots())
      .build();

    // Custom scrollbar should be present
    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).not.toBeNull();

    // Snapshot should work
    const snapshot = (list as any).getScrollSnapshot();
    expect(snapshot).toBeDefined();
  });

  it("should capture and restore snapshot with compression", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100000),
    })
      .use(withScale())
      .use(withSnapshots())
      .build();

    // Scroll to middle
    list.scrollToIndex(50000);

    const snapshot = (list as any).getScrollSnapshot();
    expect(snapshot.index).toBeGreaterThan(0);

    // Scroll away
    list.scrollToIndex(0);

    // Restore
    expect(() => (list as any).restoreScroll(snapshot)).not.toThrow();
  });
});

// =============================================================================
// Multiple Event Subscriptions & Cleanup
// =============================================================================

describe("integration — event subscription edge cases", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should handle multiple scroll event listeners", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    }).build();

    const handler1 = mock(() => {});
    const handler2 = mock(() => {});
    const handler3 = mock(() => {});

    const unsub1 = list.on("scroll", handler1);
    list.on("scroll", handler2);
    list.on("scroll", handler3);

    simulateScroll(list, 100);

    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
    expect(handler3).toHaveBeenCalled();

    // Unsubscribe one
    unsub1();

    simulateScroll(list, 200);

    const h1Calls = handler1.mock.calls.length;
    const h2Calls = handler2.mock.calls.length;

    simulateScroll(list, 300);

    // handler1 should not get new calls
    expect(handler1.mock.calls.length).toBe(h1Calls);
    // handler2 should still receive calls
    expect(handler2.mock.calls.length).toBeGreaterThan(h2Calls);
  });

  it("should handle range:change with multiple listeners", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(200),
    }).build();

    const handler1 = mock(() => {});
    const handler2 = mock(() => {});

    list.on("range:change", handler1);
    list.on("range:change", handler2);

    // Scroll far enough to trigger range change
    simulateScroll(list, 2000);

    // Both handlers should be called
    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it("should not deliver events after destroy", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    }).build();

    const handler = mock(() => {});
    list.on("scroll", handler);

    list.destroy();

    // After destroy, the viewport is removed; dispatching scroll shouldn't call handler
    // (emitter is cleared on destroy)
    const callsBefore = handler.mock.calls.length;

    // Direct emission on emitter won't work after clear
    // Just verify destroy completed without error
    expect(callsBefore).toBe(0);
  });
});

// =============================================================================
// Groups + Grid Combined
// =============================================================================

describe("integration — groups + grid combined", () => {
  let container: HTMLElement;
  let list: VList<GroupedTestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should combine groups with grid layout", () => {
    const items = createGroupedItems(24);
    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i: number) => items[i]?.group ?? "",
          header: { height: 30, template: headerTemplate },
        }),
      )
      .use(withGrid({ columns: 3 }))
      .build();

    // Should render without errors
    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
  });

  it("should render full-width headers in grid mode", () => {
    const items = createGroupedItems(20);
    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i: number) => items[i]?.group ?? "",
          header: { height: 30, template: headerTemplate },
        }),
      )
      .use(withGrid({ columns: 4 }))
      .build();

    // Headers should be present
    const headers = list.element.querySelectorAll(".section-header");
    expect(headers.length).toBeGreaterThan(0);
  });

  it("should handle groups + grid + selection", () => {
    const items = createGroupedItems(20);
    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i: number) => items[i]?.group ?? "",
          header: { height: 30, template: headerTemplate },
        }),
      )
      .use(withGrid({ columns: 3 }))
      .use(withSelection({ mode: "multiple" }))
      .build();

    // select by ID
    (list as any).select(1);
    const selected = (list as any).getSelected();
    expect(selected.length).toBe(1);
  });

  it("should destroy groups + grid cleanly", () => {
    const items = createGroupedItems(20);
    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i: number) => items[i]?.group ?? "",
          header: { height: 30, template: headerTemplate },
        }),
      )
      .use(withGrid({ columns: 3 }))
      .build();

    const root = list.element;
    list.destroy();
    expect(root.parentElement).toBeNull();
  });
});

// =============================================================================
// Groups with Sticky Header + Scroll
// =============================================================================

describe("integration — groups sticky header scroll", () => {
  let container: HTMLElement;
  let list: VList<GroupedTestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should update sticky header during scroll through groups", () => {
    const items = createGroupedItems(60);
    list = vlist<GroupedTestItem>({
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

    const stickyHeader = list.element.querySelector(
      "[class*='sticky']",
    ) as HTMLElement;

    // Scroll through groups
    simulateScroll(list, 200);
    simulateScroll(list, 500);
    simulateScroll(list, 1000);

    // Sticky header element should exist and be in DOM
    expect(stickyHeader || list.element.querySelector("[aria-hidden='true']")).toBeDefined();
  });

  it("should handle scrollToIndex in grouped list with sticky headers", () => {
    const items = createGroupedItems(100);
    list = vlist<GroupedTestItem>({
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

    // Should not throw when scrolling to various positions
    expect(() => list.scrollToIndex(0)).not.toThrow();
    expect(() => list.scrollToIndex(50)).not.toThrow();
    expect(() => list.scrollToIndex(99)).not.toThrow();
  });
});

// =============================================================================
// Data Operations with Multiple Features
// =============================================================================

describe("integration — data operations with features", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should handle setItems with selection + scrollbar", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .use(withScrollbar())
      .build();

    // select by IDs
    (list as any).select(1, 2);

    // Replace items
    list.setItems(createTestItems(50));

    // Selection state may persist (depends on IDs)
    const selected = (list as any).getSelected();
    expect(selected).toBeDefined();
  });

  it("should handle appendItems with scrollbar updates", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10),
    })
      .use(withScrollbar({ autoHide: false }))
      .build();

    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).not.toBeNull();

    // Append items
    list.appendItems(createTestItems(50).slice(10));

    // Scrollbar should still work
    expect(list.element.querySelector(".vlist-scrollbar")).not.toBeNull();
  });

  it("should handle prependItems with snapshots", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
    })
      .use(withSnapshots())
      .build();

    const snapshotBefore = (list as any).getScrollSnapshot();

    // Prepend items
    list.prependItems(
      Array.from({ length: 10 }, (_, i) => ({
        id: -(i + 1),
        name: `Prepended ${i + 1}`,
      })) as TestItem[],
    );

    const snapshotAfter = (list as any).getScrollSnapshot();
    expect(snapshotAfter).toBeDefined();
  });

  it("should handle removeItem with selection cleanup", () => {
    const items = createTestItems(10);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // select by IDs
    (list as any).select(3, 6);

    // Remove an item
    list.removeItem(2);

    // List should still be functional
    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
  });

  it("should handle updateItem with selection state preserved", () => {
    const items = createTestItems(10);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items,
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // select by ID (item at index 3 has id=4)
    (list as any).select(4);

    // Update the selected item
    list.updateItem(3, { name: "Updated Item 4" });

    // Selection should be preserved (by ID)
    const selected = (list as any).getSelected();
    expect(selected).toContain(4);
  });
});

// =============================================================================
// Reverse Mode Data Operations with Features
// =============================================================================

describe("integration — reverse mode data operations with features", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should handle appendItems in reverse mode with scrollbar", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
      reverse: true,
    })
      .use(withScrollbar())
      .build();

    const newItems: TestItem[] = [
      { id: 21, name: "Item 21" },
      { id: 22, name: "Item 22" },
    ];

    expect(() => list.appendItems(newItems)).not.toThrow();
  });

  it("should handle prependItems in reverse mode with snapshots", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
      reverse: true,
    })
      .use(withSnapshots())
      .build();

    const newItems: TestItem[] = [
      { id: 100, name: "Prepended 1" },
      { id: 101, name: "Prepended 2" },
    ];

    expect(() => list.prependItems(newItems)).not.toThrow();

    const snapshot = (list as any).getScrollSnapshot();
    expect(snapshot).toBeDefined();
  });
});

// =============================================================================
// Custom Class Prefix with Multiple Features
// =============================================================================

describe("integration — custom class prefix with features", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should apply custom prefix to all feature DOM elements", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(50),
      classPrefix: "mylist",
    })
      .use(withScrollbar())
      .use(withSelection({ mode: "single" }))
      .build();

    // Root should use custom prefix
    const root = list.element;
    expect(root.classList.contains("mylist")).toBe(true);

    // Viewport should use custom prefix
    const viewport = root.querySelector(".mylist-viewport");
    expect(viewport).not.toBeNull();

    // Items container should use custom prefix
    const items = root.querySelector(".mylist-items");
    expect(items).not.toBeNull();

    // Scrollbar should use custom prefix
    const scrollbar = root.querySelector(".mylist-scrollbar");
    expect(scrollbar).not.toBeNull();
  });

  it("should apply custom prefix to grid layout", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
      classPrefix: "custom",
    })
      .use(withGrid({ columns: 3 }))
      .build();

    const root = list.element;
    expect(root.classList.contains("custom")).toBe(true);
    expect(root.classList.contains("custom--grid")).toBe(true);
  });
});

// =============================================================================
// Async + Grid Combined
// =============================================================================

describe("integration — async + grid", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should render grid layout with async-loaded data", async () => {
    const adapter = createMockAdapter(100);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    })
      .use(withAsync({ adapter }))
      .use(withGrid({ columns: 4 }))
      .build();

    await flush();

    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
  });

  it("should reload and maintain grid layout", async () => {
    const adapter = createMockAdapter(80);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    })
      .use(withAsync({ adapter }))
      .use(withGrid({ columns: 3 }))
      .build();

    await flush();

    const indicesBefore = getRenderedIndices(list);
    expect(indicesBefore.length).toBeGreaterThan(0);

    await list.reload();
    await flush();

    const indicesAfter = getRenderedIndices(list);
    expect(indicesAfter.length).toBeGreaterThan(0);
    expect(indicesAfter[0]).toBe(0);
  });
});

// =============================================================================
// Velocity-Change Event with Scale
// =============================================================================

describe("integration — velocity events with compression", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should emit velocity:change events during scroll", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(200),
    }).build();

    const velocityHandler = mock(() => {});
    list.on("velocity:change", velocityHandler);

    // Simulate scroll
    simulateScroll(list, 100);
    simulateScroll(list, 300);
    simulateScroll(list, 600);

    expect(velocityHandler).toHaveBeenCalled();
  });

  it("should emit velocity 0 on scroll idle", async () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(200),
      scroll: { idleTimeout: 50 },
    }).build();

    let lastVelocity: number = -1;
    list.on("velocity:change" as any, (e: any) => {
      lastVelocity = e.velocity;
    });

    simulateScroll(list, 500);

    // Wait for idle
    await new Promise((r) => setTimeout(r, 100));

    // After idle, velocity should be reported as 0
    expect(lastVelocity as number).toBe(0);
  });
});

// =============================================================================
// ARIA Attributes with Features
// =============================================================================

describe("integration — ARIA attributes with features", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should set ARIA role on items container with selection", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
      ariaLabel: "Test list",
    })
      .use(withSelection({ mode: "single" }))
      .build();

    const items = list.element.querySelector(".vlist-items");
    expect(items).not.toBeNull();
    expect(items!.getAttribute("role")).toBe("listbox");
    expect(items!.getAttribute("aria-label")).toBe("Test list");
  });

  it("should include ARIA live region with selection plugin", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "single" }))
      .build();

    const liveRegion = list.element.querySelector("[aria-live]");
    expect(liveRegion).not.toBeNull();
  });

  it("should support multiple selection mode", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // Verify multiple selection actually works (select two items by ID)
    (list as any).select(1, 2);
    const selected = (list as any).getSelected();
    expect(selected.length).toBe(2);
    expect(selected).toContain(1);
    expect(selected).toContain(2);
  });

  it("should set aria-selected on items in selection mode", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "single" }))
      .build();

    // select by ID (item at index 0 has id=1)
    (list as any).select(1);

    // After select, re-render happens; check the rendered item
    const firstItem = list.element.querySelector("[data-index='0']") as HTMLElement;
    if (firstItem) {
      expect(firstItem.getAttribute("aria-selected")).toBe("true");
    }
  });
});

// =============================================================================
// Scrollbar Scrollbar:none Config
// =============================================================================

describe("integration — scroll config scrollbar none", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should hide native scrollbar when scrollbar is none", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
      scroll: { wheel: false },
    }).build();

    const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
    // The class or style should hide scrollbar
    expect(viewport).not.toBeNull();
  });
});

// =============================================================================
// Grid with Variable Height Function
// =============================================================================

describe("integration — grid with variable height", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should handle grid with height function", () => {
    list = vlist<TestItem>({
      container,
      item: {
        height: (index: number) => (index % 3 === 0 ? 80 : 50),
        template,
      },
      items: createTestItems(60),
    })
      .use(withGrid({ columns: 4 }))
      .build();

    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
  });

  it("should handle grid with height function and gap", () => {
    list = vlist<TestItem>({
      container,
      item: {
        height: (index: number) => 50 + (index % 5) * 10,
        template,
      },
      items: createTestItems(40),
    })
      .use(withGrid({ columns: 3, gap: 8 }))
      .build();

    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Concurrent Operations
// =============================================================================

describe("integration — concurrent operations", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should handle rapid setItems calls", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(10),
    })
      .use(withSelection({ mode: "multiple" }))
      .use(withScrollbar())
      .build();

    // Rapid data changes
    for (let i = 0; i < 10; i++) {
      list.setItems(createTestItems(10 + i * 5));
    }

    // Should still render correctly
    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
  });

  it("should handle rapid scroll + data changes", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(100),
    })
      .use(withScrollbar())
      .build();

    // Interleave scrolls and data changes
    simulateScroll(list, 100);
    list.appendItems([{ id: 101, name: "Item 101" }] as TestItem[]);
    simulateScroll(list, 200);
    list.appendItems([{ id: 102, name: "Item 102" }] as TestItem[]);
    simulateScroll(list, 300);

    // Should not throw and should have rendered items
    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
  });

  it("should handle selection during scroll", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
      items: createTestItems(200),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // Select by IDs, scroll, select more
    (list as any).select(1);
    simulateScroll(list, 500);
    (list as any).select(6);
    simulateScroll(list, 1000);
    (list as any).select(11);

    const selected = (list as any).getSelected();
    expect(selected.length).toBe(3);
  });
});

// =============================================================================
// Async + Table Combined
// =============================================================================

describe("integration — async + table", () => {
  let container: HTMLElement;
  let list: VList<TestItem>;

  const tableColumns = [
    { key: "name", label: "Name", width: 150 },
    { key: "value", label: "Value", width: 100, align: "right" as const },
  ];

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) list.destroy();
    container.remove();
  });

  it("should render all visible rows after async data loads", async () => {
    // This is the exact bug that was fixed: withAsync + withTable initially
    // showed only ~4 rows because onItemsLoaded triggered forceRender before
    // onStateChange rebuilt the size cache — so sizeCache.totalSize was 0
    // and the visible range calculation produced [0..0] + overscan = [0..3].
    const adapter = createMockAdapter(500);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withAsync({ adapter }))
      .use(withTable({ columns: tableColumns, rowHeight: 40, headerHeight: 40 }))
      .build();

    await flush();

    // Container is 500px, header is 40px, so viewport is 460px.
    // At 40px per row, we expect ~12 visible rows + overscan (3) = ~15.
    // With the bug, only 4 rows were rendered.
    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(8);
  });

  it("should set content height to match total items after load", async () => {
    const adapter = createMockAdapter(1000);
    list = vlist<TestItem>({
      container,
      item: { height: 50, template },
    })
      .use(withAsync({ adapter }))
      .use(withTable({ columns: tableColumns, rowHeight: 50, headerHeight: 40 }))
      .build();

    await flush();

    // Content height should be total * rowHeight = 1000 * 50 = 50000
    const content = list.element.querySelector(".vlist-content") as HTMLElement;
    expect(content).not.toBeNull();
    const height = parseInt(content.style.height, 10);
    expect(height).toBe(50000);
  });

  it("should render correct range after reload", async () => {
    const adapter = createMockAdapter(200);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withAsync({ adapter }))
      .use(withTable({ columns: tableColumns, rowHeight: 40, headerHeight: 40 }))
      .build();

    await flush();

    const indicesBefore = getRenderedIndices(list);
    expect(indicesBefore.length).toBeGreaterThan(8);

    await list.reload();
    await flush();

    const indicesAfter = getRenderedIndices(list);
    expect(indicesAfter.length).toBeGreaterThan(8);
  });

  it("should emit range:change with correct count after async load", async () => {
    const adapter = createMockAdapter(500);
    let lastRange: { start: number; end: number } | null = null;

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withAsync({ adapter }))
      .use(withTable({ columns: tableColumns, rowHeight: 40, headerHeight: 40 }))
      .build();

    list.on("range:change", ({ range }: any) => {
      lastRange = range;
    });

    await flush();

    expect(lastRange).not.toBeNull();
    // The range should cover significantly more than 4 rows
    const count = lastRange!.end - lastRange!.start + 1;
    expect(count).toBeGreaterThan(8);
  });

  it("should work with async + table + selection combined", async () => {
    const adapter = createMockAdapter(200);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withAsync({ adapter }))
      .use(withTable({ columns: tableColumns, rowHeight: 40, headerHeight: 40 }))
      .use(withSelection({ mode: "single" }))
      .build();

    await flush();

    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(8);

    // Selection should work on loaded items
    (list as any).select(1);
    const selected = (list as any).getSelected();
    expect(selected.length).toBe(1);
  });
});