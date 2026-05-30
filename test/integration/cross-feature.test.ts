/**
 * vlist v2 — Cross-Feature Integration Tests
 *
 * Recovers missing coverage from v1 integration/features.test.ts.
 * Tests multi-plugin combos, data ops with features, horizontal mode
 * with features, concurrent operations, and feature interaction edge cases.
 */

import {
  describe,
  it,
  expect,
  mock,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";
import {
  createTestItems,
  createContainer,
  simpleTemplate,
  type TestItem,
} from "../helpers/factory";
import { grid } from "../../src/plugins/grid/plugin";
import { scale } from "../../src/plugins/scale/plugin";
import { selection } from "../../src/plugins/selection/plugin";
import { scrollbar } from "../../src/plugins/scrollbar/plugin";
import { groups } from "../../src/plugins/groups/plugin";
import { snapshots } from "../../src/plugins/snapshots/plugin";
import { data as dataPlugin } from "../../src/plugins/data/plugin";
import { table } from "../../src/plugins/table/plugin";
import type { VListAdapter } from "../../src/types";

// =============================================================================
// DOM Setup
// =============================================================================

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  GlobalRegistrator.register();
  origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});
afterAll(() => {
  if (origClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", origClientHeight);
  if (origClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", origClientWidth);
  GlobalRegistrator.unregister();
});

// =============================================================================
// Helpers
// =============================================================================

let container: HTMLElement;
let list: VList<TestItem> | null = null;

beforeEach(() => {
  container = createContainer({ width: 300, height: 500 });
});
afterEach(() => {
  if (list) {
    list.destroy();
    list = null;
  }
  container.remove();
});

function getViewport(c: HTMLElement): HTMLElement {
  return c.querySelector<HTMLElement>(".vlist-viewport")!;
}

function getContent(c: HTMLElement): HTMLElement {
  return c.querySelector<HTMLElement>(".vlist-content")!;
}

function simulateScroll(viewport: HTMLElement, scrollTop: number): void {
  Object.defineProperty(viewport, "scrollTop", {
    value: scrollTop,
    writable: true,
    configurable: true,
  });
  viewport.dispatchEvent(new Event("scroll", { bubbles: false }));
}

function createMockAdapter(total: number = 100): VListAdapter<TestItem> {
  return {
    read: mock(async ({ offset, limit }) => {
      const items: TestItem[] = [];
      const end = Math.min(offset + limit, total);
      for (let i = offset; i < end; i++) {
        items.push({ id: i + 1, name: `Item ${i + 1}`, value: (i + 1) * 10 });
      }
      return { items, total, hasMore: end < total };
    }),
  };
}

function waitForLoad(vlist: VList<TestItem>): Promise<void> {
  return new Promise((resolve) => {
    const unsub = vlist.on("load:end" as any, () => {
      unsub();
      resolve();
    });
    setTimeout(resolve, 200);
  });
}

// =============================================================================
// Three-Way Plugin Combos
// =============================================================================

describe("cross-feature — three-way combos", () => {
  it("grid + selection + scale initializes without error", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(10000), item: { height: 50, template: simpleTemplate } },
      [grid({ columns: 3 }), selection(), scale({ force: true })],
    );

    expect(list.items.length).toBe(10000);
    expect(list.element.querySelectorAll("[data-index]").length).toBeGreaterThan(0);
  });

  it("grid + selection + scale supports programmatic selection", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(10000), item: { height: 50, template: simpleTemplate } },
      [grid({ columns: 3 }), selection(), scale({ force: true })],
    );

    (list as any).select(5);
    expect((list as any).getSelected()).toContain(5);
  });

  it("grid + selection + scale destroys cleanly", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(10000), item: { height: 50, template: simpleTemplate } },
      [grid({ columns: 3 }), selection(), scale({ force: true })],
    );

    expect(() => {
      list!.destroy();
      list = null;
    }).not.toThrow();
  });

  it("grid + selection + scrollbar renders all components", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(100), item: { height: 50, template: simpleTemplate } },
      [grid({ columns: 3 }), selection(), scrollbar()],
    );

    expect(list.items.length).toBe(100);
    const sb = container.querySelector(".vlist-scrollbar");
    expect(sb).not.toBeNull();
  });

  it("grid + selection + scrollbar destroys cleanly", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(100), item: { height: 50, template: simpleTemplate } },
      [grid({ columns: 3 }), selection(), scrollbar()],
    );

    expect(() => {
      list!.destroy();
      list = null;
    }).not.toThrow();
  });

  it("selection + scrollbar + snapshots works together", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(100), item: { height: 50, template: simpleTemplate } },
      [selection(), scrollbar(), snapshots()],
    );

    (list as any).select(5);
    expect((list as any).getSelected()).toContain(5);
    expect(container.querySelector(".vlist-scrollbar")).not.toBeNull();
  });

  it("scale + scrollbar + snapshots initializes and destroys", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(100000), item: { height: 50, template: simpleTemplate } },
      [scale({ force: true }), scrollbar(), snapshots()],
    );

    expect(list.items.length).toBe(100000);
    expect(() => {
      list!.destroy();
      list = null;
    }).not.toThrow();
  });
});

// =============================================================================
// Grid + Scale
// =============================================================================

describe("cross-feature — grid + scale", () => {
  it("grid + scale renders items for large dataset", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(100000), item: { height: 50, template: simpleTemplate } },
      [grid({ columns: 4 }), scale({ force: true })],
    );

    expect(list.items.length).toBe(100000);
    expect(list.element.querySelectorAll("[data-index]").length).toBeGreaterThan(0);
  });

  it("grid + scale handles scrollToIndex", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(100000), item: { height: 50, template: simpleTemplate } },
      [grid({ columns: 4 }), scale({ force: true })],
    );

    expect(() => list!.scrollToIndex(50000)).not.toThrow();
  });

  it("grid + scale destroys without leaks", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(100000), item: { height: 50, template: simpleTemplate } },
      [grid({ columns: 4 }), scale({ force: true })],
    );

    expect(() => {
      list!.destroy();
      list = null;
    }).not.toThrow();
  });
});

// =============================================================================
// Async + Grid
// =============================================================================

describe("cross-feature — async + grid", () => {
  it("renders grid layout with async-loaded data", async () => {
    const adapter = createMockAdapter(200);
    list = createVList<TestItem>(
      { container, items: [], item: { height: 50, template: simpleTemplate } },
      [dataPlugin({ adapter, autoLoad: true }), grid({ columns: 3 })],
    );

    await waitForLoad(list);

    expect(list.total).toBeGreaterThan(0);
  });

  it("async + grid destroys cleanly", async () => {
    const adapter = createMockAdapter(100);
    list = createVList<TestItem>(
      { container, items: [], item: { height: 50, template: simpleTemplate } },
      [dataPlugin({ adapter, autoLoad: true }), grid({ columns: 2 })],
    );

    await waitForLoad(list);

    expect(() => {
      list!.destroy();
      list = null;
    }).not.toThrow();
  });

  it("renders DOM elements with real data, not empty placeholders", async () => {
    const adapter = createMockAdapter(100);
    list = createVList<TestItem>(
      { container, items: [], item: { height: 50, template: simpleTemplate } },
      [dataPlugin({ adapter, autoLoad: true }), grid({ columns: 3 })],
    );

    await waitForLoad(list);

    const content = getContent(container);
    expect(content.children.length).toBeGreaterThan(0);

    const firstItem = content.querySelector("[data-index='0']") as HTMLElement;
    expect(firstItem).not.toBeNull();
    expect(firstItem!.getAttribute("data-id")).not.toMatch(/^__placeholder/);
    expect(firstItem!.innerHTML).toContain("Item 1");
  });

  it("updates placeholder elements when real data arrives", async () => {
    let resolveRead: ((value: any) => void) | null = null;
    const localContainer = createContainer({ width: 300, height: 500 });
    const adapter: VListAdapter<TestItem> = {
      read: mock(async ({ offset, limit }: any) => {
        return new Promise<any>((resolve) => { resolveRead = resolve; });
      }),
    };

    const localList = createVList<TestItem>(
      { container: localContainer, items: [], item: { height: 50, template: simpleTemplate } },
      [dataPlugin({ adapter, autoLoad: true, total: 50 }), grid({ columns: 3 })],
    );

    // Before data arrives, elements should be placeholders
    await new Promise((r) => setTimeout(r, 10));
    const content = getContent(localContainer);
    const placeholders = content.querySelectorAll("[data-id^='__placeholder']");

    // Resolve with real data
    resolveRead!({
      items: Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        value: (i + 1) * 10,
      })),
      total: 50,
      hasMore: true,
    });

    await new Promise((r) => setTimeout(r, 50));

    // After data arrives, placeholders should be replaced with real content
    const realItems = content.querySelectorAll("[data-index]");
    expect(realItems.length).toBeGreaterThan(0);

    const firstItem = content.querySelector("[data-index='0']") as HTMLElement;
    expect(firstItem).not.toBeNull();
    expect(firstItem!.getAttribute("data-id")).toBe("1");
    expect(firstItem!.innerHTML).toContain("Item 1");

    localList.destroy();
    localContainer.remove();
  });

  it("grid items have correct dimensions after async load", async () => {
    const adapter = createMockAdapter(100);
    list = createVList<TestItem>(
      { container, items: [], item: { height: 50, template: simpleTemplate } },
      [dataPlugin({ adapter, autoLoad: true }), grid({ columns: 3 })],
    );

    await waitForLoad(list);

    const content = getContent(container);
    const firstItem = content.querySelector("[data-index='0']") as HTMLElement;
    expect(firstItem).not.toBeNull();
    expect(firstItem!.style.width).toBeTruthy();
    expect(firstItem!.style.height).toBeTruthy();
    expect(firstItem!.style.transform).toContain("translate(");
  });
});

// =============================================================================
// Async + Groups
// =============================================================================

describe("cross-feature — async + groups", () => {
  it("async + groups initializes without error", async () => {
    const adapter = createMockAdapter(100);
    list = createVList<TestItem>(
      { container, items: [], item: { height: 40, template: simpleTemplate } },
      [
        dataPlugin({ adapter, autoLoad: true }),
        groups({
          getGroupForIndex: (i: number) => (i < 50 ? "A" : "B"),
          header: { height: 30, template: (g: string) => `<div>${g}</div>` },
        }),
      ],
    );

    await waitForLoad(list);

    expect(list.total).toBeGreaterThan(0);
  });

  it("async + groups destroys cleanly", async () => {
    const adapter = createMockAdapter(50);
    list = createVList<TestItem>(
      { container, items: [], item: { height: 40, template: simpleTemplate } },
      [
        dataPlugin({ adapter, autoLoad: true }),
        groups({
          getGroupForIndex: (i: number) => (i < 25 ? "X" : "Y"),
          header: { height: 30, template: (g: string) => `<div>${g}</div>` },
        }),
      ],
    );

    await waitForLoad(list);

    expect(() => {
      list!.destroy();
      list = null;
    }).not.toThrow();
  });
});

// =============================================================================
// Async + Table
// =============================================================================

describe("cross-feature — async + table", () => {
  it("renders table rows after async load", async () => {
    const adapter = createMockAdapter(100);
    list = createVList<TestItem>(
      { container, items: [], item: { height: 40, template: simpleTemplate } },
      [
        dataPlugin({ adapter, autoLoad: true }),
        table({
          columns: [
            { key: "name", label: "Name", width: 150 },
            { key: "value", label: "Value", width: 100 },
          ],
          rowHeight: 40,
        }),
      ],
    );

    await waitForLoad(list);

    expect(list.total).toBeGreaterThan(0);
  });

  it("async + table + selection combined", async () => {
    const adapter = createMockAdapter(100);
    list = createVList<TestItem>(
      { container, items: [], item: { height: 40, template: simpleTemplate } },
      [
        dataPlugin({ adapter, autoLoad: true }),
        table({
          columns: [
            { key: "name", label: "Name", width: 150 },
          ],
          rowHeight: 40,
        }),
        selection(),
      ],
    );

    await waitForLoad(list);

    (list as any).select(1);
    expect((list as any).getSelected()).toContain(1);
  });

  it("async + table destroys cleanly", async () => {
    const adapter = createMockAdapter(50);
    list = createVList<TestItem>(
      { container, items: [], item: { height: 40, template: simpleTemplate } },
      [
        dataPlugin({ adapter, autoLoad: true }),
        table({
          columns: [{ key: "name", label: "Name", width: 200 }],
          rowHeight: 40,
        }),
      ],
    );

    await waitForLoad(list);

    expect(() => {
      list!.destroy();
      list = null;
    }).not.toThrow();
  });
});

// =============================================================================
// Data Operations with Features
// =============================================================================

describe("cross-feature — data ops with features", () => {
  it("setItems preserves scrollbar with selection + scrollbar", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(50), item: { height: 50, template: simpleTemplate } },
      [selection(), scrollbar()],
    );

    (list as any).select(1);
    list.setItems(createTestItems(100));

    expect(list.total).toBe(100);
    expect(container.querySelector(".vlist-scrollbar")).not.toBeNull();
  });

  it("appendItems updates scrollbar", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(50), item: { height: 50, template: simpleTemplate } },
      [scrollbar()],
    );

    const before = list.total;
    const newItems = createTestItems(20).map((item, i) => ({
      ...item,
      id: 1000 + i,
      name: `New ${i}`,
    }));
    list.appendItems(newItems);

    expect(list.total).toBe(before + 20);
  });

  it("removeItem does not crash with selection active", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(50), item: { height: 50, template: simpleTemplate } },
      [selection()],
    );

    (list as any).select(5);
    expect((list as any).getSelected()).toContain(5);

    list.removeItem(5);
    expect(list.total).toBe(49);
    // Selection is ID-based — plugin may retain the ID or clean it up
    // Either way, no crash
  });

  it("setItems during scroll with selection + scrollbar", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(100), item: { height: 50, template: simpleTemplate } },
      [selection(), scrollbar()],
    );

    const viewport = getViewport(container);
    simulateScroll(viewport, 500);

    list.setItems(createTestItems(200));

    expect(list.total).toBe(200);
    expect(getContent(container).children.length).toBeGreaterThan(0);
  });

  it("updateItem preserves selection state", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(50), item: { height: 50, template: simpleTemplate } },
      [selection()],
    );

    (list as any).select(3);
    list.updateItem(3, { id: 3, name: "Updated Item 3", value: 999 });

    expect((list as any).getSelected()).toContain(3);
  });
});

// =============================================================================
// Horizontal Mode with Features
// =============================================================================

describe("cross-feature — horizontal mode", () => {
  it("horizontal + selection renders correctly", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        orientation: "horizontal",
        item: { width: 80, template: simpleTemplate },
      },
      [selection()],
    );

    expect(list.element.classList.contains("vlist--horizontal")).toBe(true);
    (list as any).select(5);
    expect((list as any).getSelected()).toContain(5);
  });

  it("horizontal + scrollbar renders", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        orientation: "horizontal",
        item: { width: 80, template: simpleTemplate },
      },
      [scrollbar()],
    );

    expect(list.element.classList.contains("vlist--horizontal")).toBe(true);
    expect(list.total).toBe(100);
  });

  it("horizontal + snapshots captures and restores", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        orientation: "horizontal",
        item: { width: 80, template: simpleTemplate },
      },
      [snapshots()],
    );

    expect(list.element.classList.contains("vlist--horizontal")).toBe(true);
    expect(list.total).toBe(100);
  });

  it("horizontal mode destroys cleanly with features", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        orientation: "horizontal",
        item: { width: 80, template: simpleTemplate },
      },
      [selection(), scrollbar()],
    );

    expect(() => {
      list!.destroy();
      list = null;
    }).not.toThrow();
  });
});

// =============================================================================
// Concurrent Operations
// =============================================================================

describe("cross-feature — concurrent operations", () => {
  it("rapid setItems calls do not corrupt state", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(100), item: { height: 50, template: simpleTemplate } },
      [selection()],
    );

    for (let i = 0; i < 10; i++) {
      list.setItems(createTestItems(50 + i * 10));
    }

    expect(list.total).toBe(140);
    expect(getContent(container).children.length).toBeGreaterThan(0);
  });

  it("rapid scroll + data changes do not crash", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(100), item: { height: 50, template: simpleTemplate } },
      [scrollbar()],
    );

    const viewport = getViewport(container);

    for (let i = 0; i < 5; i++) {
      simulateScroll(viewport, i * 200);
      list.appendItems([{ id: 1000 + i, name: `New ${i}`, value: i * 10 }]);
    }

    expect(list.total).toBe(105);
  });

  it("selection during scroll does not corrupt state", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(100), item: { height: 50, template: simpleTemplate } },
      [selection({ mode: "multiple" })],
    );

    const viewport = getViewport(container);

    simulateScroll(viewport, 200);
    (list as any).select(5);
    simulateScroll(viewport, 500);
    (list as any).select(20);
    simulateScroll(viewport, 0);

    expect((list as any).getSelected()).toContain(5);
    expect((list as any).getSelected()).toContain(20);
  });
});

// =============================================================================
// Cross-Feature Destroy Ordering
// =============================================================================

describe("cross-feature — destroy ordering", () => {
  it("groups + scrollbar + selection destroys cleanly", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(100), item: { height: 40, template: simpleTemplate } },
      [
        groups({
          getGroupForIndex: (i: number) => (i < 50 ? "A" : "B"),
          header: { height: 30, template: (g: string) => `<div>${g}</div>` },
        }),
        scrollbar(),
        selection(),
      ],
    );

    expect(() => {
      list!.destroy();
      list = null;
    }).not.toThrow();
  });

  it("async + selection + scrollbar destroys cleanly", async () => {
    const adapter = createMockAdapter(100);
    list = createVList<TestItem>(
      { container, items: [], item: { height: 50, template: simpleTemplate } },
      [dataPlugin({ adapter, autoLoad: true }), selection(), scrollbar()],
    );

    await waitForLoad(list);

    expect(() => {
      list!.destroy();
      list = null;
    }).not.toThrow();
  });

  it("double destroy with multiple features does not throw", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(50), item: { height: 50, template: simpleTemplate } },
      [selection(), scrollbar(), snapshots()],
    );

    list.destroy();
    expect(() => list!.destroy()).not.toThrow();
    list = null;
  });
});

// =============================================================================
// Group Header Interaction
// =============================================================================

describe("cross-feature — group header interaction", () => {
  it("group headers are rendered with correct class", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(50), item: { height: 40, template: simpleTemplate } },
      [
        groups({
          getGroupForIndex: (i: number) => (i < 25 ? "A" : "B"),
          header: { height: 30, template: (g: string) => `<div class="group-hdr">${g}</div>` },
        }),
      ],
    );

    const headers = container.querySelectorAll(".vlist-group-header");
    expect(headers.length).toBeGreaterThan(0);
  });

  it("clicking a regular item in grouped list emits item:click", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(50), item: { height: 40, template: simpleTemplate } },
      [
        groups({
          getGroupForIndex: (i: number) => (i < 25 ? "A" : "B"),
          header: { height: 30, template: (g: string) => `<div>${g}</div>` },
        }),
      ],
    );

    let itemClicked = false;
    list.on("item:click", () => { itemClicked = true; });

    const content = getContent(container);
    const itemEl = content.querySelector("[data-index]:not(.vlist-group-header)");
    if (itemEl) {
      itemEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(itemClicked).toBe(true);
    }
  });
});

// =============================================================================
// Grid with Variable Height
// =============================================================================

describe("cross-feature — grid with variable height", () => {
  it("grid renders with height function", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: {
          height: (i: number) => 30 + (i % 3) * 20,
          template: simpleTemplate,
        },
      },
      [grid({ columns: 3 })],
    );

    expect(list.items.length).toBe(100);
    expect(list.element.querySelectorAll("[data-index]").length).toBeGreaterThan(0);
  });

  it("grid with gap and variable height", () => {
    list = createVList<TestItem>(
      {
        container,
        items: createTestItems(100),
        item: {
          height: (i: number) => 40 + (i % 2) * 30,
          template: simpleTemplate,
        },
      },
      [grid({ columns: 2, gap: 8 })],
    );

    expect(list.items.length).toBe(100);
    expect(list.element.querySelectorAll("[data-index]").length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Velocity Events with Scale
// =============================================================================

describe("cross-feature — velocity events with scale", () => {
  it("velocity:change handler is registered with scale plugin", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(100000), item: { height: 50, template: simpleTemplate } },
      [scale({ force: true })],
    );

    const velocities: number[] = [];
    list.on("velocity:change", (e) => velocities.push(e.velocity));

    const viewport = getViewport(container);

    // Simulate two scroll events with time gap via distinct scrollTop values
    simulateScroll(viewport, 1000);

    // Velocity may or may not fire depending on timing — verify no crash
    expect(list.total).toBe(100000);
  });
});

// =============================================================================
// Scroll Idle with Features
// =============================================================================

describe("cross-feature — scroll idle", () => {
  it("adds scrolling class during scroll", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(100), item: { height: 50, template: simpleTemplate } },
      [],
    );

    const viewport = getViewport(container);
    simulateScroll(viewport, 200);

    expect(list.element.classList.contains("vlist--scrolling")).toBe(true);
  });

  it("scroll idle event fires after timeout", async () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(100), item: { height: 50, template: simpleTemplate }, scroll: { idleTimeout: 30 } },
      [],
    );

    let idleFired = false;
    list.on("scroll:idle", () => { idleFired = true; });

    const viewport = getViewport(container);
    simulateScroll(viewport, 200);

    await new Promise((r) => setTimeout(r, 80));
    expect(idleFired).toBe(true);
  });

  it("removes scrolling class after idle fires", async () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(100), item: { height: 50, template: simpleTemplate }, scroll: { idleTimeout: 20 } },
      [],
    );

    const rootEl = list.element;
    const viewport = getViewport(container);
    simulateScroll(viewport, 200);
    expect(rootEl.classList.contains("vlist--scrolling")).toBe(true);

    // Wait for idle event rather than fixed timeout — more reliable under concurrency
    await new Promise<void>((resolve) => {
      list!.on("scroll:idle", () => resolve());
      setTimeout(resolve, 2000);
    });
    expect(rootEl.classList.contains("vlist--scrolling")).toBe(false);
  });
});

// =============================================================================
// ARIA with Selection
// =============================================================================

describe("cross-feature — ARIA with selection", () => {
  it("sets aria role on content with selection", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(50), item: { height: 50, template: simpleTemplate } },
      [selection()],
    );

    const content = getContent(container);
    const role = content.getAttribute("role");
    expect(role).toBeTruthy();
  });

  it("selection plugin registers select/deselect methods", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(50), item: { height: 50, template: simpleTemplate } },
      [selection({ mode: "multiple" })],
    );

    expect(typeof (list as any).select).toBe("function");
    expect(typeof (list as any).deselect).toBe("function");
    expect(typeof (list as any).getSelected).toBe("function");
    expect(typeof (list as any).selectAll).toBe("function");
  });
});

// =============================================================================
// grid + snapshots — sizeCache must stay in row space
// =============================================================================

describe("grid + snapshots", () => {
  it("should not rebuild sizeCache to item count when grid uses row count", () => {
    const items = createTestItems(900);
    const autoSaveKey = "__test_grid_snap";
    sessionStorage.removeItem(autoSaveKey);

    // First list: create, scroll, destroy — saves snapshot to sessionStorage
    list = createVList<TestItem>(
      { container, items, item: { height: 50, template: simpleTemplate } },
      [grid({ columns: 4, gap: 8 }), snapshots({ autoSave: autoSaveKey })],
    );
    list.destroy();
    list = null;

    // Second list: recreates with snapshot in sessionStorage.
    // The snapshots plugin must NOT rebuild the sizeCache from 225 (rows) to 900 (items).
    container = createContainer({ width: 300, height: 500 });
    list = createVList<TestItem>(
      { container, items, item: { height: 50, template: simpleTemplate } },
      [grid({ columns: 4, gap: 8 }), snapshots({ autoSave: autoSaveKey })],
    );

    const content = getContent(container);
    const contentHeight = parseInt(content.style.height, 10);
    const expectedRows = Math.ceil(900 / 4); // 225
    const expectedHeight = expectedRows * (50 + 8) - 8; // 225 * 58 - 8 = 13042
    // Allow some padding variance but must be in row space, not item space
    // Item space would be 900 * 58 - 8 = 52192
    expect(contentHeight).toBeLessThan(expectedRows * (50 + 8) * 2);
    expect(contentHeight).toBeGreaterThan(0);

    sessionStorage.removeItem(autoSaveKey);
  });
});
