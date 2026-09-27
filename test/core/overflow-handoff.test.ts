/**
 * overflow() — a native list hands its input to the synthetic handler past a
 * content size, and takes it back below another (RFC-015, FLO-247).
 *
 * Thresholds are lowered so that a few hundred rows cross them; the handoff
 * does not depend on the number, only on the crossing.
 */
import { capturePrototypeGeometry } from "../helpers/geometry";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createContainer, createTestItems, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/index";
import { createVList as createSynthetic } from "../../src/synthetic";
import { overflow } from "../../src/overflow";
import { page } from "../../src/plugins/page";
import { carousel } from "../../src/plugins/carousel";
import { selection } from "../../src/plugins/selection";

const ROW = 40;
const VIEWPORT = 500;
const ABOVE = 10_000; // 250 rows
const BELOW = 6_000; // 150 rows
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

function make(rows: number, extra: Parameters<typeof createVList<TestItem>>[1] = []) {
  const container = createContainer({ width: 300, height: VIEWPORT });
  const modes: string[] = [];
  const errors: string[] = [];
  const list = createVList(
    { container, items: createTestItems(rows), item: { height: ROW, template: simpleTemplate }, scroll: { idleTimeout: IDLE } },
    [overflow({ threshold: ABOVE, returnBelow: BELOW }), ...extra],
  );
  list.on("scroll:mode", (e) => modes.push(e.mode));
  list.on("error", (e) => errors.push(e.context));
  const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
  const content = container.querySelector<HTMLElement>(".vlist-content")!;
  const destroy = (): void => { list.destroy(); container.remove(); };
  /** Indexes of the rows on screen, in order. */
  const visible = (): number[] =>
    [...content.querySelectorAll<HTMLElement>("[data-index]")]
      .map((el) => Number(el.dataset.index))
      .filter((i) => {
        const top = i * ROW - list.getScrollPosition();
        return top + ROW > 0 && top < VIEWPORT;
      })
      .sort((a, b) => a - b);
  return { list, container, viewport, content, modes, errors, visible, destroy };
}

describe("overflow(): native → synthetic", () => {
  it("a list that grows past the threshold hands over in place, on the row it showed", async () => {
    const f = make(100);
    try {
      f.list.scrollToIndex(60);
      // A jump is a scroll too: the list is idle again after the timeout.
      await wait(IDLE * 3);
      const before = f.list.getScrollPosition();
      expect(before).toBe(60 * ROW);
      expect(f.content.style.height).toBe(`${100 * ROW}px`);

      f.list.setItems(createTestItems(1000));

      expect(f.modes).toEqual(["synthetic"]);
      // Synthetic content is the size of its viewport, not of its rows.
      expect(f.content.style.height).toBe("100%");
      expect(f.viewport.scrollTop).toBe(0);
      expect(f.list.getScrollPosition()).toBe(before);
      expect(f.visible()[0]).toBe(60);
      // Handled, so nothing tells the application to switch entries.
      expect(f.errors).toEqual([]);
    } finally {
      f.destroy();
    }
  });

  it("once synthetic, the end of the list is reachable", () => {
    const f = make(1000);
    try {
      f.list.scrollToIndex(999, "end");
      expect(f.list.getScrollPosition()).toBe(1000 * ROW - VIEWPORT);
      expect(f.visible()[f.visible().length - 1]).toBe(999);
    } finally {
      f.destroy();
    }
  });

  it("a list created past the threshold starts synthetic and takes wheel input", async () => {
    const f = make(1000);
    try {
      expect(f.content.style.height).toBe("100%");
      expect(f.list.element.classList.contains("vlist--scrolling")).toBe(false);
      f.viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }));
      await wait(40);
      expect(f.list.getScrollPosition()).toBeGreaterThan(0);
    } finally {
      f.destroy();
    }
  });

  it("the plugins keep their state across the handoff", () => {
    const f = make(100, [selection()]);
    try {
      (f.list as unknown as { select(id: number): void }).select(3);
      f.list.setItems(createTestItems(1000));
      expect(f.modes).toEqual(["synthetic"]);
      expect((f.list as unknown as { getSelected(): number[] }).getSelected()).toEqual([3]);
    } finally {
      f.destroy();
    }
  });
});

describe("overflow(): synthetic → native", () => {
  it("a list that shrinks below returnBelow takes native input back, on the same row", async () => {
    const f = make(1000);
    try {
      f.list.scrollToIndex(80);
      await wait(IDLE * 3);
      f.list.setItems(createTestItems(120));

      expect(f.modes).toEqual(["native"]);
      expect(f.content.style.height).toBe(`${120 * ROW}px`);
      expect(f.viewport.scrollTop).toBe(80 * ROW);
      expect(f.list.getScrollPosition()).toBe(80 * ROW);
      expect(f.visible()[0]).toBe(80);
    } finally {
      f.destroy();
    }
  });

  it("between returnBelow and the threshold nothing swaps, in either direction", async () => {
    const f = make(200); // 8,000 px: native
    try {
      f.list.setItems(createTestItems(240)); // 9,600: still under the threshold
      expect(f.modes).toEqual([]);
      f.list.setItems(createTestItems(300)); // 12,000: over
      await wait(IDLE * 3);
      f.list.setItems(createTestItems(200)); // 8,000: over returnBelow, stays synthetic
      expect(f.modes).toEqual(["synthetic"]);
      expect(f.content.style.height).toBe("100%");
      f.list.setItems(createTestItems(100)); // 4,000: under returnBelow
      expect(f.modes).toEqual(["synthetic", "native"]);
    } finally {
      f.destroy();
    }
  });
});

describe("overflow(): a scroll in flight is never cut off", () => {
  it("the handoff waits for idle, and runs then", async () => {
    const f = make(100);
    try {
      f.viewport.scrollTop = 400;
      f.viewport.dispatchEvent(new Event("scroll"));
      expect(f.list.element.classList.contains("vlist--scrolling")).toBe(true);

      f.list.setItems(createTestItems(1000));
      expect(f.modes).toEqual([]);
      expect(f.content.style.height).toBe(`${1000 * ROW}px`);

      await wait(IDLE * 3);
      expect(f.modes).toEqual(["synthetic"]);
      expect(f.content.style.height).toBe("100%");
      expect(f.list.getScrollPosition()).toBe(400);
    } finally {
      f.destroy();
    }
  });
});

describe("overflow(): combinations", () => {
  it("page() and carousel() are refused at creation", () => {
    for (const other of [page<TestItem>(), carousel<TestItem>()]) {
      const container = createContainer({ width: 300, height: VIEWPORT });
      try {
        expect(() => createVList(
          { container, items: createTestItems(10), item: { height: ROW, template: simpleTemplate } },
          [overflow(), other],
        )).toThrow(/overflow.*conflicts|conflicts with "overflow"/);
      } finally {
        container.remove();
      }
    }
  });

  it("the vlist/synthetic entry has no limit to hand over: overflow() is dropped", () => {
    const container = createContainer({ width: 300, height: VIEWPORT });
    const list = createSynthetic(
      { container, items: createTestItems(100), item: { height: ROW, template: simpleTemplate } },
      [overflow({ threshold: ABOVE, returnBelow: BELOW })],
    );
    const modes: string[] = [];
    list.on("scroll:mode", (e) => modes.push(e.mode));
    try {
      list.setItems(createTestItems(1000));
      list.setItems(createTestItems(10));
      expect(modes).toEqual([]);
      expect(container.querySelector<HTMLElement>(".vlist-content")!.style.height).toBe("100%");
    } finally {
      list.destroy();
      container.remove();
    }
  });
});
