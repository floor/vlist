/**
 * FLO-204 — a lap shorter than the viewport.
 *
 * Two or three 100 px slides in a 400 px viewport: a lap is 200 or 300 px, so
 * the viewport shows more than one lap and each slide must be painted once per
 * lap on screen. The carousel placed an element by its data index, so every
 * copy of a slide landed on the same spot and part of the viewport was blank.
 * Asserted is what a person sees: the painted spans cover the viewport, with
 * no hole, at every position through a full turn in each direction.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { carouselEntries, carouselEntry } from "../../helpers/carousel-entry";

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

type Fixture = ReturnType<typeof carouselEntry>;
const VIEWPORT = 400;

function spans(f: Fixture): { id: string | null; from: number; to: number }[] {
  return [...f.host.querySelectorAll<HTMLElement>("[data-index]")]
    .filter((el) => el.style.display !== "none")
    .map((el) => {
      const t = el.style.transform.match(/translate[XY]\(([-\d.]+)px\)/);
      const from = t ? parseFloat(t[1]!) : NaN;
      return { id: el.textContent, from, to: from + parseFloat(el.style.height) };
    })
    .sort((a, b) => a.from - b.from);
}

/** The first uncovered point of the viewport, or null when it is fully painted. */
function hole(f: Fixture): number | null {
  const start = f.list.getScrollPosition() - f.ctx.scroll.getRenderOrigin();
  let reach = start;
  for (const row of spans(f)) {
    if (row.to <= reach) continue;
    if (row.from > reach + 0.5) return Math.round(reach - start);
    reach = row.to;
    if (reach >= start + VIEWPORT - 0.5) return null;
  }
  return Math.round(reach - start);
}

for (const [entry, create] of carouselEntries) {
  for (const count of [2, 3]) {
    describe(`${entry}: ${count} slides of 100 px in a 400 px viewport`, () => {
      test("the viewport is painted end to end at every position, through a full turn each way", () => {
        const f = carouselEntry(create, {}, false, count);
        try {
          expect(hole(f)).toBeNull();
          const lap = count * 100;
          for (const direction of [1, -1]) {
            for (let moved = 0; moved < lap + 50; moved += 10) {
              f.wheel(direction * 10);
              expect({ at: f.list.getScrollPosition(), hole: hole(f) }).toEqual({ at: f.list.getScrollPosition(), hole: null });
            }
          }
        } finally {
          f.destroy();
        }
      });

      test("each slide appears once per lap on screen, in order", () => {
        const f = carouselEntry(create, {}, false, count);
        try {
          const ids = spans(f).filter((r) => r.to > f.list.getScrollPosition() - f.ctx.scroll.getRenderOrigin()).map((r) => Number(r.id));
          // Consecutive painted slides follow the data order, wrapping.
          for (let i = 1; i < ids.length; i++) expect(ids[i]).toBe((ids[i - 1]! + 1) % count);
        } finally {
          f.destroy();
        }
      });
    });
  }
}
