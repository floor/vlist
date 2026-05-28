/**
 * vlist v2 — Scroll Bounds & Clamping Tests
 *
 * Verifies that the scroll handler correctly clamps scroll positions
 * within valid bounds during wheel events, filters sub-pixel deltas,
 * and tracks direction state accurately.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createScrollHandler } from "../../src/core/scroll";
import { createEngineState } from "../../src/core/state";

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

// =============================================================================
// Helpers
// =============================================================================

function createViewport(opts: {
  scrollHeight?: number;
  clientHeight?: number;
  scrollWidth?: number;
  clientWidth?: number;
} = {}): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { value: opts.scrollHeight ?? 5000, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: opts.clientHeight ?? 500, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: opts.scrollWidth ?? 5000, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: opts.clientWidth ?? 500, configurable: true });
  return el;
}

function makeHandler(viewport: HTMLElement, opts: {
  isX?: boolean;
  state?: ReturnType<typeof createEngineState>;
} = {}) {
  const state = opts.state ?? createEngineState(10);
  const frames: number[] = [];
  const config = {
    state,
    viewport,
    isX: opts.isX ?? false,
    wheelEnabled: true,
    idleTimeout: 1500,
    onFrame: () => { frames.push(state.scrollPosition); },
    onIdle: () => {},
  };
  const handler = createScrollHandler(config);
  handler.attach();
  return { handler, state, frames };
}

function fireWheel(target: HTMLElement, deltaY: number, deltaX = 0): void {
  target.dispatchEvent(
    new WheelEvent("wheel", { deltaY, deltaX, bubbles: true, cancelable: true }),
  );
}

// =============================================================================
// Wheel clamping — vertical
// =============================================================================

describe("scroll bounds — vertical wheel clamping", () => {
  it("should clamp scroll to 0 when wheeling up past top", () => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 50;
    viewport.scrollTop = 50;

    const { handler } = makeHandler(viewport, { state });

    fireWheel(viewport, -1000);

    expect(viewport.scrollTop).toBe(0);
    handler.detach();
  });

  it("should clamp scroll to max when wheeling down past bottom", () => {
    const viewport = createViewport({ scrollHeight: 2000, clientHeight: 500 });
    const state = createEngineState(10);
    state.scrollPosition = 1400;
    viewport.scrollTop = 1400;

    const { handler } = makeHandler(viewport, { state });

    fireWheel(viewport, 1000);

    // max = scrollHeight - clientHeight = 1500
    expect(viewport.scrollTop).toBe(1500);
    handler.detach();
  });

  it("should not produce negative scrollPosition from large upward delta", () => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 10;
    viewport.scrollTop = 10;

    const { handler } = makeHandler(viewport, { state });

    fireWheel(viewport, -99999);

    expect(state.scrollPosition).toBeGreaterThanOrEqual(0);
    expect(viewport.scrollTop).toBeGreaterThanOrEqual(0);
    handler.detach();
  });

  it("should not exceed max scrollPosition from large downward delta", () => {
    const viewport = createViewport({ scrollHeight: 1000, clientHeight: 400 });
    const state = createEngineState(10);
    state.scrollPosition = 500;
    viewport.scrollTop = 500;

    const { handler } = makeHandler(viewport, { state });

    fireWheel(viewport, 99999);

    // max = 1000 - 400 = 600
    expect(state.scrollPosition).toBeLessThanOrEqual(600);
    expect(viewport.scrollTop).toBeLessThanOrEqual(600);
    handler.detach();
  });
});

// =============================================================================
// Wheel clamping — horizontal
// =============================================================================

describe("scroll bounds — horizontal wheel clamping", () => {
  it("should clamp horizontal scroll to 0 when wheeling left past start", () => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 20;
    viewport.scrollLeft = 20;

    const { handler } = makeHandler(viewport, { isX: true, state });

    fireWheel(viewport, -5000);

    expect(viewport.scrollLeft).toBe(0);
    handler.detach();
  });

  it("should clamp horizontal scroll to max when wheeling right past end", () => {
    const viewport = createViewport({ scrollWidth: 3000, clientWidth: 500 });
    const state = createEngineState(10);
    state.scrollPosition = 2400;
    viewport.scrollLeft = 2400;

    const { handler } = makeHandler(viewport, { isX: true, state });

    fireWheel(viewport, 5000);

    // max = 3000 - 500 = 2500
    expect(viewport.scrollLeft).toBe(2500);
    handler.detach();
  });
});

// =============================================================================
// Sub-pixel filtering
// =============================================================================

describe("scroll bounds — sub-pixel filtering", () => {
  it("should ignore wheel events with delta < 1px effective change", () => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 100;
    viewport.scrollTop = 100;

    const frames: number[] = [];
    const handler = createScrollHandler({
      state,
      viewport,
      isX: false,
      wheelEnabled: true,
      idleTimeout: 1500,
      onFrame: () => { frames.push(state.scrollPosition); },
      onIdle: () => {},
    });
    handler.attach();

    // Very small delta that results in < 1px change after sensitivity
    fireWheel(viewport, 0.001);

    expect(frames.length).toBe(0);
    handler.detach();
  });

  it("should ignore scroll events with position change < 0.5px", () => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 100;

    let frameCount = 0;
    const handler = createScrollHandler({
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => { frameCount++; },
      onIdle: () => {},
    });
    handler.attach();

    // Set scrollTop to a value very close to current position
    viewport.scrollTop = 100.3;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(frameCount).toBe(0);
    handler.detach();
  });
});

// =============================================================================
// Direction tracking accuracy
// =============================================================================

describe("scroll bounds — direction tracking", () => {
  it("should set direction to 1 for forward wheel", () => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 100;
    viewport.scrollTop = 100;

    const { handler } = makeHandler(viewport, { state });

    fireWheel(viewport, 50);

    expect(state.scrollDirection).toBe(1);
    handler.detach();
  });

  it("should set direction to -1 for backward wheel", () => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 200;
    viewport.scrollTop = 200;

    const { handler } = makeHandler(viewport, { state });

    fireWheel(viewport, -50);

    expect(state.scrollDirection).toBe(-1);
    handler.detach();
  });

  it("should track previous scroll position accurately", () => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 100;
    viewport.scrollTop = 100;

    const { handler } = makeHandler(viewport, { state });

    fireWheel(viewport, 50);
    const prev = state.prevScrollPosition;

    expect(prev).toBe(100);
    handler.detach();
  });

  it("should not fire onFrame when clamped at boundary (already at 0, wheel up)", () => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 0;
    viewport.scrollTop = 0;

    const { handler, frames } = makeHandler(viewport, { state });

    fireWheel(viewport, -50);

    // next would be 0 (clamped), current is 0 → diff < 1 → no frame
    expect(frames.length).toBe(0);
    handler.detach();
  });

  it("should not fire onFrame when clamped at max boundary", () => {
    const viewport = createViewport({ scrollHeight: 1000, clientHeight: 500 });
    const state = createEngineState(10);
    // Already at max
    state.scrollPosition = 500;
    viewport.scrollTop = 500;

    const { handler, frames } = makeHandler(viewport, { state });

    fireWheel(viewport, 100);

    // next would be 500 (clamped), current is 500 → diff < 1 → no frame
    expect(frames.length).toBe(0);
    handler.detach();
  });
});

// =============================================================================
// Cross-axis wheel passthrough
// =============================================================================

describe("scroll bounds — cross-axis passthrough", () => {
  it("should ignore horizontal deltaX in vertical mode when no cross overflow", () => {
    const viewport = createViewport({ scrollWidth: 500, clientWidth: 500 });
    const state = createEngineState(10);
    state.scrollPosition = 100;
    viewport.scrollTop = 100;

    const { handler, frames } = makeHandler(viewport, { state });

    // Pure horizontal scroll — should be ignored in vertical mode (no cross overflow)
    viewport.dispatchEvent(
      new WheelEvent("wheel", { deltaX: 50, deltaY: 0, bubbles: true, cancelable: true }),
    );

    expect(frames.length).toBe(0);
    handler.detach();
  });

  it("should pass through horizontal deltaX in horizontal mode when deltaX > deltaY", () => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 100;
    viewport.scrollLeft = 100;

    const { handler, frames } = makeHandler(viewport, { isX: true, state });

    // In horizontal mode, deltaX > deltaY means it's the primary axis → ignored by wheel handler
    viewport.dispatchEvent(
      new WheelEvent("wheel", { deltaX: 50, deltaY: 10, bubbles: true, cancelable: true }),
    );

    // The handler returns early when abs(deltaX) > abs(deltaY) in horizontal mode
    expect(frames.length).toBe(0);
    handler.detach();
  });
});
