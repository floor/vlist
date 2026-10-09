/**
 * scroll.mode — who owns scroll input (RFC-015, #319).
 *
 * `"auto"` (the default) scrolls natively and hands input to the synthetic
 * handler in place past the browser's element size limit, and back below 3/4
 * of it; `"synthetic"` hands over from the start; `"native"` never does. The
 * driver is loaded with a dynamic import, so each handoff is awaited.
 *
 * Rows are 20,000 px tall so that the real 16,000,000 px limit is crossed by a
 * thousand of them.
 */
import { capturePrototypeGeometry } from "../helpers/geometry";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createContainer, createTestItems, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/index";
import { createVList as createSynthetic } from "../../src/synthetic";
import { page } from "../../src/plugins/page";
import { carousel } from "../../src/plugins/carousel";
import { selection } from "../../src/plugins/selection";
import { scrollbar } from "../../src/plugins/scrollbar";
import type { ScrollConfig } from "../../src/types";

const ROW = 20_000;
const VIEWPORT = 500;
const OVER = 1000; // 20,000,000 px: past the limit
const BETWEEN = 700; // 14,000,000 px: under it, above 3/4 of it
const UNDER = 500; // 10,000,000 px: under 3/4 of it
const IDLE = 20;

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  setupDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => VIEWPORT });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 300 });
});
afterAll(() => {
  geometry.restore();
  teardownDOM();
});
// Registered after cleanup: catch a missing or incomplete restore.
afterAll(() => geometry.assertRestored());

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function make(rows: number, mode?: ScrollConfig["mode"], plugins: Parameters<typeof createVList<TestItem>>[1] = []) {
  const container = createContainer({ width: 300, height: VIEWPORT });
  const modes: string[] = [];
  const errors: string[] = [];
  const list = createVList(
    { container, items: createTestItems(rows), item: { height: ROW, template: simpleTemplate }, scroll: { idleTimeout: IDLE, ...(mode ? { mode } : {}) } },
    plugins,
  );
  list.on("scroll:mode", (e) => modes.push(e.mode));
  list.on("error", (e) => errors.push(e.context));
  const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
  const content = container.querySelector<HTMLElement>(".vlist-content")!;
  const destroy = (): void => { list.destroy(); container.remove(); };
  /** True once synthetic: its content is the size of its viewport. */
  const synthetic = (): boolean => content.style.height === "100%";
  /** Wait for the driver to load and the swap to run (at once when cached). */
  const until = async (state: boolean): Promise<void> => {
    for (let i = 0; i < 100 && synthetic() !== state; i++) await wait(5);
  };
  /** Indexes of the rows on screen, in order. */
  const visible = (): number[] =>
    [...content.querySelectorAll<HTMLElement>("[data-index]")]
      .map((el) => Number(el.dataset.index))
      .filter((i) => {
        const top = i * ROW - list.getScrollPosition();
        return top + ROW > 0 && top < VIEWPORT;
      })
      .sort((a, b) => a - b);
  return { list, viewport, content, modes, errors, synthetic, until, visible, destroy };
}

describe("scroll.mode auto (default): native → synthetic past the limit", () => {
  it("a list that grows past the limit hands over in place, on the row it showed", async () => {
    const f = make(100);
    try {
      f.list.scrollToIndex(60);
      // A jump is a scroll too: the list is idle again after the timeout.
      await wait(IDLE * 3);
      expect(f.content.style.height).toBe(`${100 * ROW}px`);

      f.list.setItems(createTestItems(OVER));
      await f.until(true);

      expect(f.modes).toEqual(["synthetic"]);
      expect(f.viewport.scrollTop).toBe(0);
      expect(f.list.getScrollPosition()).toBe(60 * ROW);
      expect(f.visible()[0]).toBe(60);
      // Handled, so nothing tells the application to change its configuration.
      expect(f.errors).toEqual([]);
    } finally {
      f.destroy();
    }
  });

  it("once synthetic, the last row is reachable", async () => {
    const f = make(OVER);
    try {
      await f.until(true);
      f.list.scrollToIndex(OVER - 1, "end");
      expect(f.list.getScrollPosition()).toBe(OVER * ROW - VIEWPORT);
      expect(f.visible()[f.visible().length - 1]).toBe(OVER - 1);
    } finally {
      f.destroy();
    }
  });

  it("a list created past the limit goes synthetic and takes wheel input", async () => {
    const f = make(OVER);
    try {
      await f.until(true);
      expect(f.synthetic()).toBe(true);
      await wait(IDLE * 3);
      f.viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }));
      await wait(40);
      expect(f.list.getScrollPosition()).toBeGreaterThan(0);
    } finally {
      f.destroy();
    }
  });

  it("the plugins keep their state across the handoff", async () => {
    const f = make(100, undefined, [selection()]);
    try {
      (f.list as unknown as { select(id: number): void }).select(3);
      f.list.setItems(createTestItems(OVER));
      await f.until(true);
      expect((f.list as unknown as { getSelected(): number[] }).getSelected()).toEqual([3]);
    } finally {
      f.destroy();
    }
  });

  it("a list that shrinks below 3/4 of the limit takes native input back, on the same row", async () => {
    const f = make(OVER);
    try {
      await f.until(true);
      f.list.scrollToIndex(80);
      await wait(IDLE * 3);
      f.list.setItems(createTestItems(UNDER));

      expect(f.modes[f.modes.length - 1]).toBe("native");
      expect(f.content.style.height).toBe(`${UNDER * ROW}px`);
      expect(f.viewport.scrollTop).toBe(80 * ROW);
      expect(f.list.getScrollPosition()).toBe(80 * ROW);
      expect(f.visible()[0]).toBe(80);
    } finally {
      f.destroy();
    }
  });

  it("between 3/4 of the limit and the limit nothing swaps, in either direction", async () => {
    const f = make(UNDER);
    try {
      f.list.setItems(createTestItems(BETWEEN));
      await wait(50);
      expect(f.modes).toEqual([]);
      f.list.setItems(createTestItems(OVER));
      await f.until(true);
      await wait(IDLE * 3);
      f.list.setItems(createTestItems(BETWEEN));
      expect(f.synthetic()).toBe(true);
      f.list.setItems(createTestItems(UNDER));
      expect(f.synthetic()).toBe(false);
      expect(f.modes).toEqual(["synthetic", "native"]);
    } finally {
      f.destroy();
    }
  });

  it("a scroll in flight is never cut off: the handoff waits for idle", async () => {
    const f = make(OVER); // loads the driver, so the next handoff is synchronous
    await f.until(true);
    f.destroy();
    const g = make(100);
    try {
      g.viewport.scrollTop = 400;
      g.viewport.dispatchEvent(new Event("scroll"));
      expect(g.list.element.classList.contains("vlist--scrolling")).toBe(true);

      g.list.setItems(createTestItems(OVER));
      expect(g.modes).toEqual([]);
      // Capped at the limit while it waits (Firefox lays out nothing larger).
      expect(g.content.style.height).toBe("16000000px");

      await wait(IDLE * 3);
      expect(g.modes).toEqual(["synthetic"]);
      expect(g.synthetic()).toBe(true);
      expect(g.list.getScrollPosition()).toBe(400);
    } finally {
      g.destroy();
    }
  });
});

describe("scroll.mode auto: a jump the browser clamped", () => {
  it("lands where it was asked once the list is synthetic, not where the browser stopped it", async () => {
    const f = make(OVER); // loads the driver
    await f.until(true);
    f.destroy();
    const g = make(100);
    // The browser's element cap, scaled down: writes past it are clamped.
    const CAP = 5_000_000;
    let top = 0;
    Object.defineProperty(g.viewport, "scrollTop", { configurable: true, get: () => top, set: (v: number) => { top = Math.min(v, CAP); } });
    try {
      top = 400;
      g.viewport.dispatchEvent(new Event("scroll")); // in flight: the handoff waits
      g.list.setItems(createTestItems(OVER));
      g.list.scrollToIndex(OVER - 1, "end");
      expect(g.list.getScrollPosition()).toBe(CAP);

      await wait(IDLE * 3);
      expect(g.synthetic()).toBe(true);
      expect(g.list.getScrollPosition()).toBe(OVER * ROW - VIEWPORT);
      expect(g.visible()[g.visible().length - 1]).toBe(OVER - 1);
    } finally {
      g.destroy();
    }
  });

  it("a smooth jump while the swap is pending lands on its target too", async () => {
    const g = make(100);
    const CAP = 5_000_000;
    let top = 0;
    Object.defineProperty(g.viewport, "scrollTop", { configurable: true, get: () => top, set: (v: number) => { top = Math.min(v, CAP); } });
    try {
      top = 400;
      g.viewport.dispatchEvent(new Event("scroll"));
      g.list.setItems(createTestItems(OVER));
      g.list.scrollToIndex(OVER - 1, { align: "end", behavior: "smooth" });

      await wait(IDLE * 3);
      expect(g.synthetic()).toBe(true);
      expect(g.list.getScrollPosition()).toBe(OVER * ROW - VIEWPORT);
    } finally {
      g.destroy();
    }
  });

  it("a write clamped before any swap was pending is not replayed later", async () => {
    const g = make(100);
    const CAP = 1_000_000;
    let top = 0;
    Object.defineProperty(g.viewport, "scrollTop", { configurable: true, get: () => top, set: (v: number) => { top = Math.min(v, CAP); } });
    try {
      g.list.scrollToIndex(90); // 1,800,000 px, clamped at the cap; nothing pending
      expect(g.list.getScrollPosition()).toBe(CAP);
      await wait(IDLE * 3);
      g.list.setItems(createTestItems(OVER));
      await g.until(true);
      // Where the list was, not the write the browser refused long before.
      expect(g.list.getScrollPosition()).toBe(CAP);
    } finally {
      g.destroy();
    }
  });

  it("a scroll after the clamped jump wins over it", async () => {
    const g = make(100);
    const CAP = 5_000_000;
    let top = 0;
    Object.defineProperty(g.viewport, "scrollTop", { configurable: true, get: () => top, set: (v: number) => { top = Math.min(v, CAP); } });
    try {
      top = 400;
      g.viewport.dispatchEvent(new Event("scroll"));
      g.list.setItems(createTestItems(OVER));
      g.list.scrollToIndex(OVER - 1, "end");
      top = 4_000_000; // the user scrolls back up before idle
      g.viewport.dispatchEvent(new Event("scroll"));

      await g.until(true);
      await wait(IDLE * 3);
      expect(g.synthetic()).toBe(true);
      expect(g.list.getScrollPosition()).toBe(4_000_000);
    } finally {
      g.destroy();
    }
  });
});

describe("scroll.mode synthetic and native", () => {
  it('"synthetic" hands a small list over from the start', async () => {
    const f = make(100, "synthetic");
    try {
      await f.until(true);
      expect(f.synthetic()).toBe(true);
      expect(f.list.getScrollPosition()).toBe(0);
      // A handoff after creation commits the position, a scroll frame like any
      // other; with the driver cached it happens during creation and does not.
      // Either way the list settles.
      await wait(IDLE * 3);
      expect(f.list.element.classList.contains("vlist--scrolling")).toBe(false);
    } finally {
      f.destroy();
    }
  });

  it('"native" never hands over, and says so past the limit', async () => {
    const f = make(100, "native");
    try {
      f.list.setItems(createTestItems(OVER));
      await wait(50);
      expect(f.modes).toEqual([]);
      // 20,000,000 px of rows, capped: Firefox lays out nothing above 17,895,697 px.
      expect(f.content.style.height).toBe("16000000px");
      expect(f.errors).toEqual(["content:size:overflow"]);
    } finally {
      f.destroy();
    }
  });

  it("an unknown mode, and the removed bounded mode and runway, are refused", () => {
    const container = createContainer({ width: 300, height: VIEWPORT });
    try {
      for (const scroll of [{ mode: "bounded" }, { mode: "fast" }, { runway: 4 }]) {
        expect(() => createVList({ container, items: createTestItems(10), item: { height: 40, template: simpleTemplate },
          scroll: scroll as unknown as ScrollConfig })).toThrow(/scroll\.mode is "auto", "native" or "synthetic"/);
      }
      expect(() => createVList({ container, items: createTestItems(10), item: { height: 40, template: simpleTemplate },
        scroll: { mode: "synthetic", scrollbar: "native" } })).toThrow(/scroll.scrollbar "native" needs native scrolling/);
    } finally {
      container.remove();
    }
  });
});

describe("scroll.mode where input is fixed", () => {
  it("page() scrolls the document: no handoff", async () => {
    const f = make(100, "synthetic", [page()]);
    try {
      await wait(50);
      expect(f.modes).toEqual([]);
      expect(f.synthetic()).toBe(false);
    } finally {
      f.destroy();
    }
  });

  it("carousel() owns its input already (the runway): no handoff", async () => {
    const f = make(10, "native", [carousel()]);
    try {
      await wait(50);
      expect(f.modes).toEqual([]);
    } finally {
      f.destroy();
    }
  });

  it('carousel() with "synthetic" runs on the synthetic handler, with no scrollbar', async () => {
    // The switch from the runway is the carousel's (test/plugins/carousel/input.test.ts);
    // here the list ends synthetic whichever way it got there.
    const f = make(10, "synthetic", [carousel()]);
    try {
      await f.until(true);
      expect(f.viewport.style.touchAction).toBe("pan-x pinch-zoom");
      // An endless loop has no position for a scrollbar to show.
      expect(f.list.element.parentElement!.querySelectorAll(".vlist-scrollbar")).toHaveLength(0);
    } finally {
      f.destroy();
    }
  });

  it("the vlist/synthetic entry is synthetic whatever the mode", async () => {
    const container = createContainer({ width: 300, height: VIEWPORT });
    const list = createSynthetic({ container, items: createTestItems(100), item: { height: 40, template: simpleTemplate }, scroll: { mode: "native" } });
    const modes: string[] = [];
    list.on("scroll:mode", (e) => modes.push(e.mode));
    try {
      list.setItems(createTestItems(OVER));
      await wait(50);
      expect(modes).toEqual([]);
      expect(container.querySelector<HTMLElement>(".vlist-content")!.style.height).toBe("100%");
    } finally {
      list.destroy();
      container.remove();
    }
  });
});

describe("scroll.mode: the scrollbar a synthetic list gets", () => {
  const bars = (container: ParentNode): number => container.querySelectorAll(".vlist-scrollbar").length;

  it("auto draws one past the limit, and removes it with native input back", async () => {
    const f = make(100);
    const root = f.list.element.parentElement!;
    try {
      expect(bars(root)).toBe(0);
      f.list.setItems(createTestItems(OVER));
      await f.until(true);
      expect(bars(root)).toBe(1);
      expect(f.viewport.classList.contains("vlist-viewport--custom-scrollbar")).toBe(true);

      await wait(IDLE * 3);
      f.list.setItems(createTestItems(UNDER));
      expect(f.synthetic()).toBe(false);
      expect(bars(root)).toBe(0);
      expect(f.viewport.classList.contains("vlist-viewport--custom-scrollbar")).toBe(false);
    } finally {
      f.destroy();
    }
  });

  it("its thumb follows the position", async () => {
    const f = make(OVER);
    const root = f.list.element.parentElement!;
    try {
      await f.until(true);
      const thumb = root.querySelector<HTMLElement>(".vlist-scrollbar__thumb")!;
      const before = thumb.style.transform;
      f.list.scrollToIndex(OVER / 2);
      expect(thumb.style.transform).not.toBe(before);
    } finally {
      f.destroy();
    }
  });

  it('"synthetic" draws one from the start, and destroy removes it', async () => {
    const f = make(100, "synthetic");
    const root = f.list.element.parentElement!;
    await f.until(true);
    expect(bars(root)).toBe(1);
    f.destroy();
    expect(bars(root)).toBe(0);
  });

  it("a list with scrollbar() keeps that one: never two", async () => {
    const f = make(OVER, undefined, [scrollbar()]);
    const root = f.list.element.parentElement!;
    try {
      await f.until(true);
      expect(bars(root)).toBe(1);
    } finally {
      f.destroy();
    }
  });

  it('scroll.scrollbar "none" skips it; options configure it', async () => {
    for (const [option, expected] of [["none", 0], [{ minThumbSize: 40 }, 1]] as const) {
      const container = createContainer({ width: 300, height: VIEWPORT });
      const list = createVList({ container, items: createTestItems(100), item: { height: ROW, template: simpleTemplate },
        scroll: { mode: "synthetic", scrollbar: option } });
      try {
        for (let i = 0; i < 100 && container.querySelector(".vlist-content")!.getAttribute("style")?.includes("100%") !== true; i++) await wait(5);
        expect(bars(container)).toBe(expected);
        if (expected) {
          expect(container.querySelector<HTMLElement>(".vlist-scrollbar")!.style.getPropertyValue("--vlist-custom-scrollbar-min-thumb-size")).toBe("40px");
        }
      } finally {
        list.destroy();
        container.remove();
      }
    }
  });
});
