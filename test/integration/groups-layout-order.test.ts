/**
 * vlist — groups with grid / masonry is independent of plugin array order
 *
 * Both layout plugins and groups used to sit at priority 10, so setup was
 * array order. Groups resolved getGridLayout / getMasonryLayout in setup();
 * listed first it never saw them, the layout plugin then overwrote render
 * and the size cache, and every group header vanished with no error.
 *
 * Groups is now priority 11 — after the layout plugins — so either order
 * wraps the same size cache and takes over the same render pipeline.
 */

import { registerDOM, unregisterDOM } from "../helpers/dom";
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import {
  createTestItems,
  createContainer,
  simpleTemplate,
  type TestItem,
} from "../helpers/factory";
import { groups } from "../../src/plugins/groups/plugin";
import { grid } from "../../src/plugins/grid/plugin";
import { masonry } from "../../src/plugins/masonry/plugin";

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() {
      return 500;
    },
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    get() {
      return 300;
    },
    configurable: true,
  });
});

afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

let container: HTMLElement;
let list: VList<TestItem> | null = null;

beforeEach(() => {
  container = createContainer({ width: 300, height: 500 });
});

afterEach(() => {
  if (list) {
    list.destroy();
    list = null;
  }
  container.remove();
});

function getGroupByTen(index: number): string {
  if (index < 10) return "Alpha";
  if (index < 20) return "Beta";
  if (index < 30) return "Gamma";
  return "Delta";
}

function groupsPlugin(): VListPlugin<TestItem> {
  return groups({
    getGroupForIndex: getGroupByTen,
    header: { height: 24, template: (key) => key },
    sticky: false,
  });
}

function snapshot(plugins: VListPlugin<TestItem>[]): { headers: number; rows: number } {
  if (list) {
    list.destroy();
    list = null;
  }
  container.innerHTML = "";
  list = createVList(
    {
      container,
      items: createTestItems(40),
      item: { height: 40, template: simpleTemplate },
    },
    plugins,
  );
  return {
    headers: container.querySelectorAll(".vlist-group-header").length,
    rows: container.querySelectorAll("[data-index]").length,
  };
}

describe("groups + layout plugin order", () => {
  it("grid + groups renders the same headers and rows in either order", () => {
    const gridFirst = snapshot([grid({ columns: 4, gap: 8 }), groupsPlugin()]);
    const groupsFirst = snapshot([groupsPlugin(), grid({ columns: 4, gap: 8 })]);

    expect(gridFirst.headers).toBeGreaterThan(0);
    expect(gridFirst.rows).toBeGreaterThan(gridFirst.headers);
    expect(groupsFirst).toEqual(gridFirst);
  });

  it("masonry + groups renders the same headers and rows in either order", () => {
    const masonryFirst = snapshot([masonry({ columns: 3, gap: 8 }), groupsPlugin()]);
    const groupsFirst = snapshot([groupsPlugin(), masonry({ columns: 3, gap: 8 })]);

    expect(masonryFirst.headers).toBeGreaterThan(0);
    expect(masonryFirst.rows).toBeGreaterThan(masonryFirst.headers);
    expect(groupsFirst).toEqual(masonryFirst);
  });
});
