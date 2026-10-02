/** Focused-row removal (#339), adapted from the archived release-path tests.
 * happy-dom drops focus without focusout. The extra dispatch below models
 * Chromium's synchronous focusout from inside removeChild; browsers cover both.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { registerDOM } from "../helpers/dom";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createContainer } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import { a11y, selection, table, grid, groups, tree, masonry } from "../../src/index";
import type { VListPlugin } from "../../src/core/types";

interface Row { id: number; value: string; }
const layouts = ["table", "plain", "grid", "groups", "tree", "masonry"] as const;
type Layout = typeof layouts[number];
let geometry: ReturnType<typeof capturePrototypeGeometry>;
beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 320, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});
afterAll(() => { geometry.restore(); geometry.assertRestored(); });

const cell = (row: Row): HTMLElement => {
  const span = document.createElement("span");
  span.tabIndex = 0;
  span.textContent = row.value;
  return span;
};
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 10));
const tableLabel = "Focus removal rows";
function fixture(layout: Layout, owner: "a11y" | "selection") {
  const container = createContainer({ width: 300, height: 320 });
  const outside = document.createElement("button");
  document.body.append(outside);
  let passes = 0;
  const plugins: VListPlugin<Row>[] = [];
  if (layout === "table") plugins.push(table({ rowHeight: 48, columns: [{ key: "value", label: "Value", width: 240, cell }] }));
  if (layout === "grid") plugins.push(grid({ columns: 3 }));
  if (layout === "groups") plugins.push(groups({ getGroupForIndex: i => `G${Math.floor(i / 1000)}`, header: { height: 30, template: g => g } }));
  if (layout === "tree") plugins.push(tree({ label: "value" }));
  if (layout === "masonry") plugins.push(masonry({ columns: 3, gap: 8 }));
  plugins.push(owner === "a11y" ? a11y() : selection(), { name: "pass-counter", hooks: { onCommit() { passes++; } } });
  const list = createVList<Row>({ container, ariaLabel: tableLabel, items: Array.from({ length: 50000 }, (_, id) => ({ id, value: `Row ${id}` })), item: { height: 48, template: cell } }, plugins);
  const root = container.querySelector<HTMLElement>(".vlist")!;
  const content = container.querySelector<HTMLElement>(".vlist-content")!;
  // In a table with selection() the content is a rowgroup without a tabindex
  // and the grid root carries it, so recovery lands there, as the plugin's
  // own click path does. Every other owner/layout keeps its target. #339
  const target = layout === "table" && owner === "selection"
    ? root
    : content.hasAttribute("tabindex") ? content : container.querySelector<HTMLElement>(".vlist-viewport")!;
  const span = content.querySelector<HTMLElement>("span[tabindex]")!;
  return { list, root, content, target, span, outside, get passes() { return passes; }, scrollAway() {
    list.scrollToIndex(layout === "masonry" ? 49900 : 49999, "center");
    // Masonry retains offscreen rows for one render cycle before releasing.
    if (layout === "masonry") list.scrollToIndex(49999, "center");
  }, destroy() { list.destroy(); container.remove(); outside.remove(); } };
}

for (const owner of ["a11y", "selection"] as const) {
  for (const layout of layouts) describe(`${owner}: focus removal in ${layout}`, () => {
    // document.activeElement and prototype geometry are process globals.
    it.serial("recovers focus without a focusout, with at most one deferred render", async () => {
      const f = fixture(layout, owner);
      try {
        f.span.focus();
        expect(document.activeElement === f.span).toBe(true);
        f.scrollAway();
        const synchronous = f.passes;
        await settle();
        expect(document.activeElement === f.target).toBe(true);
        expect(f.content.contains(f.span)).toBe(false);
        expect(f.content.textContent).toContain("Row 49999");
        expect(f.passes - synchronous).toBe(1);
      } finally { f.destroy(); }
    });
    it.serial("does no deferred rendering and takes no focus when focus is outside", async () => {
      const f = fixture(layout, owner);
      try {
        f.outside.focus();
        f.scrollAway();
        const synchronous = f.passes;
        await settle();
        expect(document.activeElement === f.outside).toBe(true);
        expect(f.passes - synchronous).toBe(0);
      } finally { f.destroy(); }
    });
    it.serial("does not steal focus moved elsewhere in the removal task", async () => {
      const f = fixture(layout, owner);
      try {
        f.span.focus();
        f.scrollAway();
        f.outside.focus();
        const synchronous = f.passes;
        await settle();
        expect(document.activeElement === f.outside).toBe(true);
        expect(f.passes - synchronous).toBe(0);
      } finally { f.destroy(); }
    });
  });

  it.serial(`${owner}: focusout during table removal never reenters removeChild`, async () => {
    const f = fixture("table", owner);
    const original = f.content.removeChild;
    let removing = false;
    let reentries = 0;
    f.content.removeChild = function<T extends Node>(node: T): T {
      if (removing) reentries++;
      const focused = node.contains(document.activeElement);
      if (focused && !removing) {
        removing = true;
        f.span.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      }
      const result = original.call(this, node) as T;
      removing = false;
      return result;
    };
    try {
      f.span.focus();
      f.scrollAway();
      const synchronous = f.passes;
      await settle();
      expect(reentries).toBe(0);
      expect(document.activeElement === f.target).toBe(true);
      expect(f.passes - synchronous).toBe(1);
    } finally { f.content.removeChild = original; f.destroy(); }
  });

  it.serial(`${owner}: a surviving focused row adds no deferred render`, async () => {
    const f = fixture("plain", owner);
    try {
      const span = f.content.querySelector<HTMLElement>('[data-index="5"] span')!;
      span.focus();
      f.list.scrollToIndex(3, "start");
      const synchronous = f.passes;
      await settle();
      expect(document.activeElement === span).toBe(true);
      expect(f.passes - synchronous).toBe(0);
    } finally { f.destroy(); }
  });

  it.serial(`${owner}: a recycled focused row returns focus to the list, not its new item`, async () => {
    const f = fixture("plain", owner);
    try {
      const row = f.span.parentElement!;
      row.tabIndex = 0;
      row.focus();
      f.scrollAway();
      await settle();
      expect(document.activeElement === f.target).toBe(true);
    } finally { f.destroy(); }
  });
  it.serial(`${owner}: an ordinary blur clears active descendant without restoring focus`, async () => {
    const f = fixture("plain", owner);
    try {
      f.target.focus();
      f.target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      expect(f.content.hasAttribute("aria-activedescendant")).toBe(true);
      f.target.blur();
      await settle();
      expect(document.activeElement === document.body).toBe(true);
      expect(f.content.hasAttribute("aria-activedescendant")).toBe(false);
    } finally { f.destroy(); }
  });

  it.serial(`${owner}: destroying before deferred recovery cancels focus repair`, async () => {
    const f = fixture("plain", owner);
    try {
      f.span.focus();
      f.scrollAway();
      f.list.destroy();
      const synchronous = f.passes;
      await settle();
      expect(document.activeElement === f.target).toBe(false);
      expect(f.passes).toBe(synchronous);
    } finally { f.destroy(); }
  });
}

// #339: in a table with selection() the recovery returns focus to the grid
// root — the element selection()'s own click path focuses — and the role and
// the name given at creation sit on that same element.
it.serial("selection: table removal returns focus to the named grid root", async () => {
  const f = fixture("table", "selection");
  try {
    f.span.focus();
    f.scrollAway();
    await settle();
    const active = document.activeElement as HTMLElement;
    expect(active === f.root).toBe(true);
    expect(active.getAttribute("role")).toBe("grid");
    expect(active.getAttribute("aria-label")).toBe(tableLabel);
  } finally { f.destroy(); }
});
