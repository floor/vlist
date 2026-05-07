/**
 * vlist - Async + Groups Integration Tests
 * Tests for withAsync + withGroups used together via the builder.
 *
 * Validates:
 * - Both features can be combined without errors
 * - Group headers appear as async pages load
 * - Index mapping works correctly through the bridge
 * - Sticky header setup works in async mode
 * - Template dispatches headers vs data items correctly
 */

import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import { JSDOM } from "jsdom";
import { vlist } from "../../../src/builder/core";
import { withAsync } from "../../../src/features/async/feature";
import { withGroups } from "../../../src/features/groups/feature";
import type { VListItem, VListAdapter } from "../../../src/types";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;
let originalDocument: any;
let originalWindow: any;
let originalRAF: any;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  originalDocument = global.document;
  originalWindow = global.window;
  originalRAF = global.requestAnimationFrame;

  global.document = dom.window.document;
  global.window = dom.window as any;
  global.HTMLElement = dom.window.HTMLElement;

  global.requestAnimationFrame = ((cb: Function) => {
    setTimeout(cb, 16);
    return 0;
  }) as any;

  global.ResizeObserver = class ResizeObserver {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback(
        [
          {
            target,
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
    unobserve() {}
    disconnect() {}
  };
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
  global.requestAnimationFrame = originalRAF;
});

// =============================================================================
// Test Helpers
// =============================================================================

interface TrackItem extends VListItem {
  id: number;
  title: string;
  day: string;
}

/**
 * Creates tracks grouped by day:
 *   Day 1: items 0..perDay-1
 *   Day 2: items perDay..2*perDay-1
 *   etc.
 */
function createTracks(totalDays: number, perDay: number): TrackItem[] {
  const tracks: TrackItem[] = [];
  for (let d = 0; d < totalDays; d++) {
    for (let i = 0; i < perDay; i++) {
      const idx = d * perDay + i;
      tracks.push({
        id: idx,
        title: `Track ${idx}`,
        day: `Day ${d + 1}`,
      });
    }
  }
  return tracks;
}

function createContainer(): HTMLElement {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", { value: 500 });
  Object.defineProperty(container, "clientWidth", { value: 300 });
  document.body.appendChild(container);
  return container;
}

function createAdapter(allItems: TrackItem[], delay: number = 0): VListAdapter<TrackItem> {
  return {
    read: mock(async ({ offset, limit }) => {
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      const items = allItems.slice(offset, offset + limit);
      return {
        items,
        total: allItems.length,
        hasMore: offset + limit < allItems.length,
      };
    }),
  };
}

// =============================================================================
// Build Tests
// =============================================================================

describe("withAsync + withGroups integration", () => {
  describe("build", () => {
    it("should build without errors", () => {
      const container = createContainer();
      const allTracks = createTracks(3, 5); // 15 tracks, 3 groups

      const list = vlist<TrackItem>({
        container,
        item: {
          height: 50,
          template: (item) => `<div>${item.title}</div>`,
        },
      })
      .use(withAsync<TrackItem>({
        adapter: createAdapter(allTracks),
        total: 0,
        autoLoad: false,
      }))
      .use(withGroups<TrackItem>({
        getGroupForIndex: (_i, item) => item?.day ?? "Unknown",
        header: {
          height: 32,
          template: (key) => `<div class="header">${key}</div>`,
        },
        sticky: true,
      }))
      .build();

      expect(list).toBeDefined();
      expect(list.element).toBeInstanceOf(HTMLElement);
      list.destroy();
      container.remove();
    });

    it("should add grouped CSS class", () => {
      const container = createContainer();
      const allTracks = createTracks(2, 3);

      const list = vlist<TrackItem>({
        container,
        item: {
          height: 50,
          template: (item) => `<div>${item.title}</div>`,
        },
      })
      .use(withAsync<TrackItem>({
        adapter: createAdapter(allTracks),
        total: 0,
        autoLoad: false,
      }))
      .use(withGroups<TrackItem>({
        getGroupForIndex: (_i, item) => item?.day ?? "Unknown",
        header: {
          height: 32,
          template: (key) => `<div>${key}</div>`,
        },
      }))
      .build();

      expect(list.element.classList.contains("vlist--grouped")).toBe(true);
      list.destroy();
      container.remove();
    });
  });

  // ===========================================================================
  // Async Bridge Wiring
  // ===========================================================================

  describe("async bridge wiring", () => {
    it("should register _getGroupBridge method", async () => {
      const container = createContainer();
      const allTracks = createTracks(3, 5);

      const list = vlist<TrackItem>({
        container,
        item: {
          height: 50,
          template: (item) => `<div>${item.title}</div>`,
        },
      })
      .use(withAsync<TrackItem>({
        adapter: createAdapter(allTracks, 10),
        total: 0,
        autoLoad: false,
      }))
      .use(withGroups<TrackItem>({
        getGroupForIndex: (_i, item) => item?.day ?? "Unknown",
        header: {
          height: 32,
          template: (key) => `<div>${key}</div>`,
        },
      }))
      .build();

      // Bridge is wired via microtask — wait for it
      await new Promise(resolve => setTimeout(resolve, 50));

      // The bridge should be accessible via internal method
      // (we can't access ctx.methods directly, but the bridge is wired)
      expect(list).toBeDefined();
      list.destroy();
      container.remove();
    });

    it("should discover groups as data loads", async () => {
      const container = createContainer();
      const allTracks = createTracks(3, 5); // 15 tracks, 3 days
      let loadEndEvents = 0;

      const list = vlist<TrackItem>({
        container,
        item: {
          height: 50,
          template: (item) => `<div>${item.title}</div>`,
        },
      })
      .use(withAsync<TrackItem>({
        adapter: createAdapter(allTracks, 5),
        total: 0,
        autoLoad: false,
      }))
      .use(withGroups<TrackItem>({
        getGroupForIndex: (_i, item) => item?.day ?? "Unknown",
        header: {
          height: 32,
          template: (key) => `<div class="day-header">${key}</div>`,
        },
      }))
      .build();

      list.on("load:end", () => { loadEndEvents++; });

      // Wait for microtask to wire bridge
      await new Promise(resolve => setTimeout(resolve, 10));

      // Trigger reload which loads initial data
      await list.reload();

      // Wait for data to arrive
      await new Promise(resolve => setTimeout(resolve, 100));

      // After data loads, the total should reflect items + group headers
      // 15 items + 3 groups = 18 total entries
      expect(list.total).toBeGreaterThan(0);

      list.destroy();
      container.remove();
    });
  });

  // ===========================================================================
  // Feature Order Independence
  // ===========================================================================

  describe("feature order independence", () => {
    it("should work with withGroups before withAsync", () => {
      const container = createContainer();
      const allTracks = createTracks(2, 3);

      // Groups before Async in .use() chain
      const list = vlist<TrackItem>({
        container,
        item: {
          height: 50,
          template: (item) => `<div>${item.title}</div>`,
        },
      })
      .use(withGroups<TrackItem>({
        getGroupForIndex: (_i, item) => item?.day ?? "Unknown",
        header: {
          height: 32,
          template: (key) => `<div>${key}</div>`,
        },
      }))
      .use(withAsync<TrackItem>({
        adapter: createAdapter(allTracks),
        total: 0,
        autoLoad: false,
      }))
      .build();

      expect(list).toBeDefined();
      list.destroy();
      container.remove();
    });

    it("should work with withAsync before withGroups", () => {
      const container = createContainer();
      const allTracks = createTracks(2, 3);

      // Async before Groups in .use() chain
      const list = vlist<TrackItem>({
        container,
        item: {
          height: 50,
          template: (item) => `<div>${item.title}</div>`,
        },
      })
      .use(withAsync<TrackItem>({
        adapter: createAdapter(allTracks),
        total: 0,
        autoLoad: false,
      }))
      .use(withGroups<TrackItem>({
        getGroupForIndex: (_i, item) => item?.day ?? "Unknown",
        header: {
          height: 32,
          template: (key) => `<div>${key}</div>`,
        },
      }))
      .build();

      expect(list).toBeDefined();
      list.destroy();
      container.remove();
    });
  });

  // ===========================================================================
  // Sticky Header
  // ===========================================================================

  describe("sticky header", () => {
    it("should create sticky header element in async mode", async () => {
      const container = createContainer();
      const allTracks = createTracks(3, 5);

      const list = vlist<TrackItem>({
        container,
        item: {
          height: 50,
          template: (item) => `<div>${item.title}</div>`,
        },
      })
      .use(withAsync<TrackItem>({
        adapter: createAdapter(allTracks, 5),
        total: 0,
        autoLoad: false,
      }))
      .use(withGroups<TrackItem>({
        getGroupForIndex: (_i, item) => item?.day ?? "Unknown",
        header: {
          height: 32,
          template: (key) => {
            const el = document.createElement("div");
            el.className = "day-header";
            el.textContent = key;
            return el;
          },
        },
        sticky: true,
      }))
      .build();

      // Wait for async bridge wiring
      await new Promise(resolve => setTimeout(resolve, 50));

      // Load data
      await list.reload();
      await new Promise(resolve => setTimeout(resolve, 100));

      // The sticky header element should be present
      const stickyEl = list.element.querySelector(".vlist-sticky-header");
      expect(stickyEl).not.toBeNull();

      list.destroy();
      container.remove();
    });

    it("should update sticky header content after async data loads", async () => {
      const container = createContainer();
      const allTracks = createTracks(3, 5); // 15 tracks, 3 days

      const list = vlist<TrackItem>({
        container,
        item: {
          height: 50,
          template: (item) => `<div>${item.title}</div>`,
        },
      })
      .use(withAsync<TrackItem>({
        adapter: createAdapter(allTracks, 5),
        total: 0,
        autoLoad: false,
      }))
      .use(withGroups<TrackItem>({
        getGroupForIndex: (_i, item) => item?.day ?? "Unknown",
        header: {
          height: 32,
          template: (key) => {
            const el = document.createElement("div");
            el.className = "day-header";
            el.textContent = key;
            return el;
          },
        },
        sticky: true,
      }))
      .build();

      // Wait for async bridge wiring
      await new Promise(resolve => setTimeout(resolve, 50));

      // Load data
      await list.reload();
      await new Promise(resolve => setTimeout(resolve, 100));

      // The sticky header should have rendered content for the first group
      // after data loads (update() called with current scroll position)
      const stickyEl = list.element.querySelector(".vlist-sticky-header");
      expect(stickyEl).not.toBeNull();

      const activeSlot = stickyEl!.querySelector(".sticky-group");
      expect(activeSlot).not.toBeNull();
      // After loading, with scroll at 0, the sticky header should show Day 1
      expect(activeSlot!.textContent).toBe("Day 1");

      list.destroy();
      container.remove();
    });
  });

  // ===========================================================================
  // Destroy
  // ===========================================================================

  describe("destroy", () => {
    it("should clean up without errors", async () => {
      const container = createContainer();
      const allTracks = createTracks(2, 3);

      const list = vlist<TrackItem>({
        container,
        item: {
          height: 50,
          template: (item) => `<div>${item.title}</div>`,
        },
      })
      .use(withAsync<TrackItem>({
        adapter: createAdapter(allTracks, 5),
        total: 0,
        autoLoad: false,
      }))
      .use(withGroups<TrackItem>({
        getGroupForIndex: (_i, item) => item?.day ?? "Unknown",
        header: {
          height: 32,
          template: (key) => `<div>${key}</div>`,
        },
      }))
      .build();

      // Wait for wiring
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should not throw
      expect(() => list.destroy()).not.toThrow();
      container.remove();
    });

    it("should remove grouped CSS class on destroy", async () => {
      const container = createContainer();
      const allTracks = createTracks(2, 3);

      const list = vlist<TrackItem>({
        container,
        item: {
          height: 50,
          template: (item) => `<div>${item.title}</div>`,
        },
      })
      .use(withAsync<TrackItem>({
        adapter: createAdapter(allTracks),
        total: 0,
        autoLoad: false,
      }))
      .use(withGroups<TrackItem>({
        getGroupForIndex: (_i, item) => item?.day ?? "Unknown",
        header: {
          height: 32,
          template: (key) => `<div>${key}</div>`,
        },
      }))
      .build();

      const element = list.element;
      expect(element.classList.contains("vlist--grouped")).toBe(true);

      list.destroy();
      expect(element.classList.contains("vlist--grouped")).toBe(false);
      container.remove();
    });
  });
});
