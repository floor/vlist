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
import { JSDOM } from "jsdom";
import { resolveContainer, createDOMStructure } from "../../src/builder/dom";

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
});

afterAll(() => {
  global.document = originalDocument;
  global.window = originalWindow;
});

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
  it("should create root, viewport, content, and items elements", () => {
    const container = document.createElement("div");
    const { root, viewport, content, items } = createDOMStructure(
      container,
      "vlist",
    );

    expect(root).toBeInstanceOf(HTMLElement);
    expect(viewport).toBeInstanceOf(HTMLElement);
    expect(content).toBeInstanceOf(HTMLElement);
    expect(items).toBeInstanceOf(HTMLElement);
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

  it("should set listbox role and tabindex on root", () => {
    const container = document.createElement("div");
    const { root } = createDOMStructure(container, "vlist");

    expect(root.getAttribute("role")).toBe("listbox");
    expect(root.getAttribute("tabindex")).toBe("0");
  });

  it("should add aria-label when provided", () => {
    const container = document.createElement("div");
    const { root } = createDOMStructure(container, "vlist", "My List");

    expect(root.getAttribute("aria-label")).toBe("My List");
  });

  it("should not add aria-label when not provided", () => {
    const container = document.createElement("div");
    const { root } = createDOMStructure(container, "vlist");

    expect(root.hasAttribute("aria-label")).toBe(false);
  });

  it("should configure vertical mode by default", () => {
    const container = document.createElement("div");
    const { root, viewport, content } = createDOMStructure(
      container,
      "vlist",
    );

    expect(root.classList.contains("vlist--horizontal")).toBe(false);
    expect(root.hasAttribute("aria-orientation")).toBe(false);
    expect(viewport.style.overflow).toBe("auto");
    expect(content.style.width).toBe("100%");
  });

  it("should configure horizontal mode when specified", () => {
    const container = document.createElement("div");
    const { root, viewport } = createDOMStructure(
      container,
      "vlist",
      undefined,
      true,
    );

    expect(root.classList.contains("vlist--horizontal")).toBe(true);
    expect(root.getAttribute("aria-orientation")).toBe("horizontal");
    expect(viewport.style.overflowX).toBe("auto");
    expect(viewport.style.overflowY).toBe("hidden");
  });
});