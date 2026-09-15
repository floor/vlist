/** Large grouped-list regressions formerly covered by bounded mode.
 * Default synthetic input keeps the full logical range and viewport-sized content.
 */

import { capturePrototypeGeometry } from "../helpers/geometry";
import { describe, it, expect, mock, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/synthetic";
import type { VList } from "../../src/core/types";
import { createContainer, type TestItem } from "../helpers/factory";
import { data as dataPlugin } from "../../src/plugins/data/plugin";
import { groups } from "../../src/plugins/groups/plugin";
import { grid } from "../../src/plugins/grid/plugin";
import type { VListAdapter } from "../../src/types";

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  GlobalRegistrator.register();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 500; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 300; }, configurable: true });
});
afterAll(() => {
  geometry.restore();
  GlobalRegistrator.unregister();
});
// Registered after cleanup: catch a missing or incomplete restore.
afterAll(() => geometry.assertRestored());

interface UserItem extends TestItem {
  day: number;
}

const TOTAL = 500_000;
const ITEM_H = 100;
const CHUNK = 50;

function createUserAdapter(): VListAdapter<UserItem> {
  return {
    read: mock(async ({ offset, limit }: { offset: number; limit: number }) => {
      const end = Math.min(offset + limit, TOTAL);
      const items: UserItem[] = [];
      for (let i = offset; i < end; i++) {
        items.push({ id: i + 1, name: `User ${i + 1}`, value: i, day: Math.floor(i / 20) });
      }
      return { items, total: TOTAL, hasMore: end < TOTAL };
    }),
  };
}

const dayGroup = (_index: number, item?: any): string => (item ? `day-${item.day}` : "loading");

function translateMain(el: HTMLElement): number {
  // groups buildTransform emits `translate(0, Ypx)` (vertical) — grab the Y.
  const m = /,\s*([-\d.]+)px/.exec(el.style.transform || "");
  return m ? parseFloat(m[1]) : NaN;
}

let container: HTMLElement;
let list: VList<UserItem> | null = null;

beforeEach(() => { container = createContainer({ width: 300, height: 500 }); });
afterEach(() => { list?.destroy(); list = null; container.remove(); });

describe("groups + data + synthetic scroll", () => {
  it("keeps content viewport-sized and renders items in-viewport when scrolled deep", async () => {
    const adapter = createUserAdapter();
    list = createVList(
      { container, item: { height: ITEM_H, template: (it: any) => (it ? it.name : "") } } as any,
      [
        dataPlugin({ adapter, storage: { chunkSize: CHUNK, maxCachedItems: 100_000 } }),
        groups({ getGroupForIndex: dayGroup, header: { height: 28, template: (k) => k } }),
      ],
    );
    await new Promise((r) => setTimeout(r, 120));

    // Scroll deep into the list (far past the browser element cap in raw pixels).
    (list as any).scrollToIndex(200_000);
    await (list as any).loadVisibleRange();
    await new Promise((r) => setTimeout(r, 120));

    const content = container.querySelector(".vlist-content") as HTMLElement;
    const contentHeight = container.querySelector<HTMLElement>(".vlist-viewport")!.clientHeight;
    expect(content.style.height).toBe("100%");
    expect(content.style.overflow).toBe("clip");
    const fullVirtual = TOTAL * ITEM_H; // ~50,000,000px

    // Content stays viewport-sized regardless of virtual height.
    expect(contentHeight).toBe(500);
    expect(contentHeight).toBeLessThan(fullVirtual / 100);

    const items = Array.from(container.querySelectorAll(".vlist-item")) as HTMLElement[];
    expect(items.length).toBeGreaterThan(0); // not blank

    // Every rendered item sits within the runway (offset - baseOffset), not at
    // its multi-million-pixel absolute offset.
    const maxAbsY = Math.max(...items.map((el) => Math.abs(translateMain(el))).filter((n) => !isNaN(n)));
    expect(maxAbsY).toBeLessThan(contentHeight + 5 * ITEM_H);
  });

  it("keeps items distinctly spaced during gradual scroll (logical origin repositions all visible items)", async () => {
    // Small wheel deltas retain rows across frames. Their transforms must
    // follow every logical-origin change, even when the visible range stays put.
    const adapter = createUserAdapter();
    list = createVList(
      { container, item: { height: ITEM_H, template: (it: any) => (it ? it.name : "") } } as any,
      [
        dataPlugin({ adapter, storage: { chunkSize: CHUNK, maxCachedItems: 100_000 } }),
        groups({ getGroupForIndex: dayGroup, header: { height: 28, template: (k) => k } }),
      ],
    );
    await new Promise((r) => setTimeout(r, 120));

    const vp = container.querySelector(".vlist-viewport") as HTMLElement;
    const content = container.querySelector(".vlist-content") as HTMLElement;

    // Small (trackpad-like) steps keep items in the visible range across frames,
    // so they hit the render's fast path while the logical origin changes.
    // Check overlap on EVERY step, not just the end — a coarse jump would turn
    // the whole range over and mask the bug.
    let maxRendered = 0;
    let worstOverlap = 0;
    for (let k = 0; k < 200; k++) {
      vp.dispatchEvent(new WheelEvent("wheel", { deltaY: 35, cancelable: true }));
      expect(vp.scrollTop).toBe(0);
      const items = Array.from(container.querySelectorAll(".vlist-item")) as HTMLElement[];
      const ys = items.map(translateMain).filter((n) => !isNaN(n));
      const distinct = new Set(ys.map((y) => Math.round(y))).size;
      maxRendered = Math.max(maxRendered, ys.length);
      worstOverlap = Math.max(worstOverlap, ys.length - distinct);
    }

    expect(list.getScrollPosition()).toBeGreaterThan(0);
    expect(maxRendered).toBeGreaterThan(3);   // items actually rendered
    expect(worstOverlap).toBe(0);             // no item ever shares another's Y
  });

  it("grouped GRID renders items in-viewport when scrolled deep (synthetic)", () => {
    // Covers buildTransform's grid branch (pos.rowY - baseOffset), which the
    // desk tracks grid view uses. Static items keep it synchronous/deterministic.
    const COLS = 4;
    const items = Array.from({ length: 5000 }, (_, i) => ({ id: i + 1, name: `U${i + 1}`, value: i, day: Math.floor(i / 40) }));
    list = createVList(
      { container, items, item: { height: ITEM_H, template: (it: any) => (it ? it.name : "") } } as any,
      [
        grid({ columns: COLS, gap: 8 }),
        groups({ getGroupForIndex: dayGroup, header: { height: 28, template: (k) => k } }),
      ],
    );

    // Scroll deep — row offset is far past the runway, so baseOffset is large.
    (list as any).scrollToIndex(2000);

    const content = container.querySelector(".vlist-content") as HTMLElement;
    const contentHeight = container.querySelector<HTMLElement>(".vlist-viewport")!.clientHeight;
    expect(content.style.height).toBe("100%");
    expect(content.style.overflow).toBe("clip");
    const rows = 5000 / COLS;
    const fullVirtual = rows * ITEM_H; // grid: ~125,000px

    // Content bounded to the runway, not the full grid height.
    expect(contentHeight).toBe(500);
    expect(contentHeight).toBeLessThan(fullVirtual / 10);

    const els = Array.from(container.querySelectorAll(".vlist-item")) as HTMLElement[];
    expect(els.length).toBeGreaterThan(0);

    // Main-axis (Y) transforms land in the runway, not at the absolute rowY.
    const maxAbsY = Math.max(...els.map((el) => Math.abs(translateMain(el))).filter((n) => !isNaN(n)));
    expect(maxAbsY).toBeLessThan(contentHeight + 5 * ITEM_H);

    // Grid is actually laying out columns: data rows occupy >1 distinct X.
    const xs = new Set(
      els
        .map((el) => /translate\(\s*([-\d.]+)px/.exec(el.style.transform || ""))
        .filter(Boolean)
        .map((m) => Math.round(parseFloat(m![1]))),
    );
    expect(xs.size).toBeGreaterThan(1);
  });
});
