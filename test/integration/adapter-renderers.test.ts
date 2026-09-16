import type { VListItem } from "../../src/types";
import { beforeAll, afterAll, describe, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createPluginMockContext } from "../helpers/plugin-context";
import { grid } from "../../src/plugins/grid/plugin";
import { table } from "../../src/plugins/table/plugin";
import { masonry } from "../../src/plugins/masonry/plugin";
import { groups } from "../../src/plugins/groups/plugin";
import { tree } from "../../src/plugins/tree/plugin";

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const factories = [
  () => grid({ columns: 2 }),
  () => table({ columns: [{ key: "id", label: "ID", width: 200 }], rowHeight: 40 }),
  () => masonry({ columns: 2 }),
  () => tree(),
  () => groups({ getGroupForIndex: () => "A", headerHeight: 20, headerTemplate: () => "A" }),
];

for (const factory of factories) describe(`${factory().name} adapter boundary`, () => {
  it("positions from the adapter and commits an origin-only change once per frame", () => {
    const items = Array.from({ length: 100 }, (_, id) => ({ id }));
    const t = createPluginMockContext<VListItem>(items, { itemSize: 40, containerHeight: 400 });
    let origin = 100;
    let originReads = 0;
    let positionReads = 0;
    Object.assign(t.ctx.scroll, {
      getRenderOrigin: () => { originReads++; return origin; },
      getPixelEquivalent: () => { positionReads++; return 0; },
    });
    const plugin = factory();
    try {
      plugin.setup!(t.ctx);
      // Deliberately disagree with the adapter: renderers must not read these.
      t.engineState.baseOffset = 900;
      t.engineState.prevBaseOffset = 777;
      t.engineState.scrollPosition = 1000;
      originReads = positionReads = 0;
      t.ctx.render.force();
      const row = t.dom.content.querySelector('[data-index="0"]') as HTMLElement;
      expect(row).not.toBeNull();
      const y = () => {
        const match = row.style.transform.match(/translate(?:Y\((-?[\d.]+)px\)|\([^,]+,\s*(-?[\d.]+)px\))/);
        return Number(match?.[1] ?? match?.[2]);
      };
      expect(y()).toBe(-100);
      expect(originReads).toBe(1);
      expect(positionReads).toBe(1);
      const range = [t.engineState.prevRangeStart, t.engineState.prevRangeEnd];
      origin = 107;
      originReads = positionReads = 0;
      t.ctx.render.ifNeeded();
      expect(y()).toBe(-107);
      expect([t.engineState.prevRangeStart, t.engineState.prevRangeEnd]).toEqual(range);
      expect(originReads).toBe(1);
      expect(positionReads).toBe(1);
      expect(t.engineState.prevBaseOffset).toBe(777);
    } finally {
      for (const destroy of t.destroyHandlers) destroy();
      t.cleanup();
    }
  });
});
