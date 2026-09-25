/**
 * vlist — Listbox semantics on a masonry list
 *
 * Core sets `role` on every rendered item, and `aria-posinset` / `aria-setsize`
 * when the list is interactive. `masonry()` replaces the render pipeline and
 * used to pass `undefined` as the renderer's `interactive` flag, so every row
 * took the non-interactive branch (`listitem`) even under `selection()`.
 *
 * What makes a list interactive is `ctx.dom.enableListbox()`, which **both**
 * `a11y()` and `selection()` call. The plugin reads that marker on the render
 * path — masonry sets up at priority 10, ahead of selection (50) and a11y (55).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { masonry } from "../../src/plugins/masonry/plugin";
import { a11y } from "../../src/plugins/a11y/plugin";
import { selection } from "../../src/plugins/selection/plugin";

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  GlobalRegistrator.register();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 400; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 300; }, configurable: true });
});
afterAll(() => {
  geometry.restore();
  GlobalRegistrator.unregister();
});
afterAll(() => geometry.assertRestored());

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A built list owned by one test, so tests can run concurrently. */
interface Fixture {
  readonly list: VList<TestItem>;
  readonly container: HTMLElement;
  /** The first rendered row, re-read on access so it survives a re-render. */
  readonly row: HTMLElement;
  dispose(): void;
}

async function build(plugins: VListPlugin<TestItem>[], count = 100): Promise<Fixture> {
  const container = createContainer({ width: 300, height: 400 });
  const list = createVList<TestItem>(
    { container, items: createTestItems(count), item: { height: 40, template: simpleTemplate } },
    plugins,
  );
  await tick(0);
  await tick(50);
  return {
    list,
    container,
    get row(): HTMLElement {
      return container.querySelector("[data-index]") as HTMLElement;
    },
    dispose(): void {
      list.destroy();
      container.remove();
    },
  };
}

describe("masonry — listbox semantics", () => {
  it("gives rows a role even without a11y or selection", async () => {
    const fixture = await build([masonry({ columns: 3 })]);
    try {
      expect(fixture.row.getAttribute("role")).toBe("listitem");
      expect(fixture.row.hasAttribute("aria-setsize")).toBe(false);
      expect(fixture.row.hasAttribute("aria-posinset")).toBe(false);
    } finally {
      fixture.dispose();
    }
  });

  it("announces position and size under selection()", async () => {
    const fixture = await build([masonry({ columns: 3 }), selection({ mode: "multiple" })]);
    try {
      expect(fixture.row.getAttribute("role")).toBe("option");
      expect(fixture.row.getAttribute("aria-setsize")).toBe("100");
      expect(fixture.row.getAttribute("aria-posinset")).toBe("1");
      expect(fixture.row.id).toBe("vlist-item-0");
    } finally {
      fixture.dispose();
    }
  });

  it("keeps the active descendant on screen while moving through the lanes", async () => {
    const container = createContainer({ width: 300, height: 300 });
    const items = Array.from({ length: 40 }, (_, id) => ({ id, name: `item ${id}` }));
    const list = createVList<TestItem>(
      {
        container,
        items,
        item: {
          // Masonry's height callback is (index, context?), not (item, index).
          // Written the other way round, `index` received the context object,
          // `context % 3` was NaN, and every item silently got 48 -- so the
          // varied heights this test exists to exercise never happened.
          height: (index) => (index % 3 === 0 ? 180 : 48),
          template: simpleTemplate,
        },
      },
      [masonry({ columns: 2 }), a11y()],
    );
    await tick(0);
    const content = container.querySelector(".vlist-content")!;
    const press = (key: string): void => {
      content.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    };
    for (let i = 0; i < 15; i++) press("ArrowDown");

    const activeId = content.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    const active = container.querySelector<HTMLElement>(`#${activeId}`);
    expect(active).not.toBeNull();
    const y = Number(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(active!.style.transform)?.[2]);
    const height = parseFloat(active!.style.height);
    const scroll = list.getScrollPosition();
    // clientHeight is forced to 400 for this file. The cell must sit inside
    // that window, not below it with only its id left on aria-activedescendant.
    const viewport = 400;
    expect(y).toBeGreaterThanOrEqual(scroll - 1);
    expect(y + height).toBeLessThanOrEqual(scroll + viewport + 1);

    list.destroy();
    container.remove();
  });

  it("does the same under a11y() alone, which publishes no _getSelectedIds", async () => {
    const fixture = await build([masonry({ columns: 3 }), a11y()]);
    try {
      expect(fixture.row.getAttribute("role")).toBe("option");
      expect(fixture.row.getAttribute("aria-setsize")).toBe("100");
      expect(fixture.row.getAttribute("aria-posinset")).toBe("1");
    } finally {
      fixture.dispose();
    }
  });

  it("matches a plain list given the same plugins", async () => {
    const plainList = await build([a11y()]);
    const plain = {
      role: plainList.row.getAttribute("role"),
      setsize: plainList.row.getAttribute("aria-setsize"),
      posinset: plainList.row.getAttribute("aria-posinset"),
    };
    plainList.dispose();

    const fixture = await build([masonry({ columns: 3 }), a11y()]);
    try {
      expect({
        role: fixture.row.getAttribute("role"),
        setsize: fixture.row.getAttribute("aria-setsize"),
        posinset: fixture.row.getAttribute("aria-posinset"),
      }).toEqual(plain);
    } finally {
      fixture.dispose();
    }
  });

  it("rewrites aria-setsize when the total changes", async () => {
    const fixture = await build([masonry({ columns: 3 }), selection({ mode: "multiple" })], 60);
    try {
      expect(fixture.row.getAttribute("aria-setsize")).toBe("60");

      fixture.list.setItems(createTestItems(90));
      await tick(0);
      await tick(50);

      expect(fixture.row.getAttribute("aria-setsize")).toBe("90");
    } finally {
      fixture.dispose();
    }
  });
});
