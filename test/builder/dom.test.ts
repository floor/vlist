/**
 * vlist v2 - Core DOM Tests
 *
 * Tests the core DOM structure creation functions:
 * - resolveContainer: resolve HTML elements or selectors
 * - createDOMStructure: create and configure root > viewport > content hierarchy
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { resolveContainer, createDOMStructure } from "../../src/core/dom";

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
      "[vlist] Container not found: #nonexistent-element",
    );
  });
});

// =============================================================================
// createDOMStructure
// =============================================================================

describe("createDOMStructure", () => {
  it("should create root, viewport, and content elements", () => {
    const container = document.createElement("div");
    const { root, viewport, content } = createDOMStructure(
      container,
      "vlist",
      false,
      true,
    );

    expect(root).toBeInstanceOf(HTMLElement);
    expect(viewport).toBeInstanceOf(HTMLElement);
    expect(content).toBeInstanceOf(HTMLElement);
  });

  it("should nest elements correctly: container > root > viewport > content", () => {
    const container = document.createElement("div");
    const { root, viewport, content } = createDOMStructure(
      container,
      "vlist",
      false,
      true,
    );

    expect(root.parentElement).toBe(container);
    expect(viewport.parentElement).toBe(root);
    expect(content.parentElement).toBe(viewport);
  });

  it("should apply class prefix to all elements", () => {
    const container = document.createElement("div");
    const { root, viewport, content } = createDOMStructure(
      container,
      "my-list",
      false,
      true,
    );

    expect(root.className).toBe("my-list");
    expect(viewport.className).toBe("my-list-viewport");
    expect(content.className).toBe("my-list-content");
  });

  it("should set listbox role and tabindex on content", () => {
    const container = document.createElement("div");
    const { root, content } = createDOMStructure(container, "vlist", false, true);

    expect(root.getAttribute("role")).toBeNull();
    expect(root.getAttribute("tabindex")).toBeNull();
    expect(content.getAttribute("role")).toBe("listbox");
    expect(content.getAttribute("tabindex")).toBe("0");
  });

  it("should downgrade to list role when interactive is false", () => {
    const container = document.createElement("div");
    const { content } = createDOMStructure(container, "vlist", false, false);

    expect(content.getAttribute("role")).toBe("list");
    expect(content.hasAttribute("tabindex")).toBe(false);
  });

  it("should use listbox role when interactive is true", () => {
    const container = document.createElement("div");
    const { content } = createDOMStructure(container, "vlist", false, true);

    expect(content.getAttribute("role")).toBe("listbox");
    expect(content.getAttribute("tabindex")).toBe("0");
  });

  it("should add aria-label when provided", () => {
    const container = document.createElement("div");
    const { content } = createDOMStructure(container, "vlist", false, true, "My List");

    expect(content.getAttribute("aria-label")).toBe("My List");
  });

  it("should not add aria-label when not provided", () => {
    const container = document.createElement("div");
    const { content } = createDOMStructure(container, "vlist", false, true);

    expect(content.hasAttribute("aria-label")).toBe(false);
  });

  it("should configure vertical mode by default", () => {
    const container = document.createElement("div");
    const { root, viewport, content } = createDOMStructure(
      container,
      "vlist",
      false,
      true,
    );

    expect(root.classList.contains("vlist--horizontal")).toBe(false);
    expect(content.hasAttribute("aria-orientation")).toBe(false);
    expect(viewport.style.overflow).toBe("auto");
    expect(viewport.style.height).toBe("100%");
    expect(viewport.style.width).toBe("100%");
  });

  it("should configure horizontal mode when specified", () => {
    const container = document.createElement("div");
    const { root, viewport, content } = createDOMStructure(
      container,
      "vlist",
      true,
      true,
    );

    expect(root.classList.contains("vlist--horizontal")).toBe(true);
    expect(content.getAttribute("aria-orientation")).toBe("horizontal");
    expect(viewport.style.overflowX).toBe("auto");
    expect(viewport.style.overflowY).toBe("hidden");
  });
});
