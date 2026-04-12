/**
 * vlist - withAutoSize Feature Tests
 * Tests for: factory shape, validation, setup (size cache replacement,
 * constrain-size injection, afterRenderBatch observation), idle flush,
 * destroy cleanup.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { JSDOM } from "jsdom";

import { withAutoSize } from "../../../src/features/autosize";
import { vlist } from "../../../src/builder/core";
import type { VList } from "../../../src/builder/types";
import type { VListItem } from "../../../src/types";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    pretendToBeVisual: true,
  });

  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Element = dom.window.Element;
  global.Node = dom.window.Node;
  global.MutationObserver = dom.window.MutationObserver;
  global.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number;
  global.cancelAnimationFrame = clearTimeout;
  global.matchMedia = () =>
    ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as any;

  // Mock ResizeObserver — fires synchronously with configurable sizes
  (global as any).ResizeObserver = class {
    callback: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.callback = cb; }
    observe(target: Element) {
      const indexAttr = (target as HTMLElement).dataset?.index;
      if (indexAttr != null) {
        const size = 80; // default measured size
        this.callback(
          [{
            target,
            contentRect: { width: size, height: size, top: 0, left: 0, bottom: size, right: size, x: 0, y: 0, toJSON: () => ({}) },
            borderBoxSize: [{ blockSize: size, inlineSize: size } as ResizeObserverSize],
            contentBoxSize: [{ blockSize: size, inlineSize: size } as ResizeObserverSize],
            devicePixelContentBoxSize: [],
          } as ResizeObserverEntry],
          this as any,
        );
      } else {
        // Container observation
        this.callback(
          [{
            target,
            contentRect: { width: 300, height: 500, top: 0, left: 0, bottom: 500, right: 300, x: 0, y: 0, toJSON: () => ({}) },
            borderBoxSize: [{ blockSize: 500, inlineSize: 300 } as ResizeObserverSize],
            contentBoxSize: [{ blockSize: 500, inlineSize: 300 } as ResizeObserverSize],
            devicePixelContentBoxSize: [],
          } as ResizeObserverEntry],
          this as any,
        );
      }
    }
    unobserve() {}
    disconnect() {}
  };
});

afterAll(() => {
  dom.window.close();
});

// =============================================================================
// Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

const template = (item: TestItem): string =>
  `<div>${item.name}</div>`;

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({ id: i + 100, name: `Item ${i}` }));

const createContainer = (): HTMLElement => {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: 300, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 500, configurable: true });
  document.body.appendChild(el);
  return el;
};

// =============================================================================
// Factory Tests
// =============================================================================

describe("withAutoSize factory", () => {
  it("should return a VListFeature with correct name and priority", () => {
    const feature = withAutoSize();
    expect(feature.name).toBe("withAutoSize");
    expect(feature.priority).toBe(5);
    expect(typeof feature.setup).toBe("function");
    expect(typeof feature.destroy).toBe("function");
  });

  it("should return independent instances", () => {
    const a = withAutoSize();
    const b = withAutoSize();
    expect(a).not.toBe(b);
  });
});

// =============================================================================
// Setup + Build Tests
// =============================================================================

describe("withAutoSize setup", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) { list.destroy(); list = null; }
    container.remove();
  });

  it("should build successfully with estimatedHeight", () => {
    list = vlist<TestItem>({
      container,
      item: { estimatedHeight: 50, template },
      items: createTestItems(20),
    }).use(withAutoSize()).build();

    expect(list.element).toBeDefined();
    expect(list.total).toBe(20);
  });

  it("should render items with measured sizes", () => {
    list = vlist<TestItem>({
      container,
      item: { estimatedHeight: 50, template },
      items: createTestItems(20),
    }).use(withAutoSize()).build();

    const items = list.element.querySelectorAll("[data-index]");
    expect(items.length).toBeGreaterThan(0);

    // Mock ResizeObserver fires with size=80, so items should be 80px
    const firstItem = items[0] as HTMLElement;
    expect(firstItem.style.height).toBe("80px");
  });

  it("should throw when estimatedHeight is missing", () => {
    expect(() => {
      vlist<TestItem>({
        container,
        item: { height: undefined as any, template },
        items: createTestItems(5),
      }).use(withAutoSize()).build();
    }).toThrow();
  });

  it("should throw when estimatedHeight is negative", () => {
    expect(() => {
      vlist<TestItem>({
        container,
        item: { estimatedHeight: -10, template },
        items: createTestItems(5),
      }).use(withAutoSize()).build();
    }).toThrow(/estimatedHeight/);
  });
});

// =============================================================================
// Destroy Tests
// =============================================================================

describe("withAutoSize destroy", () => {
  it("should clean up on destroy without errors", () => {
    const container = createContainer();
    const list = vlist<TestItem>({
      container,
      item: { estimatedHeight: 50, template },
      items: createTestItems(20),
    }).use(withAutoSize()).build();

    expect(() => list.destroy()).not.toThrow();
    container.remove();
  });

  it("should be safe to call destroy twice", () => {
    const container = createContainer();
    const list = vlist<TestItem>({
      container,
      item: { estimatedHeight: 50, template },
      items: createTestItems(20),
    }).use(withAutoSize()).build();

    list.destroy();
    expect(() => list.destroy()).not.toThrow();
    container.remove();
  });
});

// =============================================================================
// Data Operations with AutoSize
// =============================================================================

describe("withAutoSize data operations", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer();
  });

  afterEach(() => {
    if (list) { list.destroy(); list = null; }
    container.remove();
  });

  it("should handle setItems", () => {
    list = vlist<TestItem>({
      container,
      item: { estimatedHeight: 50, template },
      items: createTestItems(10),
    }).use(withAutoSize()).build();

    expect(list.total).toBe(10);

    list.setItems(createTestItems(30));
    expect(list.total).toBe(30);
  });

  it("should handle appendItems", () => {
    list = vlist<TestItem>({
      container,
      item: { estimatedHeight: 50, template },
      items: createTestItems(10),
    }).use(withAutoSize()).build();

    list.appendItems(createTestItems(5));
    expect(list.total).toBe(15);
  });
});
