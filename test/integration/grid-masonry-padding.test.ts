/**
 * Grid & Masonry padding integration tests.
 * Verifies that cross-axis and main-axis padding offsets are applied
 * correctly to item transforms when using grid() or masonry() plugins.
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
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";
import {
  createTestItems,
  createContainer,
  simpleTemplate,
  type TestItem,
} from "../helpers/factory";
import { grid } from "../../src/plugins/grid/plugin";
import { masonry } from "../../src/plugins/masonry/plugin";

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  GlobalRegistrator.register();
  origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() { return 500; },
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    get() { return 400; },
    configurable: true,
  });
});

afterAll(() => {
  if (origClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", origClientHeight);
  if (origClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", origClientWidth);
  GlobalRegistrator.unregister();
});

let container: HTMLElement;
let list: VList<TestItem> | null = null;

beforeEach(() => {
  container = createContainer({ width: 400, height: 500 });
});

afterEach(() => {
  if (list) {
    list.destroy();
    list = null;
  }
  container.remove();
});

function getTransforms(): { x: number; y: number }[] {
  const items = container.querySelectorAll("[data-index]");
  const result: { x: number; y: number }[] = [];
  for (const el of items) {
    const transform = (el as HTMLElement).style.transform;
    const match = transform.match(/translate\((\d+(?:\.\d+)?)px,\s*(\d+(?:\.\d+)?)px\)/);
    if (match) {
      result.push({ x: parseFloat(match[1]!), y: parseFloat(match[2]!) });
    }
  }
  return result;
}

// =============================================================================
// Grid + padding
// =============================================================================

describe("grid + padding", () => {
  it("items are offset by cross-axis and main-axis padding", () => {
    list = createVList({
      container,
      item: { height: 100, template: simpleTemplate },
      items: createTestItems(20),
      padding: 16,
    }, [grid({ columns: 3 })]);

    const transforms = getTransforms();
    expect(transforms.length).toBeGreaterThan(0);

    // First item should be at x=16 (left padding), y=16 (top padding)
    expect(transforms[0]!.x).toBe(16);
    expect(transforms[0]!.y).toBe(16);
  });

  it("column width accounts for cross-axis padding", () => {
    list = createVList({
      container,
      item: { height: 100, template: simpleTemplate },
      items: createTestItems(20),
      padding: 20,
    }, [grid({ columns: 2 })]);

    const transforms = getTransforms();
    expect(transforms.length).toBeGreaterThan(1);

    // Container = 400, padding 20 each side → effective = 360
    // 2 columns, no gap → colWidth = 180
    // col0 x = 20, col1 x = 20 + 180 = 200
    const col0 = transforms.find(t => t.x === 20);
    const col1 = transforms.find(t => t.x === 200);
    expect(col0).toBeTruthy();
    expect(col1).toBeTruthy();
  });

  it("column width accounts for cross-axis padding with gap", () => {
    list = createVList({
      container,
      item: { height: 100, template: simpleTemplate },
      items: createTestItems(20),
      padding: 10,
    }, [grid({ columns: 2, gap: 10 })]);

    const transforms = getTransforms();
    expect(transforms.length).toBeGreaterThan(1);

    // Container = 400, padding 10 each side → effective = 380
    // 2 columns, gap 10 → colWidth = (380 - 10) / 2 = 185
    // col0 x = 10, col1 x = 10 + 185 + 10 = 205
    const col0 = transforms.find(t => t.x === 10);
    const col1 = transforms.find(t => t.x === 205);
    expect(col0).toBeTruthy();
    expect(col1).toBeTruthy();
  });

  it("content height includes main-axis padding", () => {
    list = createVList({
      container,
      item: { height: 100, template: simpleTemplate },
      items: createTestItems(6),
      padding: 12,
    }, [grid({ columns: 3 })]);

    // 6 items, 3 columns → 2 rows, each 100px → 200px content + 24px padding
    const content = container.querySelector(".vlist-content") as HTMLElement;
    const height = parseInt(content.style.height);
    expect(height).toBe(224);
  });

  it("no padding produces items at x=0, y=0", () => {
    list = createVList({
      container,
      item: { height: 100, template: simpleTemplate },
      items: createTestItems(20),
    }, [grid({ columns: 3 })]);

    const transforms = getTransforms();
    expect(transforms[0]!.x).toBe(0);
    expect(transforms[0]!.y).toBe(0);
  });
});

// =============================================================================
// Masonry + padding
// =============================================================================

describe("masonry + padding", () => {
  it("items are offset by cross-axis and main-axis padding", () => {
    list = createVList({
      container,
      item: { height: () => 100, template: simpleTemplate },
      items: createTestItems(20),
      padding: 16,
    }, [masonry({ columns: 3 })]);

    const transforms = getTransforms();
    expect(transforms.length).toBeGreaterThan(0);

    // First item should be at x=16 (left padding), y=16 (top padding)
    expect(transforms[0]!.x).toBe(16);
    expect(transforms[0]!.y).toBe(16);
  });

  it("column width accounts for cross-axis padding", () => {
    list = createVList({
      container,
      item: { height: () => 100, template: simpleTemplate },
      items: createTestItems(20),
      padding: 20,
    }, [masonry({ columns: 2 })]);

    const transforms = getTransforms();
    expect(transforms.length).toBeGreaterThan(1);

    // Container = 400, padding 20 each side → effective = 360
    // 2 columns, no gap → colWidth = 180
    // col0 x = 20, col1 x = 20 + 180 = 200
    const col0 = transforms.find(t => t.x === 20);
    const col1 = transforms.find(t => t.x === 200);
    expect(col0).toBeTruthy();
    expect(col1).toBeTruthy();
  });

  it("no padding produces items at x=0, y=0", () => {
    list = createVList({
      container,
      item: { height: () => 100, template: simpleTemplate },
      items: createTestItems(20),
    }, [masonry({ columns: 3 })]);

    const transforms = getTransforms();
    expect(transforms[0]!.x).toBe(0);
    expect(transforms[0]!.y).toBe(0);
  });

  it("asymmetric padding with tuple", () => {
    list = createVList({
      container,
      item: { height: () => 100, template: simpleTemplate },
      items: createTestItems(20),
      padding: [8, 16, 8, 16],
    }, [masonry({ columns: 2 })]);

    const transforms = getTransforms();
    expect(transforms.length).toBeGreaterThan(0);

    // Top padding = 8, left padding = 16
    // Container = 400, left+right = 32 → effective = 368
    // 2 columns → colWidth = 184
    // col0 x = 16, col1 x = 16 + 184 = 200
    expect(transforms[0]!.x).toBe(16);
    expect(transforms[0]!.y).toBe(8);
  });
});
