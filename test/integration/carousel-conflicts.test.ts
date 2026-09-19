/**
 * vlist — carousel with the plugins it cannot be combined with
 *
 * Six pairs, declared in one change. `test/integration/carousel-groups.test.ts`
 * covers the seventh, which was declared first and is the pattern here.
 *
 * Each pair is asserted in both plugin orders, because the order is the whole
 * point: grid, table, masonry, tree and carousel all sit at priority 10 and
 * `sortPlugins` sorts stably, so setup order is the caller's array order and
 * nothing else. Before this was declared, the pairs behaved differently — and
 * differently *badly* — depending on which the caller happened to write first.
 * Measured at ten items of 100px in a 500px viewport, carousel written first:
 *
 *   carousel, grid      never returned; allocated to 3.9 GB (a frozen tab)
 *   carousel, masonry   constructed, rendered nothing
 *   carousel, table     constructed, drew 4 of 9 rows
 *   carousel, tree      constructed, drew 3 of 9 rows
 *   carousel, search    the window was destroyed for good by one query:
 *                       total 30 → 1 → 10, painted slides 12 → 0 → 3
 *   carousel, sortable  a real drag emitted sort:end {from: 2, to: 13}, and
 *                       dragging upward was impossible
 *
 * A test that tried only one order would have passed against the old code for
 * at least `[grid(), carousel()]`, which constructs and mounts nine elements.
 *
 * There is deliberately no test that constructs one of these pairs and asserts
 * what it renders. `[carousel(), grid()]` does not render anything: it eats the
 * machine's memory until something kills it.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import type { VListPlugin } from "../../src/core/types";
import { carousel } from "../../src/plugins/carousel/plugin";
import { grid } from "../../src/plugins/grid/plugin";
import { table } from "../../src/plugins/table/plugin";
import { masonry } from "../../src/plugins/masonry/plugin";
import { tree } from "../../src/plugins/tree/plugin";
import { search } from "../../src/plugins/search/plugin";
import { sortable } from "../../src/plugins/sortable/plugin";

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  GlobalRegistrator.register();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});

afterAll(() => {
  geometry.restore();
  GlobalRegistrator.unregister();
});

let container: HTMLElement | null = null;

afterEach(() => {
  container?.remove();
  container = null;
});

type Other = () => VListPlugin<TestItem>;

const tableConfig = {
  rowHeight: 50,
  columns: [{ key: "id" as const, label: "ID", width: 120 }],
};

/**
 * Both orders, and the container is left untouched either way — the check runs
 * before any DOM is created, so a caller who catches the throw does not have a
 * half-built list on the page.
 */
function expectsConflict(other: Other, message: string): void {
  container = createContainer({ width: 300, height: 500 });
  const config = {
    container,
    items: createTestItems(10),
    item: { height: 100, template: simpleTemplate },
  };

  expect(() => createVList<TestItem>(config, [carousel<TestItem>(), other()])).toThrow(message);
  expect(() => createVList<TestItem>(config, [other(), carousel<TestItem>()])).toThrow(message);
  expect(container.children.length).toBe(0);
}

describe("carousel — layout-tier conflicts", () => {
  it("throws with grid in either order", () => {
    expectsConflict(
      () => grid<TestItem>({ columns: 3 }) as VListPlugin<TestItem>,
      'Plugin "carousel" conflicts with "grid"',
    );
  });

  it("throws with table in either order", () => {
    expectsConflict(
      () => table<TestItem>(tableConfig) as VListPlugin<TestItem>,
      'Plugin "carousel" conflicts with "table"',
    );
  });

  it("throws with masonry in either order", () => {
    expectsConflict(
      () => masonry<TestItem>({ columns: 3 }) as VListPlugin<TestItem>,
      'Plugin "carousel" conflicts with "masonry"',
    );
  });

  it("throws with tree in either order", () => {
    expectsConflict(
      () => tree<TestItem>({}) as VListPlugin<TestItem>,
      'Plugin "carousel" conflicts with "tree"',
    );
  });
});

describe("carousel — conflicts that are not yet, rather than never", () => {
  // These two read the other way round: search and sortable are the plugins
  // that declare the conflict, so they are the ones named first in the message.
  it("throws with search in either order", () => {
    expectsConflict(
      () => search<TestItem>() as unknown as VListPlugin<TestItem>,
      'Plugin "search" conflicts with "carousel"',
    );
  });

  it("throws with sortable in either order", () => {
    expectsConflict(
      () => sortable<TestItem>() as VListPlugin<TestItem>,
      'Plugin "sortable" conflicts with "carousel"',
    );
  });
});

describe("carousel — each plugin still works on its own", () => {
  // The conflicts are between the pairs, not a mistake in one of the plugins.
  it("builds a list with each of the six alone", () => {
    const items = createTestItems(10);
    const alone: Array<[string, Other]> = [
      ["grid", () => grid<TestItem>({ columns: 3 }) as VListPlugin<TestItem>],
      ["table", () => table<TestItem>(tableConfig) as VListPlugin<TestItem>],
      ["masonry", () => masonry<TestItem>({ columns: 3 }) as VListPlugin<TestItem>],
      ["tree", () => tree<TestItem>({}) as VListPlugin<TestItem>],
      ["search", () => search<TestItem>() as unknown as VListPlugin<TestItem>],
      ["sortable", () => sortable<TestItem>() as VListPlugin<TestItem>],
      ["carousel", () => carousel<TestItem>() as VListPlugin<TestItem>],
    ];

    for (const [name, plugin] of alone) {
      container = createContainer({ width: 300, height: 500 });
      const list = createVList<TestItem>(
        { container, items, item: { height: 100, template: simpleTemplate } },
        [plugin()],
      );
      expect(list.total, name).toBe(10);
      list.destroy();
      container.remove();
      container = null;
    }
  });
});
