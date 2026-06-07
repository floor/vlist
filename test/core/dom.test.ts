/**
 * vlist v2 - Core DOM Tests
 *
 * Tests the core DOM structure creation functions:
 * - resolveContainer: resolve HTML elements or selectors
 * - createDOMStructure: create and configure root > viewport > content hierarchy
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { resolveContainer, createDOMStructure, neutralizeFocusable } from "../../src/core/dom";

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
    );

    expect(root.className).toBe("my-list");
    expect(viewport.className).toBe("my-list-viewport");
    expect(content.className).toBe("my-list-content");
  });

  it("should set list role and no tabindex on content by default", () => {
    const container = document.createElement("div");
    const { root, content } = createDOMStructure(container, "vlist", false);

    expect(root.getAttribute("role")).toBeNull();
    expect(root.getAttribute("tabindex")).toBeNull();
    expect(content.getAttribute("role")).toBe("list");
    expect(content.hasAttribute("tabindex")).toBe(false);
  });

  it("should add aria-label when provided", () => {
    const container = document.createElement("div");
    const { content } = createDOMStructure(container, "vlist", false, "My List");

    expect(content.getAttribute("aria-label")).toBe("My List");
  });

  it("should not add aria-label when not provided", () => {
    const container = document.createElement("div");
    const { content } = createDOMStructure(container, "vlist", false);

    expect(content.hasAttribute("aria-label")).toBe(false);
  });

  it("should configure vertical mode by default", () => {
    const container = document.createElement("div");
    const { root, viewport, content } = createDOMStructure(
      container,
      "vlist",
      false,
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
    );

    expect(root.classList.contains("vlist--horizontal")).toBe(true);
    expect(content.getAttribute("aria-orientation")).toBe("horizontal");
    expect(viewport.style.overflowX).toBe("auto");
    expect(viewport.style.overflowY).toBe("hidden");
  });

  it("should disable native scroll anchoring on content (RFC-012 G3)", () => {
    const vertical = createDOMStructure(document.createElement("div"), "vlist", false);
    const horizontal = createDOMStructure(document.createElement("div"), "vlist", true);

    expect(vertical.content.style.overflowAnchor).toBe("none");
    expect(horizontal.content.style.overflowAnchor).toBe("none");
  });
});

// =============================================================================
// neutralizeFocusable
// =============================================================================

describe("neutralizeFocusable", () => {
  it("should set tabindex=-1 on anchor elements with href", () => {
    const el = document.createElement("div");
    el.innerHTML = '<a href="https://example.com">Link</a>';
    neutralizeFocusable(el);
    expect(el.querySelector("a")!.getAttribute("tabindex")).toBe("-1");
  });

  it("should set tabindex=-1 on buttons", () => {
    const el = document.createElement("div");
    el.innerHTML = "<button>Click</button>";
    neutralizeFocusable(el);
    expect(el.querySelector("button")!.getAttribute("tabindex")).toBe("-1");
  });

  it("should set tabindex=-1 on form elements", () => {
    const el = document.createElement("div");
    el.innerHTML = '<input type="text"><select><option>A</option></select><textarea></textarea>';
    neutralizeFocusable(el);
    expect(el.querySelector("input")!.getAttribute("tabindex")).toBe("-1");
    expect(el.querySelector("select")!.getAttribute("tabindex")).toBe("-1");
    expect(el.querySelector("textarea")!.getAttribute("tabindex")).toBe("-1");
  });

  it("should set tabindex=-1 on elements with explicit tabindex", () => {
    const el = document.createElement("div");
    el.innerHTML = '<div tabindex="0">Focusable div</div>';
    neutralizeFocusable(el);
    expect(el.querySelector("[tabindex]")!.getAttribute("tabindex")).toBe("-1");
  });

  it("should handle multiple focusable descendants", () => {
    const el = document.createElement("div");
    el.innerHTML = '<a href="#">L1</a><button>B1</button><a href="#">L2</a><input>';
    neutralizeFocusable(el);
    const all = el.querySelectorAll("[tabindex]");
    expect(all.length).toBe(4);
    for (const node of all) {
      expect(node.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("should not affect anchors without href", () => {
    const el = document.createElement("div");
    el.innerHTML = "<a>Not focusable</a>";
    neutralizeFocusable(el);
    expect(el.querySelector("a")!.hasAttribute("tabindex")).toBe(false);
  });

  it("should be a no-op when no focusable descendants exist", () => {
    const el = document.createElement("div");
    el.innerHTML = "<div><span>Text</span><p>Paragraph</p></div>";
    neutralizeFocusable(el);
    expect(el.querySelectorAll("[tabindex]").length).toBe(0);
  });

  it("should handle nested focusable elements", () => {
    const el = document.createElement("div");
    el.innerHTML = '<div><span><a href="#">Deep link</a></span></div>';
    neutralizeFocusable(el);
    expect(el.querySelector("a")!.getAttribute("tabindex")).toBe("-1");
  });
});
