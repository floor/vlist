/**
 * vlist — the pool keeps a whole released window
 *
 * A jump releases every mounted element at once. With more than 100 mounted
 * (a tall viewport, a wide grid) a fixed cap of 100 dropped the rest, and the
 * next jump cloned them again. The cap follows the most elements ever out.
 */

import { advanceTimers } from "../helpers/timers";
import { SCROLL_IDLE_TIMEOUT } from "../../src/constants";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/native";
import type { ElementPool, VList, VListPlugin } from "../../src/core/types";
import { grid } from "../../src/plugins/grid";

// =============================================================================
// DOM Setup — a 3000px viewport over 10px rows: 300 rows on screen
// =============================================================================

const VIEWPORT = 3000;
const ITEM = 10;
const TOTAL = 100_000;

type CloneNode = (this: Node, deep?: boolean) => Node;

let geometry: ReturnType<typeof capturePrototypeGeometry>;
let cloneOwner: { cloneNode: CloneNode };
let realCloneNode: CloneNode;
let clones = 0;

beforeAll(() => {
  setupDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => VIEWPORT, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 400, configurable: true });

  // Count cloneNode calls on the prototype that owns it; the real method still runs.
  let proto: object = HTMLElement.prototype;
  while (!Object.prototype.hasOwnProperty.call(proto, "cloneNode")) proto = Object.getPrototypeOf(proto);
  cloneOwner = proto as { cloneNode: CloneNode };
  realCloneNode = cloneOwner.cloneNode;
  cloneOwner.cloneNode = function (this: Node, deep?: boolean): Node {
    clones++;
    return realCloneNode.call(this, deep);
  };
});
afterAll(() => {
  cloneOwner.cloneNode = realCloneNode;
  geometry.restore();
  teardownDOM();
});
afterAll(() => geometry.assertRestored());

// =============================================================================
// Helpers
// =============================================================================

let container: HTMLElement;
let list: VList<TestItem> | null;
let pool: ElementPool;

/** Reads the list's own pool — the one the renderer acquires from. */
const poolProbe: VListPlugin<TestItem> = {
  name: "pool-probe",
  priority: 99,
  setup(ctx) { pool = ctx.pool; },
};

beforeEach(() => {
  container = createContainer({ width: 400, height: VIEWPORT });
  list = null;
});
afterEach(() => {
  list?.destroy();
  container.remove();
});

function jumpTo(scrollTop: number): void {
  const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
  Object.defineProperty(viewport, "scrollTop", { value: scrollTop, writable: true, configurable: true });
  viewport.dispatchEvent(new Event("scroll", { bubbles: false }));
}

function mounted(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".vlist-item"));
}

function firstIndex(): number {
  return Math.min(...mounted().map((el) => Number(el.dataset.index)));
}

// =============================================================================
// Tests
// =============================================================================

describe("pool cap follows the largest mounted window", () => {
  it("keeps every element a far jump releases, and the next jump clones nothing", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(TOTAL), item: { height: ITEM, template: simpleTemplate } },
      [poolProbe],
    );

    // A window in the middle of the list (overscan on both sides).
    jumpTo(200_000);
    const before = mounted();
    expect(before.length).toBeGreaterThan(250);

    // Far enough that the two windows share no item: all of `before` is released.
    jumpTo(400_000);
    expect(firstIndex()).toBeGreaterThan(30_000);
    expect(mounted().length).toBe(before.length);
    expect(pool.size).toBe(before.length);

    clones = 0;
    jumpTo(800_000);
    const after = mounted();
    expect(firstIndex()).toBeGreaterThan(70_000);
    expect(after.length).toBe(before.length);
    expect(clones).toBe(0);
    expect(pool.size).toBe(before.length);

    // The spares are the nodes that were released, not new ones.
    const spares = new Set(before);
    expect(after.every((el) => spares.has(el))).toBe(true);
  });

  it("a grid with more than 100 cells jumps without cloning", () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(TOTAL), item: { height: ITEM, template: simpleTemplate } },
      [grid({ columns: 4 }), poolProbe],
    );

    jumpTo(50_000);
    const before = mounted();
    expect(before.length).toBeGreaterThan(250);

    // Grid releases the old window, then acquires the new one in the same frame.
    clones = 0;
    jumpTo(100_000);
    const after = mounted();
    expect(firstIndex()).toBeGreaterThan(30_000);
    expect(after.length).toBe(before.length);
    expect(clones).toBe(0);

    const spares = new Set(before);
    expect(after.every((el) => spares.has(el))).toBe(true);
  });

  it("drops spare nodes once the list is idle after a shrink", async () => {
    list = createVList<TestItem>(
      { container, items: createTestItems(TOTAL), item: { height: ITEM, template: simpleTemplate } },
      [poolProbe],
    );

    jumpTo(200_000);
    const onScreen = mounted().length;
    expect(onScreen).toBeGreaterThan(250);

    list.setItems(createTestItems(10));
    const shrunk = mounted().length;
    expect(shrunk).toBeLessThan(onScreen);
    expect(pool.size).toBeGreaterThan(shrunk);

    await advanceTimers(SCROLL_IDLE_TIMEOUT);
    expect(pool.size).toBeLessThanOrEqual(mounted().length);
  });
});
