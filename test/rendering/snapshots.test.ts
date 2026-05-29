/**
 * vlist v2 — DOM Structure Snapshot Tests
 *
 * Verifies that createVList() produces the correct DOM tree for
 * different configurations: vertical list, horizontal list, and
 * custom classPrefix.
 *
 * Hierarchy: container > root > viewport > content > items
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";

// =============================================================================
// Global DOM Setup
// =============================================================================

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  setupDOM();
  origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 500, configurable: true });
});

afterAll(() => {
  if (origClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", origClientHeight);
  if (origClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", origClientWidth);
  teardownDOM();
});

// =============================================================================
// Helpers
// =============================================================================

function createList(overrides: Partial<Parameters<typeof createVList<TestItem>>[0]> = {}): {
  container: HTMLElement;
  list: VList<TestItem>;
} {
  const container = createContainer();
  const items = createTestItems(20);
  const list = createVList<TestItem>({
    container,
    item: { height: 40, template: simpleTemplate },
    items,
    ...overrides,
  });
  return { container, list };
}

// =============================================================================
// DOM snapshots — base list
// =============================================================================

describe("DOM snapshots — base list", () => {
  it("vertical list has root > viewport > content nesting", () => {
    const { container, list } = createList();

    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.tagName).toBe("DIV");

    const viewport = root.firstElementChild as HTMLElement;
    expect(viewport).toBeTruthy();
    expect(viewport.tagName).toBe("DIV");

    const content = viewport.firstElementChild as HTMLElement;
    expect(content).toBeTruthy();
    expect(content.tagName).toBe("DIV");

    // Verify the nesting: root is child of container, viewport is child of root, content is child of viewport
    expect(root.parentElement).toBe(container);
    expect(viewport.parentElement).toBe(root);
    expect(content.parentElement).toBe(viewport);

    list.destroy();
    container.remove();
  });

  it("root has vlist class", () => {
    const { container, list } = createList();

    const root = container.querySelector(".vlist") as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.classList.contains("vlist")).toBe(true);

    list.destroy();
    container.remove();
  });

  it("viewport has vlist-viewport class with overflow styles", () => {
    const { container, list } = createList();

    const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
    expect(viewport).toBeTruthy();
    expect(viewport.classList.contains("vlist-viewport")).toBe(true);

    // Vertical viewport should have overflow:auto
    const style = viewport.getAttribute("style") ?? "";
    expect(style).toContain("overflow");
    expect(style).toContain("height:100%");
    expect(style).toContain("width:100%");

    // Viewport should have tabindex=-1 for programmatic focus
    expect(viewport.getAttribute("tabindex")).toBe("-1");

    list.destroy();
    container.remove();
  });

  it("content has role=list and no tabindex by default", () => {
    const { container, list } = createList();

    const content = container.querySelector(".vlist-content") as HTMLElement;
    expect(content).toBeTruthy();
    expect(content.getAttribute("role")).toBe("list");
    expect(content.hasAttribute("tabindex")).toBe(false);

    list.destroy();
    container.remove();
  });

  it("rendered items have data-index and data-id attributes", () => {
    const { container, list } = createList();

    const content = container.querySelector(".vlist-content") as HTMLElement;
    const itemElements = content.querySelectorAll("[data-index]");
    expect(itemElements.length).toBeGreaterThan(0);

    for (const el of itemElements) {
      const dataIndex = el.getAttribute("data-index");
      expect(dataIndex).toBeTruthy();
      expect(Number.isNaN(parseInt(dataIndex!, 10))).toBe(false);

      const dataId = el.getAttribute("data-id");
      expect(dataId).toBeTruthy();
    }

    list.destroy();
    container.remove();
  });

  it("rendered items have role=listitem by default", () => {
    const { container, list } = createList();

    const content = container.querySelector(".vlist-content") as HTMLElement;
    const itemElements = content.querySelectorAll("[data-index]");
    expect(itemElements.length).toBeGreaterThan(0);

    for (const el of itemElements) {
      expect(el.getAttribute("role")).toBe("listitem");
    }

    list.destroy();
    container.remove();
  });

  it("items have translateY positioning", () => {
    const { container, list } = createList();

    const content = container.querySelector(".vlist-content") as HTMLElement;
    const itemElements = content.querySelectorAll("[data-index]");
    expect(itemElements.length).toBeGreaterThan(0);

    for (const el of itemElements) {
      const htmlEl = el as HTMLElement;
      const transform = htmlEl.style.transform;
      expect(transform).toMatch(/translateY\(\d+px\)/);
    }

    list.destroy();
    container.remove();
  });
});

// =============================================================================
// DOM snapshots — horizontal list
// =============================================================================

describe("DOM snapshots — horizontal list", () => {
  it("horizontal list has --horizontal modifier", () => {
    const { container, list } = createList({
      orientation: "horizontal",
      item: { width: 100, template: simpleTemplate },
    });

    const root = container.querySelector(".vlist") as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.classList.contains("vlist--horizontal")).toBe(true);

    list.destroy();
    container.remove();
  });

  it("content has aria-orientation=horizontal", () => {
    const { container, list } = createList({
      orientation: "horizontal",
      item: { width: 100, template: simpleTemplate },
    });

    const content = container.querySelector(".vlist-content") as HTMLElement;
    expect(content).toBeTruthy();
    expect(content.getAttribute("aria-orientation")).toBe("horizontal");

    list.destroy();
    container.remove();
  });

  it("items use translateX positioning", () => {
    const { container, list } = createList({
      orientation: "horizontal",
      item: { width: 100, template: simpleTemplate },
    });

    const content = container.querySelector(".vlist-content") as HTMLElement;
    const itemElements = content.querySelectorAll("[data-index]");
    expect(itemElements.length).toBeGreaterThan(0);

    for (const el of itemElements) {
      const htmlEl = el as HTMLElement;
      const transform = htmlEl.style.transform;
      expect(transform).toMatch(/translateX\(\d+px\)/);
    }

    list.destroy();
    container.remove();
  });
});

// =============================================================================
// DOM snapshots — custom classPrefix
// =============================================================================

describe("DOM snapshots — custom classPrefix", () => {
  it("custom prefix applies to all elements", () => {
    const { container, list } = createList({
      classPrefix: "mylist",
    });

    const root = container.querySelector(".mylist") as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.classList.contains("mylist")).toBe(true);

    const viewport = container.querySelector(".mylist-viewport") as HTMLElement;
    expect(viewport).toBeTruthy();

    const content = container.querySelector(".mylist-content") as HTMLElement;
    expect(content).toBeTruthy();

    // Items should have the custom prefix class
    const itemElements = content.querySelectorAll("[data-index]");
    expect(itemElements.length).toBeGreaterThan(0);
    for (const el of itemElements) {
      expect((el as HTMLElement).classList.contains("mylist-item")).toBe(true);
    }

    list.destroy();
    container.remove();
  });

  it("custom prefix used in modifier classes", () => {
    const { container, list } = createList({
      classPrefix: "mylist",
      orientation: "horizontal",
      item: { width: 100, template: simpleTemplate },
    });

    const root = container.querySelector(".mylist") as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.classList.contains("mylist--horizontal")).toBe(true);

    // Live region also uses the custom prefix
    const liveRegion = container.querySelector(".mylist-live") as HTMLElement;
    expect(liveRegion).toBeTruthy();
    expect(liveRegion.getAttribute("aria-live")).toBe("polite");

    list.destroy();
    container.remove();
  });
});

// =============================================================================
// DOM snapshots — focusable descendant neutralization
// =============================================================================

describe("DOM snapshots — focusable neutralization", () => {
  const linkTemplate = (item: TestItem): string =>
    `<div class="item"><a href="https://example.com">${item.name}</a><button>Action</button></div>`;

  it("links inside rendered items have tabindex=-1", () => {
    const container = createContainer();
    const items = createTestItems(20);
    const list = createVList<TestItem>({
      container,
      item: { height: 40, template: linkTemplate },
      items,
    });

    const links = container.querySelectorAll("a[href]");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("tabindex")).toBe("-1");
    }

    list.destroy();
    container.remove();
  });

  it("buttons inside rendered items have tabindex=-1", () => {
    const container = createContainer();
    const items = createTestItems(20);
    const list = createVList<TestItem>({
      container,
      item: { height: 40, template: linkTemplate },
      items,
    });

    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
      expect(btn.getAttribute("tabindex")).toBe("-1");
    }

    list.destroy();
    container.remove();
  });

  it("items without focusable descendants are unaffected", () => {
    const container = createContainer();
    const items = createTestItems(20);
    const list = createVList<TestItem>({
      container,
      item: { height: 40, template: simpleTemplate },
      items,
    });

    const content = container.querySelector(".vlist-content") as HTMLElement;
    const itemEls = content.querySelectorAll("[data-index]");
    expect(itemEls.length).toBeGreaterThan(0);
    for (const el of itemEls) {
      expect(el.querySelectorAll("[tabindex]").length).toBe(0);
    }

    list.destroy();
    container.remove();
  });

  it("neutralization applies after setItems replaces content", () => {
    const container = createContainer();
    const items = createTestItems(10);
    const list = createVList<TestItem>({
      container,
      item: { height: 40, template: linkTemplate },
      items,
    });

    const newItems = createTestItems(10).map((item, i) => ({
      ...item,
      id: i + 100,
      name: `New ${i}`,
    }));
    list.setItems(newItems);

    const links = container.querySelectorAll("a[href]");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("tabindex")).toBe("-1");
    }

    list.destroy();
    container.remove();
  });
});
