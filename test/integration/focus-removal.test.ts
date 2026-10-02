/**
 * vlist — Removing a row that holds DOM focus (#339)
 *
 * Chromium fires focusout synchronously while the focused node is being
 * detached. The a11y plugin's focusout handler removes aria-activedescendant
 * and forces a render, and the forced render releases rows while the outer
 * release is still mid-removal: the same row is released twice and the second
 * removeChild throws NotFoundError ("the node to be removed is no longer a
 * child of this node").
 *
 * happy-dom does not implement that focus fixup — the active element silently
 * drops to <body> with no focusout — so these tests reach as far as it can:
 * no throw, focus ends on the list's focus target, the far rows are rendered,
 * and the scroll commits in the same number of passes as an identical scroll
 * that never held focus in a cell (a reentered render commits twice).
 * scripts/focus-removal-browser.mjs covers the real focusout path in Chromium.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { registerDOM, unregisterDOM } from "../helpers/dom";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createContainer } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import { a11y } from "../../src/plugins/a11y";
import { selection } from "../../src/plugins/selection";
import { table } from "../../src/plugins/table/plugin";
import { grid } from "../../src/plugins/grid/plugin";
import { groups } from "../../src/plugins/groups/plugin";
import type { VList, VListPlugin } from "../../src/core/types";

// =============================================================================
// DOM Setup
// =============================================================================

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  // The list measures .vlist-viewport, which the test cannot reach before
  // creation; mock the geometry like test/integration/cross-feature.test.ts.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get: () => 320,
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    get: () => 300,
    configurable: true,
  });
});
afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
// Registered after cleanup: catch a missing or incomplete restore.
afterAll(() => geometry.assertRestored());

let container: HTMLElement;
let list: VList<Row> | null = null;

afterEach(() => {
  if (list) {
    list.destroy();
    list = null;
  }
  container.remove();
});

// =============================================================================
// Helpers
// =============================================================================

interface Row {
  id: number;
  value: string;
}

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, id) => ({ id, value: `Row ${id}` }));

const focusableCell = (row: Row): HTMLElement => {
  const span = document.createElement("span");
  span.tabIndex = 0;
  span.textContent = row.value;
  return span;
};

const getContent = (c: HTMLElement): HTMLElement =>
  c.querySelector<HTMLElement>(".vlist-content")!;

/** The element the list focuses programmatically: the listbox content when it
 *  has a tabindex (a11y's enableListbox), else the viewport, which always
 *  carries tabindex="-1" for exactly this. Table mode sets role=rowgroup on
 *  the content (priority 10, before a11y at 55), so there content stays
 *  unfocusable and the viewport is the focus target. */
const focusTarget = (c: HTMLElement): HTMLElement => {
  const content = getContent(c);
  if (content.getAttribute("tabindex") !== null) return content;
  return c.querySelector<HTMLElement>(".vlist-viewport")!;
};

/** Counts committed render passes. A render entered from a focusout fired
 *  while a row is removed commits twice inside one scroll; the browser script
 *  turns that count into the real reentrancy check. */
function passCounter(): { plugin: VListPlugin<Row>; readonly count: number } {
  const counter = { count: 0 };
  const plugin: VListPlugin<Row> = {
    name: "pass-counter",
    hooks: {
      onCommit: (): void => {
        counter.count++;
      },
    },
  };
  return {
    plugin,
    get count() {
      return counter.count;
    },
  };
}

type BuildList = (plugins: readonly VListPlugin<Row>[]) => VList<Row>;

/** Scrolls to the last row twice — once with focus in a cell, once without —
 *  and returns how many passes each committed. */
function passesFor(build: BuildList, focused: boolean): number {
  container = createContainer({ width: 300, height: 320 });
  const counter = passCounter();
  const created = build([counter.plugin]);
  if (focused) {
    getContent(container).querySelector<HTMLElement>("span")!.focus();
  }
  created.scrollToIndex(49999, "center");
  created.destroy();
  container.remove();
  return counter.count;
}

/** Focus a cell descendant, scroll its row away, and assert the handoff.
 *  Booleans only: bun formats a whole happy-dom element into the failure diff,
 *  which alone takes longer than the test timeout (see test/helpers/dom.ts). */
function expectHandoff(build: BuildList): void {
  container = createContainer({ width: 300, height: 320 });
  list = build([]);

  const content = getContent(container);
  const span = content.querySelector<HTMLElement>("span")!;
  span.focus();
  expect(document.activeElement === span).toBe(true);

  list.scrollToIndex(49999, "center");

  expect(content.contains(span)).toBe(false);
  expect(document.activeElement === focusTarget(container)).toBe(true);
  expect(content.textContent!.includes("Row 49999")).toBe(true);
}

// =============================================================================
// Table — the reported reproduction
// =============================================================================

describe("focus removal — table", () => {
  const build: BuildList = (plugins) =>
    createVList<Row>(
      { container, items: rows(50000), item: { height: 48, template: () => "" } },
      [
        table({
          rowHeight: 48,
          columns: [{ key: "value", label: "Value", width: 240, cell: focusableCell }],
        }),
        a11y({ keyboard: false }),
        ...plugins,
      ],
    );

  it("hands focus to the list's focus target before removing its row", () => {
    expectHandoff(build);
  });

  it("commits the same number of passes as an unfocused scroll", () => {
    // No second render was entered during a release.
    expect(passesFor(build, true)).toBe(passesFor(build, false));
  });
});

// =============================================================================
// Other layouts that can remove a focused element
// =============================================================================

describe("focus removal — plain list", () => {
  const build: BuildList = (plugins) =>
    createVList<Row>(
      { container, items: rows(50000), item: { height: 48, template: focusableCell } },
      [a11y({ keyboard: false }), ...plugins],
    );

  it("hands focus to the list's focus target before removing its row", () => {
    expectHandoff(build);
    // The listbox content itself is the focus target when a11y enabled it.
    expect(getContent(container).getAttribute("tabindex")).toBe("0");
  });

  it("commits the same number of passes as an unfocused scroll", () => {
    expect(passesFor(build, true)).toBe(passesFor(build, false));
  });
});

describe("focus removal — grid", () => {
  const build: BuildList = (plugins) =>
    createVList<Row>(
      { container, items: rows(50000), item: { height: 48, template: focusableCell } },
      [grid({ columns: 3 }), a11y({ keyboard: false }), ...plugins],
    );

  it("hands focus to the list's focus target before removing its row", () => {
    expectHandoff(build);
  });

  it("commits the same number of passes as an unfocused scroll", () => {
    expect(passesFor(build, true)).toBe(passesFor(build, false));
  });
});

describe("focus removal — groups", () => {
  const build: BuildList = (plugins) =>
    createVList<Row>(
      { container, items: rows(50000), item: { height: 48, template: focusableCell } },
      [
        groups({
          getGroupForIndex: (i: number) => `G${Math.floor(i / 1000)}`,
          header: { height: 30, template: (g: string) => `<div>${g}</div>` },
        }),
        a11y({ keyboard: false }),
        ...plugins,
      ],
    );

  it("hands focus to the list's focus target before removing its row", () => {
    expectHandoff(build);
  });

  it("commits the same number of passes as an unfocused scroll", () => {
    expect(passesFor(build, true)).toBe(passesFor(build, false));
  });
});

// =============================================================================
// Selection — the other plugin that owns focus
// =============================================================================

describe("focus removal — selection", () => {
  const build: BuildList = (plugins) =>
    createVList<Row>(
      { container, items: rows(50000), item: { height: 48, template: focusableCell } },
      [selection(), ...plugins],
    );

  it("hands focus to the list's focus target before removing its row", () => {
    expectHandoff(build);
  });

  it("commits the same number of passes as an unfocused scroll", () => {
    expect(passesFor(build, true)).toBe(passesFor(build, false));
  });
});
