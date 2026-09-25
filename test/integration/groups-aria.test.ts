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
 * It has to be resolved on the render path: groups sets up at priority 11, ahead
 * of selection (50) and a11y (55).
 */

import { registerDOM, unregisterDOM } from "../helpers/dom";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { groups } from "../../src/plugins/groups/plugin";
import { a11y } from "../../src/plugins/a11y/plugin";
import { selection } from "../../src/plugins/selection/plugin";

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 400; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 300; }, configurable: true });
});
afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const groupsPlugin = () => groups<TestItem>({
  getGroupForIndex: (i) => (i < 50 ? "A" : "B"),
  header: { height: 32, template: (key) => key },
});

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
    // Headers are role=presentation; data rows carry the list/listbox role.
    get row(): HTMLElement {
      return container.querySelector(".vlist-item") as HTMLElement;
    },
    dispose(): void {
      list.destroy();
      container.remove();
    },
  };
}

describe("groups — listbox semantics", () => {
  it("gives rows a role even without a11y or selection", async () => {
    const fixture = await build([groupsPlugin()]);
    try {
      expect(fixture.row.getAttribute("role")).toBe("listitem");
      expect(fixture.row.hasAttribute("aria-setsize")).toBe(false);
      expect(fixture.row.hasAttribute("aria-posinset")).toBe(false);
    } finally {
      fixture.dispose();
    }
  });

  it("announces position and size under selection()", async () => {
    const fixture = await build([groupsPlugin(), selection({ mode: "multiple" })]);
    try {
      expect(fixture.row.getAttribute("role")).toBe("option");
      expect(fixture.row.getAttribute("aria-setsize")).toBe("100");
      expect(fixture.row.getAttribute("aria-posinset")).toBe("1");
    } finally {
      fixture.dispose();
    }
  });

  it("does the same under a11y() alone, which publishes no _getSelectedIds", async () => {
    const fixture = await build([groupsPlugin(), a11y()]);
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

    const fixture = await build([groupsPlugin(), a11y()]);
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
});
