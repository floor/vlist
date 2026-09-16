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
import { createVList as createSynthetic } from "../../src/synthetic";
import { createVList as createCore } from "../../src/core/create";
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
  it("resolves a plain config to no plugins at all", () => {
    // A config that asked for nothing gets nothing, so an adapter list behaves
    // like the same options handed straight to createVList.
    expect(names(resolvePlugins(base()))).toEqual([]);
  });

  it("leaves a plain adapter list display-only, out of the tab order", () => {
    const container = createContainer({ width: 300, height: 500 });
    const list = createVListFromConfig<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(10),
    });
    try {
      const content = container.querySelector<HTMLElement>(".vlist-content")!;
      expect(content.getAttribute("role")).toBe("list");
      expect(content.hasAttribute("tabindex")).toBe(false);
    } finally {
      list.destroy();
      container.remove();
    }
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

  it("throws for layout:grid with no grid options", () => {
    expect(() => resolvePlugins(base({ layout: "grid" }))).toThrow(
      'layout: "grid" requires a `grid` option',
    );
  });

  it("throws for layout:masonry with no masonry options", () => {
    expect(() => resolvePlugins(base({ layout: "masonry" }))).toThrow(
      'layout: "masonry" requires a `masonry` option',
    );
  });
});

describe("resolvePlugins — groups", () => {
  it("adds groups from the deprecated header fields", () => {
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

  it("accepts the documented header shape, which used to be dropped", () => {
    // Rebuilding the config field by field left `header` behind, so the plugin
    // saw no height and no template and threw "header.template is required".
    const resolved = names(
      resolvePlugins(
        base({
          groups: {
            getGroupForIndex: (i) => (i < 5 ? "a" : "b"),
            header: { height: 60, template: (g) => `<h3>${g}</h3>` },
          },
        }),
      ),
    );
    expect(resolved).toContain("groups");
  });

  it("asks a function header height for each group, not once for the first", () => {
    // The resolver called it once with ("", 0) and passed the plugin that one
    // number, so a 20/60 pair of groups rendered every header at 20.
    const container = createContainer({ width: 300, height: 500 });
    const asked: string[] = [];
    const list = createVListFromConfig<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(10),
      groups: {
        getGroupForIndex: (i) => (i < 5 ? "a" : "b"),
        header: {
          height: (group) => {
            asked.push(group);
            return group === "a" ? 20 : 60;
          },
          template: (g) => `<h3>${g}</h3>`,
        },
      },
    });
    try {
      expect(asked).toContain("a");
      expect(asked).toContain("b");
    } finally {
      list.destroy();
      container.remove();
    }
  });
});

describe("resolvePlugins — selection", () => {
  it("registers selection in a real mode when requested", () => {
    const resolved = resolvePlugins(base({ selection: { mode: "multiple" } }));
    expect(names(resolved)).toContain("selection");
  });

  it("registers nothing when selection is unset", () => {
    expect(names(resolvePlugins(base()))).not.toContain("selection");
  });

  it("passes an explicit none mode through without claiming the listbox role", () => {
    const container = createContainer({ width: 300, height: 500 });
    const list = createVListFromConfig<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(10),
      selection: { mode: "none" },
    });
    try {
      const content = container.querySelector<HTMLElement>(".vlist-content")!;
      expect(content.getAttribute("role")).toBe("list");
      expect(content.hasAttribute("tabindex")).toBe(false);
    } finally {
      list.destroy();
      container.remove();
    }
  });
});

describe("resolvePlugins — a11y", () => {
  it("adds a11y for a11y: true and for an options object", () => {
    expect(names(resolvePlugins(base({ a11y: true })))).toContain("a11y");
    expect(names(resolvePlugins(base({ a11y: { keyboard: false } })))).toContain("a11y");
  });

  it("omits a11y when unset or false", () => {
    expect(names(resolvePlugins(base()))).not.toContain("a11y");
    expect(names(resolvePlugins(base({ a11y: false })))).not.toContain("a11y");
  });

  it("gives an a11y list the listbox role and a tab stop", () => {
    const container = createContainer({ width: 300, height: 500 });
    const list = createVListFromConfig<TestItem>({
      container,
      item: { height: 40, template },
      items: createTestItems(10),
      a11y: true,
    });
    try {
      const content = container.querySelector<HTMLElement>(".vlist-content")!;
      expect(content.getAttribute("role")).toBe("listbox");
      expect(content.getAttribute("tabindex")).toBe("0");
    } finally {
      list.destroy();
      container.remove();
    }
  });
});

describe("resolvePlugins — snapshots", () => {
  it("adds snapshots only when asked", () => {
    expect(names(resolvePlugins(base()))).not.toContain("snapshots");
    expect(names(resolvePlugins(base({ snapshots: true })))).toContain("snapshots");
  });
});

describe("resolvePlugins — scrollbar", () => {
  it("omits the custom scrollbar by default, leaving the browser's own", () => {
    expect(names(resolvePlugins(base()))).not.toContain("scrollbar");
  });

  it("includes scrollbar for scrollbar: true", () => {
    expect(names(resolvePlugins(base({ scrollbar: true })))).toContain("scrollbar");
  });

  it("includes scrollbar for scroll.scrollbar options", () => {
    expect(names(resolvePlugins(base({ scroll: { scrollbar: { autoHide: false } } })))).toContain(
      "scrollbar",
    );
  });

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
    // would auto-wire the same plugin (estimatedHeight → autosize). The report
    // paired it with grid(), which 3.0 now rejects outright; the case below
    // covers that, and this keeps the duplicate-name regression it was filed for.
    const container = createContainer({ width: 400, height: 500 });
    const create = () =>
      createVListFromConfig<TestItem>({
        container,
        item: { estimatedHeight: 200, template },
        items: createTestItems(50),
        plugins: [autosize()],
      });
    expect(create).not.toThrow();
    create().destroy();
  });

  it("rejects grid with autosize, whichever way the two arrive", () => {
    // grid indexes its size cache by row while autosize measures items, so row
    // n took item n's measurement: twenty items in two columns with two cells
    // at 200px came to 800px where 650px is right.
    const container = createContainer({ width: 400, height: 500 });
    try {
      expect(() =>
        createVListFromConfig<TestItem>({
          container,
          item: { estimatedHeight: 200, template },
          items: createTestItems(50),
          plugins: [grid({ columns: 4 }), autosize()],
        }),
      ).toThrow('conflicts with "autosize"');

      // Through the convenience fields the error names those fields instead:
      // this layer wires both plugins, and the caller never wrote "autosize".
      expect(() =>
        createVListFromConfig<TestItem>({
          container,
          item: { estimatedHeight: 200, template },
          items: createTestItems(50),
          layout: "grid",
          grid: { columns: 4 },
        }),
      ).toThrow('layout: "grid" needs a fixed item size');

      expect(container.children.length).toBe(0);
    } finally {
      container.remove();
    }
  });
});

it("factory receives resolved plugins and a copy of frozen config without factory", () => {
  const host = createContainer();
  let received: any;
  let receivedPlugins: VListPlugin<TestItem>[] = [];
  const factory = (config: any, plugins: VListPlugin<TestItem>[] = []) => {
    received = config;
    receivedPlugins = plugins;
    return createCore(config, plugins);
  };
  const custom: VListPlugin<TestItem> = { name: "custom" };
  const config = Object.freeze({ ...base(), container: host, factory, plugins: [custom] });
  const list = createVListFromConfig(config);
  try {
    expect(received).toBeDefined();
    expect(received).not.toHaveProperty("factory");
    expect(received).not.toBe(config);
    expect(received.item).toBe(config.item);
    expect(receivedPlugins.map(plugin => plugin.name)).toEqual(["custom"]);
    expect(receivedPlugins[receivedPlugins.length - 1]).toBe(custom);
    expect(config.factory).toBe(factory);
    expect(Object.isFrozen(config)).toBe(true);
  } finally { list.destroy(); host.remove(); }
});

it("config factory selects the synthetic driver with the public config type", () => {
  const host = createContainer();
  const config: VListConfig<TestItem> = {
    ...base(), factory: createSynthetic,
  };
  const list = createVListFromConfig({ ...config, container: host });
  try {
    const viewport = host.querySelector<HTMLElement>(".vlist-viewport")!;
    expect(viewport.style.touchAction).toBe("pan-x pinch-zoom");
    expect(viewport.firstElementChild?.getAttribute("style")).toContain("clip");
  } finally { list.destroy(); host.remove(); }
});

it("config defaults to native input without an injected factory", () => {
  const host = createContainer();
  const list = createVListFromConfig({ ...base(), container: host });
  try {
    expect(host.querySelector<HTMLElement>(".vlist-viewport")!.style.touchAction).not.toBe("pan-x pinch-zoom");
  } finally { list.destroy(); host.remove(); }
});

it("config permits sortable with the synthetic factory", () => {
  const host=createContainer();
  const list=createVListFromConfig({...base(),container:host,factory:createSynthetic,plugins:[{name:"sortable"}]});
  try {expect(host.querySelector(".vlist-viewport")).not.toBeNull();}
  finally {list.destroy();host.remove();}
});

it("config preserves the horizontal RTL guard", () => {
  const host = createContainer();
  host.style.direction = "rtl";
  try {
    expect(() => createVListFromConfig({ ...base(), container: host, factory: createSynthetic,
      orientation: "horizontal", item: { width: 40, template },
    })).toThrow("horizontal RTL lists are not supported");
    expect(host.children.length).toBe(0);
  } finally { host.remove(); }
});
