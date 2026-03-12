/**
 * vlist/test/helpers — Shared DOM Setup
 *
 * Centralises the JSDOM environment bootstrap and MockResizeObserver that
 * is duplicated across 20+ test files.  Import `setupDOM` / `teardownDOM`
 * in your `beforeAll` / `afterAll` hooks.
 *
 * Usage:
 *   import { setupDOM, teardownDOM } from "../helpers/dom";
 *   beforeAll(() => setupDOM());
 *   afterAll(() => teardownDOM());
 */

import { JSDOM } from "jsdom";

// =============================================================================
// Saved originals — restored by teardownDOM()
// =============================================================================

let dom: JSDOM;
let origDocument: typeof globalThis.document;
let origWindow: typeof globalThis.window;
let origHTMLElement: typeof globalThis.HTMLElement;
let origElement: typeof globalThis.Element | undefined;
let origMouseEvent: typeof globalThis.MouseEvent | undefined;
let origKeyboardEvent: typeof globalThis.KeyboardEvent | undefined;
let origResizeObserver: typeof globalThis.ResizeObserver | undefined;
let origRAF: typeof globalThis.requestAnimationFrame | undefined;
let origCAF: typeof globalThis.cancelAnimationFrame | undefined;

// =============================================================================
// MockResizeObserver
// =============================================================================

export interface MockResizeObserverInstance extends ResizeObserver {
  /** The callback passed to the constructor */
  readonly callback: ResizeObserverCallback;
}

/**
 * Create a MockResizeObserver class.
 *
 * By default, `observe()` immediately fires the callback with the given
 * `width` and `height`.  Pass `{ immediate: false }` to suppress automatic
 * invocation (useful when you want to trigger resize manually).
 */
export const createMockResizeObserver = (
  opts: { width?: number; height?: number; immediate?: boolean } = {},
) => {
  const { width = 300, height = 500, immediate = true } = opts;

  return class MockResizeObserver implements ResizeObserver {
    readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element): void {
      if (!immediate) return;
      this.callback(
        [
          {
            target,
            contentRect: {
              width,
              height,
              top: 0,
              left: 0,
              bottom: height,
              right: width,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            } as DOMRectReadOnly,
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          } as ResizeObserverEntry,
        ],
        this,
      );
    }
    unobserve(_target: Element): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
};

// =============================================================================
// Setup / Teardown
// =============================================================================

export interface SetupDOMOptions {
  /** Width reported by MockResizeObserver (default 300) */
  width?: number;
  /** Height reported by MockResizeObserver (default 500) */
  height?: number;
  /** Whether MockResizeObserver fires immediately on observe (default true) */
  immediateResize?: boolean;
}

/**
 * Bootstrap a JSDOM environment and install standard mocks.
 *
 * Assigns `document`, `window`, `HTMLElement`, `Element`, `MouseEvent`,
 * `KeyboardEvent`, `ResizeObserver`, `requestAnimationFrame`, and
 * `cancelAnimationFrame` on the global object.
 *
 * Call `teardownDOM()` in `afterAll` to restore the originals.
 */
export const setupDOM = (opts: SetupDOMOptions = {}): JSDOM => {
  const { width = 300, height = 500, immediateResize = true } = opts;

  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  // Save originals
  origDocument = global.document;
  origWindow = global.window;
  origHTMLElement = global.HTMLElement;
  origElement = (global as any).Element;
  origMouseEvent = (global as any).MouseEvent;
  origKeyboardEvent = (global as any).KeyboardEvent;
  origResizeObserver = (global as any).ResizeObserver;
  origRAF = global.requestAnimationFrame;
  origCAF = global.cancelAnimationFrame;

  // Install JSDOM globals
  global.document = dom.window.document;
  global.window = dom.window as any;
  global.HTMLElement = dom.window.HTMLElement;
  (global as any).Element = dom.window.Element;
  (global as any).MouseEvent = dom.window.MouseEvent;
  (global as any).KeyboardEvent = dom.window.KeyboardEvent;

  // Install scrollTo polyfill (JSDOM doesn't have it)
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
  (dom.window as any).scrollTo = () => {};

  // ResizeObserver mock
  global.ResizeObserver = createMockResizeObserver({
    width,
    height,
    immediate: immediateResize,
  });

  // requestAnimationFrame / cancelAnimationFrame
  global.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number;
  global.cancelAnimationFrame = (id: number): void => clearTimeout(id);

  return dom;
};

/**
 * Restore all globals to their pre-setup values.
 */
export const teardownDOM = (): void => {
  global.document = origDocument;
  global.window = origWindow;
  global.HTMLElement = origHTMLElement;
  if (origElement !== undefined) (global as any).Element = origElement;
  if (origMouseEvent !== undefined) (global as any).MouseEvent = origMouseEvent;
  if (origKeyboardEvent !== undefined) (global as any).KeyboardEvent = origKeyboardEvent;
  if (origResizeObserver !== undefined) global.ResizeObserver = origResizeObserver;
  if (origRAF !== undefined) global.requestAnimationFrame = origRAF;
  if (origCAF !== undefined) global.cancelAnimationFrame = origCAF;
};