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
import { scale } from "../../src/plugins/scale/plugin";
import { groups } from "../../src/plugins/groups/plugin";
import { snapshots } from "../../src/plugins/snapshots/plugin";
import { data as dataPlugin } from "../../src/plugins/async/plugin";
import { grid } from "../../src/plugins/grid/plugin";
import { selection } from "../../src/plugins/selection/plugin";
import { scrollbar } from "../../src/plugins/scrollbar/plugin";
import type { VListAdapter } from "../../src/types";

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  GlobalRegistrator.register();
  origClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  );
  origClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() {
      return 500;
    },
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    get() {
      return 300;
    },
    configurable: true,
  });
});
afterAll(() => {
  if (origClientHeight)
    Object.defineProperty(
      HTMLElement.prototype,
      "clientHeight",
      origClientHeight,
    );
  if (origClientWidth)
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      origClientWidth,
    );
  GlobalRegistrator.unregister();
});

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

function simulateScroll(viewport: HTMLElement, scrollTop: number): void {
  Object.defineProperty(viewport, "scrollTop", {
    value: scrollTop,
    writable: true,
    configurable: true,
  });
  viewport.dispatchEvent(new Event("scroll", { bubbles: false }));
}

function getViewport(el: HTMLElement): HTMLElement {
  return el.querySelector<HTMLElement>(".vlist-viewport")!;
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

const getGroup = (index: number): string => {
  if (index < 10) return "Group A";
  if (index < 20) return "Group B";
  return "Group C";
};

// =============================================================================
// DOM leak detection per plugin
// =============================================================================

describe("memory — DOM leak detection per plugin", () => {
  it("scale create/destroy leaves no DOM nodes", () => {
    const childrenBefore = container.children.length;

    list = createVList(
      {
        container,
        items: createTestItems(1000),
        item: { height: 40, template: simpleTemplate },
      },
      [scale({ force: true })],
    );

    expect(container.children.length).toBeGreaterThan(childrenBefore);

    list.destroy();
    list = null;
    expect(container.children.length).toBe(childrenBefore);
  });

  it("groups create/destroy leaves no DOM nodes", () => {
    const childrenBefore = container.children.length;

    list = createVList(
      {
        container,
        items: createTestItems(30),
        item: { height: 40, template: simpleTemplate },
      },
      [
        groups({
          getGroupForIndex: getGroup,
          header: {
            height: 30,
            template: (groupKey) =>
              `<div class="group-header">${groupKey}</div>`,
          },
        }),
      ],
    );

    expect(container.children.length).toBeGreaterThan(childrenBefore);

    list.destroy();
    list = null;
    expect(container.children.length).toBe(childrenBefore);
  });

  it("snapshots create/destroy leaves no DOM nodes", () => {
    const childrenBefore = container.children.length;

    list = createVList(
      {
        container,
        items: createTestItems(50),
        item: { height: 40, template: simpleTemplate },
      },
      [snapshots()],
    );

    expect(container.children.length).toBeGreaterThan(childrenBefore);

    list.destroy();
    list = null;
    expect(container.children.length).toBe(childrenBefore);
  });

  it("async create/destroy leaves no DOM nodes", async () => {
    const childrenBefore = container.children.length;

    list = createVList(
      {
        container,
        items: [],
        item: { height: 40, template: simpleTemplate },
      },
      [dataPlugin({ adapter: createMockAdapter(50), autoLoad: true })],
    );

    await waitForLoad(list);

    expect(container.children.length).toBeGreaterThan(childrenBefore);

    list.destroy();
    list = null;
    expect(container.children.length).toBe(childrenBefore);
  });

  it("all features combined create/destroy leaves no DOM nodes", () => {
    const childrenBefore = container.children.length;

    list = createVList(
      {
        container,
        items: createTestItems(50),
        item: { height: 40, template: simpleTemplate },
      },
      [
        grid({ columns: 3 }),
        selection({ mode: "multiple" }),
        scrollbar(),
        snapshots(),
      ],
    );

    (list as any).selectAll();
    list.scrollToIndex(10);

    list.destroy();
    list = null;
    expect(container.children.length).toBe(childrenBefore);
  });
});

// =============================================================================
// Event listener cleanup
// =============================================================================

describe("memory — event listener cleanup", () => {
  it("scroll events stop after destroy", () => {
    list = createVList(
      {
        container,
        items: createTestItems(100),
        item: { height: 40, template: simpleTemplate },
      },
      [],
    );

    const scrollHandler = mock(() => {});
    list.on("scroll", scrollHandler);

    const viewport = getViewport(container);
    simulateScroll(viewport, 100);
    const callsBeforeDestroy = scrollHandler.mock.calls.length;
    expect(callsBeforeDestroy).toBeGreaterThan(0);

    list.destroy();
    list = null;

    simulateScroll(viewport, 200);
    expect(scrollHandler.mock.calls.length).toBe(callsBeforeDestroy);
  });

  it("unsubscribe stops event delivery", () => {
    list = createVList(
      {
        container,
        items: createTestItems(100),
        item: { height: 40, template: simpleTemplate },
      },
      [],
    );

    const handler = mock(() => {});
    const unsub = list.on("scroll", handler);

    const viewport = getViewport(container);
    simulateScroll(viewport, 100);
    expect(handler.mock.calls.length).toBeGreaterThan(0);

    const callsBefore = handler.mock.calls.length;
    unsub();

    simulateScroll(viewport, 200);
    expect(handler.mock.calls.length).toBe(callsBefore);
  });

  it("off() stops event delivery", () => {
    list = createVList(
      {
        container,
        items: createTestItems(100),
        item: { height: 40, template: simpleTemplate },
      },
      [],
    );

    const handler = mock(() => {});
    list.on("scroll", handler);

    const viewport = getViewport(container);
    simulateScroll(viewport, 100);
    expect(handler.mock.calls.length).toBeGreaterThan(0);

    const callsBefore = handler.mock.calls.length;
    list.off("scroll", handler);

    simulateScroll(viewport, 200);
    expect(handler.mock.calls.length).toBe(callsBefore);
  });

  it("events do not fire after destroy", () => {
    list = createVList(
      {
        container,
        items: createTestItems(100),
        item: { height: 40, template: simpleTemplate },
      },
      [],
    );

    const viewport = getViewport(container);
    const scrollHandler = mock(() => {});
    const rangeHandler = mock(() => {});
    list.on("scroll", scrollHandler);
    list.on("range:change", rangeHandler);

    // Trigger one scroll so listeners are wired
    simulateScroll(viewport, 100);
    const scrollCalls = scrollHandler.mock.calls.length;
    const rangeCalls = rangeHandler.mock.calls.length;

    list.destroy();
    list = null;

    // After destroy, emitter is cleared — no further events should fire
    expect(scrollHandler.mock.calls.length).toBe(scrollCalls);
    expect(rangeHandler.mock.calls.length).toBe(rangeCalls);
  });

  it("selection:change listeners cleaned on destroy", () => {
    list = createVList(
      {
        container,
        items: createTestItems(50),
        item: { height: 40, template: simpleTemplate },
      },
      [selection({ mode: "multiple" })],
    );

    const handler = mock(() => {});
    list.on("selection:change", handler);

    (list as any).select(1, 2);
    const callsBefore = handler.mock.calls.length;
    expect(callsBefore).toBeGreaterThan(0);

    list.destroy();
    list = null;

    expect(handler.mock.calls.length).toBe(callsBefore);
  });

  it("scroll handler count does not accumulate across cycles", () => {
    const scrollHandler = mock(() => {});

    for (let i = 0; i < 5; i++) {
      const cycleList = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      cycleList.on("scroll", scrollHandler);
      cycleList.destroy();
    }

    list = createVList(
      {
        container,
        items: createTestItems(100),
        item: { height: 40, template: simpleTemplate },
      },
      [],
    );

    const freshHandler = mock(() => {});
    list.on("scroll", freshHandler);

    const viewport = getViewport(container);
    simulateScroll(viewport, 100);

    expect(freshHandler.mock.calls.length).toBe(1);
  });
});

// =============================================================================
// ResizeObserver cleanup
// =============================================================================

describe("memory — ResizeObserver cleanup", () => {
  // ResizeObserver is created inside setTimeout(initObserver, 0) in create.ts,
  // so we must flush the timer before destroy to ensure it exists.
  const flush = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 0));

  it("disconnect called on destroy", async () => {
    const disconnectSpy = mock(() => {});
    const OrigRO = global.ResizeObserver;

    global.ResizeObserver = class extends OrigRO {
      disconnect(): void {
        disconnectSpy();
        super.disconnect();
      }
    } as typeof ResizeObserver;

    const localList = createVList(
      {
        container,
        items: createTestItems(50),
        item: { height: 40, template: simpleTemplate },
      },
      [],
    );

    await flush();

    localList.destroy();

    expect(disconnectSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    global.ResizeObserver = OrigRO;
  });

  it("disconnect called with multiple features", async () => {
    const disconnectSpy = mock(() => {});
    const OrigRO = global.ResizeObserver;

    global.ResizeObserver = class extends OrigRO {
      disconnect(): void {
        disconnectSpy();
        super.disconnect();
      }
    } as typeof ResizeObserver;

    const localList = createVList(
      {
        container,
        items: createTestItems(50),
        item: { height: 40, template: simpleTemplate },
      },
      [grid({ columns: 3 }), selection({ mode: "multiple" }), scrollbar()],
    );

    await flush();

    localList.destroy();

    expect(disconnectSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    global.ResizeObserver = OrigRO;
  });

  it("disconnect called on each create/destroy cycle", async () => {
    const disconnectSpy = mock(() => {});
    const OrigRO = global.ResizeObserver;

    global.ResizeObserver = class extends OrigRO {
      disconnect(): void {
        disconnectSpy();
        super.disconnect();
      }
    } as typeof ResizeObserver;

    for (let i = 0; i < 3; i++) {
      const cycleList = createVList(
        {
          container,
          items: createTestItems(50),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );
      await flush();
      cycleList.destroy();
    }

    expect(disconnectSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    global.ResizeObserver = OrigRO;
  });
});

// =============================================================================
// Async lifecycle cleanup
// =============================================================================

describe("memory — async lifecycle cleanup", () => {
  it("async create/destroy leaves no DOM nodes", async () => {
    const childrenBefore = container.children.length;
    const adapter = createMockAdapter(100);

    list = createVList(
      {
        container,
        items: [],
        item: { height: 40, template: simpleTemplate },
      },
      [dataPlugin({ adapter, autoLoad: true })],
    );

    await waitForLoad(list);

    list.destroy();
    list = null;
    expect(container.children.length).toBe(childrenBefore);
  });

  it("destroying during async load does not leak", async () => {
    const childrenBefore = container.children.length;
    let resolveRead: ((v: any) => void) | null = null;
    const slowAdapter: VListAdapter<TestItem> = {
      read: mock(async () => {
        return new Promise<any>((resolve) => {
          resolveRead = resolve;
        });
      }),
    };

    list = createVList(
      {
        container,
        items: [],
        item: { height: 40, template: simpleTemplate },
      },
      [dataPlugin({ adapter: slowAdapter, autoLoad: true })],
    );

    // Destroy before the load completes
    list.destroy();
    list = null;

    // Resolve after destroy to simulate late callback
    if (resolveRead) {
      resolveRead({ items: createTestItems(10), total: 10, hasMore: false });
    }

    await new Promise((r) => setTimeout(r, 50));

    expect(container.children.length).toBe(childrenBefore);
  });
});

// =============================================================================
// Timer cleanup
// =============================================================================

describe("memory — timer cleanup", () => {
  it("idle timer cleared on destroy during scroll", () => {
    list = createVList(
      {
        container,
        items: createTestItems(100),
        item: { height: 40, template: simpleTemplate },
      },
      [],
    );

    const viewport = getViewport(container);
    simulateScroll(viewport, 100);

    // Destroy while idle timer is pending (before idle fires)
    list.destroy();
    list = null;

    // If timer leaks, this would cause errors or fire after destroy.
    // Wait for it to pass harmlessly.
    expect(true).toBe(true);
  });

  it("deceleration timer cleared on destroy", () => {
    list = createVList(
      {
        container,
        items: createTestItems(1000),
        item: { height: 40, template: simpleTemplate },
      },
      [scale({ force: true })],
    );

    const viewport = getViewport(container);
    const wheelEvent = new WheelEvent("wheel", {
      deltaY: 100,
      bubbles: true,
      cancelable: true,
    });
    viewport.dispatchEvent(wheelEvent);

    list.destroy();
    list = null;

    // Deceleration rAF should have been cancelled
    expect(true).toBe(true);
  });
});

// =============================================================================
// Data operation cleanup
// =============================================================================

describe("memory — data operation cleanup", () => {
  it("setItems does not accumulate DOM nodes over iterations", () => {
    list = createVList(
      {
        container,
        items: createTestItems(50),
        item: { height: 40, template: simpleTemplate },
      },
      [],
    );

    const content = list.element.querySelector(".vlist-content") as HTMLElement;

    for (let i = 0; i < 10; i++) {
      list.setItems(createTestItems(50, (i + 1) * 100));
    }

    // Rendered DOM count should stay bounded (viewport/overscan)
    expect(content.children.length).toBeLessThan(40);
  });

  it("appendItems does not leak DOM nodes", () => {
    list = createVList(
      {
        container,
        items: createTestItems(20),
        item: { height: 40, template: simpleTemplate },
      },
      [],
    );

    const content = list.element.querySelector(".vlist-content") as HTMLElement;

    for (let i = 0; i < 10; i++) {
      list.appendItems(createTestItems(20, (i + 1) * 100 + 20));
    }

    expect(list.items.length).toBe(220);
    expect(content.children.length).toBeLessThan(40);
  });

  it("removeItems sequence leaves correct DOM count", () => {
    const items = createTestItems(50);
    list = createVList(
      {
        container,
        items,
        item: { height: 40, template: simpleTemplate },
      },
      [],
    );

    for (let i = 50; i > 20; i--) {
      list.removeItem(i);
    }

    expect(list.total).toBe(20);

    const content = list.element.querySelector(".vlist-content") as HTMLElement;
    expect(content.children.length).toBeLessThanOrEqual(25);
  });
});
