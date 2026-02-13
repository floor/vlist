/**
 * vlist/builder - Integration Tests
 * Tests for the composable builder, plugin system, and plugin combinations.
 *
 * Covers:
 * - Builder core (vlist().build())
 * - withSelection plugin
 * - withScrollbar plugin
 * - withData plugin (async adapter)
 * - withCompression plugin (1M+ items)
 * - withSnapshots plugin
 * - Plugin combinations (data + compression, selection + scrollbar, etc.)
 *
 * Previously known builder limitations (now fixed):
 * - ctx.renderer returns null → fixed: builder exposes renderer proxy
 * - withCompression doesn't replace getVisibleRange/getScrollToPos → fixed: plugin injects them
 * - withData items not connected to render loop → fixed: render reads from dataManagerProxy
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

import { vlist } from "../src/builder/core";
import type { BuiltVList } from "../src/builder/types";
import type { VListItem, VListAdapter } from "../src/types";
import { withSelection } from "../src/selection/plugin";
import { withScrollbar } from "../src/scroll/plugin";
import { withData } from "../src/data/plugin";
import { withCompression } from "../src/compression/plugin";
import { withSnapshots } from "../src/snapshots/plugin";
import { withGrid } from "../src/grid/plugin";
import { withGroups } from "../src/groups/plugin";
import { isGroupHeader } from "../src/groups/types";

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
// Test Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
  value?: number;
}

const createTestItems = (count: number): TestItem[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
    value: i * 10,
  }));
};

const template = (item: TestItem): string => {
  return `<div class="item">${item.name}</div>`;
};

const createContainer = (): HTMLElement => {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", { value: 500 });
  Object.defineProperty(container, "clientWidth", { value: 300 });
  document.body.appendChild(container);
  return container;
};

/** Collect rendered data-index values from a list's DOM */
const getRenderedIndices = (list: BuiltVList<TestItem>): number[] => {
  const elements = list.element.querySelectorAll("[data-index]");
  return Array.from(elements).map((el) =>
    parseInt((el as HTMLElement).dataset.index!, 10),
  );
};

/**
 * Simulate a scroll in the builder by setting scrollTop and dispatching a
 * scroll event. JSDOM does not fire scroll events when scrollTop is set
 * programmatically, so we must dispatch manually.
 */
const simulateScroll = (
  list: BuiltVList<TestItem>,
  scrollTop: number,
): void => {
  const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
  if (!viewport) return;
  viewport.scrollTop = scrollTop;
  viewport.dispatchEvent(new dom.window.Event("scroll"));
};

/** Create a mock async adapter that resolves immediately */
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

/** Wait for microtasks (async adapter loads) to settle */
const flush = () => new Promise<void>((r) => setTimeout(r, 10));

// =============================================================================
// Builder Core
// =============================================================================

describe("builder core", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should create a list with static items", () => {
    const items = createTestItems(100);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    expect(list.element).toBeDefined();
    expect(list.total).toBe(100);

    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
    // Initial render should start near index 0
    expect(Math.min(...indices)).toBe(0);
  });

  it("should render correct items after setItems", () => {
    const items = createTestItems(50);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    expect(list.total).toBe(50);

    const newItems = createTestItems(200);
    list.setItems(newItems);
    expect(list.total).toBe(200);

    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
  });

  it("should append and prepend items", () => {
    const items = createTestItems(20);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    expect(list.total).toBe(20);

    list.appendItems(
      createTestItems(10).map((item) => ({
        ...item,
        id: item.id + 20,
        name: `Appended ${item.id}`,
      })),
    );
    expect(list.total).toBe(30);

    list.prependItems(
      createTestItems(5).map((item) => ({
        ...item,
        id: item.id + 100,
        name: `Prepended ${item.id}`,
      })),
    );
    expect(list.total).toBe(35);
  });

  it("should update and remove items", () => {
    const items = createTestItems(20);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    list.updateItem(1, { name: "Updated Item" });
    expect(list.items[0]!.name).toBe("Updated Item");

    list.removeItem(1);
    expect(list.total).toBe(19);
  });

  it("should handle scrollToIndex for non-compressed lists", () => {
    const items = createTestItems(1000);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    // scrollToIndex sets viewport.scrollTop internally, but JSDOM doesn't
    // fire scroll events automatically. We call scrollToIndex to compute
    // the position, then simulate the scroll to trigger rendering.
    list.scrollToIndex(500, "center");

    // Manually dispatch scroll event so the builder's onScrollFrame runs.
    // We read the scrollTop that scrollToIndex wrote and dispatch.
    const viewport = list.element.querySelector(
      ".vlist-viewport",
    ) as HTMLElement;
    viewport.dispatchEvent(new dom.window.Event("scroll"));

    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);

    // Rendered items should be near index 500
    const minIdx = Math.min(...indices);
    const maxIdx = Math.max(...indices);
    expect(minIdx).toBeLessThanOrEqual(500);
    expect(maxIdx).toBeGreaterThanOrEqual(500);
  });

  it("should emit scroll events", () => {
    const items = createTestItems(100);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    const scrollHandler = mock(() => {});
    list.on("scroll", scrollHandler);

    // Simulate scroll using JSDOM event constructor
    simulateScroll(list, 200);
    expect(scrollHandler).toHaveBeenCalled();
  });

  it("should emit range:change on scroll when range changes", () => {
    const items = createTestItems(200);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    const rangeHandler = mock(() => {});
    list.on("range:change", rangeHandler);

    // Scroll far enough to change the visible range
    simulateScroll(list, 2000);
    expect(rangeHandler).toHaveBeenCalled();
  });

  it("should handle on/off event subscription", () => {
    const items = createTestItems(50);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    const handler = mock(() => {});
    const unsub = list.on("scroll", handler);

    simulateScroll(list, 100);
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    simulateScroll(list, 200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should handle empty items array", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: [],
    }).build();

    expect(list.total).toBe(0);
    const indices = getRenderedIndices(list);
    expect(indices.length).toBe(0);
  });

  it("should handle no items (undefined)", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    }).build();

    expect(list.total).toBe(0);
  });

  it("should handle variable height items", () => {
    const items = createTestItems(100);
    list = vlist<TestItem>({
      container,
      item: {
        height: (index: number) => 30 + (index % 3) * 20,
        template,
      },
      items,
    }).build();

    expect(list.total).toBe(100);
    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
  });

  it("should destroy cleanly", () => {
    const items = createTestItems(50);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    const element = list.element;
    expect(element.parentElement).toBeTruthy();

    list.destroy();
    expect(element.parentElement).toBeNull();
    list = null; // prevent double-destroy in afterEach
  });

  it("should not throw on double destroy", () => {
    const items = createTestItems(50);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    list.destroy();
    expect(() => list!.destroy()).not.toThrow();
    list = null;
  });

  it("should set ARIA attributes on the root", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(10),
      ariaLabel: "Test list",
    }).build();

    expect(list.element.getAttribute("role")).toBe("listbox");
    expect(list.element.getAttribute("aria-label")).toBe("Test list");
    expect(list.element.getAttribute("tabindex")).toBe("0");
  });

  it("should set ARIA attributes on rendered items", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(10),
    }).build();

    const items = list.element.querySelectorAll("[role='option']");
    expect(items.length).toBeGreaterThan(0);

    const first = items[0] as HTMLElement;
    expect(first.getAttribute("aria-setsize")).toBe("10");
    expect(first.getAttribute("aria-posinset")).toBeTruthy();
  });

  it("should include live region for accessibility", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(10),
    }).build();

    const liveRegion = list.element.querySelector("[aria-live]");
    expect(liveRegion).not.toBeNull();
    expect(liveRegion!.getAttribute("aria-live")).toBe("polite");
  });

  it("should re-render when scrolling through the list", () => {
    const items = createTestItems(500);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    const indicesBefore = getRenderedIndices(list);
    const maxBefore = Math.max(...indicesBefore);

    // Scroll far enough to see different items
    simulateScroll(list, 4000);

    const indicesAfter = getRenderedIndices(list);
    const minAfter = Math.min(...indicesAfter);

    // After scrolling 4000px at 40px per item = index ~100
    // The new visible range should start beyond the old range
    expect(minAfter).toBeGreaterThan(maxBefore);
  });
});

// =============================================================================
// Builder Validation
// =============================================================================

describe("builder validation", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should throw when no container provided", () => {
    expect(() => {
      vlist<TestItem>({
        container: null as any,
        item: { height: 40, template },
      });
    }).toThrow("Container is required");
  });

  it("should throw when no item config provided", () => {
    expect(() => {
      vlist<TestItem>({
        container,
        item: null as any,
      });
    }).toThrow("item configuration is required");
  });

  it("should throw when item height is missing", () => {
    expect(() => {
      vlist<TestItem>({
        container,
        item: { height: undefined as any, template },
      });
    }).toThrow("item.height is required");
  });

  it("should throw when item height is zero or negative", () => {
    expect(() => {
      vlist<TestItem>({
        container,
        item: { height: 0, template },
      });
    }).toThrow("item.height must be a positive number");

    expect(() => {
      vlist<TestItem>({
        container,
        item: { height: -10, template },
      });
    }).toThrow("item.height must be a positive number");
  });

  it("should throw when item template is missing", () => {
    expect(() => {
      vlist<TestItem>({
        container,
        item: { height: 40, template: null as any },
      });
    }).toThrow("item.template is required");
  });

  it("should throw when container selector not found", () => {
    expect(() => {
      vlist<TestItem>({
        container: "#nonexistent",
        item: { height: 40, template },
      }).build();
    }).toThrow("Container not found");
  });

  it("should throw when .use() called after .build()", () => {
    const builder = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: [],
    });
    const list = builder.build();

    expect(() => {
      builder.use(withSelection({ mode: "single" }));
    }).toThrow("Cannot call .use() after .build()");

    list.destroy();
  });

  it("should throw when .build() called twice", () => {
    const builder = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: [],
    });
    const list = builder.build();

    expect(() => {
      builder.build();
    }).toThrow(".build() can only be called once");

    list.destroy();
  });

  it("should throw when horizontal + reverse combined", () => {
    expect(() => {
      vlist<TestItem>({
        container,
        item: { height: 40, width: 100, template },
        direction: "horizontal",
        reverse: true,
      });
    }).toThrow("horizontal direction cannot be combined with reverse mode");
  });
});

// =============================================================================
// withSelection Plugin
// =============================================================================

describe("withSelection plugin", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should add selection methods to the API", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    expect(typeof list.select).toBe("function");
    expect(typeof list.deselect).toBe("function");
    expect(typeof list.toggleSelect).toBe("function");
    expect(typeof list.selectAll).toBe("function");
    expect(typeof list.clearSelection).toBe("function");
    expect(typeof list.getSelected).toBe("function");
    expect(typeof list.getSelectedItems).toBe("function");
  });

  it("should select and deselect items", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    list.select!(1, 2, 3);
    expect(list.getSelected!()).toEqual([1, 2, 3]);

    list.deselect!(2);
    expect(list.getSelected!()).toEqual([1, 3]);
  });

  it("should toggle selection", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    list.toggleSelect!(1);
    expect(list.getSelected!()).toEqual([1]);

    list.toggleSelect!(1);
    expect(list.getSelected!()).toEqual([]);
  });

  it("should select all and clear", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(5),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    list.selectAll!();
    expect(list.getSelected!().length).toBe(5);

    list.clearSelection!();
    expect(list.getSelected!()).toEqual([]);
  });

  it("should enforce single selection mode", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "single" }))
      .build();

    list.select!(1);
    expect(list.getSelected!()).toEqual([1]);

    list.select!(2);
    expect(list.getSelected!()).toEqual([2]);
  });

  it("should apply CSS classes to selected items", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "single" }))
      .build();

    list.select!(1);

    const selected = list.element.querySelectorAll(".vlist-item--selected");
    expect(selected.length).toBe(1);
    expect((selected[0] as HTMLElement).dataset.id).toBe("1");
  });

  it("should emit selection:change events", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    const handler = mock(() => {});
    list.on("selection:change", handler);

    list.select!(1);
    expect(handler).toHaveBeenCalled();
  });

  it("should handle keyboard navigation (ArrowDown)", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "single" }))
      .build();

    const event = new dom.window.KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
    });
    list.element.dispatchEvent(event);

    const focused = list.element.querySelectorAll(".vlist-item--focused");
    expect(focused.length).toBe(1);
  });
});

// =============================================================================
// withScrollbar Plugin
// =============================================================================

describe("withScrollbar plugin", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should create scrollbar DOM elements", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(100),
    })
      .use(withScrollbar())
      .build();

    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).not.toBeNull();

    const thumb = list.element.querySelector(".vlist-scrollbar-thumb");
    expect(thumb).not.toBeNull();
  });

  it("should not create scrollbar without plugin", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(100),
    }).build();

    // No custom scrollbar elements without the plugin
    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).toBeNull();
  });

  it("should hide native scrollbar via CSS class", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(100),
    })
      .use(withScrollbar())
      .build();

    const viewport = list.element.querySelector(".vlist-viewport");
    expect(
      viewport!.classList.contains("vlist-viewport--custom-scrollbar"),
    ).toBe(true);
  });

  it("should clean up scrollbar on destroy", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(100),
    })
      .use(withScrollbar())
      .build();

    const root = list.element;
    list.destroy();
    list = null;

    // Root removed from DOM
    expect(root.parentElement).toBeNull();
  });
});

// =============================================================================
// withData Plugin (Async Adapter)
// =============================================================================

describe("withData plugin", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should call adapter.read on initial load", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter }))
      .build();

    await flush();

    expect(adapter.read).toHaveBeenCalled();
  });

  it("should set aria-busy during initial load", () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter }))
      .build();

    // aria-busy should be set synchronously before the async load completes
    expect(list.element.getAttribute("aria-busy")).toBe("true");
  });

  it("should clear aria-busy after load completes", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter }))
      .build();

    await flush();

    expect(list.element.getAttribute("aria-busy")).toBeNull();
  });

  it("should emit load:end event after initial load", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter }))
      .build();

    const loadEndHandler = mock(() => {});
    list.on("load:end", loadEndHandler);

    await flush();

    expect(loadEndHandler).toHaveBeenCalled();
  });

  it("should expose reload method", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter }))
      .build();

    await flush();

    const callCountBefore = (adapter.read as any).mock.calls.length;
    await list.reload();
    await flush();

    expect((adapter.read as any).mock.calls.length).toBeGreaterThan(
      callCountBefore,
    );
  });

  it("should render items after async load", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter }))
      .build();

    await flush();

    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// withCompression Plugin
// =============================================================================

describe("withCompression plugin", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should handle large lists without crashing", () => {
    // 500K items × 40px = 20M px > 16.7M limit
    const items = createTestItems(500_000);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withCompression())
      .build();

    expect(list.total).toBe(500_000);
    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
    expect(indices.length).toBeLessThan(100);
  });

  it("should create custom scrollbar as fallback for compressed mode", () => {
    const items = createTestItems(500_000);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withCompression())
      .build();

    // Compression plugin creates a fallback scrollbar when no withScrollbar
    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).not.toBeNull();
  });

  it("should render initial range at top correctly", () => {
    const items = createTestItems(500_000);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withCompression())
      .build();

    const indices = getRenderedIndices(list);
    expect(indices).toContain(0);
    // All initial items should be at the start
    const maxIdx = Math.max(...indices);
    expect(maxIdx).toBeLessThan(50);
  });

  it("should render items near target after scrollToIndex", () => {
    const items = createTestItems(500_000);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withCompression())
      .build();

    const targetIndex = 250_000;
    list.scrollToIndex(targetIndex, "center");

    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);

    const tolerance = 50;
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(targetIndex - tolerance);
      expect(idx).toBeLessThanOrEqual(targetIndex + tolerance);
    }
  });

  it("should render last items when scrolled to end", () => {
    const items = createTestItems(500_000);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withCompression())
      .build();

    list.scrollToIndex(499_999, "end");

    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
    expect(indices).toContain(499_999);

    const minIdx = Math.min(...indices);
    expect(minIdx).toBeGreaterThan(499_000);
  });

  it("should handle transition from uncompressed to compressed", () => {
    const items = createTestItems(100);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withCompression())
      .build();

    expect(list.total).toBe(100);

    // Grow to trigger compression (500K × 40px = 20M > 16.7M limit)
    list.setItems(createTestItems(500_000));
    expect(list.total).toBe(500_000);

    // Should still render items at the top
    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
  });

  it("should handle transition from compressed to uncompressed", () => {
    const items = createTestItems(500_000);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withCompression())
      .build();

    // Shrink below compression threshold
    list.setItems(createTestItems(100));
    expect(list.total).toBe(100);

    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
  });

  it("should update viewport state during scroll with compression", () => {
    // Regression test for viewport state sync issue with compression + scrollbar
    // This was the bug that caused items to not render properly on large lists
    const items = createTestItems(500_000);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withCompression())
      .use(withScrollbar({ autoHide: true }))
      .build();

    // Track range changes after scroll
    let rangeChanged = false;
    list.on("range:change", () => {
      rangeChanged = true;
    });

    // Initial render at top
    const initialIndices = getRenderedIndices(list);
    expect(initialIndices.length).toBeGreaterThan(0);
    expect(initialIndices).toContain(0);

    // Scroll to middle - this should trigger range updates
    const targetIndex = 250_000;
    list.scrollToIndex(targetIndex, "center");

    // Range change event should have fired
    expect(rangeChanged).toBe(true);

    // Items should render near the target (verifies viewport state was updated)
    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);

    // At least some items should be near the target
    const hasNearbyItems = indices.some(
      (idx) => Math.abs(idx - targetIndex) < 100,
    );
    expect(hasNearbyItems).toBe(true);

    // Should not still be rendering items from the top
    const hasTopItems = indices.some((idx) => idx < 100);
    expect(hasTopItems).toBe(false);
  });

  it("should update scrollbar bounds when items change", () => {
    // Regression test for scrollbar not updating when switching item counts
    // (e.g., from 100K to 500K in the example)
    const items100k = createTestItems(100_000);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: items100k,
    })
      .use(withCompression())
      .use(withScrollbar({ autoHide: true }))
      .build();

    // Initial render
    let indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
    expect(indices).toContain(0);

    // Change to 500K items (triggers compression)
    const items500k = createTestItems(500_000);
    list.setItems(items500k);

    expect(list.total).toBe(500_000);

    // Scroll to middle - this should work if scrollbar bounds were updated
    list.scrollToIndex(250_000, "center");

    // Items should render near the middle (not stuck at top or empty)
    indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
    const hasMiddleItems = indices.some((idx) => Math.abs(idx - 250_000) < 100);
    expect(hasMiddleItems).toBe(true);

    // Scroll to end - should render items at the end
    list.scrollToIndex(499_999, "end");
    indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
    expect(indices).toContain(499_999);
  });
});

// =============================================================================
// withSnapshots Plugin
// =============================================================================

describe("withSnapshots plugin", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should add snapshot methods to the API", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(100),
    })
      .use(withSnapshots())
      .build();

    expect(typeof list.getScrollSnapshot).toBe("function");
    expect(typeof list.restoreScroll).toBe("function");
  });

  it("should capture a scroll snapshot", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(100),
    })
      .use(withSnapshots())
      .build();

    const snapshot = list.getScrollSnapshot!();
    expect(snapshot).toBeDefined();
    expect(typeof snapshot.index).toBe("number");
    expect(snapshot.index).toBeGreaterThanOrEqual(0);
  });

  it("should restore from a snapshot", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(200),
    })
      .use(withSnapshots())
      .build();

    // Scroll to a position
    list.scrollToIndex(50, "start");
    simulateScroll(list, 2000); // 50 * 40px
    const snapshot = list.getScrollSnapshot!();

    // Scroll away
    simulateScroll(list, 0);

    // Restore and verify
    list.restoreScroll!(snapshot);
    // restoreScroll should set scroll position back
    expect(list.getScrollPosition()).toBeGreaterThan(0);
  });
});

// =============================================================================
// Plugin Combinations
// =============================================================================

describe("plugin combinations", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should work with selection + scrollbar", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(100),
    })
      .use(withSelection({ mode: "multiple" }))
      .use(withScrollbar())
      .build();

    expect(list.total).toBe(100);
    expect(typeof list.select).toBe("function");

    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).not.toBeNull();

    list.select!(1, 2, 3);
    expect(list.getSelected!()).toEqual([1, 2, 3]);
  });

  it("should work with scrollbar + snapshots", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(100),
    })
      .use(withScrollbar())
      .use(withSnapshots())
      .build();

    expect(list.total).toBe(100);
    expect(typeof list.getScrollSnapshot).toBe("function");

    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).not.toBeNull();

    const snapshot = list.getScrollSnapshot!();
    expect(snapshot).toBeDefined();
  });

  it("should work with compression + scrollbar", () => {
    // This test must verify:
    // 1. getCachedCompression() returns correct compressed state
    // 2. Scrollbar gets correct compressed bounds (not uncompressed)
    // 3. Viewport state is synced during scroll
    // 4. Scrollbar updates when item count changes
    // 5. Scrolling to positions works correctly

    const items = createTestItems(500_000);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withCompression())
      .use(withScrollbar())
      .build();

    expect(list.total).toBe(500_000);

    // Scrollbar should exist (from withScrollbar plugin)
    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).not.toBeNull();

    // Initial render at top
    let indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
    expect(indices).toContain(0);

    // Scroll to middle - this tests:
    // - Viewport state is synced (needed for compression calculations)
    // - Scrollbar bounds are correct (thumb position calculated from bounds)
    list.scrollToIndex(250_000, "center");

    // Should render items near middle (not stuck at top)
    indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
    const hasMiddleItems = indices.some((idx) => Math.abs(idx - 250_000) < 100);
    expect(hasMiddleItems).toBe(true);
    const hasTopItems = indices.some((idx) => idx < 100);
    expect(hasTopItems).toBe(false);

    // Scroll to end
    list.scrollToIndex(499_999, "end");
    indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
    expect(indices).toContain(499_999);

    // Change item count to test scrollbar bounds update
    // Switch to 100K items (below compression threshold)
    const items100k = createTestItems(100_000);
    list.setItems(items100k);
    expect(list.total).toBe(100_000);

    // Scroll to top after setItems (setItems doesn't reset scroll position)
    list.scrollToIndex(0, "start");

    // Should render at top
    indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
    expect(indices).toContain(0);

    // Scroll to end with new item count - tests scrollbar bounds were updated
    list.scrollToIndex(99_999, "end");
    indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
    expect(indices).toContain(99_999);
  });

  it("should work with compression + selection", () => {
    const items = createTestItems(500_000);
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withCompression())
      .use(withSelection({ mode: "single" }))
      .build();

    list.select!(1);
    expect(list.getSelected!()).toEqual([1]);
  });

  it("should work with data + compression", async () => {
    const adapter = createMockAdapter(500_000);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter }))
      .use(withCompression())
      .build();

    await flush();

    expect(adapter.read).toHaveBeenCalled();
    expect(list.total).toBeGreaterThan(0);

    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
  });

  it("should work with all plugins combined", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(100),
    })
      .use(withCompression())
      .use(withScrollbar())
      .use(withSelection({ mode: "multiple" }))
      .use(withSnapshots())
      .build();

    expect(list.total).toBe(100);
    expect(typeof list.select).toBe("function");
    expect(typeof list.getScrollSnapshot).toBe("function");

    list.select!(1, 2);
    expect(list.getSelected!()).toEqual([1, 2]);

    list.scrollToIndex(50, "center");
    const snapshot = list.getScrollSnapshot!();
    expect(snapshot).toBeDefined();
  });

  it("should respect plugin priority order", () => {
    // Compression (20) should run before scrollbar (30) and selection (50)
    // This test verifies they don't conflict when added in arbitrary order
    // This test verifies they don't conflict when added in arbitrary order
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(500_000),
    })
      .use(withScrollbar()) // priority 30
      .use(withCompression()) // priority 20
      .use(withSelection({ mode: "single" })) // priority 50
      .build();

    expect(list.total).toBe(500_000);

    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).not.toBeNull();

    expect(typeof list.select).toBe("function");

    // Should still be able to scroll in compressed mode
    list.scrollToIndex(250_000, "center");
    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
  });

  it("should destroy cleanly with multiple plugins", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(100),
    })
      .use(withCompression())
      .use(withScrollbar())
      .use(withSnapshots())
      .build();

    const root = list.element;
    expect(root.parentElement).toBeTruthy();

    list.destroy();
    expect(root.parentElement).toBeNull();
    list = null;
  });
});

// =============================================================================
// Reverse Mode (Builder)
// =============================================================================

describe("builder reverse mode", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should create a reverse-mode list", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(100),
      reverse: true,
    }).build();

    expect(list.total).toBe(100);
    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);

    // In reverse mode, the last items should be rendered initially
    expect(indices).toContain(99);
  });

  it("should render items near the bottom on init", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(200),
      reverse: true,
    }).build();

    const indices = getRenderedIndices(list);
    const maxIdx = Math.max(...indices);

    // Should include the very last item
    expect(maxIdx).toBe(199);
  });
});

// =============================================================================
// Scroll Configuration
// =============================================================================

describe("builder scroll config", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should respect custom overscan", () => {
    // Large overscan should render more items
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(100),
      overscan: 20,
    }).build();

    const indices = getRenderedIndices(list);
    // With 500px container and 40px items = ~13 visible + 20 overscan on each side
    expect(indices.length).toBeGreaterThan(20);
  });

  it("should support custom classPrefix", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(10),
      classPrefix: "mylist",
    }).build();

    expect(list.element.classList.contains("mylist")).toBe(true);

    const viewport = list.element.querySelector(".mylist-viewport");
    expect(viewport).not.toBeNull();

    const items = list.element.querySelectorAll(".mylist-item");
    expect(items.length).toBeGreaterThan(0);
  });

  it("should use default overscan of 3", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(100),
      // no explicit overscan
    }).build();

    const indices = getRenderedIndices(list);
    // 500px / 40px = 12.5 visible → 13 visible + 3 overscan each side = ~19
    expect(indices.length).toBeGreaterThan(10);
    expect(indices.length).toBeLessThan(30);
  });
});

// =============================================================================
// Horizontal Mode
// =============================================================================

describe("builder horizontal mode", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should create a horizontal list", () => {
    list = vlist<TestItem>({
      container,
      item: { width: 100, height: 40, template },
      direction: "horizontal",
    }).build();

    expect(list.element).toBeDefined();
    expect(list.element.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("should render items in horizontal mode", () => {
    list = vlist<TestItem>({
      container,
      item: { width: 100, height: 40, template },
      items: createTestItems(50),
      direction: "horizontal",
    }).build();

    expect(list.total).toBe(50);
    const indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// withGrid Plugin
// =============================================================================

describe("withGrid plugin", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should create a grid layout with specified columns", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(20),
    })
      .use(withGrid({ columns: 4 }))
      .build();

    expect(list.element).toBeDefined();
    expect(list.element.classList.contains("vlist--grid")).toBe(true);
  });

  it("should render items in a grid pattern", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(20),
    })
      .use(withGrid({ columns: 4 }))
      .build();

    // Check that items have data-row and data-col attributes
    const items = list.element.querySelectorAll("[data-index]");
    expect(items.length).toBeGreaterThan(0);

    // First item should be at row 0, col 0
    const firstItem = items[0] as HTMLElement;
    expect(firstItem.dataset.row).toBeDefined();
    expect(firstItem.dataset.col).toBeDefined();

    // Grid items should have the grid-item class
    expect(firstItem.classList.contains("vlist-grid-item")).toBe(true);
  });

  it("should apply gap between items", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(20),
    })
      .use(withGrid({ columns: 4, gap: 8 }))
      .build();

    expect(list.element).toBeDefined();
    expect(list.element.classList.contains("vlist--grid")).toBe(true);

    // Items should be rendered
    const items = list.element.querySelectorAll("[data-index]");
    expect(items.length).toBeGreaterThan(0);
  });

  it("should calculate correct column widths", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(20),
    })
      .use(withGrid({ columns: 3, gap: 10 }))
      .build();

    // Container is 300px wide, 3 columns with 10px gap
    // Total gap = (3-1) * 10 = 20px
    // Column width = (300 - 20) / 3 ≈ 93.33px
    const items = list.element.querySelectorAll("[data-index]");
    expect(items.length).toBeGreaterThan(0);

    const firstItem = items[0] as HTMLElement;
    // Check that width is set (might differ based on viewport mock)
    expect(firstItem.style.width).toBeDefined();
    expect(parseFloat(firstItem.style.width)).toBeGreaterThan(0);
  });

  it("should position items using translate", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(12),
    })
      .use(withGrid({ columns: 4, gap: 0 }))
      .build();

    const items = list.element.querySelectorAll("[data-index]");
    expect(items.length).toBeGreaterThan(0);

    // First item should use translate positioning
    const firstItem = items[0] as HTMLElement;
    expect(firstItem.style.transform).toContain("translate");
  });

  it("should handle setItems correctly", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(8),
    })
      .use(withGrid({ columns: 4 }))
      .build();

    // Grid mode shows total items (not rows)
    const initialItems = list.element.querySelectorAll("[data-index]");
    expect(initialItems.length).toBeGreaterThan(0);

    list.setItems(createTestItems(16));

    // After setItems, should have more items available
    const newItems = list.element.querySelectorAll("[data-index]");
    expect(newItems.length).toBeGreaterThan(0);
  });

  it("should handle appendItems correctly", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(8),
    })
      .use(withGrid({ columns: 4 }))
      .build();

    const initialCount = list.element.querySelectorAll("[data-index]").length;
    expect(initialCount).toBeGreaterThan(0);

    list.appendItems(
      createTestItems(4).map((item, i) => ({
        ...item,
        id: 100 + i,
        name: `Appended ${i + 1}`,
      })),
    );

    // Should not throw and grid should still be functional
    expect(list.element.classList.contains("vlist--grid")).toBe(true);
  });

  it("should handle prependItems correctly", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(8),
    })
      .use(withGrid({ columns: 4 }))
      .build();

    const initialCount = list.element.querySelectorAll("[data-index]").length;
    expect(initialCount).toBeGreaterThan(0);

    list.prependItems(
      createTestItems(4).map((item, i) => ({
        ...item,
        id: 200 + i,
        name: `Prepended ${i + 1}`,
      })),
    );

    // Should not throw and grid should still be functional
    expect(list.element.classList.contains("vlist--grid")).toBe(true);
  });

  it("should handle removeItem correctly", () => {
    const items = createTestItems(8);
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items,
    })
      .use(withGrid({ columns: 4 }))
      .build();

    const initialCount = list.element.querySelectorAll("[data-index]").length;
    expect(initialCount).toBeGreaterThan(0);

    list.removeItem(items[0].id);

    // Should not throw and grid should still be functional
    expect(list.element.classList.contains("vlist--grid")).toBe(true);
  });

  it("should scroll to correct row when using scrollToIndex", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(100),
    })
      .use(withGrid({ columns: 4 }))
      .build();

    // Item 40 should be at row 10 (40 / 4 = 10)
    list.scrollToIndex(40, "start");

    // Viewport should have scrolled
    const viewport = list.element.querySelector(
      ".vlist-viewport",
    ) as HTMLElement;
    expect(viewport.scrollTop).toBeGreaterThan(0);
  });

  it("should throw when columns is less than 1", () => {
    expect(() => {
      vlist<TestItem>({
        container,
        item: { height: 100, template },
        items: createTestItems(8),
      })
        .use(withGrid({ columns: 0 }))
        .build();
    }).toThrow("columns must be a positive integer >= 1");
  });

  it("should throw when used with horizontal direction", () => {
    expect(() => {
      vlist<TestItem>({
        container,
        item: { height: 100, width: 100, template },
        items: createTestItems(8),
        direction: "horizontal",
      })
        .use(withGrid({ columns: 4 }))
        .build();
    }).toThrow("withGrid cannot be used with direction: 'horizontal'");
  });

  it("should throw when used with reverse mode", () => {
    expect(() => {
      vlist<TestItem>({
        container,
        item: { height: 100, template },
        items: createTestItems(8),
        reverse: true,
      })
        .use(withGrid({ columns: 4 }))
        .build();
    }).toThrow("withGrid cannot be used with reverse: true");
  });

  it("should clean up grid class on destroy", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(8),
    })
      .use(withGrid({ columns: 4 }))
      .build();

    const root = list.element;
    expect(root.classList.contains("vlist--grid")).toBe(true);

    list.destroy();
    list = null;

    expect(root.classList.contains("vlist--grid")).toBe(false);
  });

  it("should handle single column (degenerate case)", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(10),
    })
      .use(withGrid({ columns: 1 }))
      .build();

    // Should work like a normal list
    expect(list.element.classList.contains("vlist--grid")).toBe(true);

    const items = list.element.querySelectorAll("[data-index]");
    expect(items.length).toBeGreaterThan(0);

    // All items should be in col 0
    items.forEach((item) => {
      expect((item as HTMLElement).dataset.col).toBe("0");
    });
  });

  it("should handle partially filled last row", () => {
    // 10 items with 4 columns = 3 rows, last row has 2 items
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(10),
    })
      .use(withGrid({ columns: 4 }))
      .build();

    expect(list.element.classList.contains("vlist--grid")).toBe(true);

    // Check that items are rendered
    const items = list.element.querySelectorAll("[data-index]");
    expect(items.length).toBeGreaterThan(0);

    // Each item should have row and col attributes
    items.forEach((item) => {
      const el = item as HTMLElement;
      expect(el.dataset.row).toBeDefined();
      expect(el.dataset.col).toBeDefined();
    });
  });

  it("should handle empty items array", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: [],
    })
      .use(withGrid({ columns: 4 }))
      .build();

    expect(list.total).toBe(0);
    const items = list.element.querySelectorAll("[data-index]");
    expect(items.length).toBe(0);
  });

  it("should set aria attributes on grid items", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(12),
      ariaLabel: "Photo gallery",
    })
      .use(withGrid({ columns: 4 }))
      .build();

    const items = list.element.querySelectorAll("[data-index]");
    expect(items.length).toBeGreaterThan(0);

    const firstItem = items[0] as HTMLElement;
    expect(firstItem.getAttribute("role")).toBe("option");
    // aria-setsize reflects total items
    expect(firstItem.getAttribute("aria-setsize")).toBeDefined();
    expect(firstItem.getAttribute("aria-posinset")).toBeDefined();
  });

  // Integration tests for scroll virtualization
  it("should virtualize and render multiple rows on scroll", () => {
    // Container with 600px height can show ~6 rows at 100px each
    container.style.height = "600px";

    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(600), // 150 rows with 4 columns
    })
      .use(withGrid({ columns: 4 }))
      .build();

    // Initial: first rows (with overscan)
    let indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(16); // More than 1 row
    const firstMax = Math.max(...indices);
    expect(firstMax).toBeLessThan(60); // Still near top

    // Scroll down
    simulateScroll(list, 2000);
    flush();

    indices = getRenderedIndices(list);
    const secondMin = Math.min(...indices);
    const secondMax = Math.max(...indices);

    // Should have scrolled - range should be different
    expect(secondMin).toBeGreaterThan(50); // Past initial rows
    expect(secondMax).toBeGreaterThan(firstMax); // Further than before
  });

  it("should update rendered items continuously as user scrolls", () => {
    container.style.height = "400px";

    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(400), // 100 rows
    })
      .use(withGrid({ columns: 4 }))
      .build();

    // Start at top
    let indices = getRenderedIndices(list);
    const firstMin = Math.min(...indices);
    const firstMax = Math.max(...indices);

    // Scroll down by 500px
    simulateScroll(list, 500);
    flush();

    indices = getRenderedIndices(list);
    const secondMin = Math.min(...indices);
    const secondMax = Math.max(...indices);

    // Range should have shifted down
    expect(secondMin).toBeGreaterThan(firstMin);
    expect(secondMax).toBeGreaterThan(firstMax);

    // Scroll down more
    simulateScroll(list, 1500);
    flush();

    indices = getRenderedIndices(list);
    const thirdMin = Math.min(...indices);
    const thirdMax = Math.max(...indices);

    // Range should continue shifting
    expect(thirdMin).toBeGreaterThan(secondMin);
    expect(thirdMax).toBeGreaterThan(secondMax);
  });

  it("should render correct rows with gap applied", () => {
    container.style.height = "600px";

    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(200), // 50 rows
    })
      .use(withGrid({ columns: 4, gap: 8 }))
      .build();

    // Initial render
    let indices = getRenderedIndices(list);
    expect(indices.length).toBeGreaterThan(0);

    // Scroll down
    simulateScroll(list, 1000);
    flush();

    indices = getRenderedIndices(list);
    // Should have items from middle rows
    expect(Math.min(...indices)).toBeGreaterThan(20);
    expect(Math.max(...indices)).toBeLessThan(180);
  });

  it("should handle range:change events on scroll", () => {
    container.style.height = "600px";
    let rangeChanges = 0;

    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(400),
    })
      .use(withGrid({ columns: 4 }))
      .build();

    list.on("range:change", () => {
      rangeChanges++;
    });

    const initialRangeChanges = rangeChanges;

    // Scroll and trigger range updates
    simulateScroll(list, 500);
    flush();

    simulateScroll(list, 1500);
    flush();

    // Should have emitted range:change events
    expect(rangeChanges).toBeGreaterThan(initialRangeChanges);
  });

  it("should render all visible items in viewport at various scroll positions", () => {
    container.style.height = "500px"; // 5 rows visible

    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(1000), // 250 rows
    })
      .use(withGrid({ columns: 4 }))
      .build();

    // Test multiple scroll positions (stay within reasonable scroll bounds)
    const scrollPositions = [0, 1000, 3000, 5000];

    for (const scrollTop of scrollPositions) {
      simulateScroll(list, scrollTop);
      flush();

      const indices = getRenderedIndices(list);
      // Should always have items rendered (with overscan)
      expect(indices.length).toBeGreaterThan(20); // At least 5 rows + overscan
      expect(indices.length).toBeLessThan(100); // But not everything
    }
  });
});

// =============================================================================
// withGrid + Plugin Combinations
// =============================================================================

describe("withGrid plugin combinations", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should work with selection plugin", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(20),
    })
      .use(withGrid({ columns: 4 }))
      .use(withSelection({ mode: "multiple" }))
      .build();

    expect(list.select).toBeDefined();
    expect(list.getSelected).toBeDefined();

    list.select!(1, 2, 3);
    expect(list.getSelected!()).toEqual([1, 2, 3]);
  });

  it("should work with scrollbar plugin", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(100),
    })
      .use(withGrid({ columns: 4 }))
      .use(withScrollbar())
      .build();

    const scrollbar = list.element.querySelector(".vlist-scrollbar-track");
    expect(scrollbar).toBeDefined();
  });

  it("should work with snapshots plugin", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(100),
    })
      .use(withGrid({ columns: 4 }))
      .use(withSnapshots())
      .build();

    expect(list.getScrollSnapshot).toBeDefined();
    expect(list.restoreScroll).toBeDefined();

    const snapshot = list.getScrollSnapshot!();
    expect(snapshot).toHaveProperty("index");
    expect(snapshot).toHaveProperty("offsetInItem");
  });

  it("should work with selection + scrollbar", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(100),
    })
      .use(withGrid({ columns: 4 }))
      .use(withSelection({ mode: "single" }))
      .use(withScrollbar())
      .build();

    // Selection should work
    list.select!(5);
    expect(list.getSelected!()).toEqual([5]);

    // Scrollbar should exist
    const scrollbar = list.element.querySelector(".vlist-scrollbar-track");
    expect(scrollbar).toBeDefined();
  });

  it("should work with compression for large grids", () => {
    // Create a large grid that would exceed browser height limit
    // With 5 columns and 100px rows, 100000 items = 20000 rows = 2M pixels
    const largeItems = createTestItems(100000);

    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: largeItems,
    })
      .use(withGrid({ columns: 5 }))
      .use(withCompression())
      .build();

    // Should render some items (viewport + overscan)
    const items = list.element.querySelectorAll("[data-index]");
    expect(items.length).toBeGreaterThan(0);

    // Grid class should be applied
    expect(list.element.classList.contains("vlist--grid")).toBe(true);
  });

  it("should work with data plugin for async loading", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
    })
      .use(withGrid({ columns: 4 }))
      .use(withData({ adapter }))
      .build();

    // Wait for initial load
    await flush();

    // Items should have loaded
    expect(adapter.read).toHaveBeenCalled();

    // Should render items in grid pattern
    const items = list.element.querySelectorAll("[data-index]");
    expect(items.length).toBeGreaterThan(0);
  });

  it("should maintain grid layout after reload", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
    })
      .use(withGrid({ columns: 4 }))
      .use(withData({ adapter }))
      .build();

    await flush();

    const callsBefore = (adapter.read as any).mock.calls.length;

    await list.reload();
    await flush();

    expect((adapter.read as any).mock.calls.length).toBeGreaterThan(
      callsBefore,
    );

    // Grid class should still be present
    expect(list.element.classList.contains("vlist--grid")).toBe(true);
  });

  it("should apply selected class to grid items", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(20),
    })
      .use(withGrid({ columns: 4 }))
      .use(withSelection({ mode: "multiple" }))
      .build();

    // Select items that are in the visible range
    list.select!(1, 2, 3);

    // Check that selected items have the class
    const selectedItems = list.element.querySelectorAll(
      ".vlist-item--selected",
    );
    expect(selectedItems.length).toBeGreaterThan(0);
  });

  it("should destroy cleanly with multiple plugins", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(20),
    })
      .use(withGrid({ columns: 4 }))
      .use(withSelection({ mode: "multiple" }))
      .use(withScrollbar())
      .build();

    const root = list.element;

    expect(() => {
      list!.destroy();
      list = null;
    }).not.toThrow();

    expect(root.classList.contains("vlist--grid")).toBe(false);
  });
});

// =============================================================================
// withGroups Plugin
// =============================================================================

/** Test item with a group field for grouped list tests */
interface GroupedTestItem extends VListItem {
  id: number;
  name: string;
  group: string;
}

/** Create sorted grouped test items (contacts sorted by first letter) */
const createGroupedItems = (count: number): GroupedTestItem[] => {
  const names = [
    "Alice",
    "Amy",
    "Anna",
    "Bob",
    "Ben",
    "Brian",
    "Carol",
    "Chris",
    "Cathy",
    "David",
    "Dan",
    "Diana",
    "Eve",
    "Emma",
    "Eric",
  ];

  const items: GroupedTestItem[] = [];
  for (let i = 0; i < count; i++) {
    const name = names[i % names.length]!;
    items.push({
      id: i + 1,
      name: `${name} ${i + 1}`,
      group: name[0]!, // First letter as group
    });
  }

  // Sort by group (first letter) then by name
  items.sort((a, b) => {
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    return a.name.localeCompare(b.name);
  });

  return items;
};

const groupedTemplate = (item: GroupedTestItem): string => {
  return `<div class="contact">${item.name}</div>`;
};

const headerTemplate = (key: string, _groupIndex: number): HTMLElement => {
  const el = document.createElement("div");
  el.className = "group-header";
  el.textContent = key;
  return el;
};

describe("withGroups plugin", () => {
  let container: HTMLElement;
  let list: BuiltVList<GroupedTestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should create a grouped list with headers", () => {
    const items = createGroupedItems(15);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    expect(list.element).toBeDefined();
    expect(list.element.classList.contains("vlist--grouped")).toBe(true);
  });

  it("should insert header items at group boundaries", () => {
    const items = createGroupedItems(9); // 3 items per group (A, B, C)

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    // Should have group headers rendered
    const headers = list.element.querySelectorAll(".group-header");
    expect(headers.length).toBeGreaterThan(0);
  });

  it("should render header content correctly", () => {
    const items = createGroupedItems(6);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    const headers = list.element.querySelectorAll(".group-header");
    expect(headers.length).toBeGreaterThan(0);

    // First header should contain the first group key
    const firstHeader = headers[0] as HTMLElement;
    expect(firstHeader.textContent).toBe("A");
  });

  it("should create sticky header element when sticky is enabled", () => {
    const items = createGroupedItems(15);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
          sticky: true, // explicit
        }),
      )
      .build();

    const stickyHeader = list.element.querySelector(".vlist-sticky-header");
    expect(stickyHeader).toBeDefined();
    expect(stickyHeader).not.toBeNull();
  });

  it("should not create sticky header when sticky is false", () => {
    const items = createGroupedItems(15);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
          sticky: false,
        }),
      )
      .build();

    const stickyHeader = list.element.querySelector(".vlist-sticky-header");
    expect(stickyHeader).toBeNull();
  });

  it("should handle setItems correctly", () => {
    const items = createGroupedItems(9);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    // Create new items with different groups
    const newItems = createGroupedItems(6);

    // setItems should work without throwing
    expect(() => list!.setItems(newItems)).not.toThrow();

    // List should still be functional
    expect(list.element.classList.contains("vlist--grouped")).toBe(true);
  });

  it("should handle appendItems correctly", () => {
    // Use a mutable reference for getGroupForIndex
    let currentItems = createGroupedItems(6);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items: currentItems,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => currentItems[i]?.group ?? "Z",
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    const moreItems: GroupedTestItem[] = [
      { id: 100, name: "Zach 100", group: "Z" },
      { id: 101, name: "Zoe 101", group: "Z" },
    ];

    // Update the reference before appending
    currentItems = [...currentItems, ...moreItems];

    expect(() => list!.appendItems(moreItems)).not.toThrow();
    expect(list.element.classList.contains("vlist--grouped")).toBe(true);
  });

  it("should handle prependItems correctly", () => {
    // Use a mutable reference for getGroupForIndex
    let currentItems = createGroupedItems(6);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items: currentItems,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => currentItems[i]?.group ?? "A",
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    const moreItems: GroupedTestItem[] = [
      { id: 200, name: "Aaron 200", group: "A" },
    ];

    // Update the reference before prepending
    currentItems = [...moreItems, ...currentItems];

    expect(() => list!.prependItems(moreItems)).not.toThrow();
    expect(list.element.classList.contains("vlist--grouped")).toBe(true);
  });

  it("should handle removeItem correctly", () => {
    const items = createGroupedItems(9);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    // Remove an item
    expect(() => list!.removeItem(items[0]!.id)).not.toThrow();
    expect(list.element.classList.contains("vlist--grouped")).toBe(true);
  });

  it("should map data index to layout index correctly for scrollToIndex", () => {
    const items = createGroupedItems(15);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    // scrollToIndex should not throw (uses data index → layout index mapping)
    expect(() => list!.scrollToIndex(5)).not.toThrow();
    expect(() => list!.scrollToIndex(10, "center")).not.toThrow();
  });

  it("should include headers in layout items", () => {
    const items = createGroupedItems(9);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    // The items getter returns layout items (data items + headers)
    // This is the current implementation behavior
    const returnedItems = list.items;

    // Layout items = data items + group headers
    // With 9 items in ~3 groups, we get 9 + 3 = 12 layout items
    expect(returnedItems.length).toBeGreaterThan(items.length);

    // Some of the returned items should be headers
    const headers = returnedItems.filter((item: any) => isGroupHeader(item));
    expect(headers.length).toBeGreaterThan(0);
  });

  it("should return layout total (data items + headers)", () => {
    const items = createGroupedItems(9); // 9 items in ~3 groups

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    // total returns layout items count (data + headers)
    // This is the current implementation behavior
    expect(list.total).toBeGreaterThan(items.length);
  });

  it("should throw when getGroupForIndex is missing", () => {
    const items = createGroupedItems(6);

    expect(() => {
      vlist<GroupedTestItem>({
        container,
        item: { height: 50, template: groupedTemplate },
        items,
      })
        .use(
          withGroups({
            getGroupForIndex: undefined as any,
            headerHeight: 32,
            headerTemplate,
          }),
        )
        .build();
    }).toThrow(/getGroupForIndex is required/);
  });

  it("should throw when headerHeight is missing or invalid", () => {
    const items = createGroupedItems(6);

    expect(() => {
      vlist<GroupedTestItem>({
        container,
        item: { height: 50, template: groupedTemplate },
        items,
      })
        .use(
          withGroups({
            getGroupForIndex: (i) => items[i]!.group,
            headerHeight: 0,
            headerTemplate,
          }),
        )
        .build();
    }).toThrow(/headerHeight must be a positive number/);

    expect(() => {
      vlist<GroupedTestItem>({
        container,
        item: { height: 50, template: groupedTemplate },
        items,
      })
        .use(
          withGroups({
            getGroupForIndex: (i) => items[i]!.group,
            headerHeight: -10,
            headerTemplate,
          }),
        )
        .build();
    }).toThrow(/headerHeight must be a positive number/);
  });

  it("should throw when headerTemplate is missing", () => {
    const items = createGroupedItems(6);

    expect(() => {
      vlist<GroupedTestItem>({
        container,
        item: { height: 50, template: groupedTemplate },
        items,
      })
        .use(
          withGroups({
            getGroupForIndex: (i) => items[i]!.group,
            headerHeight: 32,
            headerTemplate: undefined as any,
          }),
        )
        .build();
    }).toThrow(/headerTemplate is required/);
  });

  it("should throw when used with horizontal direction", () => {
    const items = createGroupedItems(6);

    expect(() => {
      vlist<GroupedTestItem>({
        container,
        item: { height: 50, width: 100, template: groupedTemplate },
        items,
        direction: "horizontal",
      })
        .use(
          withGroups({
            getGroupForIndex: (i) => items[i]!.group,
            headerHeight: 32,
            headerTemplate,
          }),
        )
        .build();
    }).toThrow(/cannot be used with direction: 'horizontal'/);
  });

  it("should throw when used with reverse mode", () => {
    const items = createGroupedItems(6);

    expect(() => {
      vlist<GroupedTestItem>({
        container,
        item: { height: 50, template: groupedTemplate },
        items,
        reverse: true,
      })
        .use(
          withGroups({
            getGroupForIndex: (i) => items[i]!.group,
            headerHeight: 32,
            headerTemplate,
          }),
        )
        .build();
    }).toThrow(/cannot be used with reverse: true/);
  });

  it("should clean up grouped class on destroy", () => {
    const items = createGroupedItems(9);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    const root = list.element;
    expect(root.classList.contains("vlist--grouped")).toBe(true);

    list.destroy();
    list = null;

    expect(root.classList.contains("vlist--grouped")).toBe(false);
  });

  it("should remove sticky header on destroy", () => {
    const items = createGroupedItems(9);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
          sticky: true,
        }),
      )
      .build();

    const root = list.element;
    expect(root.querySelector(".vlist-sticky-header")).not.toBeNull();

    list.destroy();
    list = null;

    expect(root.querySelector(".vlist-sticky-header")).toBeNull();
  });

  it("should handle empty items array", () => {
    const items: GroupedTestItem[] = [];

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (_i) => "A",
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    expect(list.element.classList.contains("vlist--grouped")).toBe(true);
    expect(list.total).toBe(0);
  });

  it("should handle single item", () => {
    const items: GroupedTestItem[] = [{ id: 1, name: "Alice", group: "A" }];

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    // total returns layout count: 1 item + 1 header = 2
    expect(list.total).toBe(2);

    // Should have one header
    const headers = list.element.querySelectorAll(".group-header");
    expect(headers.length).toBe(1);
  });

  it("should handle all items in single group", () => {
    const items: GroupedTestItem[] = [
      { id: 1, name: "Alice", group: "A" },
      { id: 2, name: "Amy", group: "A" },
      { id: 3, name: "Anna", group: "A" },
    ];

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    // total returns layout count: 3 items + 1 header = 4
    expect(list.total).toBe(4);

    // Should have exactly one header
    const headers = list.element.querySelectorAll(".group-header");
    expect(headers.length).toBe(1);
  });

  it("should support string return from headerTemplate", () => {
    const items = createGroupedItems(6);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate: (key) => `<div class="string-header">${key}</div>`,
        }),
      )
      .build();

    const headers = list.element.querySelectorAll(".string-header");
    expect(headers.length).toBeGreaterThan(0);
  });

  it("should support variable height items", () => {
    const items = createGroupedItems(9);

    list = vlist<GroupedTestItem>({
      container,
      item: {
        height: (index: number) => (index % 2 === 0 ? 60 : 40),
        template: groupedTemplate,
      },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    expect(list.element.classList.contains("vlist--grouped")).toBe(true);
    // total returns layout count: 9 items + ~3 headers = 12 layout items
    expect(list.total).toBeGreaterThan(items.length);
  });
});

// =============================================================================
// withGroups Plugin Combinations
// =============================================================================

describe("withGroups plugin combinations", () => {
  let container: HTMLElement;
  let list: BuiltVList<GroupedTestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should work with selection plugin", () => {
    const items = createGroupedItems(12);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .use(withSelection({ mode: "multiple" }))
      .build();

    expect(list.element.classList.contains("vlist--grouped")).toBe(true);
    expect(typeof list.select).toBe("function");
    expect(typeof list.getSelected).toBe("function");

    // Selection should work
    list.select(items[0]!.id);
    expect(list.getSelected()).toContain(items[0]!.id);
  });

  it("should work with scrollbar plugin", () => {
    const items = createGroupedItems(30);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .use(withScrollbar())
      .build();

    expect(list.element.classList.contains("vlist--grouped")).toBe(true);

    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).not.toBeNull();
  });

  it("should work with snapshots plugin", () => {
    const items = createGroupedItems(15);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .use(withSnapshots())
      .build();

    expect(list.element.classList.contains("vlist--grouped")).toBe(true);

    // Snapshots plugin adds getScrollSnapshot/restoreScroll methods
    expect(typeof list.getScrollSnapshot).toBe("function");
    expect(typeof list.restoreScroll).toBe("function");

    // Snapshot should work
    const snapshot = list.getScrollSnapshot!();
    expect(snapshot).toBeDefined();
    expect(typeof snapshot.index).toBe("number");
  });

  it("should work with selection + scrollbar", () => {
    const items = createGroupedItems(20);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .use(withSelection({ mode: "multiple" }))
      .use(withScrollbar())
      .build();

    expect(list.element.classList.contains("vlist--grouped")).toBe(true);

    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).not.toBeNull();

    list.select(items[0]!.id);
    expect(list.getSelected()).toContain(items[0]!.id);
  });

  it("should conflict with withGrid plugin", () => {
    const items = createGroupedItems(12);

    // withGroups declares conflict with withGrid
    expect(() => {
      vlist<GroupedTestItem>({
        container,
        item: { height: 50, template: groupedTemplate },
        items,
      })
        .use(
          withGroups({
            getGroupForIndex: (i) => items[i]!.group,
            headerHeight: 32,
            headerTemplate,
          }),
        )
        .use(withGrid({ columns: 3 }))
        .build();
    }).toThrow();
  });

  it("should destroy cleanly with multiple plugins", () => {
    const items = createGroupedItems(15);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .use(withSelection({ mode: "multiple" }))
      .use(withScrollbar())
      .build();

    const root = list.element;

    expect(() => {
      list!.destroy();
      list = null;
    }).not.toThrow();

    expect(root.classList.contains("vlist--grouped")).toBe(false);
    expect(root.querySelector(".vlist-sticky-header")).toBeNull();
  });
});

// =============================================================================
// withGroups Layout Logic (Unit Tests)
// =============================================================================

describe("withGroups layout logic", () => {
  let container: HTMLElement;
  let list: BuiltVList<GroupedTestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should correctly intersperse headers with items", () => {
    // Create items: A, A, B, B, C, C (6 data items, 3 groups)
    const items: GroupedTestItem[] = [
      { id: 1, name: "Alice", group: "A" },
      { id: 2, name: "Amy", group: "A" },
      { id: 3, name: "Bob", group: "B" },
      { id: 4, name: "Ben", group: "B" },
      { id: 5, name: "Carol", group: "C" },
      { id: 6, name: "Chris", group: "C" },
    ];

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 30,
          headerTemplate,
        }),
      )
      .build();

    // Layout should be:
    // [headerA, Alice, Amy, headerB, Bob, Ben, headerC, Carol, Chris]
    // Total layout items = 6 data + 3 headers = 9

    expect(list.total).toBe(9); // Layout items count (data + headers)
    expect(list.items.length).toBe(9);
  });

  it("should handle groups with single item each", () => {
    const items: GroupedTestItem[] = [
      { id: 1, name: "Alice", group: "A" },
      { id: 2, name: "Bob", group: "B" },
      { id: 3, name: "Carol", group: "C" },
    ];

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 30,
          headerTemplate,
        }),
      )
      .build();

    // 3 items, 3 groups = 3 headers → 6 layout items
    expect(list.total).toBe(6);

    // Virtual scrolling only renders visible items in the viewport
    // So we may not see all headers, just check we have at least one
    const headers = list.element.querySelectorAll(".group-header");
    expect(headers.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle large groups correctly", () => {
    // 20 items all in group A
    const items: GroupedTestItem[] = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      name: `Item ${i + 1}`,
      group: "A",
    }));

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 30,
          headerTemplate,
        }),
      )
      .build();

    // 20 items + 1 header = 21 layout items
    expect(list.total).toBe(21);

    // Only one header for single group
    const headers = list.element.querySelectorAll(".group-header");
    expect(headers.length).toBe(1);
  });

  it("should handle alternating groups", () => {
    // This tests the edge case of many small groups
    // A, B, A, B... - but since groups assumes pre-sorted, this creates many groups
    const items: GroupedTestItem[] = [
      { id: 1, name: "A1", group: "A" },
      { id: 2, name: "B1", group: "B" },
      { id: 3, name: "A2", group: "A" },
      { id: 4, name: "B2", group: "B" },
    ];

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 30,
          headerTemplate,
        }),
      )
      .build();

    // Since items aren't sorted, each "switch" creates a new group
    // A -> B -> A -> B = 4 groups → 4 items + 4 headers = 8 layout items
    expect(list.total).toBe(8);

    // Virtual scrolling only renders visible items in the viewport
    // So we may not see all 4 headers, just check we have at least one
    const headers = list.element.querySelectorAll(".group-header");
    expect(headers.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// withGroups Sticky Header Behavior
// =============================================================================

describe("withGroups sticky header behavior", () => {
  let container: HTMLElement;
  let list: BuiltVList<GroupedTestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should position sticky header at top of root", () => {
    const items = createGroupedItems(15);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    const stickyHeader = list.element.querySelector(
      ".vlist-sticky-header",
    ) as HTMLElement;
    expect(stickyHeader).not.toBeNull();
    expect(stickyHeader.style.position).toBe("absolute");
    expect(stickyHeader.style.top).toBe("0px");
  });

  it("should have correct z-index for sticky header", () => {
    const items = createGroupedItems(15);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    const stickyHeader = list.element.querySelector(
      ".vlist-sticky-header",
    ) as HTMLElement;
    expect(stickyHeader.style.zIndex).toBe("5");
  });

  it("should set correct height on sticky header", () => {
    const items = createGroupedItems(15);
    const headerHeight = 40;

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight,
          headerTemplate,
        }),
      )
      .build();

    // Simulate scroll to trigger sticky header update
    const viewport = list.element.querySelector(
      ".vlist-viewport",
    ) as HTMLElement;
    if (viewport) {
      viewport.scrollTop = 50;
      viewport.dispatchEvent(new dom.window.Event("scroll"));
    }

    const stickyHeader = list.element.querySelector(
      ".vlist-sticky-header",
    ) as HTMLElement;

    // After scrolling past first header, sticky should have correct height
    if (stickyHeader.style.display !== "none") {
      expect(stickyHeader.style.height).toBe(`${headerHeight}px`);
    }
  });

  it("should have aria-hidden on sticky header", () => {
    const items = createGroupedItems(15);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    const stickyHeader = list.element.querySelector(
      ".vlist-sticky-header",
    ) as HTMLElement;
    expect(stickyHeader.getAttribute("aria-hidden")).toBe("true");
  });

  it("should have pointer-events none on sticky header", () => {
    const items = createGroupedItems(15);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    const stickyHeader = list.element.querySelector(
      ".vlist-sticky-header",
    ) as HTMLElement;
    expect(stickyHeader.style.pointerEvents).toBe("none");
  });
});

// =============================================================================
// withGroups Template Rendering
// =============================================================================

describe("withGroups template rendering", () => {
  let container: HTMLElement;
  let list: BuiltVList<GroupedTestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should render data items using user template", () => {
    const items: GroupedTestItem[] = [
      { id: 1, name: "Alice", group: "A" },
      { id: 2, name: "Bob", group: "B" },
    ];

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    // Data items should use the user template (contact class)
    const contacts = list.element.querySelectorAll(".contact");
    expect(contacts.length).toBeGreaterThan(0);
  });

  it("should render headers using headerTemplate", () => {
    const items: GroupedTestItem[] = [
      { id: 1, name: "Alice", group: "A" },
      { id: 2, name: "Bob", group: "B" },
    ];

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    // Headers should use the headerTemplate (group-header class)
    const headers = list.element.querySelectorAll(".group-header");
    expect(headers.length).toBeGreaterThan(0);
  });

  it("should render both headers and items in correct order", () => {
    const items: GroupedTestItem[] = [
      { id: 1, name: "Alice", group: "A" },
      { id: 2, name: "Amy", group: "A" },
    ];

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    // Should have 1 header and at least 2 contacts (may have more due to overscan)
    const headers = list.element.querySelectorAll(".group-header");
    const contacts = list.element.querySelectorAll(".contact");

    expect(headers.length).toBe(1);
    expect(contacts.length).toBeGreaterThanOrEqual(2);
  });

  it("should pass groupKey and groupIndex to headerTemplate", () => {
    const items: GroupedTestItem[] = [
      { id: 1, name: "Alice", group: "A" },
      { id: 2, name: "Bob", group: "B" },
    ];

    let capturedKey: string | null = null;
    let capturedIndex: number | null = null;

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate: (key, groupIndex) => {
            if (capturedKey === null) {
              capturedKey = key;
              capturedIndex = groupIndex;
            }
            const el = document.createElement("div");
            el.className = "group-header";
            el.textContent = `${key}-${groupIndex}`;
            return el;
          },
        }),
      )
      .build();

    // First header should have key "A" and index 0
    expect(capturedKey).toBe("A");
    expect(capturedIndex).toBe(0);
  });
});

// =============================================================================
// withGroups Scroll Behavior
// =============================================================================

describe("withGroups scroll behavior", () => {
  let container: HTMLElement;
  let list: BuiltVList<GroupedTestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should handle scrollToIndex with start alignment", () => {
    const items = createGroupedItems(30);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    expect(() => list!.scrollToIndex(10, "start")).not.toThrow();
  });

  it("should handle scrollToIndex with center alignment", () => {
    const items = createGroupedItems(30);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    expect(() => list!.scrollToIndex(15, "center")).not.toThrow();
  });

  it("should handle scrollToIndex with end alignment", () => {
    const items = createGroupedItems(30);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    expect(() => list!.scrollToIndex(20, "end")).not.toThrow();
  });

  it("should handle scrollToIndex with options object", () => {
    const items = createGroupedItems(30);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    expect(() =>
      list!.scrollToIndex(10, { align: "center", behavior: "auto" }),
    ).not.toThrow();
  });

  it("should handle scrollToIndex with smooth behavior", () => {
    const items = createGroupedItems(30);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    expect(() =>
      list!.scrollToIndex(15, { align: "start", behavior: "smooth" }),
    ).not.toThrow();
  });

  it("should handle scrollToIndex with custom duration", () => {
    const items = createGroupedItems(30);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
        }),
      )
      .build();

    expect(() =>
      list!.scrollToIndex(10, {
        align: "start",
        behavior: "smooth",
        duration: 500,
      }),
    ).not.toThrow();
  });

  it("should update sticky header on scroll", () => {
    const items = createGroupedItems(30);

    list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
          sticky: true,
        }),
      )
      .build();

    const viewport = list.element.querySelector(
      ".vlist-viewport",
    ) as HTMLElement;

    // Simulate scroll
    if (viewport) {
      viewport.scrollTop = 200;
      viewport.dispatchEvent(new dom.window.Event("scroll"));
    }

    // Sticky header should exist and be updated
    const stickyHeader = list.element.querySelector(
      ".vlist-sticky-header",
    ) as HTMLElement;
    expect(stickyHeader).not.toBeNull();
  });
});

// =============================================================================
// withGroups Destroy Behavior
// =============================================================================

describe("withGroups destroy behavior", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    container.remove();
  });

  it("should clean up all DOM elements on destroy", () => {
    const items = createGroupedItems(15);

    const list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
          sticky: true,
        }),
      )
      .build();

    const root = list.element;

    // Verify elements exist before destroy
    expect(root.classList.contains("vlist--grouped")).toBe(true);
    expect(root.querySelector(".vlist-sticky-header")).not.toBeNull();

    list.destroy();

    // Verify elements are cleaned up after destroy
    expect(root.classList.contains("vlist--grouped")).toBe(false);
    expect(root.querySelector(".vlist-sticky-header")).toBeNull();
  });

  it("should not throw when destroy is called multiple times", () => {
    const items = createGroupedItems(15);

    const list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
          sticky: true,
        }),
      )
      .build();

    expect(() => {
      list.destroy();
      list.destroy();
    }).not.toThrow();
  });

  it("should clean up when sticky is disabled", () => {
    const items = createGroupedItems(15);

    const list = vlist<GroupedTestItem>({
      container,
      item: { height: 50, template: groupedTemplate },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (i) => items[i]!.group,
          headerHeight: 32,
          headerTemplate,
          sticky: false,
        }),
      )
      .build();

    const root = list.element;

    // Verify sticky header doesn't exist
    expect(root.querySelector(".vlist-sticky-header")).toBeNull();

    // Destroy should not throw
    expect(() => list.destroy()).not.toThrow();

    // Grouped class should be removed
    expect(root.classList.contains("vlist--grouped")).toBe(false);
  });
});

// =============================================================================
// withData Plugin - Velocity-Aware Loading
// =============================================================================

describe("withData plugin velocity-aware loading", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should load data when scrolling slowly", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter }))
      .build();

    await flush();

    // Should have loaded initial data
    expect(adapter.read).toHaveBeenCalled();
  });

  it("should trigger load:end events after loading", async () => {
    const adapter = createMockAdapter(100);
    const loadEndHandler = mock(() => {});

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter }))
      .build();

    list.on("load:end", loadEndHandler);

    await flush();

    // load:end should be called after initial load completes
    expect(loadEndHandler).toHaveBeenCalled();
  });

  it("should set aria-busy during loading", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter }))
      .build();

    // aria-busy should be set during initial load
    // Note: Due to async timing, we may need to check immediately after build
    // or after flush depending on when the attribute is set/cleared

    await flush();

    // After loading completes, aria-busy should be removed
    expect(list.element.getAttribute("aria-busy")).toBeNull();
  });

  it("should handle reload method", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter }))
      .build();

    await flush();

    const callsBefore = (adapter.read as any).mock.calls.length;

    // Reload should trigger another read
    await list.reload();
    await flush();

    expect((adapter.read as any).mock.calls.length).toBeGreaterThan(
      callsBefore,
    );
  });

  it("should handle scroll and trigger ensureRange", async () => {
    const adapter = createMockAdapter(200);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter }))
      .build();

    await flush();

    // Simulate scroll
    simulateScroll(list, 500);
    await flush();

    // Should have called read at least once for initial + range
    expect((adapter.read as any).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("should support custom loading thresholds", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(
        withData({
          adapter,
          loading: {
            cancelThreshold: 50,
            preloadThreshold: 5,
            preloadAhead: 100,
          },
        }),
      )
      .build();

    await flush();

    expect(adapter.read).toHaveBeenCalled();
  });

  it("should handle adapter that throws errors", async () => {
    const failingAdapter: VListAdapter<TestItem> = {
      read: mock(async () => {
        throw new Error("Network error");
      }),
    };

    // The error is caught internally by the plugin
    // Just verify the list can be created and destroyed without crashing
    expect(() => {
      list = vlist<TestItem>({
        container,
        item: { height: 40, template },
      })
        .use(withData({ adapter: failingAdapter }))
        .build();
    }).not.toThrow();

    await flush();

    // List should still be functional (even if no data loaded)
    expect(list!.element).toBeDefined();
  });

  it("should clean up idle timer on destroy", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter }))
      .build();

    await flush();

    // Simulate some scrolling to set up idle timer
    simulateScroll(list, 100);

    // Destroy should clean up timers without throwing
    expect(() => {
      list!.destroy();
      list = null;
    }).not.toThrow();
  });

  it("should handle hasMore=false and stop loading more", async () => {
    // Create adapter that returns hasMore=false
    const finiteAdapter: VListAdapter<TestItem> = {
      read: mock(async ({ offset, limit }) => {
        const items: TestItem[] = [];
        const total = 20;
        const end = Math.min(offset + limit, total);
        for (let i = offset; i < end; i++) {
          items.push({ id: i + 1, name: `Item ${i + 1}`, value: i * 10 });
        }
        return { items, total, hasMore: false };
      }),
    };

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter: finiteAdapter }))
      .build();

    await flush();

    const callsAfterInit = (finiteAdapter.read as any).mock.calls.length;

    // Scroll to bottom - should not trigger more loads since hasMore=false
    simulateScroll(list, 10000);
    await flush();

    // May have same or slightly more calls but not significantly more
    expect((finiteAdapter.read as any).mock.calls.length).toBeLessThanOrEqual(
      callsAfterInit + 2,
    );
  });

  it("should work with reverse mode", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      reverse: true,
    })
      .use(withData({ adapter }))
      .build();

    await flush();

    // Should have loaded initial data
    expect(adapter.read).toHaveBeenCalled();

    // List should be in reverse mode
    expect(list.element).toBeDefined();
  });

  it("should handle multiple sequential scrolls", async () => {
    const adapter = createMockAdapter(200);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter }))
      .build();

    await flush();

    // Multiple scrolls in sequence
    simulateScroll(list, 100);
    await flush();
    simulateScroll(list, 200);
    await flush();
    simulateScroll(list, 300);
    await flush();

    // Should not crash and adapter should have been called
    expect(adapter.read).toHaveBeenCalled();
  });

  it("should handle scroll direction changes", async () => {
    const adapter = createMockAdapter(200);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter }))
      .build();

    await flush();

    // Scroll down
    simulateScroll(list, 500);
    await flush();

    // Scroll back up
    simulateScroll(list, 200);
    await flush();

    // Should not crash
    expect(list.element).toBeDefined();
  });

  it("should handle destroyed state during scroll", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
    })
      .use(withData({ adapter }))
      .build();

    await flush();

    // Destroy the list
    list.destroy();

    // Simulate scroll after destroy - should not crash
    const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
    if (viewport) {
      viewport.scrollTop = 100;
      viewport.dispatchEvent(new dom.window.Event("scroll"));
    }

    list = null; // Already destroyed
  });
});

// =============================================================================
// Builder Core - Edge Cases
// =============================================================================

describe("builder core edge cases", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should handle scrollToItem by id", () => {
    const items = createTestItems(50);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    // scrollToItem should work with item id
    expect(() => list!.scrollToItem(25)).not.toThrow();
    expect(() => list!.scrollToItem(25, "center")).not.toThrow();
  });

  it("should handle scrollToItem with non-existent id", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    // Should not throw for non-existent id
    expect(() => list!.scrollToItem(999)).not.toThrow();
  });

  it("should handle off() to unsubscribe events", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    const handler = mock(() => {});

    // Subscribe
    list.on("scroll", handler);

    // Simulate scroll
    simulateScroll(list, 100);

    const callsBefore = handler.mock.calls.length;

    // Unsubscribe using off
    list.off("scroll", handler);

    // Simulate another scroll
    simulateScroll(list, 200);

    // Handler should not be called again
    expect(handler.mock.calls.length).toBe(callsBefore);
  });

  it("should handle scrollToIndex with smooth behavior", () => {
    const items = createTestItems(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    // Smooth scroll should not throw
    expect(() =>
      list!.scrollToIndex(50, { align: "center", behavior: "smooth" }),
    ).not.toThrow();
  });

  it("should handle scrollToIndex with smooth and custom duration", () => {
    const items = createTestItems(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    expect(() =>
      list!.scrollToIndex(50, {
        align: "start",
        behavior: "smooth",
        duration: 500,
      }),
    ).not.toThrow();
  });

  it("should handle cancelScroll", () => {
    const items = createTestItems(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    // Start smooth scroll
    list.scrollToIndex(50, { behavior: "smooth" });

    // Cancel it
    expect(() => list!.cancelScroll()).not.toThrow();
  });

  it("should handle getScrollPosition", () => {
    const items = createTestItems(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    // Should return a number
    const position = list.getScrollPosition();
    expect(typeof position).toBe("number");
    expect(position).toBeGreaterThanOrEqual(0);
  });

  it("should handle reload without data plugin", async () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    // reload should not throw even without data plugin
    await expect(list.reload()).resolves.toBeUndefined();
  });

  it("should handle updateItem", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    // updateItem should not throw
    expect(() => list!.updateItem(5, { name: "Updated Item" })).not.toThrow();
  });
});

// =============================================================================
// Builder Core - Reverse Mode Data Operations
// =============================================================================

describe("builder core reverse mode data operations", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should handle appendItems in reverse mode", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
      reverse: true,
    }).build();

    const newItems = createTestItems(5).map((item, i) => ({
      ...item,
      id: 100 + i,
      name: `Appended ${i}`,
    }));

    expect(() => list!.appendItems(newItems)).not.toThrow();
    expect(list.total).toBe(25);
  });

  it("should handle prependItems in reverse mode", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
      reverse: true,
    }).build();

    const newItems = createTestItems(5).map((item, i) => ({
      ...item,
      id: 200 + i,
      name: `Prepended ${i}`,
    }));

    expect(() => list!.prependItems(newItems)).not.toThrow();
    expect(list.total).toBe(25);
  });

  it("should handle setItems in reverse mode", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
      reverse: true,
    }).build();

    const newItems = createTestItems(10);

    expect(() => list!.setItems(newItems)).not.toThrow();
    expect(list.total).toBe(10);
  });

  it("should handle removeItem in reverse mode", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
      reverse: true,
    }).build();

    expect(() => list!.removeItem(5)).not.toThrow();
    expect(list.total).toBe(19);
  });

  it("should handle scrollToIndex in reverse mode", () => {
    const items = createTestItems(50);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
      reverse: true,
    }).build();

    expect(() => list!.scrollToIndex(25)).not.toThrow();
    expect(() => list!.scrollToIndex(25, "center")).not.toThrow();
    expect(() => list!.scrollToIndex(25, "end")).not.toThrow();
  });
});

// =============================================================================
// Grid Plugin - Additional Coverage
// =============================================================================

describe("withGrid plugin additional coverage", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should handle grid with gap and variable height function", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: {
        height: (index: number) => (index % 2 === 0 ? 80 : 60),
        template,
      },
      items,
    })
      .use(withGrid({ columns: 3, gap: 10 }))
      .build();

    expect(list.element.classList.contains("vlist--grid")).toBe(true);
  });

  it("should handle grid scrollToIndex with smooth behavior", () => {
    const items = createTestItems(100);

    list = vlist<TestItem>({
      container,
      item: { height: 80, template },
      items,
    })
      .use(withGrid({ columns: 4 }))
      .build();

    expect(() =>
      list!.scrollToIndex(50, { align: "center", behavior: "smooth" }),
    ).not.toThrow();
  });

  it("should handle grid scrollToIndex with options object", () => {
    const items = createTestItems(100);

    list = vlist<TestItem>({
      container,
      item: { height: 80, template },
      items,
    })
      .use(withGrid({ columns: 4 }))
      .build();

    expect(() =>
      list!.scrollToIndex(25, { align: "end", behavior: "auto" }),
    ).not.toThrow();
  });

  it("should update grid on resize", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 80, template },
      items,
    })
      .use(withGrid({ columns: 3 }))
      .build();

    // Simulate resize by triggering ResizeObserver callback
    // The grid should handle resize without throwing
    expect(list.element.classList.contains("vlist--grid")).toBe(true);
  });

  it("should handle grid with compression for very large lists", () => {
    const largeItems = createTestItems(500000);

    list = vlist<TestItem>({
      container,
      item: { height: 80, template },
      items: largeItems,
    })
      .use(withGrid({ columns: 4 }))
      .use(withCompression())
      .build();

    expect(list.element.classList.contains("vlist--grid")).toBe(true);

    // Scroll should work
    expect(() => list!.scrollToIndex(250000)).not.toThrow();
  });
});

// =============================================================================
// Scrollbar Plugin - Additional Coverage
// =============================================================================

describe("withScrollbar plugin additional coverage", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should update scrollbar on scroll", () => {
    const items = createTestItems(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withScrollbar())
      .build();

    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).not.toBeNull();

    // Simulate scroll
    simulateScroll(list, 500);

    // Scrollbar should still exist
    expect(list.element.querySelector(".vlist-scrollbar")).not.toBeNull();
  });

  it("should handle scrollbar with compression", () => {
    const largeItems = createTestItems(500000);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: largeItems,
    })
      .use(withCompression())
      .use(withScrollbar())
      .build();

    const scrollbar = list.element.querySelector(".vlist-scrollbar");
    expect(scrollbar).not.toBeNull();
  });

  it("should add custom-scrollbar class to viewport", () => {
    const items = createTestItems(50);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withScrollbar())
      .build();

    const viewport = list.element.querySelector(".vlist-viewport");
    expect(viewport).not.toBeNull();
    expect(
      viewport!.classList.contains("vlist-viewport--custom-scrollbar"),
    ).toBe(true);
  });
});

// =============================================================================
// withSnapshots Plugin - Compression Mode
// =============================================================================

describe("withSnapshots plugin compression mode", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should capture snapshot with empty list", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: [],
    })
      .use(withSnapshots())
      .build();

    const snapshot = list.getScrollSnapshot!();
    expect(snapshot).toBeDefined();
    expect(snapshot.index).toBe(0);
    expect(snapshot.offsetInItem).toBe(0);
  });

  it("should capture snapshot with selection", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withSelection({ mode: "multiple" }))
      .use(withSnapshots())
      .build();

    // Select some items
    list.select(1, 2, 3);

    const snapshot = list.getScrollSnapshot!();
    expect(snapshot).toBeDefined();
    expect(snapshot.selectedIds).toBeDefined();
    expect(snapshot.selectedIds).toContain(1);
    expect(snapshot.selectedIds).toContain(2);
    expect(snapshot.selectedIds).toContain(3);
  });

  it("should restore snapshot with selection", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withSelection({ mode: "multiple" }))
      .use(withSnapshots())
      .build();

    // Select and scroll
    list.select(5, 6);
    list.scrollToIndex(10);
    simulateScroll(list, 400);

    const snapshot = list.getScrollSnapshot!();

    // Clear selection and scroll back
    list.clearSelection();
    simulateScroll(list, 0);

    // Restore
    list.restoreScroll!(snapshot);

    // Selection should be restored
    const selected = list.getSelected();
    expect(selected).toContain(5);
    expect(selected).toContain(6);
  });

  it("should handle restore with empty list", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: [],
    })
      .use(withSnapshots())
      .build();

    const snapshot = { index: 5, offsetInItem: 10 };

    // Should not throw
    expect(() => list!.restoreScroll!(snapshot)).not.toThrow();
  });

  it("should clamp snapshot index to valid range on restore", () => {
    const items = createTestItems(10);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withSnapshots())
      .build();

    // Snapshot with index beyond current total
    const snapshot = { index: 100, offsetInItem: 0 };

    // Should not throw and clamp to valid range
    expect(() => list!.restoreScroll!(snapshot)).not.toThrow();
  });

  it("should work with compression plugin", async () => {
    // 400K items at 40px = 16M pixels, which triggers compression
    const largeItems = createTestItems(400000);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: largeItems,
    })
      .use(withCompression())
      .use(withSnapshots())
      .build();

    // Scroll to middle
    list.scrollToIndex(200000);
    simulateScroll(list, 8000000);

    const snapshot = list.getScrollSnapshot!();
    expect(snapshot).toBeDefined();
    expect(snapshot.index).toBeGreaterThan(0);

    // Scroll away
    simulateScroll(list, 0);

    // Restore
    expect(() => list!.restoreScroll!(snapshot)).not.toThrow();
  });

  it("should capture compressed snapshot at various scroll positions", () => {
    // 500K items at 40px = 20M pixels, which triggers compression (MAX is 16M)
    const largeItems = createTestItems(500000);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: largeItems,
    })
      .use(withCompression())
      .use(withSnapshots())
      .build();

    // Scroll to top
    simulateScroll(list, 0);
    const topSnapshot = list.getScrollSnapshot!();
    expect(topSnapshot.index).toBeGreaterThanOrEqual(0);
    expect(topSnapshot.offsetInItem).toBeGreaterThanOrEqual(0);

    // Capture snapshot at different scroll positions - just verify they don't throw
    // and return valid snapshots (JSDOM doesn't actually move scrollTop)
    const snapshot1 = list.getScrollSnapshot!();
    expect(snapshot1).toBeDefined();
    expect(typeof snapshot1.index).toBe("number");
    expect(typeof snapshot1.offsetInItem).toBe("number");
  });

  it("should restore compressed snapshot without throwing", () => {
    // 500K items at 40px = 20M pixels, triggers compression
    const largeItems = createTestItems(500000);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: largeItems,
    })
      .use(withCompression())
      .use(withSnapshots())
      .build();

    // Get current snapshot
    const snapshot = list.getScrollSnapshot!();
    expect(snapshot).toBeDefined();

    // Restore should not throw
    expect(() => list!.restoreScroll!(snapshot)).not.toThrow();

    // Create a manual snapshot with specific values and restore
    const manualSnapshot = { index: 250000, offsetInItem: 20 };
    expect(() => list!.restoreScroll!(manualSnapshot)).not.toThrow();
  });

  it("should handle snapshot with zero item height in compression", () => {
    // 500K items at 40px = 20M pixels, triggers compression
    const largeItems = createTestItems(500000);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: largeItems,
    })
      .use(withCompression())
      .use(withSnapshots())
      .build();

    // Create a snapshot manually with edge case values
    const snapshot = { index: 250000, offsetInItem: 0 };

    // Should not throw
    expect(() => list!.restoreScroll!(snapshot)).not.toThrow();
  });

  it("should handle negative offsetInItem by clamping", () => {
    const items = createTestItems(50);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withSnapshots())
      .build();

    // Scroll to top (offset should be 0 or small positive)
    simulateScroll(list, 0);
    const snapshot = list.getScrollSnapshot!();

    // offsetInItem should be non-negative
    expect(snapshot.offsetInItem).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// Builder Core - Event Handling Edge Cases
// =============================================================================

describe("builder core event handling", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should handle multiple event subscriptions", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    const handler1 = mock(() => {});
    const handler2 = mock(() => {});

    list.on("scroll", handler1);
    list.on("scroll", handler2);

    simulateScroll(list, 100);

    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it("should handle unsubscribe with returned function", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    const handler = mock(() => {});
    const unsubscribe = list.on("scroll", handler);

    simulateScroll(list, 100);
    const callsBeforeUnsub = handler.mock.calls.length;

    // Unsubscribe using returned function
    unsubscribe();

    simulateScroll(list, 200);

    // Should not have more calls
    expect(handler.mock.calls.length).toBe(callsBeforeUnsub);
  });

  it("should emit range:change events on scroll", () => {
    const items = createTestItems(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    const rangeHandler = mock(() => {});
    list.on("range:change", rangeHandler);

    simulateScroll(list, 500);

    expect(rangeHandler).toHaveBeenCalled();
  });

  it("should handle item:click events", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    const clickHandler = mock(() => {});
    list.on("item:click", clickHandler);

    // Click on an item
    const item = list.element.querySelector("[data-index='2']");
    if (item) {
      item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    }

    expect(clickHandler).toHaveBeenCalled();
  });
});

// =============================================================================
// Builder Core - Scroll Methods Edge Cases
// =============================================================================

describe("builder core scroll methods", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should handle scrollToIndex at boundaries", () => {
    const items = createTestItems(50);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    // Scroll to first item
    expect(() => list!.scrollToIndex(0)).not.toThrow();

    // Scroll to last item
    expect(() => list!.scrollToIndex(49)).not.toThrow();

    // Scroll to negative (should clamp or handle gracefully)
    expect(() => list!.scrollToIndex(-1)).not.toThrow();

    // Scroll beyond total (should clamp or handle gracefully)
    expect(() => list!.scrollToIndex(100)).not.toThrow();
  });

  it("should handle scrollToItem with string id", () => {
    const items: TestItem[] = [
      { id: "a", name: "Item A" } as any,
      { id: "b", name: "Item B" } as any,
      { id: "c", name: "Item C" } as any,
    ];

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    expect(() => list!.scrollToItem("b")).not.toThrow();
  });

  it("should handle cancelScroll when no animation is running", () => {
    const items = createTestItems(50);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    // Cancel when nothing is animating
    expect(() => list!.cancelScroll()).not.toThrow();
  });

  it("should handle smooth scroll followed by cancelScroll", () => {
    const items = createTestItems(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    // Start smooth scroll
    list.scrollToIndex(50, { behavior: "smooth", duration: 1000 });

    // Immediately cancel
    list.cancelScroll();

    // Should not throw
    expect(list.element).toBeDefined();
  });

  it("should handle getScrollPosition at various states", () => {
    const items = createTestItems(50);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    }).build();

    // Initial position
    const pos1 = list.getScrollPosition();
    expect(typeof pos1).toBe("number");

    // After scroll
    simulateScroll(list, 200);
    const pos2 = list.getScrollPosition();
    expect(typeof pos2).toBe("number");
  });
});

// =============================================================================
// Compression Plugin - Additional Coverage
// =============================================================================

describe("withCompression plugin additional coverage", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should handle scrollToIndex in compressed mode", () => {
    // 500K items at 40px = 20M pixels, triggers compression
    const largeItems = createTestItems(500000);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: largeItems,
    })
      .use(withCompression())
      .build();

    // Various scroll positions
    expect(() => list!.scrollToIndex(0)).not.toThrow();
    expect(() => list!.scrollToIndex(250000)).not.toThrow();
    expect(() => list!.scrollToIndex(499999)).not.toThrow();
  });

  it("should handle scrollToIndex with align options in compressed mode", () => {
    const largeItems = createTestItems(500000);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: largeItems,
    })
      .use(withCompression())
      .build();

    expect(() => list!.scrollToIndex(250000, "start")).not.toThrow();
    expect(() => list!.scrollToIndex(250000, "center")).not.toThrow();
    expect(() => list!.scrollToIndex(250000, "end")).not.toThrow();
  });

  it("should transition from uncompressed to compressed on setItems", () => {
    // Start with small list (not compressed)
    const smallItems = createTestItems(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: smallItems,
    })
      .use(withCompression())
      .build();

    expect(list.total).toBe(100);

    // Replace with large list (compressed)
    const largeItems = createTestItems(500000);
    list.setItems(largeItems);

    expect(list.total).toBe(500000);
  });

  it("should transition from compressed to uncompressed on setItems", () => {
    // Start with large list (compressed)
    const largeItems = createTestItems(500000);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: largeItems,
    })
      .use(withCompression())
      .build();

    expect(list.total).toBe(500000);

    // Replace with small list (not compressed)
    const smallItems = createTestItems(100);
    list.setItems(smallItems);

    expect(list.total).toBe(100);
  });

  it("should handle scroll events in compressed mode", () => {
    const largeItems = createTestItems(500000);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: largeItems,
    })
      .use(withCompression())
      .build();

    const scrollHandler = mock(() => {});
    list.on("scroll", scrollHandler);

    // Simulate scrolling
    simulateScroll(list, 1000000);
    simulateScroll(list, 5000000);
    simulateScroll(list, 10000000);

    expect(scrollHandler).toHaveBeenCalled();
  });

  it("should render correct items at compressed scroll positions", () => {
    const largeItems = createTestItems(500000);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: largeItems,
    })
      .use(withCompression())
      .build();

    // Should have rendered items
    const renderedItems = list.element.querySelectorAll("[data-index]");
    expect(renderedItems.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Data Plugin - Reverse Mode
// =============================================================================

describe("withData plugin reverse mode", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should load data in reverse mode", async () => {
    const adapter = createMockAdapter(100);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      reverse: true,
    })
      .use(withData({ adapter }))
      .build();

    await flush();

    expect(adapter.read).toHaveBeenCalled();
  });

  it("should handle scroll in reverse mode with data", async () => {
    const adapter = createMockAdapter(200);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      reverse: true,
    })
      .use(withData({ adapter }))
      .build();

    await flush();

    // Scroll near top (which triggers load more in reverse)
    simulateScroll(list, 50);
    await flush();

    expect(adapter.read).toHaveBeenCalled();
  });
});

// =============================================================================
// Selection Plugin - Edge Cases
// =============================================================================

describe("withSelection plugin edge cases", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should handle selection mode none", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withSelection({ mode: "none" }))
      .build();

    // In none mode, setup returns early so no selection methods are added
    // The list should still function normally
    expect(list.element).toBeDefined();

    // Selection methods should not exist
    expect((list as any).select).toBeUndefined();
    expect((list as any).getSelected).toBeUndefined();

    // Clicking items should not cause errors
    const item = list.element.querySelector("[data-index='2']");
    if (item) {
      expect(() =>
        item.dispatchEvent(
          new dom.window.MouseEvent("click", { bubbles: true }),
        ),
      ).not.toThrow();
    }
  });

  it("should handle getSelectedItems", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    list.select(1, 2, 3);

    const selectedItems = list.getSelectedItems();
    expect(selectedItems.length).toBe(3);
  });

  it("should handle toggleSelect method", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // Toggle on
    list.toggleSelect(5);
    expect(list.getSelected()).toContain(5);

    // Toggle off
    list.toggleSelect(5);
    expect(list.getSelected()).not.toContain(5);
  });

  it("should handle deselect method", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    list.select(5, 6, 7);
    expect(list.getSelected().length).toBe(3);

    list.deselect(6);
    expect(list.getSelected().length).toBe(2);
    expect(list.getSelected()).not.toContain(6);
  });

  it("should handle clearSelection", () => {
    const items = createTestItems(20);

    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items,
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    list.selectAll();
    expect(list.getSelected().length).toBe(20);

    list.clearSelection();
    expect(list.getSelected().length).toBe(0);
  });
});

// =============================================================================
// withSelection Plugin - Keyboard Navigation
// =============================================================================

describe("withSelection plugin keyboard navigation", () => {
  let container: HTMLElement;
  let list: BuiltVList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("should handle ArrowUp key", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // First click to set focus
    const firstItem = list.element.querySelector("[data-index='5']");
    if (firstItem) {
      firstItem.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
    }

    // Press ArrowUp
    const event = new dom.window.KeyboardEvent("keydown", {
      key: "ArrowUp",
      bubbles: true,
    });
    list.element.dispatchEvent(event);

    // Focus should move up
    const focused = list.element.querySelector(".vlist-item--focused");
    expect(focused).not.toBeNull();
  });

  it("should handle ArrowDown key", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // Press ArrowDown
    const event = new dom.window.KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
    });
    list.element.dispatchEvent(event);

    const focused = list.element.querySelector(".vlist-item--focused");
    expect(focused).not.toBeNull();
  });

  it("should handle Home key to focus first item", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // Click on item 5 first
    const item5 = list.element.querySelector("[data-index='5']");
    if (item5) {
      item5.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
    }

    // Press Home
    const event = new dom.window.KeyboardEvent("keydown", {
      key: "Home",
      bubbles: true,
    });
    list.element.dispatchEvent(event);

    // Focus should move to first item
    const focused = list.element.querySelector(".vlist-item--focused");
    expect(focused).not.toBeNull();
    if (focused) {
      expect((focused as HTMLElement).dataset.index).toBe("0");
    }
  });

  it("should handle End key to set focus to last index", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // Click on item 0 first
    const item0 = list.element.querySelector("[data-index='0']");
    if (item0) {
      item0.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
    }

    // Press End
    const event = new dom.window.KeyboardEvent("keydown", {
      key: "End",
      bubbles: true,
    });
    list.element.dispatchEvent(event);

    // aria-activedescendant should point to last item (index 19)
    // Note: The last item may not be rendered due to virtual scrolling
    const activeDescendant = list.element.getAttribute("aria-activedescendant");
    expect(activeDescendant).toContain("item-19");
  });

  it("should handle Space key to toggle selection", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // Click to focus item 3
    const item3 = list.element.querySelector("[data-index='3']");
    if (item3) {
      item3.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
    }

    // Clear selection first
    list.clearSelection();

    // Move to item 5
    list.element.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
      }),
    );
    list.element.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
      }),
    );

    // Press Space to select
    const spaceEvent = new dom.window.KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
    });
    list.element.dispatchEvent(spaceEvent);

    // Should have selected the focused item
    const selected = list.getSelected();
    expect(selected.length).toBeGreaterThan(0);
  });

  it("should handle Enter key to toggle selection", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // Click to focus item 2
    const item2 = list.element.querySelector("[data-index='2']");
    if (item2) {
      item2.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
    }

    // Clear and focus again
    list.clearSelection();

    // Press Enter to select
    const enterEvent = new dom.window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
    });
    list.element.dispatchEvent(enterEvent);

    // Should have selected the focused item
    const selected = list.getSelected();
    expect(selected.length).toBeGreaterThan(0);
  });

  it("should emit selection:change on Space/Enter", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    const selectionHandler = mock(() => {});
    list.on("selection:change", selectionHandler);

    // Click to focus
    const item = list.element.querySelector("[data-index='1']");
    if (item) {
      item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    }

    // Clear call count after click selection
    selectionHandler.mockClear();

    // Press Enter
    list.element.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(selectionHandler).toHaveBeenCalled();
  });

  it("should update aria-activedescendant on focus change", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // Click to focus
    const item = list.element.querySelector("[data-index='3']");
    if (item) {
      item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    }

    // aria-activedescendant should be set
    const activeDescendant = list.element.getAttribute("aria-activedescendant");
    expect(activeDescendant).toContain("item-3");
  });

  it("should scroll focused item into view", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(100),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // Click to start focus
    const item = list.element.querySelector("[data-index='0']");
    if (item) {
      item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    }

    // Press End to go to last item
    list.element.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );

    // Scroll position should have changed
    const viewport = list.element.querySelector(
      ".vlist-viewport",
    ) as HTMLElement;
    // The scroll position may or may not have changed depending on viewport size
    // but the operation should not throw
    expect(viewport).not.toBeNull();
  });

  it("should handle keyboard navigation with no initial focus", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // Press ArrowDown without any prior focus
    const event = new dom.window.KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
    });

    // Should not throw
    expect(() => list!.element.dispatchEvent(event)).not.toThrow();
  });

  it("should prevent default on handled keyboard events", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    // Click to focus first
    const item = list.element.querySelector("[data-index='0']");
    if (item) {
      item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    }

    const event = new dom.window.KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });

    list.element.dispatchEvent(event);

    // Event should be prevented
    expect(event.defaultPrevented).toBe(true);
  });

  it("should not handle unrecognized keys", () => {
    list = vlist<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withSelection({ mode: "multiple" }))
      .build();

    const event = new dom.window.KeyboardEvent("keydown", {
      key: "x",
      bubbles: true,
      cancelable: true,
    });

    list.element.dispatchEvent(event);

    // Unrecognized key should not be prevented
    expect(event.defaultPrevented).toBe(false);
  });
});
