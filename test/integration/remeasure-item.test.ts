/**
 * vlist — remeasureItem(): per-item size re-read
 *
 * The issue's repro: a table row's content changes to need a different height
 * (an editor grows, say). The item's data is not rewritten — the row's data
 * lives in a side map while a control inside it is focused — so no update path
 * exists that would re-read the size spec. `remeasureItem(index)` asks the
 * owning size source for one fresh size and makes the layout observe it: the
 * mounted row keeps its element and its focus, and every later row moves.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";
import { table } from "../../src/plugins/table/plugin";

// =============================================================================
// Setup
// =============================================================================

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  setupDOM({ width: 300, height: 500 });
  geometry = capturePrototypeGeometry();
  // Core reads the viewport's client box at creation. happy-dom reports 0
  // unless the prototype answers, as in the other integration suites.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() { return 500; },
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    get() { return 300; },
    configurable: true,
  });
});
afterAll(() => {
  geometry.restore();
  teardownDOM();
});
afterAll(() => geometry.assertRestored());

// =============================================================================
// Fixtures
// =============================================================================

const COLUMNS = [{ key: "name", label: "Name", width: 200 }];

interface TableFixture {
  readonly list: VList<TestItem>;
  readonly container: HTMLElement;
  /** Per-index height overrides read by the plugin's `rowHeight` function. */
  readonly heights: number[];
  row(index: number): HTMLElement | null;
  content(): HTMLElement;
  dispose(): void;
}

/** A plain table over 30 items, all 40px until a test writes `heights`. */
function buildTable(count = 30): TableFixture {
  const heights: number[] = [];
  const container = createContainer({ width: 300, height: 500 });
  const list = createVList<TestItem>(
    {
      container,
      items: createTestItems(count),
      item: { height: 40, template: simpleTemplate },
    },
    [
      table({
        columns: COLUMNS,
        rowHeight: (index: number) => heights[index] ?? 40,
        headerHeight: 20,
      }),
    ],
  );
  return {
    list,
    container,
    heights,
    row(index: number): HTMLElement | null {
      return container.querySelector<HTMLElement>(`.vlist-table-row[data-index="${index}"]`);
    },
    content(): HTMLElement {
      return container.querySelector<HTMLElement>(".vlist-content")!;
    },
    dispose(): void {
      list.destroy();
      container.remove();
    },
  };
}

// =============================================================================
// The issue's repro
// =============================================================================

describe("remeasureItem — table with a function rowHeight", () => {
  it("grows a mounted row in place and moves the rows after it", () => {
    const f = buildTable();
    try {
      const row2 = f.row(2);
      const row3 = f.row(3);
      const row4 = f.row(4);
      expect(row2).not.toBeNull();
      expect(row3).not.toBeNull();
      expect(row4).not.toBeNull();

      // Before: 30 rows of 40px, content 1200px.
      expect(row2!.style.height).toBe("40px");
      expect(row2!.style.transform).toBe("translateY(80px)");
      expect(row3!.style.transform).toBe("translateY(120px)");
      expect(f.content().style.height).toBe("1200px");

      // The content now needs 80px, but no item data was written: the new
      // height is only visible to the size function.
      f.heights[2] = 80;
      expect(f.list.remeasureItem(2)).toBe(true);

      // The same element, updated in place — not recreated, no template re-run.
      expect(f.row(2)).toBe(row2);
      expect(row2!.style.height).toBe("80px");

      // Every later row moved down by the delta.
      expect(row3!.style.transform).toBe("translateY(160px)");
      expect(row4!.style.transform).toBe("translateY(200px)");

      // The scroll content grew with it.
      expect(f.content().style.height).toBe("1240px");
    } finally {
      f.dispose();
    }
  });
});
