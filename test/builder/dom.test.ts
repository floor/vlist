/**
 * vlist - Builder DOM Tests
 *
 * NOTE: The functions exported by builder/dom.ts (resolveContainer,
 * createDOMStructure) are duplicates of the same logic in
 * rendering/renderer.ts, which is comprehensively tested in
 * rendering/renderer.test.ts (13 tests covering container resolution,
 * DOM structure creation, aria-label, horizontal mode, class prefix,
 * nesting, overflow styles, and content/items positioning).
 *
 * Coverage: 97.96% lines, 100% functions (via builder integration tests).
 *
 * This file exists to maintain the 1:1 source↔test mapping convention.
 * Add tests here only for builder/dom.ts behavior that diverges from
 * the rendering/renderer.ts implementation.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { resolveContainer, createDOMStructure } from "../../src/builder/dom";

// =============================================================================
// JSDOM Setup
// =============================================================================

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

// =============================================================================
// resolveContainer
// =============================================================================

describe("resolveContainer", () => {
  it("should return element directly when passed an HTMLElement", () => {
    const el = document.createElement("div");
    expect(resolveContainer(el)).toBe(el);
  });

  it("should resolve element from string selector", () => {
    const el = document.createElement("div");
    el.id = "builder-dom-test";
    document.body.appendChild(el);

    expect(resolveContainer("#builder-dom-test")).toBe(el);

    el.remove();
  });

  it("should throw with builder-specific error message for missing selector", () => {
    expect(() => resolveContainer("#nonexistent-element")).toThrow(
      "[vlist/builder] Container not found: #nonexistent-element",
    );
  });
});

// =============================================================================
// createDOMStructure
// =============================================================================

describe("createDOMStructure", () => {
  it("should create root, viewport, content, items, and liveRegion elements", () => {
    const container = document.createElement("div");
    const { root, viewport, content, items, liveRegion } = createDOMStructure(
      container,
      "vlist",
    );

    expect(root).toBeInstanceOf(HTMLElement);
    expect(viewport).toBeInstanceOf(HTMLElement);
    expect(content).toBeInstanceOf(HTMLElement);
    expect(items).toBeInstanceOf(HTMLElement);
    expect(liveRegion).toBeInstanceOf(HTMLElement);
  });

  it("should nest elements correctly: container > root > viewport > content > items", () => {
    const container = document.createElement("div");
    const { root, viewport, content, items } = createDOMStructure(
      container,
      "vlist",
    );

    expect(root.parentElement).toBe(container);
    expect(viewport.parentElement).toBe(root);
    expect(content.parentElement).toBe(viewport);
    expect(items.parentElement).toBe(content);
  });

  it("should apply class prefix to all elements", () => {
    const container = document.createElement("div");
    const { root, viewport, content, items } = createDOMStructure(
      container,
      "my-list",
    );

    expect(root.className).toBe("my-list");
    expect(viewport.className).toBe("my-list-viewport");
    expect(content.className).toBe("my-list-content");
    expect(items.className).toBe("my-list-items");
  });

  it("should set listbox role on items and tabindex on root", () => {
    const container = document.createElement("div");
    const { root, items } = createDOMStructure(container, "vlist");

    expect(root.getAttribute("role")).toBeNull();
    expect(root.getAttribute("tabindex")).toBe("0");
    expect(items.getAttribute("role")).toBe("listbox");
  });

  it("should add aria-label when provided", () => {
    const container = document.createElement("div");
    const { items } = createDOMStructure(container, "vlist", "My List");

    expect(items.getAttribute("aria-label")).toBe("My List");
  });

  it("should not add aria-label when not provided", () => {
    const container = document.createElement("div");
    const { items } = createDOMStructure(container, "vlist");

    expect(items.hasAttribute("aria-label")).toBe(false);
  });

  it("should configure vertical mode by default", () => {
    const container = document.createElement("div");
    const { root, viewport, content, items } = createDOMStructure(
      container,
      "vlist",
    );

    expect(root.classList.contains("vlist--horizontal")).toBe(false);
    expect(items.hasAttribute("aria-orientation")).toBe(false);
    expect(viewport.style.overflow).toBe("auto");
    expect(content.style.width).toBe("100%");
  });

  it("should configure horizontal mode when specified", () => {
    const container = document.createElement("div");
    const { root, viewport, items } = createDOMStructure(
      container,
      "vlist",
      undefined,
      true,
    );

    expect(root.classList.contains("vlist--horizontal")).toBe(true);
    expect(items.getAttribute("aria-orientation")).toBe("horizontal");
    expect(viewport.style.overflowX).toBe("auto");
    expect(viewport.style.overflowY).toBe("hidden");
  });

  // ── ARIA live region (#13b) ─────────────────────────────────────

  it("should create a visually-hidden ARIA live region", () => {
    const container = document.createElement("div");
    const { liveRegion } = createDOMStructure(container, "vlist");

    expect(liveRegion).toBeInstanceOf(HTMLElement);
    expect(liveRegion.getAttribute("aria-live")).toBe("polite");
    expect(liveRegion.getAttribute("aria-atomic")).toBe("true");
    expect(liveRegion.getAttribute("role")).toBe("status");
    expect(liveRegion.className).toBe("vlist-live");
  });

  it("should visually hide the live region with clip-rect technique", () => {
    const container = document.createElement("div");
    const { liveRegion } = createDOMStructure(container, "vlist");

    expect(liveRegion.style.position).toBe("absolute");
    expect(liveRegion.style.width).toBe("1px");
    expect(liveRegion.style.height).toBe("1px");
    expect(liveRegion.style.overflow).toBe("hidden");
    // JSDOM normalizes clip rect values with units
    expect(liveRegion.style.clip).toMatch(/rect\(0(px)?,\s*0(px)?,\s*0(px)?,\s*0(px)?\)/);
  });

  it("should place live region as a direct child of root", () => {
    const container = document.createElement("div");
    const { root, liveRegion } = createDOMStructure(container, "vlist");

    expect(liveRegion.parentElement).toBe(root);
  });

  it("should use class prefix for live region class name", () => {
    const container = document.createElement("div");
    const { liveRegion } = createDOMStructure(container, "my-list");

    expect(liveRegion.className).toBe("my-list-live");
  });
});