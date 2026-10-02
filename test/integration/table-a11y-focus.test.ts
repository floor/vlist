/**
 * vlist — the grid is a tab stop with `table()` + `a11y()` (#352)
 *
 * A table moves the composite role to the root (`role="grid"`) and turns the
 * content element into a rowgroup, so `enableListbox()` leaves the content
 * without a tabindex. The only writer of a root tabindex was the table plugin,
 * and it wrote one only when `selection()` was present. With `a11y()` alone the
 * grid was not in the tab order, `a11y()`'s click path called `focus()` on the
 * rowgroup (which cannot take focus), and the header's ArrowDown called
 * `root.focus()` on a root with no tabindex.
 *
 * The rule this pins: in table mode the grid root is the element that takes
 * focus, it carries the tab stop exactly when a focus owner (`a11y()` or
 * `selection()`) is wired, and every focus path — the click, the header's
 * ArrowDown, the focus-in that rings a row — lands on it. `selection()`'s
 * attributes and paths are the same before and after, and so is the plain list
 * with `a11y()`.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { registerDOM, unregisterDOM } from "../helpers/dom";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import { a11y } from "../../src/plugins/a11y/plugin";
import { grid } from "../../src/plugins/grid/plugin";
import { groups } from "../../src/plugins/groups/plugin";
import { masonry } from "../../src/plugins/masonry/plugin";
import { selection } from "../../src/plugins/selection/plugin";
import { table } from "../../src/plugins/table/plugin";
import { tree } from "../../src/plugins/tree/plugin";

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 360, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 480, configurable: true });
});
afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

const tick = (ms = 10): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const LABEL = "Orders";

type Layout = "plain" | "grid" | "groups" | "tree" | "masonry" | "table";
type Owner = "none" | "a11y" | "selection" | "a11y+selection" | "none+a11y";
interface FixtureConfig {
  readonly layout: Layout;
  readonly owner: Owner;
}

interface Fixture {
  readonly list: VList<TestItem>;
  readonly container: HTMLElement;
  readonly root: HTMLElement;
  readonly content: HTMLElement;
  readonly viewport: HTMLElement;
  dispose(): void;
}

/** A built list owned by one test, so tests can run concurrently. */
function fixture(config: FixtureConfig, count = 100): Fixture {
  const container = createContainer({ width: 480, height: 360 });
  const plugins: VListPlugin<TestItem>[] = [];
  if (config.layout === "table") {
    plugins.push(table({ rowHeight: 32, columns: [{ key: "name", label: "Name", width: 240, sortable: true }] }));
  }
  if (config.layout === "grid") plugins.push(grid({ columns: 3 }));
  if (config.layout === "groups") {
    plugins.push(groups({ getGroupForIndex: (i) => `G${Math.floor(i / 1000)}`, header: { height: 30, template: (g) => g } }));
  }
  if (config.layout === "tree") plugins.push(tree({ label: "name" }));
  if (config.layout === "masonry") plugins.push(masonry({ columns: 3, gap: 8 }));
  if (config.owner === "a11y" || config.owner === "a11y+selection") plugins.push(a11y());
  if (config.owner === "selection" || config.owner === "a11y+selection") plugins.push(selection());
  if (config.owner === "none+a11y") plugins.push(selection({ mode: "none" }), a11y());
  const list = createVList<TestItem>(
    { container, ariaLabel: LABEL, items: createTestItems(count), item: { height: 32, template: simpleTemplate } },
    plugins,
  );
  return {
    list,
    container,
    root: container.querySelector<HTMLElement>(".vlist")!,
    content: container.querySelector<HTMLElement>(".vlist-content")!,
    viewport: container.querySelector<HTMLElement>(".vlist-viewport")!,
    dispose(): void {
      list.destroy();
      container.remove();
    },
  };
}

/** The layout index of the active row (`content` carries the attribute). */
function activeIndex(content: HTMLElement): number {
  const id = content.getAttribute("aria-activedescendant");
  if (!id) return -1;
  const row = content.ownerDocument.getElementById(id);
  return row ? Number(row.dataset.index) : -1;
}

const key = (target: HTMLElement, key: string): void => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
};

/** A click on a row inside the content element, as a person's click bubbles. */
function clickRow(content: HTMLElement, index = 0): void {
  const row = document.createElement("div");
  row.setAttribute("data-index", String(index));
  content.appendChild(row);
  row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("#352 — table() + a11y(): the grid root is the tab stop", () => {
  // document.activeElement is a process global; the focus tests are serial.
  it.serial("B: exactly one new tab stop, the grid root, before the header cell", async () => {
    const f = fixture({ layout: "table", owner: "a11y" });
    try {
      await tick();
      expect(f.root.getAttribute("role")).toBe("grid");
      expect(f.root.getAttribute("aria-label")).toBe(LABEL);
      expect(f.root.getAttribute("tabindex")).toBe("0");
      expect(f.content.getAttribute("role")).toBe("rowgroup");
      expect(f.content.hasAttribute("tabindex")).toBe(false);
      // The only other tab stop inside the grid is the first header cell; rows
      // and the viewport (tabindex -1) stay out of the order.
      const stops = [...f.root.querySelectorAll<HTMLElement>("[tabindex='0']")];
      expect(stops.map((el) => el.getAttribute("role"))).toEqual(["columnheader"]);
    } finally {
      f.dispose();
    }
  });

  it.serial("A: a table with no focus owner stays out of the tab order", async () => {
    const f = fixture({ layout: "table", owner: "none" });
    try {
      await tick();
      expect(f.root.getAttribute("tabindex")).toBeNull();
      expect(f.content.hasAttribute("tabindex")).toBe(false);
    } finally {
      f.dispose();
    }
  });

  it.serial("C and D: with selection() the root's tab stop is unchanged", async () => {
    for (const owner of ["selection", "a11y+selection"] as const) {
      const f = fixture({ layout: "table", owner });
      try {
        await tick();
        expect(f.root.getAttribute("tabindex")).toBe("0");
        expect(f.content.hasAttribute("tabindex")).toBe(false);
        clickRow(f.content);
        await tick(0);
        expect(document.activeElement).toBe(f.root);
      } finally {
        f.dispose();
      }
    }
  });
});

describe("table teardown before the deferred grid tab stop", () => {
  for (const owner of ["a11y", "selection", "none+a11y"] as const) {
    it(`${owner}: immediate destroy leaves no root tabindex after the microtask`, async () => {
      const f = fixture({ layout: "table", owner });
      const root = f.list.element;
      try {
        f.list.destroy();
        expect(root.hasAttribute("tabindex")).toBe(false);
        await Promise.resolve();
        expect(root.hasAttribute("tabindex")).toBe(false);
      } finally {
        f.dispose();
      }
    });
  }
});

describe("#352 — keys reach the grid", () => {
  it.serial("B: Tab into the grid rings the first row, then ArrowDown/End/Home move it", async () => {
    const f = fixture({ layout: "table", owner: "a11y" }, 1000);
    try {
      await tick();
      f.root.focus();
      expect(document.activeElement).toBe(f.root);
      // Landing on the grid rings the first row, as the listbox does.
      expect(activeIndex(f.content)).toBe(0);
      key(f.root, "ArrowDown");
      await tick(0);
      expect(activeIndex(f.content)).toBe(1);
      key(f.root, "End");
      await tick(0);
      expect(activeIndex(f.content)).toBe(999);
      expect(document.activeElement).toBe(f.root);
      key(f.root, "Home");
      await tick(0);
      expect(activeIndex(f.content)).toBe(0);
      const row = f.content.querySelector<HTMLElement>('[data-index="0"]');
      expect(row?.className).toContain("--focused");
    } finally {
      f.dispose();
    }
  });

  it.serial("B: the header's ArrowDown lands in the grid and rings the first row", async () => {
    const f = fixture({ layout: "table", owner: "a11y" }, 1000);
    try {
      await tick();
      const cell = f.root.querySelector<HTMLElement>(".vlist-table-header-cell")!;
      cell.focus();
      expect(document.activeElement).toBe(cell);
      key(cell, "ArrowDown");
      await tick(0);
      expect(document.activeElement).toBe(f.root);
      expect(activeIndex(f.content)).toBe(0);
    } finally {
      f.dispose();
    }
  });

  it.serial("C and D: the selection keys are unchanged", async () => {
    for (const owner of ["selection", "a11y+selection"] as const) {
      const f = fixture({ layout: "table", owner }, 1000);
      try {
        await tick();
        const cell = f.root.querySelector<HTMLElement>(".vlist-table-header-cell")!;
        cell.focus();
        key(cell, "ArrowDown");
        await tick(0);
        expect(document.activeElement).toBe(f.root);
        expect(activeIndex(f.content)).toBe(0);
        key(f.root, "End");
        await tick(0);
        expect(activeIndex(f.content)).toBe(999);
        key(f.root, "Home");
        await tick(0);
        expect(activeIndex(f.content)).toBe(0);
      } finally {
        f.dispose();
      }
    }
  });

  it.serial("E: the plain list with a11y() is unchanged", async () => {
    const f = fixture({ layout: "plain", owner: "a11y" }, 1000);
    try {
      await tick();
      expect(f.content.getAttribute("tabindex")).toBe("0");
      expect(f.root.hasAttribute("tabindex")).toBe(false);
      f.content.focus();
      expect(activeIndex(f.content)).toBe(0);
      key(f.content, "ArrowDown");
      await tick(0);
      expect(activeIndex(f.content)).toBe(1);
      key(f.content, "End");
      await tick(0);
      expect(activeIndex(f.content)).toBe(999);
      key(f.content, "Home");
      await tick(0);
      expect(activeIndex(f.content)).toBe(0);
    } finally {
      f.dispose();
    }
  });
});

// The click path focuses "the content when it carries a tabindex, the root
// otherwise" — the rule selection()'s click has always used. A click that
// focuses nothing leaves the browser to focus the viewport instead.
for (const layout of ["plain", "grid", "groups", "tree", "masonry", "table"] as const) {
  it.serial(`a11y() click in ${layout}: focus lands on the tabbable element`, async () => {
    const f = fixture({ layout, owner: "a11y" });
    try {
      await tick();
      const target = layout === "table" ? f.root : f.content;
      expect(target.getAttribute("tabindex")).toBe("0");
      clickRow(f.content);
      await tick(0);
      expect(document.activeElement).toBe(target);
      expect(target.getAttribute("tabindex")).toBe("0");
    } finally {
      f.dispose();
    }
  });
}
