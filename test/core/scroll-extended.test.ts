/**
 * vlist v2 — Scroll Handler Extended Tests
 *
 * Covers wheel handler gaps (vertical/horizontal modes, cross-axis overflow),
 * SCROLL_EASING function correctness, state update edge cases, smooth scroll
 * edge cases, and wheel-to-idle integration cycles.
 *
 * Complements test/core/scroll.test.ts (29 tests) and scroll-bounds.test.ts
 * without duplicating them.
 */

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createScrollHandler } from "../../src/core/scroll";
import type { ScrollHandlerConfig } from "../../src/core/scroll";
import { createEngineState } from "../../src/core/state";
import { SCROLL_EASING, WHEEL_SENSITIVITY } from "../../src/constants";

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

// =============================================================================
// Helpers
// =============================================================================

function createViewport(opts: {
  scrollHeight?: number;
  scrollWidth?: number;
  clientHeight?: number;
  clientWidth?: number;
} = {}): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { value: opts.scrollHeight ?? 5000, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: opts.scrollWidth ?? 300, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: opts.clientHeight ?? 500, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: opts.clientWidth ?? 300, configurable: true });
  return el;
}

function makeHandler(overrides: Partial<ScrollHandlerConfig> = {}): {
  handler: ReturnType<typeof createScrollHandler>;
  viewport: HTMLElement;
  state: ReturnType<typeof createEngineState>;
  onFrame: ReturnType<typeof mock>;
  onIdle: ReturnType<typeof mock>;
} {
  const viewport = (overrides.viewport ?? createViewport()) as HTMLElement;
  const state = (overrides.state ?? createEngineState(10)) as ReturnType<typeof createEngineState>;
  const onFrame = (overrides.onFrame ?? mock(() => {})) as ReturnType<typeof mock>;
  const onIdle = (overrides.onIdle ?? mock(() => {})) as ReturnType<typeof mock>;
  const config: ScrollHandlerConfig = {
    state,
    viewport,
    isX: false,
    wheelEnabled: true,
    idleTimeout: 100,
    onFrame,
    onIdle,
    ...overrides,
  };
  const handler = createScrollHandler(config);
  handler.attach();
  return { handler, viewport, state, onFrame, onIdle };
}

function fireWheel(target: HTMLElement, deltaY: number, deltaX: number = 0): WheelEvent {
  const event = new WheelEvent("wheel", {
    deltaY,
    deltaX,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

// =============================================================================
// 1. Wheel handler — vertical mode
// =============================================================================

describe("wheel handler — vertical mode", () => {
  it("vertical wheel updates state and calls onFrame", () => {
    const viewport = createViewport();
    viewport.scrollTop = 100;
    const state = createEngineState(10);
    state.scrollPosition = 100;
    const onFrame = mock(() => {});
    const { handler } = makeHandler({ viewport, state, onFrame });

    fireWheel(viewport, 50);

    expect(state.scrollPosition).toBe(100 + 50 * WHEEL_SENSITIVITY);
    expect(onFrame).toHaveBeenCalled();
    handler.detach();
  });

  it("vertical wheel clamps to 0 at top boundary", () => {
    const viewport = createViewport();
    viewport.scrollTop = 5;
    const state = createEngineState(10);
    state.scrollPosition = 5;
    const { handler } = makeHandler({ viewport, state });

    fireWheel(viewport, -1000);

    expect(viewport.scrollTop).toBe(0);
    expect(state.scrollPosition).toBe(0);
    handler.detach();
  });

  it("vertical wheel clamps to max at bottom boundary", () => {
    const viewport = createViewport({ scrollHeight: 2000, clientHeight: 500 });
    viewport.scrollTop = 1490;
    const state = createEngineState(10);
    state.scrollPosition = 1490;
    const { handler } = makeHandler({ viewport, state });

    fireWheel(viewport, 500);

    // max = 2000 - 500 = 1500
    expect(viewport.scrollTop).toBe(1500);
    expect(state.scrollPosition).toBe(1500);
    handler.detach();
  });

  it("vertical wheel skips when change < 1px (at boundary)", () => {
    const viewport = createViewport();
    viewport.scrollTop = 0;
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const onFrame = mock(() => {});
    const { handler } = makeHandler({ viewport, state, onFrame });

    // Delta so small the clamped result differs by < 1px from current
    fireWheel(viewport, 0.5);

    expect(onFrame).not.toHaveBeenCalled();
    handler.detach();
  });

  it("vertical wheel calls preventDefault on processed event", () => {
    const viewport = createViewport();
    viewport.scrollTop = 100;
    const state = createEngineState(10);
    state.scrollPosition = 100;
    const { handler } = makeHandler({ viewport, state });

    const event = fireWheel(viewport, 50);

    expect(event.defaultPrevented).toBe(true);
    handler.detach();
  });

  it("vertical wheel does not fire when wheelEnabled is false", () => {
    const viewport = createViewport();
    viewport.scrollTop = 100;
    const state = createEngineState(10);
    state.scrollPosition = 100;
    const onFrame = mock(() => {});
    const { handler } = makeHandler({ viewport, state, onFrame, wheelEnabled: false });

    fireWheel(viewport, 50);

    expect(onFrame).not.toHaveBeenCalled();
    // State should be unchanged since listener was never attached
    expect(state.scrollPosition).toBe(100);
    handler.detach();
  });

  it("vertical wheel does not fire when isCompressed is true", () => {
    const viewport = createViewport();
    viewport.scrollTop = 100;
    const state = createEngineState(10);
    state.scrollPosition = 100;
    state.isCompressed = true;
    const onFrame = mock(() => {});
    const { handler } = makeHandler({ viewport, state, onFrame });

    fireWheel(viewport, 50);

    expect(onFrame).not.toHaveBeenCalled();
    expect(state.scrollPosition).toBe(100);
    handler.detach();
  });

  it("vertical wheel with cross-axis overflow forwards deltaX to scrollLeft", () => {
    // Cross-axis overflow: scrollWidth > clientWidth
    const viewport = createViewport({ scrollWidth: 800, clientWidth: 300 });
    viewport.scrollTop = 100;
    viewport.scrollLeft = 50;
    const state = createEngineState(10);
    state.scrollPosition = 100;
    const { handler } = makeHandler({ viewport, state });

    // deltaY is dominant (vertical scroll goes through), but deltaX is forwarded
    fireWheel(viewport, 20, 10);

    // deltaX should be forwarded to scrollLeft
    expect(viewport.scrollLeft).toBe(60);
    // deltaY should still update vertical position
    expect(viewport.scrollTop).toBe(120);
    handler.detach();
  });

  it("vertical wheel with cross-axis overflow does NOT forward when deltaX is 0", () => {
    const viewport = createViewport({ scrollWidth: 800, clientWidth: 300 });
    viewport.scrollTop = 100;
    viewport.scrollLeft = 50;
    const state = createEngineState(10);
    state.scrollPosition = 100;
    const { handler } = makeHandler({ viewport, state });

    // No deltaX, only deltaY
    fireWheel(viewport, 20, 0);

    expect(viewport.scrollLeft).toBe(50); // unchanged
    expect(viewport.scrollTop).toBe(120);
    handler.detach();
  });

  it("vertical wheel with cross-axis overflow passes through predominantly horizontal gestures", () => {
    const viewport = createViewport({ scrollWidth: 800, clientWidth: 300 });
    viewport.scrollTop = 100;
    const state = createEngineState(10);
    state.scrollPosition = 100;
    const onFrame = mock(() => {});
    const { handler } = makeHandler({ viewport, state, onFrame });

    // deltaX > deltaY → horizontal passthrough, handler returns early
    fireWheel(viewport, 5, 50);

    expect(onFrame).not.toHaveBeenCalled();
    expect(state.scrollPosition).toBe(100);
    handler.detach();
  });
});

// =============================================================================
// 2. Wheel handler — horizontal mode
// =============================================================================

describe("wheel handler — horizontal mode", () => {
  it("horizontal wheel converts deltaY to scrollLeft change", () => {
    const viewport = createViewport({ scrollWidth: 5000, clientWidth: 500 });
    viewport.scrollLeft = 100;
    const state = createEngineState(10);
    state.scrollPosition = 100;
    const { handler } = makeHandler({ viewport, state, isX: true });

    fireWheel(viewport, 30);

    expect(viewport.scrollLeft).toBe(100 + 30 * WHEEL_SENSITIVITY);
    expect(state.scrollPosition).toBe(130);
    handler.detach();
  });

  it("horizontal wheel passes through predominantly horizontal gestures (deltaX > deltaY)", () => {
    const viewport = createViewport({ scrollWidth: 5000, clientWidth: 500 });
    viewport.scrollLeft = 100;
    const state = createEngineState(10);
    state.scrollPosition = 100;
    const onFrame = mock(() => {});
    const { handler } = makeHandler({ viewport, state, isX: true, onFrame });

    // abs(deltaX) > abs(deltaY) → native horizontal passthrough
    fireWheel(viewport, 10, 50);

    expect(onFrame).not.toHaveBeenCalled();
    expect(state.scrollPosition).toBe(100);
    handler.detach();
  });

  it("horizontal wheel clamps to 0 at start boundary", () => {
    const viewport = createViewport({ scrollWidth: 5000, clientWidth: 500 });
    viewport.scrollLeft = 5;
    const state = createEngineState(10);
    state.scrollPosition = 5;
    const { handler } = makeHandler({ viewport, state, isX: true });

    fireWheel(viewport, -1000);

    expect(viewport.scrollLeft).toBe(0);
    expect(state.scrollPosition).toBe(0);
    handler.detach();
  });

  it("horizontal wheel clamps to max at end boundary", () => {
    const viewport = createViewport({ scrollWidth: 3000, clientWidth: 500 });
    viewport.scrollLeft = 2490;
    const state = createEngineState(10);
    state.scrollPosition = 2490;
    const { handler } = makeHandler({ viewport, state, isX: true });

    fireWheel(viewport, 500);

    // max = 3000 - 500 = 2500
    expect(viewport.scrollLeft).toBe(2500);
    expect(state.scrollPosition).toBe(2500);
    handler.detach();
  });

  it("horizontal wheel skips when change < 1px", () => {
    const viewport = createViewport({ scrollWidth: 5000, clientWidth: 500 });
    viewport.scrollLeft = 100;
    const state = createEngineState(10);
    state.scrollPosition = 100;
    const onFrame = mock(() => {});
    const { handler } = makeHandler({ viewport, state, isX: true, onFrame });

    fireWheel(viewport, 0.3);

    expect(onFrame).not.toHaveBeenCalled();
    handler.detach();
  });

  it("horizontal wheel calls preventDefault on processed event", () => {
    const viewport = createViewport({ scrollWidth: 5000, clientWidth: 500 });
    viewport.scrollLeft = 100;
    const state = createEngineState(10);
    state.scrollPosition = 100;
    const { handler } = makeHandler({ viewport, state, isX: true });

    const event = fireWheel(viewport, 50);

    expect(event.defaultPrevented).toBe(true);
    handler.detach();
  });

  it("horizontal wheel does not fire when isCompressed is true", () => {
    const viewport = createViewport({ scrollWidth: 5000, clientWidth: 500 });
    viewport.scrollLeft = 100;
    const state = createEngineState(10);
    state.scrollPosition = 100;
    state.isCompressed = true;
    const onFrame = mock(() => {});
    const { handler } = makeHandler({ viewport, state, isX: true, onFrame });

    fireWheel(viewport, 50);

    expect(onFrame).not.toHaveBeenCalled();
    expect(state.scrollPosition).toBe(100);
    handler.detach();
  });

  it("horizontal wheel handles negative deltaY (scroll backward)", () => {
    const viewport = createViewport({ scrollWidth: 5000, clientWidth: 500 });
    viewport.scrollLeft = 200;
    const state = createEngineState(10);
    state.scrollPosition = 200;
    const { handler } = makeHandler({ viewport, state, isX: true });

    fireWheel(viewport, -50);

    expect(viewport.scrollLeft).toBe(150);
    expect(state.scrollPosition).toBe(150);
    expect(state.scrollDirection).toBe(-1);
    handler.detach();
  });
});

// =============================================================================
// 3. Easing function
// =============================================================================

describe("SCROLL_EASING function", () => {
  it("returns 0 at t=0", () => {
    expect(SCROLL_EASING(0)).toBe(0);
  });

  it("returns 1 at t=1", () => {
    expect(SCROLL_EASING(1)).toBe(1);
  });

  it("returns 0.5 at t=0.5", () => {
    expect(SCROLL_EASING(0.5)).toBe(0.5);
  });

  it("eases in for first half (t < 0.5)", () => {
    // For easeInOutQuad, the first half accelerates: value < linear (t)
    const t = 0.25;
    const value = SCROLL_EASING(t);
    expect(value).toBeLessThan(t);
    expect(value).toBeGreaterThan(0);
  });

  it("eases out for second half (t >= 0.5)", () => {
    // For easeInOutQuad, the second half decelerates: value > linear (t)
    const t = 0.75;
    const value = SCROLL_EASING(t);
    expect(value).toBeGreaterThan(t);
    expect(value).toBeLessThan(1);
  });

  it("is symmetric around t=0.5", () => {
    // easeInOutQuad is symmetric: f(t) + f(1-t) = 1
    const testPoints = [0.1, 0.2, 0.3, 0.4];
    for (const t of testPoints) {
      const sum = SCROLL_EASING(t) + SCROLL_EASING(1 - t);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-10);
    }
  });

  it("is continuous at t=0.5 (no jump)", () => {
    // Values just below and just above 0.5 should be very close to 0.5
    const below = SCROLL_EASING(0.4999);
    const above = SCROLL_EASING(0.5001);
    expect(Math.abs(below - above)).toBeLessThan(0.01);
    expect(Math.abs(below - 0.5)).toBeLessThan(0.01);
    expect(Math.abs(above - 0.5)).toBeLessThan(0.01);
  });

  it("handles t=0.25 and t=0.75", () => {
    // t=0.25: first half formula: 2 * 0.25^2 = 0.125
    expect(SCROLL_EASING(0.25)).toBeCloseTo(0.125, 10);
    // t=0.75: second half formula: 1 - (-2*0.75 + 2)^2 / 2 = 1 - 0.5^2/2 = 1 - 0.125 = 0.875
    expect(SCROLL_EASING(0.75)).toBeCloseTo(0.875, 10);
  });
});

// =============================================================================
// 4. Scroll state updates
// =============================================================================

describe("scroll handler — state updates", () => {
  it("sub-pixel scroll (< 0.5px change) is ignored", () => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 100;
    const onFrame = mock(() => {});
    const { handler } = makeHandler({ viewport, state, onFrame, wheelEnabled: false });

    // Set scrollTop to something very close to current state
    viewport.scrollTop = 100.3;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(onFrame).not.toHaveBeenCalled();
    expect(state.scrollPosition).toBe(100);
    handler.detach();
  });

  it("scroll from 0 to N sets direction to 1", () => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const { handler } = makeHandler({ viewport, state, wheelEnabled: false });

    viewport.scrollTop = 100;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(state.scrollDirection).toBe(1);
    handler.detach();
  });

  it("scroll from N to 0 sets direction to -1", () => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 200;
    const { handler } = makeHandler({ viewport, state, wheelEnabled: false });

    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(state.scrollDirection).toBe(-1);
    handler.detach();
  });

  it("scroll to same position is ignored (sub-pixel filter)", () => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 250;
    const onFrame = mock(() => {});
    const { handler } = makeHandler({ viewport, state, onFrame, wheelEnabled: false });

    // scrollTop matches state exactly
    viewport.scrollTop = 250;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(onFrame).not.toHaveBeenCalled();
    handler.detach();
  });

  it("prevScrollPosition is updated correctly", () => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 50;
    const { handler } = makeHandler({ viewport, state, wheelEnabled: false });

    viewport.scrollTop = 150;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(state.prevScrollPosition).toBe(50);
    expect(state.scrollPosition).toBe(150);

    viewport.scrollTop = 300;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(state.prevScrollPosition).toBe(150);
    expect(state.scrollPosition).toBe(300);
    handler.detach();
  });

  it("scheduleIdle is called on wheel events too", (done) => {
    const viewport = createViewport();
    viewport.scrollTop = 100;
    const state = createEngineState(10);
    state.scrollPosition = 100;
    const onIdle = mock(() => {});
    const { handler } = makeHandler({ viewport, state, onIdle, idleTimeout: 50 });

    fireWheel(viewport, 20);

    // Idle should fire after timeout
    setTimeout(() => {
      expect(onIdle).toHaveBeenCalled();
      expect(state.scrollDirection).toBe(0);
      handler.detach();
      done();
    }, 100);
  });

  it("multiple rapid scrolls only trigger one idle", (done) => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 0;
    let idleCount = 0;
    const onIdle = mock(() => { idleCount++; });
    const { handler } = makeHandler({ viewport, state, onIdle, wheelEnabled: false, idleTimeout: 80 });

    // Rapid scrolls
    viewport.scrollTop = 50;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

    setTimeout(() => {
      viewport.scrollTop = 100;
      viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    }, 20);

    setTimeout(() => {
      viewport.scrollTop = 150;
      viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    }, 40);

    // Wait for idle timeout from last scroll
    setTimeout(() => {
      expect(idleCount).toBe(1);
      handler.detach();
      done();
    }, 200);
  });

  it("idle timer is cleared on detach even if scroll happened", (done) => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const onIdle = mock(() => {});
    const { handler } = makeHandler({ viewport, state, onIdle, wheelEnabled: false, idleTimeout: 50 });

    viewport.scrollTop = 100;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

    // Detach immediately
    handler.detach();

    // Wait past idle timeout
    setTimeout(() => {
      expect(onIdle).not.toHaveBeenCalled();
      done();
    }, 120);
  });
});

// =============================================================================
// 5. Smooth scroll edge cases
// =============================================================================

describe("smooth scroll — edge cases", () => {
  it("smoothScrollTo with custom setFn does NOT update state.scrollPosition", (done) => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const positions: number[] = [];
    const setFn = (pos: number): void => { positions.push(pos); };
    const { handler } = makeHandler({ viewport, state });

    handler.smoothScrollTo(200, 100, setFn);

    setTimeout(() => {
      // setFn was called with positions
      expect(positions.length).toBeGreaterThan(0);
      // state.scrollPosition should NOT have been updated by the animation
      expect(state.scrollPosition).toBe(0);
      handler.detach();
      done();
    }, 150);
  });

  it("smoothScrollTo from non-zero position scrolls backward", (done) => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 500;
    viewport.scrollTop = 500;
    const { handler } = makeHandler({ viewport, state });

    handler.smoothScrollTo(100, 100);

    setTimeout(() => {
      expect(viewport.scrollTop).toBe(100);
      expect(state.scrollPosition).toBe(100);
      handler.detach();
      done();
    }, 150);
  });

  it("smoothScrollTo with distance >= 1 uses rAF animation", (done) => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const onFrame = mock(() => {});
    const { handler } = makeHandler({ viewport, state, onFrame });

    handler.smoothScrollTo(100, 200);

    // After first frame, position should be intermediate (not yet 100)
    setTimeout(() => {
      // onFrame should have been called at least once during animation
      expect(onFrame.mock.calls.length).toBeGreaterThanOrEqual(1);
      handler.detach();
      done();
    }, 50);
  });

  it("cancelScroll during detach prevents further frames", (done) => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const onFrame = mock(() => {});
    const { handler } = makeHandler({ viewport, state, onFrame });

    handler.smoothScrollTo(1000, 500);

    // Let one frame execute
    setTimeout(() => {
      const callsBeforeDetach = onFrame.mock.calls.length;
      handler.detach(); // detach calls cancelScroll

      setTimeout(() => {
        // No more frames should have fired
        expect(onFrame.mock.calls.length).toBe(callsBeforeDetach);
        done();
      }, 100);
    }, 20);
  });

  it("smoothScrollTo to horizontal uses scrollLeft", (done) => {
    const viewport = createViewport({ scrollWidth: 5000, clientWidth: 500 });
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const { handler } = makeHandler({ viewport, state, isX: true });

    handler.smoothScrollTo(300, 100);

    setTimeout(() => {
      expect(viewport.scrollLeft).toBe(300);
      expect(state.scrollPosition).toBe(300);
      handler.detach();
      done();
    }, 150);
  });

  it("smoothScrollTo with negative target clamps via easing (no overshoot)", (done) => {
    const viewport = createViewport();
    const state = createEngineState(10);
    state.scrollPosition = 50;
    viewport.scrollTop = 50;
    const positions: number[] = [];
    const { handler } = makeHandler({
      viewport,
      state,
      onFrame: () => { positions.push(viewport.scrollTop); },
    });

    // Target is negative; easing interpolates from 50 to -10
    // The easing won't overshoot — easeInOutQuad stays in [0,1] range
    handler.smoothScrollTo(-10, 100);

    setTimeout(() => {
      // All positions during animation should be between -10 and 50 (no overshoot)
      for (const pos of positions) {
        expect(pos).toBeGreaterThanOrEqual(-10);
        expect(pos).toBeLessThanOrEqual(50);
      }
      // Final position should be target
      expect(viewport.scrollTop).toBe(-10);
      handler.detach();
      done();
    }, 150);
  });
});

// =============================================================================
// 6. Wheel handler — scroll cycle integration
// =============================================================================

describe("wheel handler — scroll cycle integration", () => {
  it("wheel event triggers onFrame and scheduleIdle", (done) => {
    const viewport = createViewport();
    viewport.scrollTop = 100;
    const state = createEngineState(10);
    state.scrollPosition = 100;
    const onFrame = mock(() => {});
    const onIdle = mock(() => {});
    const { handler } = makeHandler({ viewport, state, onFrame, onIdle, idleTimeout: 50 });

    fireWheel(viewport, 20);

    expect(onFrame).toHaveBeenCalledTimes(1);

    setTimeout(() => {
      expect(onIdle).toHaveBeenCalledTimes(1);
      handler.detach();
      done();
    }, 100);
  });

  it("wheel at top boundary does not call onFrame", () => {
    const viewport = createViewport();
    viewport.scrollTop = 0;
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const onFrame = mock(() => {});
    const { handler } = makeHandler({ viewport, state, onFrame });

    // Scroll up when already at top
    fireWheel(viewport, -50);

    expect(onFrame).not.toHaveBeenCalled();
    handler.detach();
  });

  it("wheel at bottom boundary does not call onFrame", () => {
    const viewport = createViewport({ scrollHeight: 1000, clientHeight: 500 });
    // max = 500, already at max
    viewport.scrollTop = 500;
    const state = createEngineState(10);
    state.scrollPosition = 500;
    const onFrame = mock(() => {});
    const { handler } = makeHandler({ viewport, state, onFrame });

    // Scroll down when already at bottom
    fireWheel(viewport, 50);

    expect(onFrame).not.toHaveBeenCalled();
    handler.detach();
  });

  it("rapid wheel events reschedule idle each time", (done) => {
    const viewport = createViewport();
    viewport.scrollTop = 0;
    const state = createEngineState(10);
    state.scrollPosition = 0;
    let idleCount = 0;
    const onIdle = mock(() => { idleCount++; });
    const { handler } = makeHandler({ viewport, state, onIdle, idleTimeout: 80 });

    // First wheel
    fireWheel(viewport, 20);

    // Second wheel 30ms later — should reset the idle timer
    setTimeout(() => {
      // Update scrollTop to reflect previous wheel
      viewport.scrollTop = state.scrollPosition;
      fireWheel(viewport, 20);
    }, 30);

    // Third wheel 60ms later — should reset again
    setTimeout(() => {
      viewport.scrollTop = state.scrollPosition;
      fireWheel(viewport, 20);
    }, 60);

    // Check: only one idle after the last wheel + timeout
    setTimeout(() => {
      expect(idleCount).toBe(1);
      handler.detach();
      done();
    }, 200);
  });

  it("wheel updates state.scrollDirection", () => {
    const viewport = createViewport();
    viewport.scrollTop = 200;
    const state = createEngineState(10);
    state.scrollPosition = 200;
    const { handler } = makeHandler({ viewport, state });

    // Forward scroll
    fireWheel(viewport, 50);
    expect(state.scrollDirection).toBe(1);

    // Update viewport to match state for next wheel
    viewport.scrollTop = state.scrollPosition;

    // Backward scroll
    fireWheel(viewport, -100);
    expect(state.scrollDirection).toBe(-1);

    handler.detach();
  });
});
