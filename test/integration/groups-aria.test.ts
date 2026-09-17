/**
 * vlist — Listbox semantics on a grouped list
 *
 * Core sets `role` on every rendered item, and `aria-posinset` / `aria-setsize`
 * when the list is interactive. `groups()` replaces the render pipeline, so it
 * has to apply the same attributes itself.
 *
 * What makes a list interactive is `ctx.dom.enableListbox()`, which **both**
 * `a11y()` and `selection()` call. So the signal is the marker it leaves on the
 * content element, not the presence of `_getSelectedIds` — that hook is only
 * published by `selection()`, and keying on it is why `groups()` used to render
 * `listitem` for an `a11y()`-only list.
 *
 * It has to be resolved on the render path: groups sets up at priority 10, ahead
 * of selection (50) and a11y (55).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { groups } from "../../src/plugins/groups/plugin";
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

const groupsPlugin = () => groups<TestItem>({
  getGroupForIndex: (i) => (i < 50 ? "A" : "B"),
  header: { height: 32, template: (key) => key },
});

async function build(plugins: VListPlugin<TestItem>[], count = 100): Promise<HTMLElement> {
  container = createContainer({ width: 300, height: 400 });
  list = createVList<TestItem>(
    { container, items: createTestItems(count), item: { height: 40, template: simpleTemplate } },
    plugins,
  );
  await tick(0);
  await tick(50);
  // Headers are role=presentation; data rows carry the list/listbox role.
  return container.querySelector(".vlist-item") as HTMLElement;
}

describe("groups — listbox semantics", () => {
  it("gives rows a role even without a11y or selection", async () => {
    const row = await build([groupsPlugin()]);
    expect(row.getAttribute("role")).toBe("listitem");
    expect(row.hasAttribute("aria-setsize")).toBe(false);
    expect(row.hasAttribute("aria-posinset")).toBe(false);
  });

  it("announces position and size under selection()", async () => {
    const row = await build([groupsPlugin(), selection({ mode: "multiple" })]);
    expect(row.getAttribute("role")).toBe("option");
    expect(row.getAttribute("aria-setsize")).toBe("100");
    expect(row.getAttribute("aria-posinset")).toBe("1");
  });

  it("does the same under a11y() alone, which publishes no _getSelectedIds", async () => {
    const row = await build([groupsPlugin(), a11y()]);
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

    const groupedRow = await build([groupsPlugin(), a11y()]);
    expect({
      role: groupedRow.getAttribute("role"),
      setsize: groupedRow.getAttribute("aria-setsize"),
      posinset: groupedRow.getAttribute("aria-posinset"),
    }).toEqual(plain);
  });
});
