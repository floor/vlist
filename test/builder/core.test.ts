/**
 * vlist - Builder Core Tests
 *
 * NOTE: The builder core (src/builder/core.ts) is extensively tested through
 * integration tests in builder/index.test.ts (233 tests, 531 assertions).
 * Those tests exercise the full vlist().use().build() pipeline covering:
 *
 * - Builder creation and configuration validation
 * - Feature registration and priority ordering
 * - .build() lifecycle (resolve config → create DOM → create components → run features → wire events)
 * - All built-in features (withSelection, withScrollbar, withAsync, withScale,
 *   withSnapshots, withGrid, withSections) and their combinations
 * - Reverse mode, horizontal mode, scroll config, keyboard navigation
 * - Template rendering, velocity-aware loading, sticky headers
 * - Grid scroll virtualization integration
 * - Destroy lifecycle and cleanup
 *
 * Coverage: 86.34% lines, 81.48% functions.
 * Uncovered lines are primarily error paths, compression branches,
 * and window mode paths that require a real browser environment.
 *
 * This file exists to maintain the 1:1 source↔test mapping convention.
 * Add unit tests here for core.ts internals not reachable through
 * the builder integration tests.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { vlist } from "../../src/builder/core";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;
let originalDocument: any;
let originalWindow: any;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  originalDocument = global.document;
  originalWindow = global.window;

  global.document = dom.window.document;
  global.window = dom.window as any;
  global.HTMLElement = dom.window.HTMLElement;

  global.ResizeObserver = class MockResizeObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: { width: 400, height: 600 } as DOMRectReadOnly,
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          },
        ] as any,
        this as any,
      );
    }
    unobserve() {}
    disconnect() {}
  } as any;

  if (!global.requestAnimationFrame) {
    global.requestAnimationFrame = (cb: FrameRequestCallback): number =>
      setTimeout(() => cb(performance.now()), 0) as unknown as number;
  }
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
});

// =============================================================================
// Smoke Tests
// =============================================================================

describe("builder/core.ts (see index.test.ts for full coverage)", () => {
  it("should export vlist builder function", () => {
    expect(typeof vlist).toBe("function");
  });

  it("should return a builder with use() and build() methods", () => {
    const builder = vlist({
      container: document.createElement("div"),
      item: {
        height: 40,
        template: () => "",
      },
    });

    expect(typeof builder.use).toBe("function");
    expect(typeof builder.build).toBe("function");
  });

  it("should support method chaining on use()", () => {
    const builder = vlist({
      container: document.createElement("div"),
      item: {
        height: 40,
        template: () => "",
      },
    });

    const result = builder.use({
      name: "testFeature",
      priority: 50,
      setup: () => {},
    });

    // use() returns the builder for chaining
    expect(typeof result.use).toBe("function");
    expect(typeof result.build).toBe("function");
  });
});