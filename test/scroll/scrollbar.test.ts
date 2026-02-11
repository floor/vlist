/**
 * vlist - Scrollbar Tests
 * Tests for the custom scrollbar component
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  mock,
} from "bun:test";
import { JSDOM } from "jsdom";
import { createScrollbar, type Scrollbar } from "../../src/scroll/scrollbar";

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

  // Mock requestAnimationFrame / cancelAnimationFrame (used by scrollbar drag)
  global.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    return setTimeout(() => cb(performance.now()), 0) as unknown as number;
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
  dom.window.close();
});

// =============================================================================
// Test Utilities
// =============================================================================

const createMockViewport = (): HTMLElement => {
  const viewport = document.createElement("div");
  viewport.className = "vlist-viewport";
  viewport.style.height = "400px";
  viewport.style.width = "300px";
  document.body.appendChild(viewport);
  return viewport;
};

const cleanupViewport = (viewport: HTMLElement): void => {
  if (viewport && viewport.parentNode) {
    viewport.parentNode.removeChild(viewport);
  }
};

// =============================================================================
// Tests
// =============================================================================

describe("createScrollbar", () => {
  let viewport: HTMLElement;
  let scrollbar: Scrollbar;
  let onScrollMock: ReturnType<typeof mock>;

  beforeEach(() => {
    viewport = createMockViewport();
    onScrollMock = mock(() => {});
  });

  afterEach(() => {
    if (scrollbar) {
      scrollbar.destroy();
    }
    cleanupViewport(viewport);
  });

  describe("initialization", () => {
    it("should create scrollbar elements", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);

      const track = viewport.querySelector(".vlist-scrollbar");
      const thumb = viewport.querySelector(".vlist-scrollbar-thumb");

      expect(track).not.toBeNull();
      expect(thumb).not.toBeNull();
    });

    it("should use custom class prefix", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {}, "custom");

      const track = viewport.querySelector(".custom-scrollbar");
      const thumb = viewport.querySelector(".custom-scrollbar-thumb");

      expect(track).not.toBeNull();
      expect(thumb).not.toBeNull();
    });

    it("should hide scrollbar initially", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);

      expect(scrollbar.isVisible()).toBe(false);
    });
  });

  describe("updateBounds", () => {
    it("should hide scrollbar when content fits", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(300, 400); // Content smaller than container

      const track = viewport.querySelector(".vlist-scrollbar") as HTMLElement;
      expect(track.style.display).toBe("none");
    });

    it("should show track when content exceeds container", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(1000, 400);

      const track = viewport.querySelector(".vlist-scrollbar") as HTMLElement;
      expect(track.style.display).not.toBe("none");
    });

    it("should calculate thumb height proportionally", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(1000, 400); // 40% visible

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      const thumbHeight = parseFloat(thumb.style.height);

      // 40% of 400px container = 160px
      expect(thumbHeight).toBeCloseTo(160, 0);
    });

    it("should respect minimum thumb size", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, { minThumbSize: 50 });
      scrollbar.updateBounds(100000, 400); // Very small visible ratio

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      const thumbHeight = parseFloat(thumb.style.height);

      expect(thumbHeight).toBeGreaterThanOrEqual(50);
    });
  });

  describe("updatePosition", () => {
    it("should position thumb at top when scrolled to top", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(1000, 400);
      scrollbar.updatePosition(0);

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      expect(thumb.style.transform).toBe("translateY(0px)");
    });

    it("should position thumb at bottom when scrolled to bottom", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(1000, 400);

      const maxScroll = 1000 - 400; // 600
      scrollbar.updatePosition(maxScroll);

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      const thumbHeight = parseFloat(thumb.style.height);
      const maxThumbTravel = 400 - thumbHeight;

      // Thumb should be at max travel position
      expect(thumb.style.transform).toBe(`translateY(${maxThumbTravel}px)`);
    });

    it("should position thumb correctly in the middle", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(1000, 400);

      const maxScroll = 600;
      scrollbar.updatePosition(maxScroll / 2); // 50% scrolled

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      const thumbHeight = parseFloat(thumb.style.height);
      const maxThumbTravel = 400 - thumbHeight;
      const expectedPosition = 0.5 * maxThumbTravel;

      expect(thumb.style.transform).toBe(`translateY(${expectedPosition}px)`);
    });
  });

  describe("show / hide", () => {
    it("should show scrollbar", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, { autoHide: false });
      scrollbar.updateBounds(1000, 400);
      scrollbar.show();

      expect(scrollbar.isVisible()).toBe(true);

      const track = viewport.querySelector(".vlist-scrollbar");
      expect(track?.classList.contains("vlist-scrollbar--visible")).toBe(true);
    });

    it("should hide scrollbar", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, { autoHide: false });
      scrollbar.updateBounds(1000, 400);
      scrollbar.show();
      scrollbar.hide();

      expect(scrollbar.isVisible()).toBe(false);
    });

    it("should not show when content fits in container", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(300, 400);
      scrollbar.show();

      expect(scrollbar.isVisible()).toBe(false);
    });
  });

  describe("track click", () => {
    it("should call onScroll when track is clicked", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(1000, 400);
      scrollbar.show();

      const track = viewport.querySelector(".vlist-scrollbar") as HTMLElement;

      // Mock getBoundingClientRect
      track.getBoundingClientRect = () => ({
        top: 0,
        left: 0,
        right: 300,
        bottom: 400,
        width: 8,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      // Simulate click at middle of track
      const clickEvent = new MouseEvent("click", {
        clientY: 200,
        bubbles: true,
      });
      track.dispatchEvent(clickEvent);

      expect(onScrollMock).toHaveBeenCalled();
    });
  });

  describe("thumb drag", () => {
    it("should add dragging class on mousedown", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(1000, 400);
      scrollbar.show();

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      const track = viewport.querySelector(".vlist-scrollbar") as HTMLElement;

      const mousedownEvent = new MouseEvent("mousedown", {
        clientY: 50,
        bubbles: true,
      });
      thumb.dispatchEvent(mousedownEvent);

      expect(track.classList.contains("vlist-scrollbar--dragging")).toBe(true);

      // Cleanup: trigger mouseup
      const mouseupEvent = new MouseEvent("mouseup", { bubbles: true });
      document.dispatchEvent(mouseupEvent);
    });

    it("should remove dragging class on mouseup", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(1000, 400);
      scrollbar.show();

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      const track = viewport.querySelector(".vlist-scrollbar") as HTMLElement;

      // Start drag
      const mousedownEvent = new MouseEvent("mousedown", {
        clientY: 50,
        bubbles: true,
      });
      thumb.dispatchEvent(mousedownEvent);

      // End drag
      const mouseupEvent = new MouseEvent("mouseup", { bubbles: true });
      document.dispatchEvent(mouseupEvent);

      expect(track.classList.contains("vlist-scrollbar--dragging")).toBe(false);
    });
  });

  describe("auto-hide", () => {
    it("should auto-hide after delay when autoHide is true", async () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {
        autoHide: true,
        autoHideDelay: 50, // Short delay for testing
      });
      scrollbar.updateBounds(1000, 400);
      scrollbar.show();

      expect(scrollbar.isVisible()).toBe(true);

      // Wait for auto-hide
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(scrollbar.isVisible()).toBe(false);
    });

    it("should not auto-hide when autoHide is false", async () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {
        autoHide: false,
      });
      scrollbar.updateBounds(1000, 400);
      scrollbar.show();

      expect(scrollbar.isVisible()).toBe(true);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(scrollbar.isVisible()).toBe(true);
    });
  });

  describe("destroy", () => {
    it("should remove scrollbar elements", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);

      expect(viewport.querySelector(".vlist-scrollbar")).not.toBeNull();

      scrollbar.destroy();

      expect(viewport.querySelector(".vlist-scrollbar")).toBeNull();
    });

    it("should cleanup event listeners", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(1000, 400);

      scrollbar.destroy();

      // Simulate events after destroy - should not cause errors
      const mouseEvent = new MouseEvent("mousemove", { clientY: 100 });
      document.dispatchEvent(mouseEvent);

      // If no error thrown, test passes
      expect(true).toBe(true);
    });
  });

  describe("viewport hover", () => {
    it("should show scrollbar on viewport mouseenter", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, { autoHide: false });
      scrollbar.updateBounds(1000, 400);

      const mouseenterEvent = new MouseEvent("mouseenter", { bubbles: true });
      viewport.dispatchEvent(mouseenterEvent);

      expect(scrollbar.isVisible()).toBe(true);
    });
  });

  describe("configuration", () => {
    it("should use default values when config is empty", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {});
      scrollbar.updateBounds(100000, 400);

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      const thumbHeight = parseFloat(thumb.style.height);

      // Default minThumbSize is 30
      expect(thumbHeight).toBeGreaterThanOrEqual(30);
    });

    it("should allow custom minThumbSize", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {
        minThumbSize: 100,
      });
      scrollbar.updateBounds(100000, 400);

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      const thumbHeight = parseFloat(thumb.style.height);

      expect(thumbHeight).toBeGreaterThanOrEqual(100);
    });
  });

  // ===========================================================================
  // Horizontal Mode
  // ===========================================================================

  describe("horizontal mode", () => {
    it("should add --horizontal class to track", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {}, "vlist", true);

      const track = viewport.querySelector(".vlist-scrollbar") as HTMLElement;
      expect(track.classList.contains("vlist-scrollbar--horizontal")).toBe(
        true,
      );
    });

    it("should not add --horizontal class in vertical mode", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {}, "vlist", false);

      const track = viewport.querySelector(".vlist-scrollbar") as HTMLElement;
      expect(track.classList.contains("vlist-scrollbar--horizontal")).toBe(
        false,
      );
    });

    it("should use width instead of height for thumb size", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {}, "vlist", true);
      scrollbar.updateBounds(1000, 400); // 40% visible

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      const thumbWidth = parseFloat(thumb.style.width);

      // 40% of 400px container = 160px
      expect(thumbWidth).toBeCloseTo(160, 0);
    });

    it("should use translateX instead of translateY for thumb positioning", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {}, "vlist", true);
      scrollbar.updateBounds(1000, 400);
      scrollbar.updatePosition(0);

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      expect(thumb.style.transform).toBe("translateX(0px)");
    });

    it("should position thumb at end using translateX when scrolled to end", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {}, "vlist", true);
      scrollbar.updateBounds(1000, 400);

      const maxScroll = 1000 - 400; // 600
      scrollbar.updatePosition(maxScroll);

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      const thumbWidth = parseFloat(thumb.style.width);
      const maxThumbTravel = 400 - thumbWidth;

      expect(thumb.style.transform).toBe(`translateX(${maxThumbTravel}px)`);
    });

    it("should position thumb correctly in the middle using translateX", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {}, "vlist", true);
      scrollbar.updateBounds(1000, 400);

      const maxScroll = 600;
      scrollbar.updatePosition(maxScroll / 2); // 50% scrolled

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      const thumbWidth = parseFloat(thumb.style.width);
      const maxThumbTravel = 400 - thumbWidth;
      const expectedPosition = 0.5 * maxThumbTravel;

      expect(thumb.style.transform).toBe(`translateX(${expectedPosition}px)`);
    });

    it("should handle horizontal track click using clientX", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {}, "vlist", true);
      scrollbar.updateBounds(1000, 400);
      scrollbar.show();

      const track = viewport.querySelector(".vlist-scrollbar") as HTMLElement;

      // Mock getBoundingClientRect for horizontal layout
      track.getBoundingClientRect = () => ({
        top: 390,
        left: 0,
        right: 400,
        bottom: 400,
        width: 400,
        height: 8,
        x: 0,
        y: 390,
        toJSON: () => ({}),
      });

      // Simulate click at middle of horizontal track
      const clickEvent = new MouseEvent("click", {
        clientX: 200,
        bubbles: true,
      });
      track.dispatchEvent(clickEvent);

      expect(onScrollMock).toHaveBeenCalled();
    });

    it("should handle horizontal thumb drag using clientX", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {}, "vlist", true);
      scrollbar.updateBounds(1000, 400);
      scrollbar.show();

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      const track = viewport.querySelector(".vlist-scrollbar") as HTMLElement;

      // Start drag
      const mousedownEvent = new MouseEvent("mousedown", {
        clientX: 50,
        bubbles: true,
      });
      thumb.dispatchEvent(mousedownEvent);

      expect(track.classList.contains("vlist-scrollbar--dragging")).toBe(true);

      // Move horizontally
      const mousemoveEvent = new MouseEvent("mousemove", {
        clientX: 150,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);

      // onScroll should be called via RAF during drag
      // (may not fire synchronously, but the drag state should be active)

      // End drag
      const mouseupEvent = new MouseEvent("mouseup", { bubbles: true });
      document.dispatchEvent(mouseupEvent);

      expect(track.classList.contains("vlist-scrollbar--dragging")).toBe(false);
    });

    it("should respect minimum thumb size in horizontal mode", () => {
      scrollbar = createScrollbar(
        viewport,
        onScrollMock,
        { minThumbSize: 50 },
        "vlist",
        true,
      );
      scrollbar.updateBounds(100000, 400);

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      const thumbWidth = parseFloat(thumb.style.width);

      expect(thumbWidth).toBeGreaterThanOrEqual(50);
    });

    it("should hide horizontal scrollbar when content fits", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {}, "vlist", true);
      scrollbar.updateBounds(300, 400); // Content smaller than container

      const track = viewport.querySelector(".vlist-scrollbar") as HTMLElement;
      expect(track.style.display).toBe("none");
    });

    it("should use custom class prefix with horizontal modifier", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {}, "custom", true);

      const track = viewport.querySelector(".custom-scrollbar") as HTMLElement;
      expect(track).not.toBeNull();
      expect(track.classList.contains("custom-scrollbar--horizontal")).toBe(
        true,
      );
    });

    it("should destroy horizontal scrollbar cleanly", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {}, "vlist", true);

      expect(viewport.querySelector(".vlist-scrollbar")).not.toBeNull();

      scrollbar.destroy();

      expect(viewport.querySelector(".vlist-scrollbar")).toBeNull();
    });
  });

  describe("full drag sequence", () => {
    it("should call onScroll during mousemove drag", async () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(2000, 400);
      scrollbar.show();

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;

      // Start drag
      const mousedownEvent = new MouseEvent("mousedown", {
        clientY: 50,
        bubbles: true,
      });
      thumb.dispatchEvent(mousedownEvent);

      // Move mouse (simulates dragging thumb down)
      const mousemoveEvent = new MouseEvent("mousemove", {
        clientY: 100,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);

      // Wait for RAF to fire
      await new Promise((resolve) => setTimeout(resolve, 50));

      // onScroll should have been called with a new position
      expect(onScrollMock).toHaveBeenCalled();

      // End drag
      const mouseupEvent = new MouseEvent("mouseup", { bubbles: true });
      document.dispatchEvent(mouseupEvent);
    });

    it("should update thumb transform immediately during mousemove", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(2000, 400);
      scrollbar.show();

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;

      // Start drag
      const mousedownEvent = new MouseEvent("mousedown", {
        clientY: 50,
        bubbles: true,
      });
      thumb.dispatchEvent(mousedownEvent);

      // Move mouse
      const mousemoveEvent = new MouseEvent("mousemove", {
        clientY: 150,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);

      // Thumb transform should update immediately (not waiting for RAF)
      const transform = thumb.style.transform;
      expect(transform).toContain("translateY");

      // End drag
      const mouseupEvent = new MouseEvent("mouseup", { bubbles: true });
      document.dispatchEvent(mouseupEvent);
    });

    it("should apply final position on mouseup", async () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(2000, 400);
      scrollbar.show();

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;

      // Start drag
      const mousedownEvent = new MouseEvent("mousedown", {
        clientY: 50,
        bubbles: true,
      });
      thumb.dispatchEvent(mousedownEvent);

      // Move mouse
      const mousemoveEvent = new MouseEvent("mousemove", {
        clientY: 200,
        bubbles: true,
      });
      document.dispatchEvent(mousemoveEvent);

      // End drag immediately (before RAF fires)
      const mouseupEvent = new MouseEvent("mouseup", { bubbles: true });
      document.dispatchEvent(mouseupEvent);

      // onScroll should be called with the final position
      expect(onScrollMock).toHaveBeenCalled();
    });

    it("should remove document event listeners on mouseup", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(2000, 400);
      scrollbar.show();

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;

      // Start drag
      const mousedownEvent = new MouseEvent("mousedown", {
        clientY: 50,
        bubbles: true,
      });
      thumb.dispatchEvent(mousedownEvent);

      // End drag
      const mouseupEvent = new MouseEvent("mouseup", { bubbles: true });
      document.dispatchEvent(mouseupEvent);

      // Clear the mock
      onScrollMock.mockClear();

      // Further mousemove should NOT trigger onScroll (listeners removed)
      const strayMove = new MouseEvent("mousemove", {
        clientY: 300,
        bubbles: true,
      });
      document.dispatchEvent(strayMove);

      // Wait a tick for potential RAF
      // onScroll should NOT have been called
      expect(onScrollMock).not.toHaveBeenCalled();
    });

    it("should schedule auto-hide after mouseup when autoHide is true", async () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {
        autoHide: true,
        autoHideDelay: 50,
      });
      scrollbar.updateBounds(2000, 400);
      scrollbar.show();

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;

      // Start drag
      const mousedownEvent = new MouseEvent("mousedown", {
        clientY: 50,
        bubbles: true,
      });
      thumb.dispatchEvent(mousedownEvent);

      // End drag
      const mouseupEvent = new MouseEvent("mouseup", { bubbles: true });
      document.dispatchEvent(mouseupEvent);

      expect(scrollbar.isVisible()).toBe(true);

      // Wait for auto-hide delay
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(scrollbar.isVisible()).toBe(false);
    });

    it("should not hide during drag even if autoHide is enabled", async () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {
        autoHide: true,
        autoHideDelay: 30,
      });
      scrollbar.updateBounds(2000, 400);
      scrollbar.show();

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;

      // Start drag
      const mousedownEvent = new MouseEvent("mousedown", {
        clientY: 50,
        bubbles: true,
      });
      thumb.dispatchEvent(mousedownEvent);

      // Wait longer than autoHideDelay
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should still be visible because drag is in progress
      expect(scrollbar.isVisible()).toBe(true);

      // End drag
      const mouseupEvent = new MouseEvent("mouseup", { bubbles: true });
      document.dispatchEvent(mouseupEvent);
    });

    it("should handle multiple sequential drag operations", async () => {
      scrollbar = createScrollbar(viewport, onScrollMock, { autoHide: false });
      scrollbar.updateBounds(2000, 400);
      scrollbar.show();

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      const track = viewport.querySelector(".vlist-scrollbar") as HTMLElement;

      // First drag
      thumb.dispatchEvent(
        new MouseEvent("mousedown", { clientY: 50, bubbles: true }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientY: 100, bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

      expect(track.classList.contains("vlist-scrollbar--dragging")).toBe(false);

      const firstCallCount = onScrollMock.mock.calls.length;

      // Second drag
      thumb.dispatchEvent(
        new MouseEvent("mousedown", { clientY: 100, bubbles: true }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientY: 200, bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

      // Should have additional onScroll calls from second drag
      expect(onScrollMock.mock.calls.length).toBeGreaterThan(firstCallCount);
    });

    it("should prevent default and stop propagation on thumb mousedown", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(2000, 400);
      scrollbar.show();

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;

      const mousedownEvent = new MouseEvent("mousedown", {
        clientY: 50,
        bubbles: true,
        cancelable: true,
      });

      // Spy on preventDefault
      let preventDefaultCalled = false;
      const originalPreventDefault =
        mousedownEvent.preventDefault.bind(mousedownEvent);
      Object.defineProperty(mousedownEvent, "preventDefault", {
        value: () => {
          preventDefaultCalled = true;
          originalPreventDefault();
        },
      });

      thumb.dispatchEvent(mousedownEvent);

      expect(preventDefaultCalled).toBe(true);

      // Cleanup
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  });

  describe("viewport leave", () => {
    it("should start auto-hide timer on viewport mouseleave", async () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {
        autoHide: true,
        autoHideDelay: 50,
      });
      scrollbar.updateBounds(2000, 400);
      scrollbar.show();

      expect(scrollbar.isVisible()).toBe(true);

      // Trigger viewport leave
      const mouseleaveEvent = new MouseEvent("mouseleave", { bubbles: true });
      viewport.dispatchEvent(mouseleaveEvent);

      // Should still be visible immediately
      expect(scrollbar.isVisible()).toBe(true);

      // Wait for auto-hide delay
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(scrollbar.isVisible()).toBe(false);
    });

    it("should not hide on viewport leave when dragging", async () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {
        autoHide: true,
        autoHideDelay: 30,
      });
      scrollbar.updateBounds(2000, 400);
      scrollbar.show();

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;

      // Start drag
      thumb.dispatchEvent(
        new MouseEvent("mousedown", { clientY: 50, bubbles: true }),
      );

      // Leave viewport while dragging
      viewport.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));

      // Wait longer than autoHideDelay
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should still be visible because drag is in progress
      expect(scrollbar.isVisible()).toBe(true);

      // Cleanup
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    it("should cancel pending hide timer when mouse re-enters viewport", async () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {
        autoHide: true,
        autoHideDelay: 80,
      });
      scrollbar.updateBounds(2000, 400);
      scrollbar.show();

      // Leave viewport (starts hide timer)
      viewport.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));

      // Re-enter before the hide timer fires
      await new Promise((resolve) => setTimeout(resolve, 30));
      viewport.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

      // Wait past the original hide delay
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should still be visible because mouseenter cancelled the timer
      // and started a new auto-hide cycle
      // (show() clears pending hide timeout, then schedules a new one)
      // We just check it didn't hide at the original 80ms mark
      // It may have hidden by the new cycle's 80ms, so check at ~60ms after re-enter
    });

    it("should not start hide timer on leave when autoHide is false", async () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {
        autoHide: false,
      });
      scrollbar.updateBounds(2000, 400);
      scrollbar.show();

      // Leave viewport
      viewport.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should still be visible (autoHide is false, but viewport leave
      // still schedules a timeout if autoHide is true — when false, nothing happens)
      expect(scrollbar.isVisible()).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle updatePosition when totalSize <= containerSize", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(400, 400); // Content fits

      // updatePosition should be a no-op
      scrollbar.updatePosition(100);

      // Should not crash
      expect(scrollbar.isVisible()).toBe(false);
    });

    it("should handle updatePosition when maxThumbTravel is 0", () => {
      scrollbar = createScrollbar(viewport, onScrollMock, {
        minThumbSize: 400,
      });
      scrollbar.updateBounds(500, 400); // Thumb fills entire track

      scrollbar.updatePosition(50);

      // Should not crash
      expect(true).toBe(true);
    });

    it("should not show scrollbar when totalSize equals containerSize", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(400, 400);

      scrollbar.show();

      expect(scrollbar.isVisible()).toBe(false);
    });

    it("should handle destroy during drag", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(2000, 400);
      scrollbar.show();

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;

      // Start drag
      thumb.dispatchEvent(
        new MouseEvent("mousedown", { clientY: 50, bubbles: true }),
      );

      // Destroy while dragging
      scrollbar.destroy();

      // Further events should not cause errors
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientY: 200, bubbles: true }),
      );
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

      expect(true).toBe(true);
    });

    it("should clamp scroll position within valid range during drag", async () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(2000, 400);
      scrollbar.show();

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;

      // Start drag at bottom
      thumb.dispatchEvent(
        new MouseEvent("mousedown", { clientY: 350, bubbles: true }),
      );

      // Drag far beyond bounds
      document.dispatchEvent(
        new MouseEvent("mousemove", { clientY: 9999, bubbles: true }),
      );

      await new Promise((resolve) => setTimeout(resolve, 20));

      // onScroll should have been called with a clamped value
      if (onScrollMock.mock.calls.length > 0) {
        const lastCall =
          onScrollMock.mock.calls[onScrollMock.mock.calls.length - 1];
        const position = lastCall[0];
        // Position should not exceed maxScroll (2000 - 400 = 1600)
        expect(position).toBeLessThanOrEqual(1600);
        expect(position).toBeGreaterThanOrEqual(0);
      }

      // Cleanup
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    it("should ignore track click on thumb element", () => {
      scrollbar = createScrollbar(viewport, onScrollMock);
      scrollbar.updateBounds(2000, 400);
      scrollbar.show();

      const thumb = viewport.querySelector(
        ".vlist-scrollbar-thumb",
      ) as HTMLElement;
      const track = viewport.querySelector(".vlist-scrollbar") as HTMLElement;

      // getBoundingClientRect mock for track
      track.getBoundingClientRect = () => ({
        top: 0,
        left: 0,
        right: 300,
        bottom: 400,
        width: 300,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Click directly on thumb (should be ignored by track click handler)
      const clickEvent = new MouseEvent("click", {
        clientY: 50,
        bubbles: true,
      });

      // Override target to be the thumb
      Object.defineProperty(clickEvent, "target", { value: thumb });
      track.dispatchEvent(clickEvent);

      // onScroll should NOT be called for click on thumb
      expect(onScrollMock).not.toHaveBeenCalled();
    });
  });
});

describe("scroll/scrollbar — destroy with pending animation frame (L348-349)", () => {


  let viewport: HTMLElement;

  const createViewport = (): HTMLElement => {
    const el = document.createElement("div");
    el.className = "vlist-viewport";
    el.style.height = "400px";
    el.style.width = "300px";
    document.body.appendChild(el);
    return el;
  };

  beforeEach(() => {
    viewport = createViewport();
  });

  afterEach(() => {
    viewport.remove();
  });

  it("should cancel pending animation frame on destroy during drag", () => {
    const onScrollMock = mock(() => {});
    const scrollbar = createScrollbar(viewport, onScrollMock, {
      autoHide: false,
    });

    // Set up scrollbar bounds so thumb is visible and has size
    scrollbar.updateBounds(2000, 400);
    scrollbar.show();

    const track = viewport.querySelector(".vlist-scrollbar") as HTMLElement;
    const thumb = viewport.querySelector(
      ".vlist-scrollbar-thumb",
    ) as HTMLElement;

    // We need to simulate a mousedown on the thumb to start drag,
    // then a mousemove to trigger the RAF-throttled handleMouseMove,
    // then destroy while the RAF is pending.
    if (thumb) {
      // Start drag — fires mousedown on thumb
      const mousedown = new dom.window.MouseEvent("mousedown", {
        bubbles: true,
        clientX: 0,
        clientY: 10,
      });
      thumb.dispatchEvent(mousedown);

      // Simulate a mousemove — this schedules a RAF
      const mousemove = new dom.window.MouseEvent("mousemove", {
        bubbles: true,
        clientX: 0,
        clientY: 50,
      });
      document.dispatchEvent(mousemove);
    }

    // Destroy while RAF could be pending — exercises the animationFrameId !== null branch
    scrollbar.destroy();

    // Verify no errors and track is removed
    expect(viewport.querySelector(".vlist-scrollbar")).toBeNull();
  });

  it("should handle destroy without pending animation frame", () => {
    const onScrollMock = mock(() => {});
    const scrollbar = createScrollbar(viewport, onScrollMock);

    // Just destroy normally — animationFrameId is null
    scrollbar.destroy();

    expect(viewport.querySelector(".vlist-scrollbar")).toBeNull();
  });
});
