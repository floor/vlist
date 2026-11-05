/**
 * vlist — container size after plugin setup, before ResizeObserver
 *
 * createVList reads the viewport box before plugin setup, then starts
 * ResizeObserver on a timer. table() and groups() shrink that box during
 * setup (a column header in the flex column, a sticky band via
 * `height: calc(100% - Npx)`). A scroll in the same turn — setQuery,
 * scrollToIndex — still uses the pre-setup size, so the target sits past
 * the real viewport. The browser case is layout-table-groups-navigate:
 * viewport 318px, then 258px, match row at 4200px, 60px below the fold.
 *
 * These tests own the process-global geometry getters and ResizeObserver,
 * so they are serial. The observer records nothing and never delivers an
 * entry: the assertion is the size plugins left, not a later observation.
 * page() publishes the window size itself and turns the element observer
 * off; reading the element afterwards would replace that size, so the
 * page case pins the window.
 */

import { registerDOM, unregisterDOM } from "../helpers/dom";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";
import { createContainer } from "../helpers/factory";
import { groups } from "../../src/plugins/groups/plugin";
import { page } from "../../src/plugins/page/plugin";
import { search, type SearchMethods } from "../../src/plugins/search/plugin";
import { table } from "../../src/plugins/table/plugin";

const BEFORE = 318;
const TABLE_HEADER = 20;
const GROUP_HEADER = 40;
const ITEM = 40;
const AFTER = BEFORE - TABLE_HEADER - GROUP_HEADER;
const DATA_INDEX = 70;
/** Group of two: 35 headers sit above data index 70, then the 70 rows. */
const OFFSET = Math.floor(DATA_INDEX / 2) * GROUP_HEADER + DATA_INDEX * ITEM;

interface Row {
  id: number;
  name: string;
  group: string;
}

let geometry: ReturnType<typeof capturePrototypeGeometry>;
let savedObserver: typeof ResizeObserver;

const viewportHeight = (el: HTMLElement): number => {
  if (!el.classList.contains("vlist-viewport")) return BEFORE;
  let size = BEFORE;
  const tableVar = el.parentElement?.style.getPropertyValue("--vlist-table-header-height") ?? "";
  const tablePx = /^(\d+(?:\.\d+)?)px$/.exec(tableVar.trim());
  if (tablePx?.[1] !== undefined) size -= Number(tablePx[1]);
  const calc = /calc\(100% - (\d+(?:\.\d+)?)px\)/.exec(el.style.height);
  if (calc?.[1] !== undefined) size -= Number(calc[1]);
  return size;
};

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  savedObserver = globalThis.ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement): number { return viewportHeight(this); },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(): number { return 480; },
  });
  // Never delivers. A real entry would hide a stale creation-time size.
  globalThis.ResizeObserver = class implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

afterAll(() => {
  globalThis.ResizeObserver = savedObserver;
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

const rows = (): Row[] => Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: i === DATA_INDEX || i === 90 ? `match ${i}` : `other ${i}`,
  group: `G${Math.floor(i / 2)}`,
}));

const plugins = () => [
  table<Row>({
    columns: [{ key: "name", label: "Name", width: 300 }],
    rowHeight: ITEM,
    headerHeight: TABLE_HEADER,
  }),
  groups<Row>({
    getGroupForIndex: (_i, item) => item?.group ?? "?",
    header: { height: GROUP_HEADER, template: (key) => key },
  }),
  search<Row>({ mode: "navigate", position: "none", field: "name" }),
];

/** The row's box in viewport space. Past `viewport` means it was scrolled with the pre-setup size. */
const expectFullyInside = (scroll: number, viewport: number): void => {
  const top = OFFSET - scroll;
  const bottom = top + ITEM;
  expect(top).toBeGreaterThanOrEqual(0);
  expect(bottom).toBeLessThanOrEqual(viewport);
  expect(scroll).toBe(OFFSET + ITEM - viewport);
};

describe("container size after plugin setup", () => {
  // Owns HTMLElement.prototype clientHeight/clientWidth and ResizeObserver.
  it.serial("table + groups: setQuery before any resize entry keeps the match inside", () => {
    const host = createContainer({ width: 480, height: 320 });
    const list = createVList<Row>(
      { container: host, items: rows(), item: { height: ITEM, template: (item) => item.name } },
      plugins(),
    ) as VList<Row> & SearchMethods;
    try {
      list.setQuery("match");
      expectFullyInside(list.getScrollPosition(), AFTER);
    } finally {
      list.destroy();
      host.remove();
    }
  });

  it.serial("table + groups: scrollToIndex before any resize entry keeps the item inside", () => {
    const host = createContainer({ width: 480, height: 320 });
    const list = createVList<Row>(
      { container: host, items: rows(), item: { height: ITEM, template: (item) => item.name } },
      plugins().slice(0, 2),
    );
    try {
      list.scrollToIndex(DATA_INDEX, "end");
      expectFullyInside(list.getScrollPosition(), AFTER);
    } finally {
      list.destroy();
      host.remove();
    }
  });

  // Also owns window.innerHeight, scrollX/scrollY and window.scrollTo.
  it.serial("page + table + groups: immediate scroll uses the window, not the element box", () => {
    const windowHeight = 640;
    const saved = {
      height: Object.getOwnPropertyDescriptor(window, "innerHeight"),
      width: Object.getOwnPropertyDescriptor(window, "innerWidth"),
      scrollTo: window.scrollTo,
      scrollX: Object.getOwnPropertyDescriptor(window, "scrollX"),
      scrollY: Object.getOwnPropertyDescriptor(window, "scrollY"),
    };
    let scrollY = 0;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: windowHeight });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 480 });
    Object.defineProperty(window, "scrollX", { configurable: true, get: () => 0 });
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
    window.scrollTo = (options?: ScrollToOptions | number, top?: number): void => {
      scrollY = Math.max(0, typeof options === "number" ? top ?? scrollY : options?.top ?? scrollY);
    };

    const host = createContainer({ width: 480, height: 320 });
    const list = createVList<Row>(
      { container: host, items: rows(), item: { height: ITEM, template: (item) => item.name } },
      [page<Row>(), ...plugins()],
    ) as VList<Row> & SearchMethods;
    const viewport = host.querySelector<HTMLElement>(".vlist-viewport");
    if (!viewport) throw new Error("viewport missing");
    // List at the document top: a write of `pos` comes back as the scroll position.
    viewport.getBoundingClientRect = () => new DOMRect(0, -scrollY, 480, windowHeight);

    try {
      list.setQuery("match");
      expectFullyInside(list.getScrollPosition(), windowHeight);
      list.scrollToIndex(DATA_INDEX, "end");
      expectFullyInside(list.getScrollPosition(), windowHeight);
    } finally {
      list.destroy();
      host.remove();
      window.scrollTo = saved.scrollTo;
      for (const [name, desc] of [
        ["innerHeight", saved.height],
        ["innerWidth", saved.width],
        ["scrollX", saved.scrollX],
        ["scrollY", saved.scrollY],
      ] as const) {
        if (desc) Object.defineProperty(window, name, desc);
        else Reflect.deleteProperty(window, name);
      }
    }
  });
});
