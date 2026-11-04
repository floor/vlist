import { beforeAll, afterAll, expect, it } from "bun:test";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { createContainer } from "../../helpers/factory";
import { scoped, type TestScope } from "../../helpers/scope";
import { createVList } from "../../../src/core/create";
import { tree, type TreeMethods } from "../../../src/plugins/tree/plugin";
import { a11y } from "../../../src/plugins/a11y/plugin";
import { selection } from "../../../src/plugins/selection/plugin";
import type { VList, VListPlugin } from "../../../src/core/types";

interface Node { id: string; children: Node[]; }
let geometry: ReturnType<typeof capturePrototypeGeometry>;
beforeAll(() => {
  setupDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 300 });
});
afterAll(() => { geometry.restore(); teardownDOM(); geometry.assertRestored(); });

const nodes = (): Node[] => Array.from({ length: 12 }, (_, root) => ({
  id: `r${root}`,
  children: Array.from({ length: 8 }, (_, child) => ({ id: `r${root}c${child}`, children: [] })),
}));

async function fixture(scope: TestScope, owner: "standalone" | "a11y" | "selection", horizontal: boolean) {
  const container = createContainer();
  const plugins: VListPlugin<Node>[] = [tree<Node>({ expanded: true })];
  if (owner === "a11y") plugins.push(a11y<Node>());
  if (owner === "selection") plugins.push(selection<Node>({ mode: "single" }));
  const list = createVList({ container, items: nodes(), orientation: horizontal ? "horizontal" : "vertical",
    scroll: { mode: "native" }, item: { height: 32, width: 32, template: (item: Node) => item.id },
  }, plugins) as VList<Node> & TreeMethods<Node>;
  scope.own(list, container);
  const content = container.querySelector<HTMLElement>(".vlist-content")!;
  const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
  const extent = horizontal ? 300 : 500;
  // Happy DOM does not implement native layout clamping. Model the browser's
  // source independently of the engine cache: after a CSS content shrink its
  // scroll getter clamps, even before the browser delivers a scroll event.
  let position = 0;
  const max = (): number => Math.max(0, parseFloat(content.style[horizontal ? "width" : "height"]) - extent);
  Object.defineProperty(viewport, horizontal ? "scrollLeft" : "scrollTop", {
    configurable: true,
    get: () => Math.min(position, max()),
    set: (value: number) => { position = Math.max(0, Math.min(value, max())); },
  });
  await Promise.resolve(); // tree resolves the external focus owner after setup.
  const press = (key: string): void => {
    content.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  };
  const focus = (id: string): void => {
    press("Home");
    for (let index = 0; index < 108 && container.querySelector(".vlist-item--focused")?.getAttribute("data-id") !== id; index++) press(horizontal && owner !== "standalone" ? "ArrowRight" : "ArrowDown");
    expect(container.querySelector(".vlist-item--focused")?.getAttribute("data-id")).toBe(id);
    expect(list.getScrollPosition()).toBeGreaterThan(0);
  };
  const expectVisibleFocus = (id: string): void => {
    expect(list.getScrollPosition()).toBe(horizontal ? viewport.scrollLeft : viewport.scrollTop);
    const row = container.querySelector<HTMLElement>(".vlist-item--focused");
    expect(row?.getAttribute("data-id")).toBe(id);
    const active = content.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    expect(content.querySelector(`[id="${active}"]`)).toBe(row);
    const index = Number(row!.dataset.index);
    expect(index * 32).toBeGreaterThanOrEqual(list.getScrollPosition());
    expect(index * 32 + 32).toBeLessThanOrEqual(list.getScrollPosition() + extent);
    expect(list.getScrollPosition()).toBeLessThanOrEqual(Math.max(0, list.total * 32 - extent));
  };
  return { list, container, content, viewport, focus, expectVisibleFocus };
}

for (const horizontal of [false, true]) {
  for (const owner of ["standalone", "a11y", "selection"] as const) {
    // Keyboard focus is process-wide; keep these scenarios serial in Bun.
    it.serial(`${owner} ${horizontal ? "horizontal" : "vertical"}: collapseAll clamps and reveals the focused root`, scoped(async scope => {
      const f = await fixture(scope, owner, horizontal);
      f.focus("r10c4");
      f.list.collapseAll();
      f.expectVisibleFocus("r10");
    }));
    it.serial(`${owner} ${horizontal ? "horizontal" : "vertical"}: collapsing a focused ancestor reveals that ancestor`, scoped(async scope => {
      const f = await fixture(scope, owner, horizontal);
      f.focus("r10c4");
      f.list.collapse("r10");
      f.expectVisibleFocus("r10");
    }));
    it.serial(`${owner} ${horizontal ? "horizontal" : "vertical"}: shorter setItems clamps the viewport`, scoped(async scope => {
      const f = await fixture(scope, owner, horizontal);
      f.focus("r10c4");
      f.list.setItems([{ id: "replacement", children: [] }]);
      expect(f.list.getScrollPosition()).toBe(0);
      expect(horizontal ? f.viewport.scrollLeft : f.viewport.scrollTop).toBe(0);
      expect(f.container.querySelector('[data-id="replacement"]')).not.toBeNull();
    }));
    it.serial(`${owner} ${horizontal ? "horizontal" : "vertical"}: shorter setItems clamps and falls back to the first row`, scoped(async scope => {
      const f = await fixture(scope, owner, horizontal);
      f.focus("r10c4");
      f.list.setItems([{ id: "replacement", children: [] }]);
      f.expectVisibleFocus("replacement");
    }));
    it.serial(`${owner} ${horizontal ? "horizontal" : "vertical"}: setItems keeps focus on a node that still exists`, scoped(async scope => {
      const f = await fixture(scope, owner, horizontal);
      f.focus("r10c4");
      f.list.setItems([{ id: "r10", children: [{ id: "r10c4", children: [] }] }]);
      f.expectVisibleFocus("r10c4");
    }));
  }
}
