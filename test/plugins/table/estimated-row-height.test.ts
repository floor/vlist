import { describe, expect, it } from "bun:test";
import { createVList } from "../../../src/core/create";
import { table, type TablePluginConfig } from "../../../src/plugins/table/plugin";
import type { VListItem } from "../../../src/types";
import { capturePrototypeGeometry } from "../../helpers/geometry";

interface Row extends VListItem {
  id: number;
  name: string;
}

const columns = [{ key: "name", label: "Name", width: 200 }];
const items = (): Row[] => [
  { id: 0, name: "First" },
  { id: 1, name: "Second" },
  { id: 2, name: "Third" },
];

function withWarnings(mode: string, run: (warnings: string[]) => void): void {
  const geometry = capturePrototypeGeometry();
  const previousMode = process.env.NODE_ENV;
  const previousWarn = console.warn;
  const warnings: string[] = [];
  process.env.NODE_ENV = mode;
  console.warn = (...args: unknown[]): void => {
    warnings.push(args.map(String).join(" "));
  };
  Object.defineProperties(HTMLElement.prototype, {
    clientHeight: { configurable: true, get: () => 240 },
    clientWidth: { configurable: true, get: () => 600 },
  });
  try {
    run(warnings);
  } finally {
    console.warn = previousWarn;
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
    geometry.restore();
    geometry.assertRestored();
  }
}

function createFixture(config: TablePluginConfig<Row>, itemHeight?: number) {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientHeight", { value: 240, configurable: true });
  Object.defineProperty(container, "clientWidth", { value: 600, configurable: true });
  document.body.appendChild(container);
  try {
    const list = createVList(
      {
        container,
        items: items(),
        item: {
          ...(itemHeight === undefined ? {} : { height: itemHeight }),
          template: (item) => item.name,
        },
      },
      [table<Row>(config)],
    );
    return {
      list,
      rows: () => Array.from(
        list.element.querySelectorAll<HTMLElement>('[role="row"][data-index]'),
        (row) => ({ height: row.style.height, transform: row.style.transform }),
      ),
      cleanup: () => {
        try {
          list.destroy();
        } finally {
          container.remove();
        }
      },
    };
  } catch (error) {
    container.remove();
    throw error;
  }
}

// Deliberately exercise the accepted JavaScript-only configuration without
// widening TableConfig: TypeScript still requires rowHeight.
const estimateOnly = (estimate: number): TablePluginConfig<Row> =>
  ({ columns, estimatedRowHeight: estimate }) as TablePluginConfig<Row>;

describe("table — estimatedRowHeight deprecation", () => {
  // Every case owns console.warn, NODE_ENV and prototype geometry; none yields
  // while they are replaced, and it.serial keeps other tests out of that window.
  it.serial("warns once per table() call in development, never per render or row", () => {
    withWarnings("development", (warnings) => {
      const fixture = createFixture({ columns, rowHeight: 41, estimatedRowHeight: 80 }, 23);
      try {
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("estimatedRowHeight is deprecated in 3.3.0");
        expect(warnings[0]).toContain("removed in 4.0");
        expect(warnings[0]).toContain("does not size or measure rows");
        expect(warnings[0]).toContain("rowHeight");
        expect(warnings[0]).toContain("remeasureItem(index)");
        expect(fixture.rows()).toHaveLength(3);

        fixture.list.updateColumns(columns);
        fixture.list.setItems(items());
        fixture.list.updateItem(1, { name: "Updated" });
        expect(fixture.rows()).toHaveLength(3);
        expect(warnings).toHaveLength(1);

        // A fresh configuration warns again, including a present zero estimate;
        // no once-per-module flag can hide this second caller's warning.
        table<Row>({ columns, rowHeight: 41, estimatedRowHeight: 0 });
        expect(warnings).toHaveLength(2);
      } finally {
        fixture.cleanup();
      }
    });
  });

  it.serial("does not warn without an estimate and preserves validation failures", () => {
    withWarnings("development", (warnings) => {
      table<Row>({ columns, rowHeight: 41 });
      // JavaScript callers can explicitly pass undefined; keep the public type
      // exact while checking that runtime edge separately.
      table<Row>(
        { columns, rowHeight: 41, estimatedRowHeight: undefined } as unknown as TablePluginConfig<Row>,
      );
      expect(() => table<Row>({ columns } as TablePluginConfig<Row>))
        .toThrow("either rowHeight or estimatedRowHeight is required");
      expect(() => table<Row>({ columns: [], rowHeight: 41, estimatedRowHeight: 80 }))
        .toThrow("columns must be a non-empty array");
      expect(warnings).toHaveLength(0);
    });
  });

  it.serial("does not warn in production and keeps numeric row sizing", () => {
    withWarnings("production", (warnings) => {
      const fixture = createFixture({ columns, rowHeight: 41, estimatedRowHeight: 80 }, 23);
      try {
        expect(warnings).toHaveLength(0);
        expect(fixture.rows()).toEqual([
          { height: "41px", transform: "translateY(0px)" },
          { height: "41px", transform: "translateY(41px)" },
          { height: "41px", transform: "translateY(82px)" },
        ]);
      } finally {
        fixture.cleanup();
      }
    });
  });

  it.serial("keeps the core item height when only the table estimate is supplied", () => {
    withWarnings("development", () => {
      const fixture = createFixture(estimateOnly(80), 23);
      try {
        expect(fixture.rows()).toEqual([
          { height: "23px", transform: "translateY(0px)" },
          { height: "23px", transform: "translateY(23px)" },
          { height: "23px", transform: "translateY(46px)" },
        ]);
      } finally {
        fixture.cleanup();
      }
    });
  });

  it.serial("keeps the 40px core fallback instead of reading the table estimate", () => {
    withWarnings("development", () => {
      const fixture = createFixture(estimateOnly(80));
      try {
        expect(fixture.rows()).toEqual([
          { height: "40px", transform: "translateY(0px)" },
          { height: "40px", transform: "translateY(40px)" },
          { height: "40px", transform: "translateY(80px)" },
        ]);
      } finally {
        fixture.cleanup();
      }
    });
  });

  it.serial("keeps explicit rowHeight ahead of core height and table estimate", () => {
    withWarnings("development", () => {
      const fixture = createFixture({ columns, rowHeight: 41, estimatedRowHeight: 80 }, 23);
      try {
        expect(fixture.rows()).toEqual([
          { height: "41px", transform: "translateY(0px)" },
          { height: "41px", transform: "translateY(41px)" },
          { height: "41px", transform: "translateY(82px)" },
        ]);
      } finally {
        fixture.cleanup();
      }
    });
  });

  it.serial("keeps function row heights and offsets instead of reading the estimate", () => {
    withWarnings("development", () => {
      const heights = [31, 47, 59];
      const fixture = createFixture({
        columns,
        rowHeight: (index) => heights[index]!,
        estimatedRowHeight: 80,
      }, 23);
      try {
        expect(fixture.rows()).toEqual([
          { height: "31px", transform: "translateY(0px)" },
          { height: "47px", transform: "translateY(31px)" },
          { height: "59px", transform: "translateY(78px)" },
        ]);
      } finally {
        fixture.cleanup();
      }
    });
  });
});
