/**
 * vlist — The render window has a ceiling
 *
 * The capacity fix made the render window the authority on how many rows to
 * buffer, and capacity grows to meet it. That removed the only upper bound with
 * it: a size spec reporting 0 puts every item at the same offset, so
 * `indexAtOffset` lands on `total - 1` and the window becomes the entire
 * dataset — 20,000 of 20,000 rows, each a TypedArray slot and a DOM node.
 *
 * An item cannot occupy less than one physical pixel, so no more than
 * `containerSize + overscan * 2` rows can ever be visible.
 *
 * The third test is the one that matters most: the ceiling must never bind on a
 * legitimately small row, or it re-introduces the truncation the capacity fix
 * existed to remove.
 */

import { registerDOM, unregisterDOM } from "../helpers/dom";
import { describe, it as baseIt, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";
import { createContainer, createTestItems, type TestItem } from "../helpers/factory";
import { OVERSCAN } from "../../src/constants";

/**
 * Serial: `viewportHeight` below is read through an `HTMLElement.prototype`
 * getter, so it is the viewport height of every element in the document. A test
 * that changes it changes what its neighbours measure, which is exactly what
 * `bun test --concurrent` would let happen.
 */
const it = baseIt.serial;

let geometry: ReturnType<typeof capturePrototypeGeometry>;
let viewportHeight = 400;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return viewportHeight; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 300; }, configurable: true });
});
afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

let list: VList<TestItem> | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  list?.destroy();
  list = null;
  container?.remove();
  container = null;
  viewportHeight = 400;
});

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const template = (item: TestItem): string => `<div class="item">${item.id}</div>`;

interface Run {
  readonly rows: number;
  readonly errors: string[];
}

async function build(total: number, height: number | (() => number)): Promise<Run> {
  container = createContainer({ width: 300, height: viewportHeight });
  const errors: string[] = [];
  list = createVList<TestItem>({
    container,
    items: createTestItems(total),
    item: { height: height as never, template },
  });
  list.on("error", (e: { error: Error; context: string }) => errors.push(e.context));
  await tick(0);
  await tick(40);
  return { rows: container.querySelectorAll("[data-index]").length, errors };
}

describe("render window ceiling", () => {
  it("does not materialise the dataset for a zero-size spec", async () => {
    const total = 20000;
    const { rows } = await build(total, () => 0);

    // Was every row in the list.
    expect(rows).toBeLessThan(total);
    // An item cannot be smaller than a pixel, so this is the most that can show.
    expect(rows).toBeLessThanOrEqual(Math.ceil(viewportHeight) + OVERSCAN * 2);
  });

  it("reports the ceiling once, not once per frame", async () => {
    const { errors } = await build(20000, () => 0);
    // Silently clamping is the defect this replaced: a short list and no reason.
    expect(errors).toContain("render:window-ceiling");
    expect(errors.filter((c) => c === "render:window-ceiling").length).toBe(1);
  });

  it("never binds on a legitimately small row — the capacity fix still holds", async () => {
    // C7: a 10px size function in a tall viewport used to render 219 of 305
    // rows because capacity came from a flat 20px guess. The ceiling sits far
    // above that, so the full window must still render, with no error.
    viewportHeight = 3050;
    const { rows, errors } = await build(20000, () => 10);

    expect(rows).toBeGreaterThan(300);
    expect(errors).not.toContain("render:window-ceiling");
  });

  it("leaves an ordinary list untouched", async () => {
    const { rows, errors } = await build(1000, 40);
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThan(40);
    expect(errors).toEqual([]);
  });
});
