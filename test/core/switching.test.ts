/**
 * core/switching.ts, as carousel() uses it under scroll.mode "synthetic": the
 * runway until the synthetic driver loads, then the synthetic handler, in place.
 *
 * The driver is a module loaded once per page, so a real carousel takes this
 * path only while nothing has loaded it yet. Here the load is a promise the
 * test resolves, through the same wrap hook the carousel uses.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createContainer, createTestItems, simpleTemplate } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import { createSwitchingHandler, type LogicalHandlerFactory } from "../../src/core/switching";
import { createRunwayHandler } from "../../src/core/runway";

let geometry: ReturnType<typeof capturePrototypeGeometry>;
beforeAll(() => {
  setupDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 300 });
});
afterAll(() => {
  geometry.restore();
  teardownDOM();
});

const LAP = 4000; // 100 rows of 40 px

function make() {
  const container = createContainer({ width: 300, height: 400 });
  let resolve!: (factory: LogicalHandlerFactory) => void;
  const load = new Promise<LogicalHandlerFactory>((r) => { resolve = r; });
  let switched = 0;
  const list = createVList({ container, items: createTestItems(100), item: { height: 40, template: simpleTemplate } }, [{
    name: "wrap-owner",
    setup(ctx) {
      ctx.scroll.setWrap({ lapSize: () => LAP, itemsPerLap: () => 100, home: () => LAP, thresholdLaps: 1 },
        (config) => createSwitchingHandler(config, createRunwayHandler, load, () => { switched++; }));
    },
  }]);
  const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
  const content = container.querySelector<HTMLElement>(".vlist-content")!;
  const destroy = (): void => { list.destroy(); container.remove(); };
  const loadDriver = async (): Promise<void> =>
    resolve((await import("../../src/synthetic/driver")).createSyntheticScrollHandler as LogicalHandlerFactory);
  return { list, viewport, content, load: loadDriver, switched: () => switched, destroy };
}

describe("createSwitchingHandler: the runway, then the synthetic handler", () => {
  it("runs the runway until the driver loads, then the synthetic handler, on the same position", async () => {
    const f = make();
    try {
      // The runway: a native scroller a few viewports long.
      expect(f.content.style.height).toMatch(/px$/);
      expect(f.viewport.style.touchAction).toBe("");
      f.list.scrollToIndex(130); // the next lap: the loop, not a clamp
      const before = f.list.getScrollPosition();

      await f.load();
      await Promise.resolve();

      expect(f.switched()).toBe(1);
      expect(f.content.style.height).toBe("100%");
      expect(f.viewport.style.touchAction).toBe("pan-x pinch-zoom");
      expect(f.list.getScrollPosition()).toBe(before);
      // Writes reach the synthetic handler now, and it still wraps.
      f.list.scrollToIndex(5);
      expect(f.list.getScrollPosition() % LAP).toBe(200);
    } finally {
      f.destroy();
    }
  });

  it("a carousel destroyed before the driver arrives does not switch", async () => {
    const f = make();
    f.destroy();
    await f.load();
    await Promise.resolve();
    expect(f.switched()).toBe(0);
  });
});
