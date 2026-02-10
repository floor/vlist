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
});
