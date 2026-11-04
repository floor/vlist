import { beforeAll, afterAll, expect, it } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createContainer } from "../helpers/factory";
import { scoped, type TestScope, waitFor } from "../helpers/scope";
import { createVList } from "../../src/core/create";
import { table, type TableMethods } from "../../src/plugins/table/plugin";
import { page } from "../../src/plugins/page/plugin";
import { groups } from "../../src/plugins/groups/plugin";
import { selection } from "../../src/plugins/selection/plugin";
import { a11y } from "../../src/plugins/a11y/plugin";
import { autosize } from "../../src/plugins/autosize/plugin";
import type { VList, VListPlugin } from "../../src/core/types";

interface Row { id: number; name: string; value: string; }
const rows = (count = 100, start = 0): Row[] => Array.from({ length: count }, (_, i) => ({ id: start + i, name: `Name ${start + i}`, value: `Value ${start + i}` }));
const columns = () => [{ key: "name", label: "Name", width: 200, sortable: true }, { key: "value", label: "Value", width: 300 }];
let geometry: ReturnType<typeof capturePrototypeGeometry>;
beforeAll(() => {
  setupDOM(); geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 300 });
});
afterAll(() => { geometry.restore(); teardownDOM(); geometry.assertRestored(); });

function tableList(scope: TestScope, extra: VListPlugin<Row>[] = [], heights: number[] = []) {
  const container = createContainer();
  const list = createVList({ container, items: rows(), item: { height: 40, template: (row: Row) => row.name } },
    [table<Row>({ columns: columns(), rowHeight: heights.length ? i => heights[i] ?? 40 : 40 }), ...extra]) as VList<Row> & TableMethods<Row>;
  scope.own(list, container);
  const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
  const content = container.querySelector<HTMLElement>(".vlist-content")!;
  let native = 0;
  Object.defineProperty(viewport, "scrollTop", { configurable: true,
    get: () => Math.min(native, Math.max(0, parseFloat(content.style.height) - 500)),
    set: (pos: number) => { native = Math.max(0, Math.min(pos, Math.max(0, parseFloat(content.style.height) - 500))); },
  });
  return { container, list, viewport, content, rendered: () => [...content.querySelectorAll<HTMLElement>(".vlist-table-row")] };
}

it("table: resizing and reordering columns while scrolled preserves rows and position", scoped(scope => {
  const f = tableList(scope); f.list.scrollToIndex(40);
  const pos = f.list.getScrollPosition(); const ids = f.rendered().map(row => row.dataset.id);
  f.list.resizeColumn("name", 250);
  expect(f.list.getColumnWidths().name).toBe(250);
  expect(f.list.getScrollPosition()).toBe(pos); expect(f.rendered().map(row => row.dataset.id)).toEqual(ids);
  f.list.updateColumns(columns().reverse());
  expect(f.list.getScrollPosition()).toBe(pos); expect(f.rendered().map(row => row.dataset.id)).toEqual(ids);
  expect(f.rendered()[0]!.firstElementChild!.textContent).toContain("Value");
  expect(f.container.querySelector("[role=columnheader]")!.textContent).toContain("Value");
}));

it("table: empty setItems removes rendered rows and resets aria-rowcount", scoped(scope => {
  const f = tableList(scope); f.list.scrollToIndex(40); expect(f.rendered().length).toBeGreaterThan(0);
  f.list.setItems([]);
  expect(f.rendered().length).toBe(0); expect(f.list.element.getAttribute("aria-rowcount")).toBe("1");
}));

it("table: shorter setItems immediately paints reachable replacement rows", scoped(scope => {
  const f = tableList(scope); f.list.scrollToIndex(70); f.list.setItems(rows(2, 1000));
  expect(f.viewport.scrollTop).toBe(0); expect(f.list.getScrollPosition()).toBe(0);
  expect(f.rendered().map(row => row.dataset.id)).toEqual(["1000", "1001"]);
}));

it("table: growing and replacing scrolled data refreshes visible cells", scoped(scope => {
  const f = tableList(scope); f.list.scrollToIndex(40); const pos = f.list.getScrollPosition();
  f.list.setItems(rows(200, 1000)); expect(f.list.getScrollPosition()).toBe(pos);
  expect(f.rendered().every(row => Number(row.dataset.id) >= 1000)).toBe(true);
  expect(f.content.textContent).toContain("Name 1040");
}));

it("table: function rowHeight remeasurement keeps the visible row in place", scoped(scope => {
  const heights = Array(100).fill(40); const f = tableList(scope, [], heights); f.list.scrollToIndex(40);
  heights[2] = 100; expect(f.list.remeasureItem(2)).toBe(true); expect(f.list.getScrollPosition()).toBe(1660);
  expect(f.content.querySelector<HTMLElement>('[data-id="40"]')!.style.transform).toBe("translateY(1660px)");
}));

it("table: unknown columns and out-of-range remeasurement are harmless", scoped(scope => {
  const f = tableList(scope); const before = f.list.getColumnWidths();
  f.list.resizeColumn("missing", 900); f.list.resizeColumn(-1, 900); f.list.resizeColumn(999, 900);
  expect(f.list.getColumnWidths()).toEqual(before); expect(f.list.remeasureItem(-1)).toBe(false); expect(f.list.remeasureItem(999)).toBe(false);
}));

for (const owner of ["selection", "a11y"] as const) {
  it.serial(`table groups ${owner}: header keys leave row focus and active descendant coherent`, scoped(async scope => {
    const extras: VListPlugin<Row>[] = [groups<Row>({ getGroupForIndex: i => i < 50 ? "A" : "B", header: { height: 30, template: key => key }, sticky: true }), owner === "selection" ? selection<Row>({ mode: "single" }) : a11y<Row>()];
    const f = tableList(scope, extras); await Promise.resolve(); await Promise.resolve();
    const root = f.list.element; root.focus(); root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    const focused = f.content.querySelector<HTMLElement>(".vlist-item--focused"); expect(focused).not.toBeNull();
    const activeOwner = root.hasAttribute("aria-activedescendant") ? root : f.content;
    expect(activeOwner.getAttribute("aria-activedescendant")).toBe(focused!.id);
    const header = f.container.querySelector<HTMLElement>("[role=columnheader]")!; header.focus();
    header.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(document.activeElement?.getAttribute("data-column-key")).toBe("value");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(root); expect(activeOwner.getAttribute("aria-activedescendant")).toBe(focused!.id);
  }));
}

it("table: destroy during a column drag removes the root and stops resize events", scoped(scope => {
  const f = tableList(scope); const root = f.list.element;
  const handle = f.container.querySelector<HTMLElement>(".vlist-table-header-resize")!;
  let captured = false;
  handle.setPointerCapture = () => { captured = true; }; handle.releasePointerCapture = () => { captured = false; };
  handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 200, pointerId: 1 }));
  expect(captured).toBe(true); expect(root.style.cursor).toBe("col-resize");
  let events = 0; f.list.on("column:resize", () => { events++; });
  f.list.destroy(); expect(root.isConnected).toBe(false);
  handle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300, pointerId: 1 }));
  expect(events).toBe(0);
}));

it("table: declared conflicts reject both plugin orders", scoped(scope => {
  const container = createContainer(); scope.defer(() => container.remove());
  for (const reverse of [false, true]) {
    const plugins = [table<Row>({ columns: columns(), rowHeight: 40 }), autosize<Row>()];
    expect(() => createVList({ container, items: rows(), item: { height: 40, template: (row: Row) => row.name } }, reverse ? plugins.reverse() : plugins)).toThrow('Plugin "table" conflicts with "autosize"');
  }
}));

// A browser document model: coordinates depend on the independent native
// window source, not vlist's cached position. All global/window probes are serial.
function documentModel(scope: TestScope, horizontal = false, initial = 0, offset = 200) {
  let x = horizontal ? initial : 0; let y = horizontal ? 0 : initial;
  let width = 800; let height = 500;
  const restore: Array<() => void> = [];
  const prop = (key: string, descriptor: PropertyDescriptor): void => {
    const old = Object.getOwnPropertyDescriptor(window, key);
    Object.defineProperty(window, key, { configurable: true, ...descriptor });
    restore.push(() => { if (old) Object.defineProperty(window, key, old); else Reflect.deleteProperty(window, key); });
  };
  prop("innerWidth", { get: () => width }); prop("innerHeight", { get: () => height });
  prop("scrollX", { get: () => x }); prop("scrollY", { get: () => y });
  prop("scrollTo", { value: (options: ScrollToOptions): void => { x = Math.max(0, Math.min(options.left ?? x, 20000 - width)); y = Math.max(0, Math.min(options.top ?? y, 20000 - height)); } });
  const oldRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (): DOMRect {
    const start = Number(this.closest<HTMLElement>("[data-page-offset]")?.dataset.pageOffset ?? offset);
    return new DOMRect(horizontal ? start - x : -x, horizontal ? -y : start - y, width, height);
  };
  scope.defer(() => { HTMLElement.prototype.getBoundingClientRect = oldRect; for (const fn of restore.reverse()) fn(); });
  const make = (extra: VListPlugin<Row>[] = [], pad = 0, docOffset = offset) => {
    const container = createContainer(); container.dataset.pageOffset = String(docOffset);
    const list = createVList({ container, items: rows(), orientation: horizontal ? "horizontal" : "vertical", item: { height: 40, width: 40, template: (row: Row) => row.name } }, [page<Row>(pad ? { scrollPadding: { top: pad, left: pad } } : undefined), ...extra]) as VList<Row> & TableMethods<Row>;
    scope.own(list, container); return { list, container };
  };
  return { make, source: () => horizontal ? x : y, move(pos: number) { if (horizontal) x = pos; else y = pos; window.dispatchEvent(new Event("scroll")); }, resize(w: number, h: number) { width = w; height = h; window.dispatchEvent(new Event("resize")); } };
}

for (const horizontal of [false, true]) {
  const axis = horizontal ? "horizontal" : "vertical";
  it.serial(`page ${axis}: instant and smooth scrollToIndex include document offset`, scoped(async scope => {
    const doc = documentModel(scope, horizontal); const f = doc.make();
    f.list.scrollToIndex(30); expect(doc.source()).toBe(1400); expect(f.list.getScrollPosition()).toBe(1200);
    f.list.scrollToIndex(40, { behavior: "smooth", duration: 30 });
    await waitFor(() => f.list.getScrollPosition() === 1600, "page smooth target"); expect(doc.source()).toBe(1800);
  }));
  it.serial(`page ${axis}: initial document scroll renders the current rows`, scoped(async scope => {
    const doc = documentModel(scope, horizontal, 1000); const f = doc.make(); await Promise.resolve();
    expect(f.list.getScrollPosition()).toBe(800); expect(f.container.textContent).toContain("Name 20");
  }));
  it.serial(`page ${axis}: scroll padding keeps its negative relative position after the window event`, scoped(scope => {
    const doc = documentModel(scope, horizontal); const f = doc.make([], 80); f.list.scrollToIndex(0);
    expect(doc.source()).toBe(120); expect(f.list.getScrollPosition()).toBe(-80);
    window.dispatchEvent(new Event("scroll")); expect(f.list.getScrollPosition()).toBe(-80);
  }));
  it.serial(`page ${axis}: native document boundary is read back immediately`, scoped(scope => {
    const doc = documentModel(scope, horizontal, 0, 20); const f = doc.make([], 80); f.list.scrollToIndex(0);
    expect(doc.source()).toBe(0); expect(f.list.getScrollPosition()).toBe(-20);
  }));
  it.serial(`page ${axis}: cross-axis resize emits the new window dimensions`, scoped(scope => {
    const doc = documentModel(scope, horizontal); const f = doc.make(); const events: Array<{ width: number; height: number }> = [];
    f.list.on("resize", event => events.push({ ...event })); doc.resize(horizontal ? 800 : 900, horizontal ? 600 : 500);
    expect(events).toEqual([{ width: horizontal ? 800 : 900, height: horizontal ? 600 : 500 }]);
  }));
  it.serial(`page ${axis}: two lists track their own offsets and destroy removes listeners`, scoped(scope => {
    const doc = documentModel(scope, horizontal); const a = doc.make([], 0, 200); const b = doc.make([], 0, 2000);
    doc.move(2600); expect(a.list.getScrollPosition()).toBe(2400); expect(b.list.getScrollPosition()).toBe(600);
    const previous = a.list.getScrollPosition(); a.list.destroy(); doc.move(3000);
    expect(a.list.getScrollPosition()).toBe(previous); expect(b.list.getScrollPosition()).toBe(1000);
  }));
}

it.serial("page table: window resize resolves flexible columns", scoped(scope => {
  const doc = documentModel(scope); const f = doc.make([table<Row>({ columns: [{ key: "name", label: "Name" }], rowHeight: 40 })]);
  expect(f.list.getColumnWidths().name).toBe(800); doc.resize(1000, 600); expect(f.list.getColumnWidths().name).toBe(1000);
}));

for (const owner of ["standalone", "selection", "a11y"] as const) {
  it.serial(`table groups ${owner}: shortening then emptying data clears rows and counts`, scoped(async scope => {
    const extra: VListPlugin<Row>[] = [groups<Row>({ getGroupForIndex: i => i < 50 ? "A" : "B", header: { height: 30, template: key => key }, sticky: true })];
    if (owner === "selection") extra.push(selection<Row>({ mode: "single" }));
    if (owner === "a11y") extra.push(a11y<Row>());
    const f = tableList(scope, extra); await Promise.resolve(); await Promise.resolve();
    f.list.scrollToIndex(70); f.list.setItems(rows(2, 1000));
    expect(f.list.getScrollPosition()).toBe(0); expect(f.content.querySelector('[data-id="1000"]')).not.toBeNull();
    f.list.setItems([]); expect(f.rendered().length).toBe(0); expect(f.list.element.getAttribute("aria-rowcount")).toBe("1");
    f.list.setItems(rows(5, 2000)); expect(f.content.querySelector('[data-id="2000"]')).not.toBeNull();
    expect(f.list.element.getAttribute("aria-rowcount")).toBe("7"); // five rows, group header and table header
  }));
}

it("table: theme/class changes preserve the header and subsequent column updates", scoped(scope => {
  const f = tableList(scope); f.list.element.classList.add("consumer-theme"); f.list.element.style.setProperty("--vlist-bg", "black");
  f.list.resizeColumn(0, 240); f.list.updateColumns(columns());
  expect(f.container.querySelectorAll("[role=columnheader]").length).toBe(2);
  expect(f.container.querySelector("[role=columnheader]")!.textContent).toContain("Name");
  expect(f.list.element.style.getPropertyValue("--vlist-bg")).toBe("black");
}));

it.serial("page table: height-only window changes preserve dragged column widths", scoped(scope => {
  const doc = documentModel(scope); const f = doc.make([table<Row>({ columns: columns(), rowHeight: 40 })]);
  f.list.resizeColumn("name", 250); doc.resize(800, 700);
  expect(f.list.getColumnWidths().name).toBe(250);
}));

it.serial("page: larger viewport renders the newly visible rows and deduplicates unchanged resize", scoped(scope => {
  const doc = documentModel(scope); const f = doc.make(); let resizes = 0; f.list.on("resize", () => { resizes++; });
  doc.resize(800, 1500); expect(f.container.textContent).toContain("Name 30"); doc.resize(800, 1500); expect(resizes).toBe(1);
}));

it.serial("page: immediate destroy cancels deferred initial synchronization", scoped(async scope => {
  const doc = documentModel(scope, false, 1000); const f = doc.make(); f.list.destroy(); await Promise.resolve();
  expect(f.list.element.isConnected).toBe(false); expect(f.list.getScrollPosition()).toBe(0);
}));

// Page mode pins the caller's band, then the table header, then the group
// header. The two headers used to scroll off the window (tops near -2460).
// These own window geometry, so they are serial.
const GROUP_H = 40;
const TABLE_H = 24;

it.serial("page groups: sticky header stays under the page band", scoped(scope => {
  const doc = documentModel(scope);
  const f = doc.make([groups<Row>({ getGroupForIndex: i => (i < 50 ? "A" : "B"), header: { height: GROUP_H, template: key => key } })], 30);
  const sticky = f.container.querySelector<HTMLElement>(".vlist-sticky-header");
  const viewport = f.container.querySelector<HTMLElement>(".vlist-viewport")!;
  expect(f.list.element.classList.contains("vlist--page")).toBe(true);
  expect(f.list.element.style.getPropertyValue("--vlist-page-pad")).toBe("30px");
  expect(sticky).not.toBeNull();
  expect(sticky!.style.position).toBe("sticky");
  expect(sticky!.style.top).toBe("30px");
  expect(viewport.style.height).not.toContain("calc");
  f.list.scrollToIndex(60);
  expect(sticky!.style.position).toBe("sticky");
}));

it.serial("page table: column header stays under the page band", scoped(scope => {
  const doc = documentModel(scope);
  const f = doc.make([table<Row>({ columns: columns(), rowHeight: 40, headerHeight: TABLE_H })], 30);
  const header = f.container.querySelector<HTMLElement>(".vlist-table-header");
  expect(header).not.toBeNull();
  expect(header!.style.position).toBe("sticky");
  expect(header!.style.top).toBe("30px");
  // The header's own sticky box is this row group. A static group only as
  // tall as the header carries the header off the window.
  expect(header!.parentElement!.style.position).toBe("sticky");
  expect(f.list.element.style.getPropertyValue("--vlist-page-pad")).toBe("30px");
  f.list.scrollToIndex(60);
  expect(header!.style.position).toBe("sticky");
}));

it.serial("page table groups: headers stack as band, table, group", scoped(scope => {
  const doc = documentModel(scope);
  const f = doc.make([
    table<Row>({ columns: columns(), rowHeight: 40, headerHeight: TABLE_H }),
    groups<Row>({ getGroupForIndex: i => (i < 50 ? "A" : "B"), header: { height: GROUP_H, template: key => key } }),
  ], 30);
  const header = f.container.querySelector<HTMLElement>(".vlist-table-header")!;
  const sticky = f.container.querySelector<HTMLElement>(".vlist-sticky-header")!;
  expect(header.style.position).toBe("sticky");
  expect(header.style.top).toBe("30px");
  expect(header.parentElement!.style.position).toBe("sticky");
  expect(Number(header.style.zIndex)).toBeGreaterThan(Number(sticky.style.zIndex));
  expect(sticky.style.top).toBe(`${30 + TABLE_H}px`);
  f.list.scrollToIndex(60);
  expect(header.style.position).toBe("sticky");
  expect(sticky.style.position).toBe("sticky");
}));

it.serial("page groups: sticky false does not pin a group header", scoped(scope => {
  const doc = documentModel(scope);
  const f = doc.make([groups<Row>({ sticky: false, getGroupForIndex: i => (i < 50 ? "A" : "B"), header: { height: GROUP_H, template: key => key } })]);
  expect(f.container.querySelector(".vlist-sticky-header")).toBeNull();
}));

it.serial("page: two lists keep their own bands", scoped(scope => {
  const doc = documentModel(scope);
  const a = doc.make([], 20);
  const b = doc.make([], 50);
  expect(a.list.element.style.getPropertyValue("--vlist-page-pad")).toBe("20px");
  expect(b.list.element.style.getPropertyValue("--vlist-page-pad")).toBe("50px");
}));

it.serial("page groups: an oversized stack clips the group header from the data side", scoped(scope => {
  const doc = documentModel(scope);
  const f = doc.make([
    table<Row>({ columns: [{ key: "name", label: "Name", width: 200 }], rowHeight: 40, headerHeight: 40 }),
    groups<Row>({ getGroupForIndex: i => (i < 50 ? "A" : "B"), header: { height: 40, template: key => key } }),
  ], 40);
  doc.resize(800, 100);
  const sticky = f.container.querySelector<HTMLElement>(".vlist-sticky-header")!;
  expect(sticky.style.position).toBe("sticky");
  expect(sticky.style.maxHeight).toBe("20px");
  f.list.scrollToIndex(60);
  expect(sticky.style.maxHeight).toBe("20px");
}));

it.serial("page table groups: a padding function moves both headers on the next scroll", scoped(async scope => {
  const doc = documentModel(scope);
  let band = 12;
  const container = createContainer();
  container.dataset.pageOffset = "200";
  const list = createVList({
    container,
    items: rows(),
    item: { height: 40, template: (row: Row) => row.name },
  }, [
    page<Row>({ scrollPadding: { top: () => band } }),
    table<Row>({ columns: columns(), rowHeight: 40, headerHeight: TABLE_H }),
    groups<Row>({ getGroupForIndex: i => (i < 50 ? "A" : "B"), header: { height: GROUP_H, template: key => key } }),
  ]) as VList<Row> & TableMethods<Row>;
  scope.own(list, container);
  const header = container.querySelector<HTMLElement>(".vlist-table-header")!;
  const sticky = container.querySelector<HTMLElement>(".vlist-sticky-header")!;
  expect(header.style.top).toBe("12px");
  expect(sticky.style.top).toBe(`${12 + TABLE_H}px`);
  await Promise.resolve();
  band = 48;
  list.scrollToIndex(10);
  expect(header.style.top).toBe("48px");
  expect(sticky.style.top).toBe(`${48 + TABLE_H}px`);
  expect(doc.source()).toBeGreaterThanOrEqual(0);
}));

it.serial("page horizontal groups: sticky header pins to the start edge", scoped(scope => {
  const doc = documentModel(scope, true);
  const f = doc.make([groups<Row>({ getGroupForIndex: i => (i < 50 ? "A" : "B"), header: { height: GROUP_H, template: key => key } })], 16);
  const sticky = f.container.querySelector<HTMLElement>(".vlist-sticky-header")!;
  expect(sticky.style.position).toBe("sticky");
  expect(sticky.style.left).toBe("16px");
  expect(f.list.element.style.getPropertyValue("--vlist-page-pad")).toBe("16px");
}));
