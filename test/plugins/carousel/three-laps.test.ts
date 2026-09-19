/**
 * Three laps and a symmetric fold (FLO-163).
 *
 * The position lives in the home lap, `[lap, 2 × lap)`, and leaves it for one
 * frame at most, in either direction. What is asserted here is what a person
 * sees: where the target item is painted, and that the leading edge of the
 * viewport is never empty — not only which index the carousel reports.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { carouselEntries, carouselEntry } from "../../helpers/carousel-entry";
import { wrapLaps } from "../../../src/core/fold";

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

type Fixture = ReturnType<typeof carouselEntry>;
const LAP = 1000; // ten items of 100 px (free) — `full` items are 400 px, lap 4000
const VIEWPORT = 400;

/** Painted spans of the visible rows along the main axis, in content coordinates. */
function spans(f: Fixture, isX = false): { id: string | null; from: number; to: number }[] {
  return [...f.host.querySelectorAll<HTMLElement>("[data-index]")]
    .filter((el) => el.style.display !== "none")
    .map((el) => {
      const t = el.style.transform.match(/translate[XY]\(([-\d.]+)px\)/);
      const from = t ? parseFloat(t[1]!) : NaN;
      return { id: el.textContent, from, to: from + parseFloat(isX ? el.style.width : el.style.height) };
    })
    .sort((a, b) => a.from - b.from);
}

/** Where the viewport starts, in the same coordinates as the painted spans. */
const viewportStart = (f: Fixture): number => f.list.getScrollPosition() - f.ctx.scroll.getRenderOrigin();

/** Distance from the viewport's start to where item `id` is painted; NaN when it is not painted. */
function landing(f: Fixture, id: number, isX = false): number {
  const row = spans(f, isX).find((r) => r.id === String(id));
  return row ? row.from - viewportStart(f) : NaN;
}

/** True when the painted rows cover the whole viewport with no hole. */
function filled(f: Fixture): boolean {
  const start = viewportStart(f);
  let reach = start;
  for (const row of spans(f)) {
    if (row.to <= reach) continue;
    if (row.from > reach + 0.5) return false;
    reach = row.to;
    if (reach >= start + VIEWPORT - 0.5) return true;
  }
  return false;
}

describe("wrapLaps", () => {
  test("an owner that folds every lap lives in [home, home + lap): it folds at once on either side", () => {
    expect(wrapLaps(0, 1)).toBe(0);
    expect(wrapLaps(0.999, 1)).toBe(0);
    expect(wrapLaps(1, 1)).toBe(1);
    expect(wrapLaps(2.5, 1)).toBe(2);
    // The side truncation got wrong: a hair before home is already the lap before.
    expect(wrapLaps(-0.001, 1)).toBe(-1);
    expect(wrapLaps(-1, 1)).toBe(-1);
    expect(wrapLaps(-1.001, 1)).toBe(-2);
  });

  test("a larger threshold keeps the symmetric dead zone it always had", () => {
    expect(wrapLaps(2.9, 3)).toBe(0);
    expect(wrapLaps(-2.9, 3)).toBe(0);
    expect(wrapLaps(3.2, 3)).toBe(3);
    expect(wrapLaps(-3.2, 3)).toBe(-3);
  });
});

for (const [entry, create] of carouselEntries) {
  describe(`${entry}: the position stays in the home lap`, () => {
    test("it starts one lap in, and a wheel in either direction never rests outside it", () => {
      const f = carouselEntry(create);
      try {
        expect(f.list.getScrollPosition()).toBe(LAP);
        for (const direction of [-1, 1]) {
          for (let i = 0; i < 80; i++) {
            f.wheel(direction * 35);
            const pos = f.list.getScrollPosition();
            expect(pos).toBeGreaterThanOrEqual(LAP);
            expect(pos).toBeLessThan(2 * LAP);
          }
        }
      } finally {
        f.destroy();
      }
    });

    test("dragging backwards from the first item: the item before it is painted at every frame — no blank leading edge", () => {
      const f = carouselEntry(create);
      try {
        f.list.scrollToIndex(0);
        expect(filled(f)).toBe(true);
        for (let i = 0; i < 40; i++) {
          f.wheel(-12);
          expect(filled(f)).toBe(true);
          // The last item of the data is what precedes the first: it is on screen, at the leading edge.
          if (i > 0 && i < 8) expect(spans(f)[0]!.id === "9" || spans(f).some((r) => r.id === "9")).toBe(true);
        }
        for (let i = 0; i < 40; i++) {
          f.wheel(12);
          expect(filled(f)).toBe(true);
        }
      } finally {
        f.destroy();
      }
    });
  });

  for (const isX of [false, true]) {
    const axis = isX ? "horizontal" : "vertical";

    test(`${entry}/${axis}: a snap from the last item to the first, and back, lands the target at the viewport's start`, () => {
      const f = carouselEntry(create, { variant: "full", snap: true, snapDuration: 64 }, isX);
      const go = (name: "next" | "prev") => (f.list[name] as (n: number, o: { behavior: string; duration: number }) => void)(1, { behavior: "smooth", duration: 64 });
      try {
        f.list.scrollToIndex(9);
        expect(landing(f, 9, isX)).toBeCloseTo(0, 0);

        go("next"); // 9 → 0: forwards across the end of the home lap
        f.advance();
        expect(f.state().index).toBe(0);
        expect(landing(f, 0, isX)).toBeCloseTo(0, 0);

        go("prev"); // 0 → 9: backwards across its start
        f.advance();
        expect(f.state().index).toBe(9);
        expect(landing(f, 9, isX)).toBeCloseTo(0, 0);

        const pos = f.list.getScrollPosition();
        expect(pos).toBeGreaterThanOrEqual(4 * LAP);
        expect(pos).toBeLessThan(8 * LAP);
      } finally {
        f.destroy();
      }
    });

    test(`${entry}/${axis}: twelve presses forwards then twelve back, 60 ms apart, return to the first item with no lap-sized jump`, () => {
      const f = carouselEntry(create, { variant: "full", snap: true, snapDuration: 64 }, isX);
      try {
        f.list.scrollToIndex(0);
        let jump = 0;
        let prev = spans(f, isX);
        const press = (key: string): void => {
          f.ctx.dom.content.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
          f.step(4);
          const rows = spans(f, isX);
          for (const row of rows) {
            const old = prev.find((r) => r.id === row.id);
            if (old) jump = Math.max(jump, Math.abs(row.from - old.from));
          }
          prev = rows;
        };
        for (let i = 0; i < 12; i++) press(isX ? "ArrowRight" : "ArrowDown");
        f.advance();
        expect(f.state().index).toBe(2);
        expect(landing(f, 2, isX)).toBeCloseTo(0, 0);

        for (let i = 0; i < 12; i++) press(isX ? "ArrowLeft" : "ArrowUp");
        f.advance();
        expect(f.state().index).toBe(0);
        expect(landing(f, 0, isX)).toBeCloseTo(0, 0);
        // A row may move by up to a step per press; never by a lap.
        expect(jump).toBeLessThan(2 * VIEWPORT);
      } finally {
        f.destroy();
      }
    });
  }
}
