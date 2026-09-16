/**
 * vlist — Listbox semantics on a grid
 *
 * Core sets `role` on every rendered item, and `aria-posinset` / `aria-setsize`
 * when the list is interactive. `grid()` replaces the render pipeline outright,
 * so none of that reached a grid row: they carried no role at all, while plain
 * and masonry lists carried one.
 *
 * What makes a list interactive is `ctx.dom.enableListbox()`, which **both**
 * `a11y()` and `selection()` call. So the signal is the marker it leaves on the
 * content element, not the presence of `_getSelectedIds` — that hook is only
 * published by `selection()`, and keying on it is why `groups()` renders
 * `listitem` for an `a11y()`-only list.
 *
 * It has to be resolved on the render path: grid sets up at priority 10, ahead
 * of selection (50) and a11y (55).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { grid } from "../../src/plugins/grid/plugin";
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

describe("grid — listbox semantics", () => {
  it("gives rows a role even without a11y or selection", async () => {
    // Was: no role attribute at all.
    const row = await build([grid({ columns: 3 })]);
    expect(row.getAttribute("role")).toBe("listitem");
    // Not interactive, so no position attributes — the same as core.
    expect(row.hasAttribute("aria-setsize")).toBe(false);
    expect(row.hasAttribute("aria-posinset")).toBe(false);
  });

  it("announces position and size under selection()", async () => {
    const row = await build([grid({ columns: 3 }), selection({ mode: "multiple" })]);
    expect(row.getAttribute("role")).toBe("option");
    expect(row.getAttribute("aria-setsize")).toBe("100");
    expect(row.getAttribute("aria-posinset")).toBe("1");
  });

  it("does the same under a11y() alone, which publishes no _getSelectedIds", async () => {
    // The case groups() gets wrong: it asks for that hook, which only
    // selection() publishes, so an a11y()-only list loses listbox semantics.
    const row = await build([grid({ columns: 3 }), a11y()]);
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

    const gridRow = await build([grid({ columns: 3 }), a11y()]);
    expect({
      role: gridRow.getAttribute("role"),
      setsize: gridRow.getAttribute("aria-setsize"),
      posinset: gridRow.getAttribute("aria-posinset"),
    }).toEqual(plain);
  });

  it("rewrites aria-setsize when the total changes", async () => {
    const row = await build([grid({ columns: 3 }), selection({ mode: "multiple" })], 60);
    expect(row.getAttribute("aria-setsize")).toBe("60");

    list!.setItems(createTestItems(90));
    await tick(0);
    await tick(50);

    // A row already on screen must not keep announcing the old count.
    const after = container!.querySelector("[data-index]") as HTMLElement;
    expect(after.getAttribute("aria-setsize")).toBe("90");
  });
});
