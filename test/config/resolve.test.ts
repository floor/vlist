/**
 * vlist — Convenience config resolver tests (`vlist/config`)
 *
 * `resolvePlugins` is the single source of truth for translating the adapters'
 * high-level config (`layout`, `grid`, `selection`, `plugins`, …) into the core
 * plugin array. These tests lock in that translation so the four framework
 * adapters, which now all delegate here, stay behavior-identical.
 *
 * Regression coverage for floor/vlist#119: a user-supplied `plugins` array must
 * be accepted and forwarded (previously impossible — the field wasn't typed and
 * was never forwarded).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { resolvePlugins, createVListFromConfig } from "../../src/config";
import type { VListConfig } from "../../src/config";
import type { VListPlugin } from "../../src/core/types";
import { grid } from "../../src/plugins/grid";
import { autosize } from "../../src/plugins/autosize";

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

const template = (item: TestItem): string => `<div>${item.id}</div>`;

/** Plugin names, in resolved order. */
const names = (plugins: VListPlugin<TestItem>[]): string[] => plugins.map((p) => p.name);

/** Minimal fixed-size config (Mode A). */
const base = (over: Partial<VListConfig<TestItem>> = {}): VListConfig<TestItem> => ({
  item: { height: 40, template },
  items: createTestItems(10),
  ...over,
});

describe("resolvePlugins — baseline", () => {
  it("always includes selection(none), scale, scrollbar, snapshots for a plain config", () => {
    const resolved = names(resolvePlugins(base()));
    expect(resolved).toEqual(["selection", "scale", "scrollbar", "snapshots"]);
  });

  it("does not add page/autosize/data/grid/masonry/groups when not requested", () => {
    const resolved = names(resolvePlugins(base()));
    for (const absent of ["page", "autosize", "data", "grid", "masonry", "groups"]) {
      expect(resolved).not.toContain(absent);
    }
  });
});

describe("resolvePlugins — window scrolling", () => {
  it("adds page when scroll.element is window", () => {
    const resolved = names(resolvePlugins(base({ scroll: { element: window } })));
    expect(resolved[0]).toBe("page");
  });

  it("omits page for a normal container", () => {
    expect(names(resolvePlugins(base()))).not.toContain("page");
  });
});

describe("resolvePlugins — autosize (Mode B)", () => {
  it("adds autosize when only estimatedHeight is provided", () => {
    const resolved = names(resolvePlugins(base({ item: { estimatedHeight: 50, template } })));
    expect(resolved).toContain("autosize");
  });

  it("does not add autosize when an explicit height is set", () => {
    const resolved = names(
      resolvePlugins(base({ item: { height: 40, estimatedHeight: 50, template } })),
    );
    expect(resolved).not.toContain("autosize");
  });

  it("uses estimatedWidth for horizontal orientation", () => {
    const resolved = names(
      resolvePlugins(base({ orientation: "horizontal", item: { estimatedWidth: 80, template } })),
    );
    expect(resolved).toContain("autosize");
  });
});

describe("resolvePlugins — data adapter", () => {
  const adapter = { read: async () => ({ items: [] as TestItem[], total: 0 }) };

  it("adds data when an adapter is provided", () => {
    const resolved = names(resolvePlugins(base({ adapter })));
    expect(resolved).toContain("data");
  });

  it("omits data with no adapter", () => {
    expect(names(resolvePlugins(base()))).not.toContain("data");
  });
});

describe("resolvePlugins — layout", () => {
  it("adds grid for layout:grid with grid options", () => {
    const resolved = names(resolvePlugins(base({ layout: "grid", grid: { columns: 4 } })));
    expect(resolved).toContain("grid");
    expect(resolved).not.toContain("masonry");
  });

  it("adds masonry for layout:masonry with masonry options", () => {
    const resolved = names(resolvePlugins(base({ layout: "masonry", masonry: { columns: 3 } })));
    expect(resolved).toContain("masonry");
    expect(resolved).not.toContain("grid");
  });

  it("does not add grid when options are missing", () => {
    expect(names(resolvePlugins(base({ layout: "grid" })))).not.toContain("grid");
  });
});

describe("resolvePlugins — groups", () => {
  it("adds groups and resolves a function headerHeight", () => {
    const resolved = names(
      resolvePlugins(
        base({
          groups: {
            getGroupForIndex: (i) => (i < 5 ? "a" : "b"),
            headerHeight: () => 32,
            headerTemplate: (g) => `<h3>${g}</h3>`,
          },
        }),
      ),
    );
    expect(resolved).toContain("groups");
  });
});

describe("resolvePlugins — selection", () => {
  it("registers selection in a real mode when requested", () => {
    const resolved = resolvePlugins(base({ selection: { mode: "multiple" } }));
    expect(names(resolved)).toContain("selection");
  });

  it("registers selection even when unset (none mode)", () => {
    expect(names(resolvePlugins(base()))).toContain("selection");
  });
});

describe("resolvePlugins — scrollbar", () => {
  it("omits scrollbar when set to none", () => {
    expect(names(resolvePlugins(base({ scrollbar: "none" })))).not.toContain("scrollbar");
  });

  it("omits scrollbar when scroll.scrollbar is none", () => {
    expect(names(resolvePlugins(base({ scroll: { scrollbar: "none" } })))).not.toContain(
      "scrollbar",
    );
  });

  it("omits the custom scrollbar for scroll.scrollbar: native (uses the browser scrollbar)", () => {
    expect(names(resolvePlugins(base({ scroll: { scrollbar: "native" } })))).not.toContain(
      "scrollbar",
    );
  });

  it("includes scrollbar with custom options", () => {
    expect(names(resolvePlugins(base({ scrollbar: { autoHide: false } })))).toContain("scrollbar");
  });
});

describe("resolvePlugins — plugins escape hatch (#119)", () => {
  it("appends user-supplied plugins to the resolved list", () => {
    const custom: VListPlugin<TestItem> = { name: "custom-x", setup: () => {} };
    const resolved = resolvePlugins(base({ plugins: [custom] }));
    expect(names(resolved)).toContain("custom-x");
    // appended last
    expect(resolved[resolved.length - 1]!.name).toBe("custom-x");
  });

  it("resolves both convenience fields and explicit plugins together", () => {
    const custom: VListPlugin<TestItem> = { name: "custom-y", setup: () => {} };
    const resolved = names(
      resolvePlugins(base({ layout: "grid", grid: { columns: 2 }, plugins: [custom] })),
    );
    expect(resolved).toContain("grid");
    expect(resolved).toContain("custom-y");
  });

  it("a user plugin overrides (does not duplicate) an auto-wired one of the same name", () => {
    // estimatedHeight auto-wires autosize; the user also supplies autosize.
    const userAutosize: VListPlugin<TestItem> = { name: "autosize", setup: () => {} };
    const resolved = resolvePlugins(
      base({ item: { estimatedHeight: 50, template }, plugins: [userAutosize] }),
    );
    const autosizes = resolved.filter((p) => p.name === "autosize");
    expect(autosizes).toHaveLength(1);
    expect(autosizes[0]).toBe(userAutosize); // the user's instance wins
  });
});

describe("createVListFromConfig", () => {
  it("creates a working instance from a high-level config", () => {
    const container = createContainer({ width: 300, height: 500 });
    const instance = createVListFromConfig<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(20),
    });
    expect(typeof instance.destroy).toBe("function");
    expect(typeof instance.setItems).toBe("function");
    instance.destroy();
  });

  it("applies grid layout end-to-end", () => {
    const container = createContainer({ width: 400, height: 500 });
    const instance = createVListFromConfig<TestItem>({
      container,
      item: { height: 100, template },
      items: createTestItems(50),
      layout: "grid",
      grid: { columns: 4 },
    });
    expect(instance).toBeTruthy();
    instance.destroy();
  });

  it("#119: runs (does not throw Duplicate plugin) with a plugins array that overlaps auto-wiring", () => {
    // The reporter's pattern — plugins passed directly — even when the config
    // would auto-wire the same plugin (estimatedHeight → autosize).
    const container = createContainer({ width: 400, height: 500 });
    const create = () =>
      createVListFromConfig<TestItem>({
        container,
        item: { estimatedHeight: 200, template },
        items: createTestItems(50),
        plugins: [grid({ columns: 4 }), autosize()],
      });
    expect(create).not.toThrow();
    create().destroy();
  });
});
