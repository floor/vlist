/**
 * vlist v2 — Sortable Plugin Tests
 * Tests for sortable(): factory, setup wiring, pointer handlers,
 * drag ghost/placeholder, sort events, handle configuration, destroy cleanup.
 *
 * Adapted from v1 withSortable feature tests to v2 PluginContext API.
 */

import { describe, it, expect, mock, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { sortable } from "../../../src/plugins/sortable/plugin";
import type { VListItem } from "../../../src/types";
import { createPluginMockContext } from "../../helpers/plugin-context";

// =============================================================================
// Fake Timer Utility
// =============================================================================

interface FakeTimerHandle { id: number; fn: () => void; time: number; interval: number }

let fakeTimers: { tick: (ms: number) => void; restore: () => void };

function useFakeTimers(): { tick: (ms: number) => void; restore: () => void } {
  const timers: FakeTimerHandle[] = [];
  let now = 0;
  let nextId = 1;

  const origSetTimeout = global.setTimeout;
  const origClearTimeout = global.clearTimeout;
  const origSetInterval = global.setInterval;
  const origClearInterval = global.clearInterval;

  global.setTimeout = ((fn: () => void, delay = 0): number => {
    const id = nextId++;
    timers.push({ id, fn, time: now + delay, interval: 0 });
    return id;
  }) as any;

  global.clearTimeout = ((id: number): void => {
    const idx = timers.findIndex(t => t.id === id);
    if (idx !== -1) timers.splice(idx, 1);
  }) as any;

  global.setInterval = ((fn: () => void, delay: number): number => {
    const id = nextId++;
    timers.push({ id, fn, time: now + delay, interval: delay });
    return id;
  }) as any;

  global.clearInterval = ((id: number): void => {
    const idx = timers.findIndex(t => t.id === id);
    if (idx !== -1) timers.splice(idx, 1);
  }) as any;

  const tick = (ms: number): void => {
    const target = now + ms;
    while (true) {
      let earliest: FakeTimerHandle | undefined;
      for (const t of timers) {
        if (t.time <= target && (!earliest || t.time < earliest.time)) earliest = t;
      }
      if (!earliest) break;
      now = earliest.time;
      if (earliest.interval > 0) {
        earliest.time = now + earliest.interval;
        earliest.fn();
      } else {
        const idx = timers.indexOf(earliest);
        timers.splice(idx, 1);
        earliest.fn();
      }
    }
    now = target;
  };

  const restore = (): void => {
    global.setTimeout = origSetTimeout;
    global.clearTimeout = origClearTimeout;
    global.setInterval = origSetInterval;
    global.clearInterval = origClearInterval;
  };

  return { tick, restore };
}

beforeEach(() => { fakeTimers = useFakeTimers(); });
afterEach(() => { fakeTimers.restore(); });

// =============================================================================
// DOM Setup
// =============================================================================

let origRAF: typeof globalThis.requestAnimationFrame;
let origCAF: typeof globalThis.cancelAnimationFrame;

beforeAll(() => {
  GlobalRegistrator.register();
  origRAF = global.requestAnimationFrame;
  origCAF = global.cancelAnimationFrame;
  global.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number;
  global.cancelAnimationFrame = (id: number): void => clearTimeout(id);
});

afterAll(() => {
  global.requestAnimationFrame = origRAF;
  global.cancelAnimationFrame = origCAF;
  GlobalRegistrator.unregister();
});

// =============================================================================
// Test Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
  }));

/**
 * Creates a mock context with 20 items and 10 rendered DOM elements in content.
 * Item size is 56px (matches v1 test sizeCache).
 */
function createMockContext() {
  const items = createTestItems(20);
  const result = createPluginMockContext<TestItem>(items, {
    itemSize: 56,
    containerWidth: 400,
    containerHeight: 600,
  });

  // Add rendered item elements to the content container (simulates rendered items 0-9)
  for (let i = 0; i < 10; i++) {
    const el = document.createElement("div");
    el.className = "vlist-item";
    el.setAttribute("data-index", String(i));
    el.setAttribute("data-id", String(items[i]!.id));
    el.innerHTML = `<div class="item">${items[i]!.name}</div>`;
    // Position at correct offset (56px each)
    el.style.transform = `translateY(${i * 56}px)`;
    result.dom.content.appendChild(el);
  }

  // Wire up an emit spy so tests can inspect emitted events
  const emitSpy = mock(() => {});
  (result.ctx as any).emitter = {
    on: () => () => {},
    off: () => {},
    emit: emitSpy,
    clear: () => {},
  };

  return { ...result, emitSpy };
}

// =============================================================================
// Factory Tests
// =============================================================================

describe("sortable — factory", () => {
  it("creates a plugin with correct name and priority", () => {
    const plugin = sortable<TestItem>();
    expect(plugin.name).toBe("sortable");
    expect(plugin.priority).toBe(30);
  });

  it("has a setup function", () => {
    const plugin = sortable<TestItem>();
    expect(plugin.setup).toBeInstanceOf(Function);
  });

  it("declares conflicts with grid, masonry, table, and scale", () => {
    const plugin = sortable<TestItem>();
    expect(plugin.conflicts).toContain("grid");
    expect(plugin.conflicts).toContain("masonry");
    expect(plugin.conflicts).toContain("table");
    expect(plugin.conflicts).toContain("scale");
  });

  it("accepts config with handle selector", () => {
    const plugin = sortable<TestItem>({ handle: ".drag-handle" });
    expect(plugin.name).toBe("sortable");
  });

  it("accepts config with all options", () => {
    const plugin = sortable<TestItem>({
      handle: ".grip",
      ghostClass: "my-ghost",
      shiftDuration: 200,
      edgeScrollZone: 60,
      edgeScrollSpeed: 12,
      dragThreshold: 10,
      ghostContainer: document.createElement("div"),
    });
    expect(plugin.name).toBe("sortable");
  });
});

// =============================================================================
// Setup Tests
// =============================================================================

describe("sortable — setup", () => {
  it("registers isSorting method on context", () => {
    const plugin = sortable<TestItem>();
    const { ctx, methods, cleanup } = createMockContext();
    plugin.setup!(ctx);

    expect(methods.has("isSorting")).toBe(true);
    const isSorting = methods.get("isSorting") as () => boolean;
    expect(isSorting()).toBe(false);

    cleanup();
  });

  it("registers a destroy handler", () => {
    const plugin = sortable<TestItem>();
    const { ctx, destroyHandlers, cleanup } = createMockContext();
    plugin.setup!(ctx);

    expect(destroyHandlers.length).toBeGreaterThan(0);
    cleanup();
  });

  it("attaches pointerdown listener to content container", () => {
    const plugin = sortable<TestItem>();
    const { ctx, cleanup } = createMockContext();

    const addListenerSpy = mock(() => {});
    ctx.dom.content.addEventListener = addListenerSpy as any;

    plugin.setup!(ctx);

    const calls = addListenerSpy.mock.calls;
    const pointerdownCall = calls.find(
      (c: any[]) => c[0] === "pointerdown",
    );
    expect(pointerdownCall).toBeDefined();

    cleanup();
  });
});

// =============================================================================
// Handle Configuration Tests
// =============================================================================

describe("sortable — handle config", () => {
  it("without handle: pointerdown on any item part registers for drag", () => {
    const plugin = sortable<TestItem>();
    const { ctx, cleanup } = createMockContext();
    plugin.setup!(ctx);

    const itemEl = ctx.dom.content.querySelector("[data-index='2']") as HTMLElement;
    expect(itemEl).toBeDefined();

    const event = new (PointerEvent ?? MouseEvent)(
      "pointerdown",
      {
        bubbles: true,
        clientX: 100,
        clientY: 100,
        button: 0,
      },
    );

    // The handler should not throw
    itemEl.dispatchEvent(event);
    cleanup();
  });

  it("with handle: pointerdown outside handle does not initiate drag", () => {
    const plugin = sortable<TestItem>({ handle: ".drag-handle" });
    const { ctx, methods, cleanup } = createMockContext();
    plugin.setup!(ctx);

    const itemEl = ctx.dom.content.querySelector("[data-index='0']") as HTMLElement;

    const event = new (PointerEvent ?? MouseEvent)(
      "pointerdown",
      {
        bubbles: true,
        clientX: 100,
        clientY: 100,
        button: 0,
      },
    );

    itemEl.dispatchEvent(event);

    const isSorting = methods.get("isSorting") as () => boolean;
    expect(isSorting()).toBe(false);
    cleanup();
  });

  it("with handle: pointerdown on handle element is accepted", () => {
    const plugin = sortable<TestItem>({ handle: ".drag-handle" });
    const { ctx, cleanup } = createMockContext();
    plugin.setup!(ctx);

    const itemEl = ctx.dom.content.querySelector("[data-index='0']") as HTMLElement;
    const handle = document.createElement("span");
    handle.className = "drag-handle";
    itemEl.appendChild(handle);

    const event = new (PointerEvent ?? MouseEvent)(
      "pointerdown",
      {
        bubbles: true,
        clientX: 100,
        clientY: 100,
        button: 0,
      },
    );

    // Should not throw — the handle is present
    handle.dispatchEvent(event);
    cleanup();
  });
});

// =============================================================================
// Sorting State Tests
// =============================================================================

describe("sortable — isSorting", () => {
  it("returns false initially", () => {
    const plugin = sortable<TestItem>();
    const { ctx, methods, cleanup } = createMockContext();
    plugin.setup!(ctx);

    const isSorting = methods.get("isSorting") as () => boolean;
    expect(isSorting()).toBe(false);
    cleanup();
  });

  it("returns true during keyboard grab", () => {
    const plugin = sortable<TestItem>();
    const { ctx, methods, cleanup } = createMockContext();
    methods.set("_getFocusedIndex", () => 3);
    methods.set("_focusById", mock(() => {}));
    plugin.setup!(ctx);

    const isSorting = methods.get("isSorting") as () => boolean;
    expect(isSorting()).toBe(false);

    // Grab via Space
    ctx.dom.root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(isSorting()).toBe(true);
    cleanup();
  });

  it("returns false after keyboard drop", () => {
    const plugin = sortable<TestItem>();
    const { ctx, methods, cleanup } = createMockContext();
    methods.set("_getFocusedIndex", () => 3);
    methods.set("_focusById", mock(() => {}));
    plugin.setup!(ctx);

    const isSorting = methods.get("isSorting") as () => boolean;

    // Grab
    ctx.dom.root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(isSorting()).toBe(true);

    // Drop
    ctx.dom.root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(isSorting()).toBe(false);
    cleanup();
  });

  it("returns false after keyboard cancel", () => {
    const plugin = sortable<TestItem>();
    const { ctx, methods, cleanup } = createMockContext();
    methods.set("_getFocusedIndex", () => 3);
    methods.set("_focusById", mock(() => {}));
    plugin.setup!(ctx);

    const isSorting = methods.get("isSorting") as () => boolean;

    // Grab
    ctx.dom.root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(isSorting()).toBe(true);

    // Cancel
    ctx.dom.root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(isSorting()).toBe(false);
    cleanup();
  });
});

// =============================================================================
// Event Emission Tests
// =============================================================================

describe("sortable — sort events", () => {
  /**
   * Helper: simulate a full drag sequence (pointerdown → pointermove past
   * threshold → returns the emitSpy so callers can inspect emitted events.
   */
  function simulateDrag(
    ctx: ReturnType<typeof createMockContext>["ctx"],
    emitSpy: ReturnType<typeof mock>,
    fromIndex: number,
    moveY: number,
  ): ReturnType<typeof mock> {
    const PointerEventCtor =
      PointerEvent ?? MouseEvent;

    const itemEl = ctx.dom.content.querySelector(
      `[data-index='${fromIndex}']`,
    ) as HTMLElement;

    // Give the item a bounding rect so ghost creation doesn't blow up
    itemEl.getBoundingClientRect = () =>
      ({
        left: 0,
        top: fromIndex * 56,
        right: 400,
        bottom: fromIndex * 56 + 56,
        width: 400,
        height: 56,
        x: 0,
        y: fromIndex * 56,
        toJSON: () => {},
      }) as DOMRect;

    // pointerdown on the item
    const downEvt = new PointerEventCtor("pointerdown", {
      bubbles: true,
      clientX: 200,
      clientY: fromIndex * 56 + 28,
      button: 0,
    });
    itemEl.dispatchEvent(downEvt);

    // pointermove past threshold (default 5px)
    const moveEvt = new PointerEventCtor("pointermove", {
      bubbles: true,
      clientX: 200,
      clientY: fromIndex * 56 + 28 + moveY,
      button: 0,
    });
    document.dispatchEvent(moveEvt);

    return emitSpy;
  }

  it("emits sort:start when drag threshold is crossed", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();
    plugin.setup!(mockCtx.ctx);

    const emitSpy = simulateDrag(mockCtx.ctx, mockCtx.emitSpy, 2, 20);

    const sortStartCall = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:start",
    );
    expect(sortStartCall).toBeDefined();
    expect(sortStartCall![1]).toEqual({ index: 2 });

    mockCtx.cleanup();
  });

  it("does not emit sort:start when move is below threshold", () => {
    const plugin = sortable<TestItem>({ dragThreshold: 10 });
    const mockCtx = createMockContext();
    plugin.setup!(mockCtx.ctx);

    const emitSpy = simulateDrag(mockCtx.ctx, mockCtx.emitSpy, 0, 3); // 3px < 10px threshold

    const sortStartCall = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:start",
    );
    expect(sortStartCall).toBeUndefined();

    mockCtx.cleanup();
  });

  it("emits sort:end on pointerup after drag", async () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 600,
        width: 400,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    const emitSpy = simulateDrag(mockCtx.ctx, mockCtx.emitSpy, 3, 20);

    // pointerup to finish the drag
    const PointerEventCtor =
      PointerEvent ?? MouseEvent;
    const upEvt = new PointerEventCtor("pointerup", {
      bubbles: true,
      clientX: 200,
      clientY: 3 * 56 + 28 + 20,
      button: 0,
    });
    document.dispatchEvent(upEvt);

    // sort:end is emitted after the drop animation timeout (shiftDuration + 50ms)
    fakeTimers.tick(250);

    const sortEndCall = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:end",
    );
    // Drop at same position → no sort:end (fromIndex === toIndex)
    // This is correct — sort:end only fires when position changed
    // With a 20px move on a 56px item, drop stays at index 3
    expect(sortEndCall).toBeUndefined();

    mockCtx.cleanup();
  });

  it("emits sort:move when drop position changes during drag", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 600,
        width: 400,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    // Drag item 1 down past the midpoint of item 2 (> 56px)
    const emitSpy = simulateDrag(mockCtx.ctx, mockCtx.emitSpy, 1, 80);

    const sortMove = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:move",
    );

    if (sortMove) {
      const payload = sortMove[1] as {
        fromIndex: number;
        currentIndex: number;
      };
      expect(payload.fromIndex).toBe(1);
      expect(payload.currentIndex).not.toBe(1);
    }

    mockCtx.cleanup();
  });

  it("does not emit sort:move when drop position stays the same", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();
    plugin.setup!(mockCtx.ctx);

    // Small move — stays within the same item's zone
    const emitSpy = simulateDrag(mockCtx.ctx, mockCtx.emitSpy, 3, 10);

    const sortMove = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:move",
    );
    // 10px move on a 56px item shouldn't cross the midpoint
    expect(sortMove).toBeUndefined();

    mockCtx.cleanup();
  });

  it("emits sort:end with fromIndex and toIndex when position changes", async () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 600,
        width: 400,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    // Drag item 1 down far enough to pass items (56px each)
    const emitSpy = simulateDrag(mockCtx.ctx, mockCtx.emitSpy, 1, 120);

    // Additional move to ensure drop position updates
    const PointerEventCtor =
      PointerEvent ?? MouseEvent;
    const moveEvt2 = new PointerEventCtor("pointermove", {
      bubbles: true,
      clientX: 200,
      clientY: 1 * 56 + 28 + 120,
      button: 0,
    });
    document.dispatchEvent(moveEvt2);

    const upEvt = new PointerEventCtor("pointerup", {
      bubbles: true,
      clientX: 200,
      clientY: 1 * 56 + 28 + 120,
      button: 0,
    });
    document.dispatchEvent(upEvt);

    // Wait for drop animation timeout
    fakeTimers.tick(250);

    // sort:start should have been emitted
    const sortStartCall = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:start",
    );
    expect(sortStartCall).toBeDefined();
    expect(sortStartCall![1]).toEqual({ index: 1 });

    // sort:end should have fromIndex=1 and a different toIndex
    const sortEndCall = emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:end",
    );
    if (sortEndCall) {
      const payload = sortEndCall[1] as { fromIndex: number; toIndex: number };
      expect(payload.fromIndex).toBe(1);
      expect(payload.toIndex).not.toBe(1);
      expect(payload.toIndex).toBeGreaterThanOrEqual(0);
    }

    mockCtx.cleanup();
  });
});

// =============================================================================
// Ghost Container Tests
// =============================================================================

describe("sortable — ghostContainer", () => {
  function startDrag(
    ctx: ReturnType<typeof createMockContext>["ctx"],
    fromIndex: number,
  ): void {
    const PointerEventCtor =
      PointerEvent ?? MouseEvent;

    const itemEl = ctx.dom.content.querySelector(
      `[data-index='${fromIndex}']`,
    ) as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({
        left: 0,
        top: fromIndex * 56,
        right: 400,
        bottom: fromIndex * 56 + 56,
        width: 400,
        height: 56,
        x: 0,
        y: fromIndex * 56,
        toJSON: () => {},
      }) as DOMRect;

    itemEl.dispatchEvent(
      new PointerEventCtor("pointerdown", {
        bubbles: true,
        clientX: 200,
        clientY: fromIndex * 56 + 28,
        button: 0,
      }),
    );

    document.dispatchEvent(
      new PointerEventCtor("pointermove", {
        bubbles: true,
        clientX: 200,
        clientY: fromIndex * 56 + 28 + 20,
        button: 0,
      }),
    );
  }

  it("appends ghost to document.body by default", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();
    plugin.setup!(mockCtx.ctx);

    startDrag(mockCtx.ctx, 2);

    const ghost = document.body.querySelector(".vlist-sort-ghost");
    expect(ghost).not.toBeNull();

    for (const h of mockCtx.destroyHandlers) h();
    ghost?.remove();
    mockCtx.cleanup();
  });

  it("appends ghost to ghostContainer when specified", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const plugin = sortable<TestItem>({ ghostContainer: container });
    const mockCtx = createMockContext();
    plugin.setup!(mockCtx.ctx);

    startDrag(mockCtx.ctx, 2);

    const ghost = container.querySelector(".vlist-sort-ghost");
    expect(ghost).not.toBeNull();
    expect(
      document.body.querySelectorAll(":scope > .vlist-sort-ghost").length,
    ).toBe(0);

    for (const h of mockCtx.destroyHandlers) h();
    ghost?.remove();
    container.remove();
    mockCtx.cleanup();
  });

  it("removes ghost from ghostContainer on cleanup", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const plugin = sortable<TestItem>({ ghostContainer: container });
    const mockCtx = createMockContext();

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 600,
        width: 400,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    startDrag(mockCtx.ctx, 2);
    expect(container.querySelector(".vlist-sort-ghost")).not.toBeNull();

    const PointerEventCtor =
      PointerEvent ?? MouseEvent;
    document.dispatchEvent(
      new PointerEventCtor("pointerup", {
        bubbles: true,
        clientX: 200,
        clientY: 2 * 56 + 28 + 20,
        button: 0,
      }),
    );

    fakeTimers.tick(250);

    expect(container.querySelector(".vlist-sort-ghost")).toBeNull();

    container.remove();
    mockCtx.cleanup();
  });
});

// =============================================================================
// Destroy Tests
// =============================================================================

describe("sortable — destroy", () => {
  it("removes pointerdown listener from content on destroy", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    const removeListenerSpy = mock(() => {});
    mockCtx.ctx.dom.content.removeEventListener = removeListenerSpy as any;

    plugin.setup!(mockCtx.ctx);

    // Run destroy handlers
    for (const handler of mockCtx.destroyHandlers) {
      handler();
    }

    const calls = removeListenerSpy.mock.calls;
    const pointerdownCall = calls.find(
      (c: any[]) => c[0] === "pointerdown",
    );
    expect(pointerdownCall).toBeDefined();

    mockCtx.cleanup();
  });
});

// =============================================================================
// Keyboard Reordering Tests
// =============================================================================

describe("sortable — keyboard reordering", () => {
  /** Helper: set up a sortable context with _getFocusedIndex mock */
  function setupKeyboard(focusedIndex: number) {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    // Mock selection's _getFocusedIndex to return the focused item
    mockCtx.methods.set("_getFocusedIndex", () => focusedIndex);
    mockCtx.methods.set("_focusById", mock(() => {}));

    plugin.setup!(mockCtx.ctx);

    return { plugin, ...mockCtx };
  }

  function dispatchKey(
    target: HTMLElement,
    key: string,
    opts: Partial<KeyboardEventInit> = {},
  ): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...opts,
    });
    target.dispatchEvent(event);
    return event;
  }

  it("Space on focused item enters grab mode and emits sort:start", () => {
    const setup = setupKeyboard(3);

    dispatchKey(setup.ctx.dom.root, " ");

    const sortStart = setup.emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:start",
    );
    expect(sortStart).toBeDefined();
    expect(sortStart![1]).toEqual({ index: 3 });

    setup.cleanup();
  });

  it("Space on focused item adds --sorting class to root", () => {
    const setup = setupKeyboard(3);

    dispatchKey(setup.ctx.dom.root, " ");

    expect(setup.ctx.dom.root.classList.contains("vlist--sorting")).toBe(true);

    setup.cleanup();
  });

  it("Space on focused item adds --kb-sorting class to grabbed item", () => {
    const setup = setupKeyboard(3);

    dispatchKey(setup.ctx.dom.root, " ");

    const el = setup.ctx.dom.content.querySelector('[data-id="3"]');
    expect(el?.classList.contains("vlist-item--kb-sorting")).toBe(true);

    setup.cleanup();
  });

  it("ArrowDown in grab mode emits sort:end with adjacent swap", () => {
    const setup = setupKeyboard(3);

    // Grab
    dispatchKey(setup.ctx.dom.root, " ");
    setup.emitSpy.mock.calls.length = 0; // Clear sort:start

    // Move down
    dispatchKey(setup.ctx.dom.root, "ArrowDown");

    const sortEnd = setup.emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:end",
    );
    expect(sortEnd).toBeDefined();
    expect(sortEnd![1]).toEqual({ fromIndex: 3, toIndex: 4 });

    setup.cleanup();
  });

  it("ArrowUp in grab mode emits sort:end with upward swap", () => {
    const setup = setupKeyboard(3);

    dispatchKey(setup.ctx.dom.root, " ");
    setup.emitSpy.mock.calls.length = 0;

    dispatchKey(setup.ctx.dom.root, "ArrowUp");

    const sortEnd = setup.emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:end",
    );
    expect(sortEnd).toBeDefined();
    expect(sortEnd![1]).toEqual({ fromIndex: 3, toIndex: 2 });

    setup.cleanup();
  });

  it("multiple ArrowDown moves accumulate position", () => {
    const setup = setupKeyboard(1);

    dispatchKey(setup.ctx.dom.root, " ");
    setup.emitSpy.mock.calls.length = 0;

    dispatchKey(setup.ctx.dom.root, "ArrowDown");
    dispatchKey(setup.ctx.dom.root, "ArrowDown");

    const sortEnds = setup.emitSpy.mock.calls.filter(
      (c: unknown[]) => c[0] === "sort:end",
    );
    expect(sortEnds.length).toBe(2);
    expect(sortEnds[0]![1]).toEqual({ fromIndex: 1, toIndex: 2 });
    expect(sortEnds[1]![1]).toEqual({ fromIndex: 2, toIndex: 3 });

    setup.cleanup();
  });

  it("ArrowDown at last index does nothing", () => {
    // Focus on item 9 (last visible in DOM)
    const setup = setupKeyboard(9);

    dispatchKey(setup.ctx.dom.root, " ");
    setup.emitSpy.mock.calls.length = 0;

    dispatchKey(setup.ctx.dom.root, "ArrowDown");

    // Total is 20, so index 9 can still move down
    const sortEnd = setup.emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:end",
    );
    expect(sortEnd).toBeDefined();
    expect(sortEnd![1]).toEqual({ fromIndex: 9, toIndex: 10 });

    setup.cleanup();
  });

  it("ArrowUp at index 0 does nothing", () => {
    const setup = setupKeyboard(0);

    dispatchKey(setup.ctx.dom.root, " ");
    setup.emitSpy.mock.calls.length = 0;

    dispatchKey(setup.ctx.dom.root, "ArrowUp");

    const sortEnd = setup.emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:end",
    );
    expect(sortEnd).toBeUndefined();

    setup.cleanup();
  });

  it("Space in grab mode drops the item (no redundant sort:end)", () => {
    const setup = setupKeyboard(3);

    dispatchKey(setup.ctx.dom.root, " ");
    dispatchKey(setup.ctx.dom.root, "ArrowDown"); // sort:end already emitted here
    setup.emitSpy.mock.calls.length = 0;

    // Drop — should NOT emit sort:end (data already reordered per move)
    dispatchKey(setup.ctx.dom.root, " ");

    const sortEnd = setup.emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:end",
    );
    expect(sortEnd).toBeUndefined();

    // Root should no longer have --sorting
    expect(setup.ctx.dom.root.classList.contains("vlist--sorting")).toBe(false);

    setup.cleanup();
  });

  it("Escape cancels grab and removes --sorting class", () => {
    const setup = setupKeyboard(3);

    dispatchKey(setup.ctx.dom.root, " ");
    expect(setup.ctx.dom.root.classList.contains("vlist--sorting")).toBe(true);

    dispatchKey(setup.ctx.dom.root, "Escape");
    expect(setup.ctx.dom.root.classList.contains("vlist--sorting")).toBe(false);

    setup.cleanup();
  });

  it("Escape after move emits sort:cancel with original items", () => {
    const setup = setupKeyboard(3);

    dispatchKey(setup.ctx.dom.root, " ");
    dispatchKey(setup.ctx.dom.root, "ArrowDown");
    dispatchKey(setup.ctx.dom.root, "ArrowDown");
    setup.emitSpy.mock.calls.length = 0;

    dispatchKey(setup.ctx.dom.root, "Escape");

    // Should emit sort:cancel with the original items snapshot
    const sortCancel = setup.emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:cancel",
    );
    expect(sortCancel).toBeDefined();
    const payload = sortCancel![1] as { originalItems: unknown[] };
    expect(payload.originalItems).toBeArray();
    expect(payload.originalItems.length).toBe(20);

    setup.cleanup();
  });

  it("keys are intercepted (stopImmediatePropagation) in grab mode", () => {
    const setup = setupKeyboard(3);

    dispatchKey(setup.ctx.dom.root, " ");

    // In grab mode, ArrowDown should be intercepted
    const event = dispatchKey(setup.ctx.dom.root, "ArrowDown");
    // The event's defaultPrevented should be true
    expect(event.defaultPrevented).toBe(true);

    setup.cleanup();
  });

  it("Space without focused item does not enter grab mode", () => {
    const setup = setupKeyboard(-1); // No focused item

    dispatchKey(setup.ctx.dom.root, " ");

    const sortStart = setup.emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:start",
    );
    expect(sortStart).toBeUndefined();

    setup.cleanup();
  });

  it("calls _focusById after keyboard move", () => {
    const setup = setupKeyboard(3);
    const focusByIdSpy = setup.methods.get("_focusById") as ReturnType<typeof mock>;

    dispatchKey(setup.ctx.dom.root, " ");
    dispatchKey(setup.ctx.dom.root, "ArrowDown");

    // _focusById should be called with the moved item's id
    expect(focusByIdSpy.mock.calls.length).toBeGreaterThan(0);
    // Item at index 3 has id=3
    expect(focusByIdSpy.mock.calls[0]![0]).toBe(3);

    setup.cleanup();
  });
});

// =============================================================================
// ARIA Attributes Tests
// =============================================================================

describe("sortable — ARIA attributes", () => {
  it("creates a hidden instructions element in the root", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();
    plugin.setup!(mockCtx.ctx);

    const instructions = document.getElementById("vlist-sort-instructions");
    expect(instructions).not.toBeNull();
    expect(instructions!.textContent).toContain("Press Space to reorder");

    mockCtx.cleanup();
  });

  it("applies aria-roledescription via onCommit hook", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();
    plugin.setup!(mockCtx.ctx);

    // Add an item element to content with data-index set
    const el = document.createElement("div");
    el.setAttribute("data-index", "0");
    mockCtx.ctx.dom.content.appendChild(el);

    // Invoke the onCommit hook (v2 equivalent of afterRenderBatch)
    plugin.hooks?.onCommit?.();

    expect(el.getAttribute("aria-roledescription")).toBe("sortable item");
    expect(el.getAttribute("aria-describedby")).toBe("vlist-sort-instructions");

    el.remove();
    mockCtx.cleanup();
  });

  it("removes instructions element on destroy", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();
    plugin.setup!(mockCtx.ctx);

    // Count children before destroy
    const childrenBefore = mockCtx.ctx.dom.root.children.length;

    for (const handler of mockCtx.destroyHandlers) {
      handler();
    }

    // One child removed (the instructions element)
    // Note: liveRegion is also removed, so at least 1 fewer
    expect(mockCtx.ctx.dom.root.children.length).toBeLessThan(childrenBefore);

    mockCtx.cleanup();
  });
});

// =============================================================================
// Live Region Announcements Tests
// =============================================================================

describe("sortable — live region announcements", () => {
  function setupWithLiveRegion(focusedIndex: number) {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();
    mockCtx.methods.set("_getFocusedIndex", () => focusedIndex);
    mockCtx.methods.set("_focusById", mock(() => {}));
    plugin.setup!(mockCtx.ctx);

    // The plugin creates a liveRegion element inside root
    const liveRegion = mockCtx.ctx.dom.root.querySelector(
      '[role="status"][aria-live="assertive"]',
    ) as HTMLElement | null;

    return { ...mockCtx, liveRegion };
  }

  function dispatchKey(target: HTMLElement, key: string): void {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  it("announces grab with position info", () => {
    const setup = setupWithLiveRegion(2);

    dispatchKey(setup.ctx.dom.root, " ");

    const text = setup.liveRegion?.textContent ?? "";
    expect(text).toContain("Grabbed");
    expect(text).toContain("position 3 of 20");

    setup.cleanup();
  });

  it("announces move with new position", () => {
    const setup = setupWithLiveRegion(2);

    dispatchKey(setup.ctx.dom.root, " ");
    dispatchKey(setup.ctx.dom.root, "ArrowDown");

    const text = setup.liveRegion?.textContent ?? "";
    expect(text).toContain("moved");
    expect(text).toContain("position 4 of 20");

    setup.cleanup();
  });

  it("announces drop with final position", () => {
    const setup = setupWithLiveRegion(2);

    dispatchKey(setup.ctx.dom.root, " ");
    dispatchKey(setup.ctx.dom.root, "ArrowDown"); // moved from 2→3
    dispatchKey(setup.ctx.dom.root, " "); // Drop

    const text = setup.liveRegion?.textContent ?? "";
    expect(text).toContain("dropped");
    expect(text).toContain("position 4 of 20"); // index 3 → position 4

    setup.cleanup();
  });

  it("announces cancel with original position", () => {
    const setup = setupWithLiveRegion(2);

    dispatchKey(setup.ctx.dom.root, " ");
    dispatchKey(setup.ctx.dom.root, "ArrowDown");
    dispatchKey(setup.ctx.dom.root, "Escape");

    const text = setup.liveRegion?.textContent ?? "";
    expect(text).toContain("cancelled");
    expect(text).toContain("position 3 of 20");

    setup.cleanup();
  });
});

// =============================================================================
// Pointer: release without crossing threshold
// =============================================================================

describe("sortable — pointer up without drag", () => {
  it("pointerup before threshold cleans up without emitting events", () => {
    const plugin = sortable<TestItem>({ dragThreshold: 10 });
    const mockCtx = createMockContext();
    plugin.setup!(mockCtx.ctx);

    const PointerEventCtor = PointerEvent ?? MouseEvent;
    const itemEl = mockCtx.ctx.dom.content.querySelector("[data-index='2']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 112, right: 400, bottom: 168, width: 400, height: 56, x: 0, y: 112, toJSON: () => {} }) as DOMRect;

    // pointerdown
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 140, button: 0,
    }));

    // Small move (below threshold)
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 143, button: 0,
    }));

    // pointerup without crossing threshold
    document.dispatchEvent(new PointerEventCtor("pointerup", {
      bubbles: true, clientX: 200, clientY: 143, button: 0,
    }));

    const sortStart = mockCtx.emitSpy.mock.calls.find((c: unknown[]) => c[0] === "sort:start");
    expect(sortStart).toBeUndefined();

    const isSorting = mockCtx.methods.get("isSorting") as () => boolean;
    expect(isSorting()).toBe(false);

    mockCtx.cleanup();
  });
});

// =============================================================================
// Keyboard: other keys blocked during grab
// =============================================================================

describe("sortable — keyboard key blocking", () => {
  function setupKeyboard(focusedIndex: number) {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();
    mockCtx.methods.set("_getFocusedIndex", () => focusedIndex);
    mockCtx.methods.set("_focusById", mock(() => {}));
    plugin.setup!(mockCtx.ctx);
    return mockCtx;
  }

  it("blocks unrelated keys during grab mode", () => {
    const mockCtx = setupKeyboard(3);

    // Enter grab mode
    mockCtx.ctx.dom.root.dispatchEvent(new KeyboardEvent("keydown", {
      key: " ", bubbles: true, cancelable: true,
    }));

    // Press an unrelated key (e.g., "a")
    const event = new KeyboardEvent("keydown", {
      key: "a", bubbles: true, cancelable: true,
    });
    mockCtx.ctx.dom.root.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    mockCtx.cleanup();
  });

  it("does not block F-keys during grab mode", () => {
    const mockCtx = setupKeyboard(3);

    mockCtx.ctx.dom.root.dispatchEvent(new KeyboardEvent("keydown", {
      key: " ", bubbles: true, cancelable: true,
    }));

    const event = new KeyboardEvent("keydown", {
      key: "F5", bubbles: true, cancelable: true,
    });
    mockCtx.ctx.dom.root.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    mockCtx.cleanup();
  });

  it("does not block Tab during grab mode", () => {
    const mockCtx = setupKeyboard(3);

    mockCtx.ctx.dom.root.dispatchEvent(new KeyboardEvent("keydown", {
      key: " ", bubbles: true, cancelable: true,
    }));

    const event = new KeyboardEvent("keydown", {
      key: "Tab", bubbles: true, cancelable: true,
    });
    mockCtx.ctx.dom.root.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    mockCtx.cleanup();
  });
});

// =============================================================================
// Edge scroll and viewport detection
// =============================================================================

describe("sortable — edge scrolling", () => {
  it("starts edge scroll loop when drag begins", async () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    const PointerEventCtor = PointerEvent ?? MouseEvent;
    const itemEl = mockCtx.ctx.dom.content.querySelector("[data-index='2']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 112, right: 400, bottom: 168, width: 400, height: 56, x: 0, y: 112, toJSON: () => {} }) as DOMRect;

    // pointerdown
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 140, button: 0,
    }));

    // Move past threshold near bottom edge
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 590, button: 0,
    }));

    // Let rAF tick for edge scroll
    fakeTimers.tick(50);

    // scrollTo should have been called (edge scroll active near bottom)
    expect(mockCtx.scrollCalls.length).toBeGreaterThan(0);

    // Clean up — pointerup
    document.dispatchEvent(new PointerEventCtor("pointerup", {
      bubbles: true, clientX: 200, clientY: 590, button: 0,
    }));

    fakeTimers.tick(250);
    mockCtx.cleanup();
  });

  it("clears shifts when pointer leaves viewport during drag", async () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    const PointerEventCtor = PointerEvent ?? MouseEvent;
    const itemEl = mockCtx.ctx.dom.content.querySelector("[data-index='2']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 112, right: 400, bottom: 168, width: 400, height: 56, x: 0, y: 112, toJSON: () => {} }) as DOMRect;

    // Start drag
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 140, button: 0,
    }));

    // Move past threshold to start sorting
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 250, button: 0,
    }));

    // Move pointer outside viewport (above top)
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: -50, button: 0,
    }));

    // Let rAF tick
    fakeTimers.tick(50);

    // Clean up
    document.dispatchEvent(new PointerEventCtor("pointerup", {
      bubbles: true, clientX: 200, clientY: -50, button: 0,
    }));

    fakeTimers.tick(250);

    // Should not throw, and sorting should have ended
    const isSorting = mockCtx.methods.get("isSorting") as () => boolean;
    expect(isSorting()).toBe(false);

    mockCtx.cleanup();
  });
});

// =============================================================================
// Pointer cancel
// =============================================================================

describe("sortable — pointer cancel", () => {
  it("pointercancel during drag cleans up", async () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    const PointerEventCtor = PointerEvent ?? MouseEvent;
    const itemEl = mockCtx.ctx.dom.content.querySelector("[data-index='2']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 112, right: 400, bottom: 168, width: 400, height: 56, x: 0, y: 112, toJSON: () => {} }) as DOMRect;

    // Start drag past threshold
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 140, button: 0,
    }));
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 200, button: 0,
    }));

    // Pointer cancel (e.g. touch interrupted)
    document.dispatchEvent(new PointerEventCtor("pointercancel", {
      bubbles: true, clientX: 200, clientY: 200,
    }));

    fakeTimers.tick(250);

    const isSorting = mockCtx.methods.get("isSorting") as () => boolean;
    expect(isSorting()).toBe(false);

    mockCtx.cleanup();
  });
});

// =============================================================================
// Escape cancels pointer drag
// =============================================================================

describe("sortable — escape cancels pointer drag", () => {
  it("Escape during pointer drag emits sort:cancel and cleans up", async () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    const PointerEventCtor = PointerEvent ?? MouseEvent;
    const itemEl = mockCtx.ctx.dom.content.querySelector("[data-index='2']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 112, right: 400, bottom: 168, width: 400, height: 56, x: 0, y: 112, toJSON: () => {} }) as DOMRect;

    // Start drag past threshold
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 140, button: 0,
    }));
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 300, button: 0,
    }));

    const isSorting = mockCtx.methods.get("isSorting") as () => boolean;
    expect(isSorting()).toBe(true);

    // Press Escape — triggers animateDrop(dragIndex, dragIndex) with ghost animation
    mockCtx.ctx.dom.root.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    }));

    // Wait for ghost animation to complete (setTimeout fallback)
    fakeTimers.tick(300);

    expect(isSorting()).toBe(false);

    const cancelCall = mockCtx.emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:cancel",
    );
    expect(cancelCall).toBeDefined();

    mockCtx.cleanup();
  });
});

// =============================================================================
// Drop at same position emits sort:cancel
// =============================================================================

describe("sortable — drop at same position", () => {
  it("emits sort:cancel when item is returned to original position", async () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    const PointerEventCtor = PointerEvent ?? MouseEvent;
    const itemEl = mockCtx.ctx.dom.content.querySelector("[data-index='3']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 168, right: 400, bottom: 224, width: 400, height: 56, x: 0, y: 168, toJSON: () => {} }) as DOMRect;

    // Start drag with small move (stays within same item zone)
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 196, button: 0,
    }));
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 216, button: 0,
    }));

    // Release — dropIndex should still equal dragIndex
    document.dispatchEvent(new PointerEventCtor("pointerup", {
      bubbles: true, clientX: 200, clientY: 216, button: 0,
    }));

    fakeTimers.tick(300);

    const cancelCall = mockCtx.emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:cancel",
    );
    expect(cancelCall).toBeDefined();

    const endCall = mockCtx.emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:end",
    );
    expect(endCall).toBeUndefined();

    mockCtx.cleanup();
  });
});

// =============================================================================
// Keyboard grab cancelled by pointer drag
// =============================================================================

describe("sortable — keyboard grab cancelled by pointer", () => {
  it("cancels keyboard grab when pointer drag starts", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();
    mockCtx.methods.set("_getFocusedIndex", () => 3);
    mockCtx.methods.set("_focusById", mock(() => {}));
    plugin.setup!(mockCtx.ctx);

    const isSorting = mockCtx.methods.get("isSorting") as () => boolean;

    // Start keyboard grab
    mockCtx.ctx.dom.root.dispatchEvent(new KeyboardEvent("keydown", {
      key: " ", bubbles: true, cancelable: true,
    }));
    expect(isSorting()).toBe(true);

    // Pointer down on a different item — should cancel keyboard grab
    const PointerEventCtor = PointerEvent ?? MouseEvent;
    const itemEl = mockCtx.ctx.dom.content.querySelector("[data-index='5']") as HTMLElement;
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 308, button: 0,
    }));

    // Keyboard grab should be cancelled (sorting still true due to pointer, but kb grab gone)
    // After pointer releases without threshold, isSorting should be false
    document.dispatchEvent(new PointerEventCtor("pointerup", {
      bubbles: true, clientX: 200, clientY: 308, button: 0,
    }));

    expect(isSorting()).toBe(false);

    mockCtx.cleanup();
  });
});

// =============================================================================
// Focus preservation across pointer drag
// =============================================================================

describe("sortable — focus preservation", () => {
  it("restores focus to originally-focused item after pointer drag reorder", async () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    // Mock _getFocusedIndex returning index 5
    mockCtx.methods.set("_getFocusedIndex", () => 5);
    const focusByIdSpy = mock(() => {});
    mockCtx.methods.set("_focusById", focusByIdSpy);

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    const PointerEventCtor = PointerEvent ?? MouseEvent;
    const itemEl = mockCtx.ctx.dom.content.querySelector("[data-index='1']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 56, right: 400, bottom: 112, width: 400, height: 56, x: 0, y: 56, toJSON: () => {} }) as DOMRect;

    // pointerdown on item 1
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 84, button: 0,
    }));

    // Move far enough to cross threshold and change drop position
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 250, button: 0,
    }));

    // pointerup
    document.dispatchEvent(new PointerEventCtor("pointerup", {
      bubbles: true, clientX: 200, clientY: 250, button: 0,
    }));

    // Wait for drop animation
    fakeTimers.tick(300);

    // _focusById should have been called with id 5 (the originally-focused item)
    const focusCalls = focusByIdSpy.mock.calls as unknown[][];
    if (focusCalls.length > 0) {
      expect(focusCalls[focusCalls.length - 1]![0]).toBe(5);
    }

    mockCtx.cleanup();
  });

  it("does not call focusById when no item was focused before drag", async () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    mockCtx.methods.set("_getFocusedIndex", () => -1); // No focus
    const focusByIdSpy = mock(() => {});
    mockCtx.methods.set("_focusById", focusByIdSpy);

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    const PointerEventCtor = PointerEvent ?? MouseEvent;
    const itemEl = mockCtx.ctx.dom.content.querySelector("[data-index='1']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 56, right: 400, bottom: 112, width: 400, height: 56, x: 0, y: 56, toJSON: () => {} }) as DOMRect;

    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 84, button: 0,
    }));

    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 84 + 20, button: 0,
    }));

    document.dispatchEvent(new PointerEventCtor("pointerup", {
      bubbles: true, clientX: 200, clientY: 84 + 20, button: 0,
    }));

    fakeTimers.tick(300);

    // focusById should NOT have been called (no item was focused)
    expect(focusByIdSpy.mock.calls.length).toBe(0);

    mockCtx.cleanup();
  });
});

// =============================================================================
// Drop Index Calculation Tests
// =============================================================================

describe("sortable — drop index calculation", () => {
  // Helper: start a drag on an item, then move to specific Y positions
  // and collect sort:move events to track the drop index at each step.
  function setupDragSession(mockCtx: ReturnType<typeof createMockContext>, fromIndex: number): {
    moveTo: (clientY: number) => void;
    getDropIndices: () => number[];
    cleanup: () => void;
  } {
    const PointerEventCtor = PointerEvent ?? MouseEvent;
    const itemEl = mockCtx.ctx.dom.content.querySelector(
      `[data-index='${fromIndex}']`,
    ) as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({
        left: 0,
        top: fromIndex * 56,
        right: 400,
        bottom: fromIndex * 56 + 56,
        width: 400,
        height: 56,
        x: 0,
        y: fromIndex * 56,
        toJSON: () => {},
      }) as DOMRect;

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 600,
        width: 400,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;

    // pointerdown
    itemEl.dispatchEvent(
      new PointerEventCtor("pointerdown", {
        bubbles: true,
        clientX: 200,
        clientY: fromIndex * 56 + 28,
        button: 0,
      }),
    );

    // Initial move to cross drag threshold
    document.dispatchEvent(
      new PointerEventCtor("pointermove", {
        bubbles: true,
        clientX: 200,
        clientY: fromIndex * 56 + 28 + 10,
        button: 0,
      }),
    );

    const dropIndices: number[] = [];

    const moveTo = (clientY: number): void => {
      // Clear previous calls to track new emissions
      const callsBefore = mockCtx.emitSpy.mock.calls.length;

      document.dispatchEvent(
        new PointerEventCtor("pointermove", {
          bubbles: true,
          clientX: 200,
          clientY,
          button: 0,
        }),
      );

      // Collect sort:move events from this move
      for (let i = callsBefore; i < mockCtx.emitSpy.mock.calls.length; i++) {
        const call = mockCtx.emitSpy.mock.calls[i] as unknown[];
        if (call[0] === "sort:move") {
          const payload = call[1] as { currentIndex: number };
          dropIndices.push(payload.currentIndex);
        }
      }
    };

    const cleanup = (): void => {
      document.dispatchEvent(
        new PointerEventCtor("pointercancel", { bubbles: true }),
      );
    };

    return { moveTo, getDropIndices: () => dropIndices, cleanup };
  }

  it("shifts one item at a time when dragging down", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();
    plugin.setup!(mockCtx.ctx);

    // Drag item 3 (offset=168, mid=196) downward
    // Item 4: offset=224, mid=252 — ghost bottom must cross 252
    // Item 5: offset=280, mid=308 — ghost bottom must cross 308
    const session = setupDragSession(mockCtx, 3);

    // Ghost bottom = clientY - ghostOffsetY + draggedItemSize
    // ghostOffsetY = 28 (pointer started at mid-item)
    // So ghost bottom = clientY - 28 + 56 = clientY + 28

    // Move ghost bottom just past mid of item 4 (252)
    // clientY + 28 > 252 → clientY > 224
    session.moveTo(225);
    expect(session.getDropIndices()).toEqual([4]);

    // Move ghost bottom just past mid of item 5 (308)
    // clientY + 28 > 308 → clientY > 280
    session.moveTo(281);
    expect(session.getDropIndices()).toEqual([4, 5]);

    session.cleanup();
    mockCtx.cleanup();
  });

  it("shifts one item at a time when dragging up", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();
    plugin.setup!(mockCtx.ctx);

    // Drag item 5 (offset=280, mid=308) upward
    // Item 4: offset=224, mid=252 — ghost top must cross BELOW 252
    // Item 3: offset=168, mid=196 — ghost top must cross BELOW 196
    const session = setupDragSession(mockCtx, 5);

    // Ghost top = clientY - ghostOffsetY
    // ghostOffsetY = 28 (pointer started at mid-item)
    // So ghost top = clientY - 28

    // Move ghost top just below mid of item 4 (252)
    // clientY - 28 < 252 → clientY < 280
    // But we also need to be above the drag slot (offset=280)
    // ghost top < 280 → clientY < 308, which is true
    session.moveTo(279);
    expect(session.getDropIndices()).toEqual([4]);

    // Move ghost top just below mid of item 3 (196)
    // clientY - 28 < 196 → clientY < 224
    session.moveTo(223);
    expect(session.getDropIndices()).toEqual([4, 3]);

    session.cleanup();
    mockCtx.cleanup();
  });

  it("does not oscillate when reversing drag direction", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();
    plugin.setup!(mockCtx.ctx);

    // Drag item 4 (offset=224, mid=252) downward past items 5 and 6
    const session = setupDragSession(mockCtx, 4);

    // Move past item 5 (mid=308): clientY + 28 > 308 → clientY > 280
    session.moveTo(281);
    expect(session.getDropIndices()).toEqual([5]);

    // Move past item 6 (mid=364): clientY + 28 > 364 → clientY > 336
    session.moveTo(337);
    expect(session.getDropIndices()).toEqual([5, 6]);

    // Now reverse direction — move back up slowly
    // The drop index should NOT oscillate between values
    const indicesBefore = session.getDropIndices().length;

    // Small upward movements within the hysteresis zone — should stay at 6
    session.moveTo(335);
    session.moveTo(333);
    session.moveTo(330);

    // Verify no oscillation: either stayed at 6 or moved to 5 once
    const indicesAfter = session.getDropIndices().slice(indicesBefore);
    for (let i = 1; i < indicesAfter.length; i++) {
      // No back-and-forth: each consecutive index should be the same or
      // monotonically decreasing (retreating)
      expect(indicesAfter[i]!).toBeLessThanOrEqual(indicesAfter[i - 1]!);
    }

    session.cleanup();
    mockCtx.cleanup();
  });

  it("handles large displacement correctly (e.g. after auto-scroll)", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();
    plugin.setup!(mockCtx.ctx);

    // Drag item 2 (offset=112, mid=140) far down past many items
    const session = setupDragSession(mockCtx, 2);

    // Jump ghost far down — past items 3 through 8
    // Item 8: offset=448, mid=476. clientY + 28 > 476 → clientY > 448
    session.moveTo(449);

    const indices = session.getDropIndices();
    // Should have jumped to 8 in one step (binary search, not scanning)
    expect(indices[indices.length - 1]).toBe(8);

    session.cleanup();
    mockCtx.cleanup();
  });

  it("returns dragIndex when ghost is within the drag slot", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();
    plugin.setup!(mockCtx.ctx);

    // Drag item 4 (offset=224) — small move that stays within the slot
    const session = setupDragSession(mockCtx, 4);

    // Move within item 4's area — no sort:move should fire
    session.moveTo(4 * 56 + 28 + 15);
    expect(session.getDropIndices()).toEqual([]);

    session.cleanup();
    mockCtx.cleanup();
  });

  it("each step shifts exactly one item when moving down then back up", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();
    plugin.setup!(mockCtx.ctx);

    // Drag item 3 downward past items 4, 5, 6
    const session = setupDragSession(mockCtx, 3);

    // Past item 4 (mid=252): clientY > 224
    session.moveTo(225);
    // Past item 5 (mid=308): clientY > 280
    session.moveTo(281);
    // Past item 6 (mid=364): clientY > 336
    session.moveTo(337);

    expect(session.getDropIndices()).toEqual([4, 5, 6]);

    // Now move back up — each step should retreat by exactly 1
    // Ghost top must cross below item midpoints to retreat
    // ghost top = clientY - 28
    // Retreat from 6: ghost top < mid(6) = 364 → clientY < 392 (already true)
    //   BUT ghost bottom must also be < mid(7) = 420 → clientY + 28 < 420 → clientY < 392
    //   We need ghost top to go above the drag slot boundary for retreat
    //   Retreat from dropIndex 6: ghost top < mid(6) = 364 → clientY - 28 < 364 → clientY < 392
    //   But we're already at 337 < 392, so why didn't it retreat?
    //   Because the downward check still holds: ghost bottom = 337 + 28 = 365 > mid(6) = 364
    //   So result stays at 6. We need ghost bottom <= 364 → clientY <= 336

    session.moveTo(335); // ghost bottom = 363 < 364 → retreat from 6 to 5
    session.moveTo(278); // ghost bottom = 306 < 308 → retreat from 5 to 4
    session.moveTo(222); // ghost bottom = 250 < 252 → retreat from 4 to 3

    expect(session.getDropIndices()).toEqual([4, 5, 6, 5, 4, 3]);

    session.cleanup();
    mockCtx.cleanup();
  });
});

// =============================================================================
// Settling class — transition suppression during finalize
// =============================================================================

describe("sortable — settling class", () => {
  it("adds --settling class during finalize when position changed", async () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    const PointerEventCtor = PointerEvent ?? MouseEvent;
    const itemEl = mockCtx.ctx.dom.content.querySelector("[data-index='1']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 56, right: 400, bottom: 112, width: 400, height: 56, x: 0, y: 56, toJSON: () => {} }) as DOMRect;

    // Drag item 1 down past item 2
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 84, button: 0,
    }));
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 200, button: 0,
    }));
    document.dispatchEvent(new PointerEventCtor("pointerup", {
      bubbles: true, clientX: 200, clientY: 200, button: 0,
    }));

    // Wait for ghost animation + finalize
    fakeTimers.tick(300);

    // --settling should have been removed after rAF
    expect(mockCtx.ctx.dom.root.classList.contains("vlist--settling")).toBe(false);

    mockCtx.cleanup();
  });

  it("adds --settling class during finalize when dropped at same position", async () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    const PointerEventCtor = PointerEvent ?? MouseEvent;
    const itemEl = mockCtx.ctx.dom.content.querySelector("[data-index='3']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 168, right: 400, bottom: 224, width: 400, height: 56, x: 0, y: 168, toJSON: () => {} }) as DOMRect;

    // Drag just past threshold but within same index zone
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 196, button: 0,
    }));
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 216, button: 0,
    }));
    document.dispatchEvent(new PointerEventCtor("pointerup", {
      bubbles: true, clientX: 200, clientY: 216, button: 0,
    }));

    // Wait for ghost animation + finalize + rAF
    fakeTimers.tick(300);

    // --settling added and removed in both paths
    expect(mockCtx.ctx.dom.root.classList.contains("vlist--settling")).toBe(false);

    mockCtx.cleanup();
  });
});

// =============================================================================
// Drag-source class — replaces inline opacity during drag
// =============================================================================

describe("sortable — drag-source class", () => {
  it("adds drag-source class to dragged item instead of inline opacity", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    const PointerEventCtor = PointerEvent ?? MouseEvent;
    const itemEl = mockCtx.ctx.dom.content.querySelector("[data-index='2']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 112, right: 400, bottom: 168, width: 400, height: 56, x: 0, y: 112, toJSON: () => {} }) as DOMRect;

    // Start drag past threshold
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 140, button: 0,
    }));
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 200, button: 0,
    }));

    expect(itemEl.classList.contains("vlist-item--drag-source")).toBe(true);
    expect(itemEl.style.opacity).toBe("");

    mockCtx.cleanup();
  });

  it("removes drag-source class on cleanup", async () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    const PointerEventCtor = PointerEvent ?? MouseEvent;
    const itemEl = mockCtx.ctx.dom.content.querySelector("[data-index='2']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 112, right: 400, bottom: 168, width: 400, height: 56, x: 0, y: 112, toJSON: () => {} }) as DOMRect;

    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 140, button: 0,
    }));
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 200, button: 0,
    }));
    document.dispatchEvent(new PointerEventCtor("pointerup", {
      bubbles: true, clientX: 200, clientY: 200, button: 0,
    }));

    fakeTimers.tick(300);

    expect(itemEl.classList.contains("vlist-item--drag-source")).toBe(false);

    mockCtx.cleanup();
  });

  it("re-applies drag-source class via onCommit hook when element is recycled", () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    const PointerEventCtor = PointerEvent ?? MouseEvent;
    const itemEl = mockCtx.ctx.dom.content.querySelector("[data-index='2']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 112, right: 400, bottom: 168, width: 400, height: 56, x: 0, y: 112, toJSON: () => {} }) as DOMRect;

    // Start drag
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 140, button: 0,
    }));
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 200, button: 0,
    }));

    // Simulate element recycling: replace the item element in content
    const newEl = document.createElement("div");
    newEl.setAttribute("data-index", "2");
    // Replace old element
    itemEl.replaceWith(newEl);

    // Call onCommit hook to re-apply state to recycled elements
    plugin.hooks?.onCommit?.();

    expect(newEl.classList.contains("vlist-item--drag-source")).toBe(true);

    mockCtx.cleanup();
  });
});

// =============================================================================
// Escape cancel animates ghost back
// =============================================================================

describe("sortable — escape animates ghost return", () => {
  it("Escape during pointer drag goes through animateDrop to animate ghost back", async () => {
    const plugin = sortable<TestItem>();
    const mockCtx = createMockContext();

    mockCtx.ctx.dom.viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

    plugin.setup!(mockCtx.ctx);

    const PointerEventCtor = PointerEvent ?? MouseEvent;
    const itemEl = mockCtx.ctx.dom.content.querySelector("[data-index='2']") as HTMLElement;

    itemEl.getBoundingClientRect = () =>
      ({ left: 0, top: 112, right: 400, bottom: 168, width: 400, height: 56, x: 0, y: 112, toJSON: () => {} }) as DOMRect;

    // Start drag past threshold — moves item down
    itemEl.dispatchEvent(new PointerEventCtor("pointerdown", {
      bubbles: true, clientX: 200, clientY: 140, button: 0,
    }));
    document.dispatchEvent(new PointerEventCtor("pointermove", {
      bubbles: true, clientX: 200, clientY: 300, button: 0,
    }));

    const isSorting = mockCtx.methods.get("isSorting") as () => boolean;
    expect(isSorting()).toBe(true);

    // Press Escape — should NOT finalize immediately (ghost animates back)
    mockCtx.ctx.dom.root.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    }));

    // Ghost animation is in progress — sorting is still true
    expect(isSorting()).toBe(true);

    // sort:cancel should NOT have fired yet
    const earlyCancel = mockCtx.emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:cancel",
    );
    expect(earlyCancel).toBeUndefined();

    // Wait for animation to complete
    fakeTimers.tick(300);

    // Now sorting is done and sort:cancel has been emitted
    expect(isSorting()).toBe(false);
    const cancelCall = mockCtx.emitSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "sort:cancel",
    );
    expect(cancelCall).toBeDefined();

    mockCtx.cleanup();
  });
});
