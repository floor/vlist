/**
 * vlist v2 - ScrollHandler Tests
 *
 * Tests the createScrollHandler API:
 * - Factory creates handler with attach/detach/cancelScroll/smoothScrollTo
 * - attach() adds scroll/wheel listeners to viewport
 * - detach() removes listeners and cleans up timers
 * - scrollTo can be simulated by setting scrollTop/scrollLeft
 * - onScroll callback fires on scroll events
 * - Horizontal mode uses scrollLeft instead of scrollTop
 */

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createScrollHandler } from "../../src/core/scroll";
import { createEngineState } from "../../src/core/state";

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

// =============================================================================
// Factory Tests
// =============================================================================

describe("createScrollHandler factory", () => {
  it("should return handler with required methods", () => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);

    expect(handler).toBeDefined();
    expect(typeof handler.attach).toBe("function");
    expect(typeof handler.detach).toBe("function");
    expect(typeof handler.cancelScroll).toBe("function");
    expect(typeof handler.smoothScrollTo).toBe("function");
  });
});

// =============================================================================
// attach() Tests
// =============================================================================

describe("ScrollHandler.attach()", () => {
  it("should add scroll listener to viewport", () => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    let scrolled = false;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {
        scrolled = true;
      },
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();

    viewport.scrollTop = 100;
    const event = new Event("scroll", { bubbles: true });
    viewport.dispatchEvent(event);

    expect(scrolled).toBe(true);
    handler.detach();
  });

  it("should add wheel listener when wheelEnabled is true", () => {
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "scrollHeight", { value: 5000, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 500, configurable: true });
    const state = createEngineState(10);
    let wheeled = false;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: true,
      idleTimeout: 1500,
      onFrame: () => {
        wheeled = true;
      },
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();

    viewport.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 10, bubbles: true, cancelable: true }),
    );

    expect(wheeled).toBe(true);
    handler.detach();
  });

  it("should use scrollTarget if provided instead of viewport", () => {
    const viewport = document.createElement("div");
    const scrollTarget = document.createElement("div");
    const state = createEngineState(10);
    let scrolled = false;
    const config = {
      state,
      viewport,
      scrollTarget,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {
        scrolled = true;
      },
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();

    viewport.scrollTop = 100;
    const event = new Event("scroll", { bubbles: true });
    scrollTarget.dispatchEvent(event);

    expect(scrolled).toBe(true);
    handler.detach();
  });
});

// =============================================================================
// detach() Tests
// =============================================================================

describe("ScrollHandler.detach()", () => {
  it("should remove scroll listener from viewport", () => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    let scrolled = false;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {
        scrolled = true;
      },
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();
    handler.detach();

    viewport.scrollTop = 100;
    const event = new Event("scroll", { bubbles: true });
    viewport.dispatchEvent(event);

    expect(scrolled).toBe(false);
  });

  it("should remove wheel listener when it was attached", () => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    let wheeled = false;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: true,
      idleTimeout: 1500,
      onFrame: () => {
        wheeled = true;
      },
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();
    handler.detach();

    viewport.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 10, bubbles: true, cancelable: true }),
    );

    expect(wheeled).toBe(false);
  });

  it("should cancel any pending animations", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();
    handler.smoothScrollTo(1000, 300);

    handler.detach();

    setTimeout(() => {
      expect(state.scrollPosition).toBe(0);
      done();
    }, 150);
  });

  it("should clear idle timeout", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    let idle = false;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 100,
      onFrame: () => {},
      onIdle: () => {
        idle = true;
      },
    };

    const handler = createScrollHandler(config);
    handler.attach();

    const event = new Event("scroll", { bubbles: true });
    viewport.dispatchEvent(event);

    handler.detach();

    setTimeout(() => {
      expect(idle).toBe(false);
      done();
    }, 200);
  });
});

// =============================================================================
// Vertical (scrollTop) Tests
// =============================================================================

describe("ScrollHandler - vertical mode", () => {
  it("should read scrollTop for vertical viewport", () => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();

    viewport.scrollTop = 250;
    const event = new Event("scroll", { bubbles: true });
    viewport.dispatchEvent(event);

    expect(state.scrollPosition).toBe(250);
    handler.detach();
  });

  it("should set scrollTop during smooth scroll animation", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();
    handler.smoothScrollTo(100, 200);

    setTimeout(() => {
      expect(viewport.scrollTop).toBeGreaterThan(0);
      expect(viewport.scrollTop).toBeLessThanOrEqual(100);
      handler.detach();
      done();
    }, 100);
  });
});

// =============================================================================
// Horizontal (scrollLeft) Tests
// =============================================================================

describe("ScrollHandler - horizontal mode", () => {
  it("should read scrollLeft for horizontal viewport", () => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    const config = {
      state,
      viewport,
      isX: true,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();

    viewport.scrollLeft = 300;
    const event = new Event("scroll", { bubbles: true });
    viewport.dispatchEvent(event);

    expect(state.scrollPosition).toBe(300);
    handler.detach();
  });

  it("should set scrollLeft during smooth scroll animation", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const config = {
      state,
      viewport,
      isX: true,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();
    handler.smoothScrollTo(100, 200);

    setTimeout(() => {
      expect(viewport.scrollLeft).toBeGreaterThan(0);
      expect(viewport.scrollLeft).toBeLessThanOrEqual(100);
      handler.detach();
      done();
    }, 100);
  });
});

// =============================================================================
// cancelScroll() Tests
// =============================================================================

describe("ScrollHandler.cancelScroll()", () => {
  it("should stop smooth scroll animation in progress", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();
    handler.smoothScrollTo(1000, 500);

    setTimeout(() => {
      const midwayPos = viewport.scrollTop;
      handler.cancelScroll();

      setTimeout(() => {
        const finalPos = viewport.scrollTop;
        expect(finalPos).toBe(midwayPos);
        handler.detach();
        done();
      }, 200);
    }, 100);
  });

  it("should be safe to call when no animation is running", () => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();

    expect(() => handler.cancelScroll()).not.toThrow();
    handler.detach();
  });
});

// =============================================================================
// smoothScrollTo() Tests
// =============================================================================

describe("ScrollHandler.smoothScrollTo()", () => {
  it("should animate to target position over duration", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();
    handler.smoothScrollTo(200, 300);

    setTimeout(() => {
      expect(viewport.scrollTop).toBeGreaterThan(0);
      expect(viewport.scrollTop).toBeLessThan(200);
      handler.detach();
      done();
    }, 150);
  });

  it("should reach exact target at end of animation", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();
    handler.smoothScrollTo(100, 100);

    setTimeout(() => {
      expect(viewport.scrollTop).toBe(100);
      handler.detach();
      done();
    }, 150);
  });

  it("should jump directly for distance < 1px", () => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 100;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();
    handler.smoothScrollTo(100.5, 300);

    expect(viewport.scrollTop).toBe(100.5);
    handler.detach();
  });

  it("should call onFrame during animation", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const onFrame = mock(() => {});
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame,
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();
    handler.smoothScrollTo(100, 100);

    setTimeout(() => {
      expect(onFrame).toHaveBeenCalled();
      handler.detach();
      done();
    }, 150);
  });

  it("should cancel previous animation when starting new one", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();
    handler.smoothScrollTo(500, 300);

    setTimeout(() => {
      const firstPos = viewport.scrollTop;
      handler.smoothScrollTo(100, 100);

      setTimeout(() => {
        expect(viewport.scrollTop).toBeLessThan(firstPos);
        handler.detach();
        done();
      }, 150);
    }, 100);
  });
});

describe("ScrollHandler.smoothScrollTo() with custom easing", () => {
  it("should use custom easing function during animation", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const positions: number[] = [];
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => { positions.push(viewport.scrollTop); },
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();
    // Linear easing: progress should be proportional to time
    handler.smoothScrollTo(100, 100, undefined, (t) => t);

    setTimeout(() => {
      expect(positions.length).toBeGreaterThan(0);
      expect(viewport.scrollTop).toBe(100);
      handler.detach();
      done();
    }, 150);
  });

  it("should apply easing to position calculation", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();
    // Easing that always returns 1 — should jump to end immediately
    handler.smoothScrollTo(200, 300, undefined, () => 1);

    requestAnimationFrame(() => {
      expect(viewport.scrollTop).toBe(200);
      handler.detach();
      done();
    });
  });

  it("should pass easing through setFn path", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const setPositions: number[] = [];
    const setFn = (pos: number) => { setPositions.push(pos); };
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();
    handler.smoothScrollTo(100, 100, setFn, (t) => t * t);

    setTimeout(() => {
      expect(setPositions.length).toBeGreaterThan(0);
      // Quadratic easing: at t=0.5, pos should be 25 (0.5^2 * 100)
      // All intermediate positions should be less than linear
      const midpoint = setPositions[Math.floor(setPositions.length / 2)];
      expect(midpoint).toBeLessThan(50);
      handler.detach();
      done();
    }, 120);
  });

  it("should use DEFAULT_EASING when no easing is provided", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const positions: number[] = [];
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => { positions.push(viewport.scrollTop); },
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();
    handler.smoothScrollTo(100, 100);

    setTimeout(() => {
      expect(positions.length).toBeGreaterThan(0);
      expect(viewport.scrollTop).toBe(100);
      handler.detach();
      done();
    }, 150);
  });
});

// =============================================================================
// Idle after smooth scroll
// =============================================================================

describe("ScrollHandler — idle after smooth scroll", () => {
  it("should fire onIdle after smooth scroll completes", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    let idleFired = false;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 50,
      onFrame: () => {},
      onIdle: () => { idleFired = true; },
    };

    const handler = createScrollHandler(config);
    handler.attach();
    handler.smoothScrollTo(500, 100);

    // After 100ms animation + 50ms idle timeout = 150ms
    setTimeout(() => {
      expect(viewport.scrollTop).toBe(500);
      expect(idleFired).toBe(true);
      handler.detach();
      done();
    }, 250);
  });

  it("should NOT fire onIdle during smooth scroll animation", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    let idleCount = 0;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 50,
      onFrame: () => {},
      onIdle: () => { idleCount++; },
    };

    const handler = createScrollHandler(config);
    handler.attach();
    handler.smoothScrollTo(500, 200);

    // At 100ms, animation is still running (200ms duration) — idle should not have fired
    setTimeout(() => {
      expect(idleCount).toBe(0);
    }, 100);

    // At 300ms, animation done (200ms) + idle timeout (50ms) passed — exactly 1 idle
    setTimeout(() => {
      expect(idleCount).toBe(1);
      handler.detach();
      done();
    }, 350);
  });

  it("should fire onIdle with correct scroll position at end", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    let idleScrollPos = -1;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 30,
      onFrame: () => {},
      onIdle: () => { idleScrollPos = state.scrollPosition; },
    };

    const handler = createScrollHandler(config);
    handler.attach();
    handler.smoothScrollTo(1000, 100);

    setTimeout(() => {
      expect(idleScrollPos).toBe(1000);
      handler.detach();
      done();
    }, 200);
  });
});

// =============================================================================
// onScroll Callback Tests
// =============================================================================

describe("ScrollHandler.onFrame callback", () => {
  it("should fire onFrame on scroll event", () => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    const onFrame = mock(() => {});
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame,
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();

    viewport.scrollTop = 100;
    const event = new Event("scroll", { bubbles: true });
    viewport.dispatchEvent(event);

    expect(onFrame).toHaveBeenCalled();
    handler.detach();
  });

  it("should update state.scrollDirection on forward scroll", () => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 100;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();

    viewport.scrollTop = 200;
    const event = new Event("scroll", { bubbles: true });
    viewport.dispatchEvent(event);

    expect(state.scrollDirection).toBe(1);
    handler.detach();
  });

  it("should update state.scrollDirection on backward scroll", () => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 200;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 1500,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();

    viewport.scrollTop = 100;
    const event = new Event("scroll", { bubbles: true });
    viewport.dispatchEvent(event);

    expect(state.scrollDirection).toBe(-1);
    handler.detach();
  });
});

// =============================================================================
// onIdle Callback Tests
// =============================================================================

describe("ScrollHandler.onIdle callback", () => {
  it("should fire onIdle after idleTimeout", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    const onIdle = mock(() => {});
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 100,
      onFrame: () => {},
      onIdle,
    };

    const handler = createScrollHandler(config);
    handler.attach();

    viewport.scrollTop = 100;
    const event = new Event("scroll", { bubbles: true });
    viewport.dispatchEvent(event);

    setTimeout(() => {
      expect(onIdle).toHaveBeenCalled();
      handler.detach();
      done();
    }, 150);
  });

  it("should reset scrollDirection on idle", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 100,
      onFrame: () => {},
      onIdle: () => {},
    };

    const handler = createScrollHandler(config);
    handler.attach();

    viewport.scrollTop = 100;
    const event = new Event("scroll", { bubbles: true });
    viewport.dispatchEvent(event);

    expect(state.scrollDirection).toBe(1);

    setTimeout(() => {
      expect(state.scrollDirection).toBe(0);
      handler.detach();
      done();
    }, 150);
  });

  it("should reschedule idle timeout on new scroll", (done) => {
    const viewport = document.createElement("div");
    const state = createEngineState(10);
    state.scrollPosition = 0;
    let idleCount = 0;
    const config = {
      state,
      viewport,
      isX: false,
      wheelEnabled: false,
      idleTimeout: 100,
      onFrame: () => {},
      onIdle: () => {
        idleCount++;
      },
    };

    const handler = createScrollHandler(config);
    handler.attach();

    viewport.scrollTop = 100;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

    setTimeout(() => {
      viewport.scrollTop = 200;
      viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    }, 50);

    setTimeout(() => {
      expect(idleCount).toBe(1);
      handler.detach();
      done();
    }, 200);
  });
});
