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
import { createScrollbar, type Scrollbar } from "../src/core/scrollbar";

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
  global.MouseEvent = dom.window.MouseEvent;
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
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
});
