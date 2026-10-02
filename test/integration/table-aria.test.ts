/**
 * vlist — the accessible name of the composite role
 *
 * `ariaLabel` is documented as the listbox's label, and core writes it onto the
 * content element — which is the element carrying the composite role in a
 * plain list (`list`, or `listbox` once `a11y()` / `selection()` is wired).
 *
 * A table moves the composite role to the root (`role="grid"`, with
 * `aria-colcount` / `aria-rowcount`) and turns the content element into a
 * rowgroup. The label did not move with it, so the grid that takes focus had
 * no accessible name while a child rowgroup carried one.
 *
 * The rule this pins: the name belongs on the element carrying the composite
 * role, whichever element that is for the layout in use.
 */

import { registerDOM, unregisterDOM } from "../helpers/dom";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin } from "../../src/core/types";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { grid } from "../../src/plugins/grid/plugin";
import { table } from "../../src/plugins/table/plugin";
import { a11y } from "../../src/plugins/a11y/plugin";

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

const LABEL = "CSV data";

/** A built list owned by one test, so tests can run concurrently. */
interface Fixture {
  readonly list: VList<TestItem>;
  readonly container: HTMLElement;
  dispose(): void;
}

function build(plugins: VListPlugin<TestItem>[], count = 100): Fixture {
  const container = createContainer({ width: 300, height: 400 });
  const list = createVList<TestItem>(
    {
      container,
      items: createTestItems(count),
      item: { height: 40, template: simpleTemplate },
      ariaLabel: LABEL,
    },
    plugins,
  );
  return {
    list,
    container,
    dispose(): void {
      list.destroy();
      container.remove();
    },
  };
}

/** Role and name of the root and of the content element, as the a11y tree sees them. */
function ax(container: HTMLElement): {
  root: { role: string | null; name: string | null };
  content: { role: string | null; name: string | null };
} {
  const root = container.querySelector(".vlist") as HTMLElement;
  const content = container.querySelector(".vlist-content") as HTMLElement;
  return {
    root: { role: root.getAttribute("role"), name: root.getAttribute("aria-label") },
    content: { role: content.getAttribute("role"), name: content.getAttribute("aria-label") },
  };
}

const COLUMNS = [{ key: "name", label: "Name", width: 200 }];

describe("accessible name of the composite role", () => {
  it("names the table grid root, not the rowgroup", () => {
    const fixture = build([table({ columns: COLUMNS, rowHeight: 40 }), a11y({ keyboard: false })]);
    try {
      expect(ax(fixture.container)).toEqual({
        root: { role: "grid", name: LABEL },
        content: { role: "rowgroup", name: null },
      });
    } finally {
      fixture.dispose();
    }
  });

  it("names the grid content, where the grid layout carries the composite role", () => {
    const fixture = build([grid({ columns: 3 }), a11y()]);
    try {
      expect(ax(fixture.container)).toEqual({
        root: { role: null, name: null },
        content: { role: "listbox", name: LABEL },
      });
    } finally {
      fixture.dispose();
    }
  });

  it("names the plain list content, unchanged", () => {
    const fixture = build([a11y()]);
    try {
      expect(ax(fixture.container)).toEqual({
        root: { role: null, name: null },
        content: { role: "listbox", name: LABEL },
      });
    } finally {
      fixture.dispose();
    }
  });

  it("keeps the display-only list on role=list with the same name", () => {
    const fixture = build([]);
    try {
      expect(ax(fixture.container)).toEqual({
        root: { role: null, name: null },
        content: { role: "list", name: LABEL },
      });
    } finally {
      fixture.dispose();
    }
  });

  it("puts the name back on the content element when the table is destroyed", () => {
    const fixture = build([table({ columns: COLUMNS, rowHeight: 40 }), a11y({ keyboard: false })]);
    const root = fixture.container.querySelector(".vlist") as HTMLElement;
    const content = fixture.container.querySelector(".vlist-content") as HTMLElement;
    try {
      expect(root.getAttribute("aria-label")).toBe(LABEL);

      fixture.list.destroy();

      expect(root.hasAttribute("aria-label")).toBe(false);
      expect(content.getAttribute("aria-label")).toBe(LABEL);
    } finally {
      fixture.dispose();
    }
  });
});
