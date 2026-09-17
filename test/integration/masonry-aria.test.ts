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

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
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

let list: VList<TestItem> | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  list?.destroy();
  list = null;
  container?.remove();
  container = null;
});

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function build(plugins: VListPlugin<TestItem>[], count = 100): Promise<HTMLElement> {
  container = createContainer({ width: 300, height: 400 });
  list = createVList<TestItem>(
    { container, items: createTestItems(count), item: { height: 40, template: simpleTemplate } },
    plugins,
  );
  await tick(0);
  await tick(50);
  return container.querySelector("[data-index]") as HTMLElement;
}

describe("masonry — listbox semantics", () => {
  it("gives rows a role even without a11y or selection", async () => {
    const row = await build([masonry({ columns: 3 })]);
    expect(row.getAttribute("role")).toBe("listitem");
    expect(row.hasAttribute("aria-setsize")).toBe(false);
    expect(row.hasAttribute("aria-posinset")).toBe(false);
  });

  it("announces position and size under selection()", async () => {
    const row = await build([masonry({ columns: 3 }), selection({ mode: "multiple" })]);
    expect(row.getAttribute("role")).toBe("option");
    expect(row.getAttribute("aria-setsize")).toBe("100");
    expect(row.getAttribute("aria-posinset")).toBe("1");
    expect(row.id).toBe("vlist-item-0");
  });

  it("does the same under a11y() alone, which publishes no _getSelectedIds", async () => {
    const row = await build([masonry({ columns: 3 }), a11y()]);
    expect(row.getAttribute("role")).toBe("option");
    expect(row.getAttribute("aria-setsize")).toBe("100");
    expect(row.getAttribute("aria-posinset")).toBe("1");
  });

  it("matches a plain list given the same plugins", async () => {
    const plainRow = await build([a11y()]);
    const plain = {
      role: plainRow.getAttribute("role"),
      setsize: plainRow.getAttribute("aria-setsize"),
      posinset: plainRow.getAttribute("aria-posinset"),
    };
    list?.destroy();
    list = null;
    container?.remove();

    const masonryRow = await build([masonry({ columns: 3 }), a11y()]);
    expect({
      role: masonryRow.getAttribute("role"),
      setsize: masonryRow.getAttribute("aria-setsize"),
      posinset: masonryRow.getAttribute("aria-posinset"),
    }).toEqual(plain);
  });

  it("rewrites aria-setsize when the total changes", async () => {
    const row = await build([masonry({ columns: 3 }), selection({ mode: "multiple" })], 60);
    expect(row.getAttribute("aria-setsize")).toBe("60");

    list!.setItems(createTestItems(90));
    await tick(0);
    await tick(50);

    const after = container!.querySelector("[data-index]") as HTMLElement;
    expect(after.getAttribute("aria-setsize")).toBe("90");
  });
});
