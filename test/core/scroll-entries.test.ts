import { afterAll, beforeAll, expect, it } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createContainer, createTestItems, simpleTemplate } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import { createVList as createAlias } from "../../src/synthetic";
import { createVList as createNative } from "../../src/native";
import { createVListFromConfig } from "../../src/config";

beforeAll(setupDOM);
afterAll(teardownDOM);

it("the deprecated synthetic entry is the exact default factory", () => {
  expect(createAlias).toBe(createVList);
});

it("core owns logical position without a mode option", () => {
  const container = createContainer();
  const list = createVList({ container, items: createTestItems(100),
    item: { height: 40, template: simpleTemplate } });
  try {
    const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
    expect(viewport.style.touchAction).toBe("pan-x pinch-zoom");
    list.scrollToIndex(20);
    expect(list.getScrollPosition()).toBe(800);
    expect(viewport.scrollTop).toBe(0);
    expect(container.querySelector<HTMLElement>(".vlist-content")!.style.overflow).toBe("clip");
  } finally { list.destroy(); container.remove(); }
});

for (const [entry, create] of [["core", createVList], ["native", createNative], ["alias", createAlias]] as const) {
  for (const scroll of [{mode:"native"}, {mode:"bounded"}, {mode:"synthetic"}, {runway:2}]) {
    it(`${entry} rejects removed ${JSON.stringify(scroll)} before DOM creation`, () => {
      const container = createContainer();
      try {
        expect(() => create({ container, items: createTestItems(1),
          item: { height: 40, template: simpleTemplate }, scroll: scroll as any,
        })).toThrow(/3.0.*scroll.mode.*scroll.runway.*bounded mode is gone.*vlist/);
        expect(container.children).toHaveLength(0);
      } finally { container.remove(); }
    });
  }
}

for (const scrollbar of ["none", "native"] as const) {
  it(`scrollbar ${scrollbar} belongs only to the native entry`, () => {
    const container = createContainer();
    const config = {container, item: {height:40, template:simpleTemplate}, scroll:{scrollbar}};
    try {
      expect(() => createVList(config as any)).toThrow(/scroll.scrollbar.*vlist\/native/);
      expect(container.children).toHaveLength(0);
      expect(() => createVListFromConfig(config)).toThrow(/scroll.scrollbar.*vlist\/native/);
      const list = createNative(config);
      expect(container.querySelector(".vlist-viewport")!.classList.contains("vlist-viewport--no-scrollbar")).toBe(scrollbar === "none");
      list.destroy();
      const configured = createVListFromConfig({...config, factory:createNative});
      expect(container.querySelector(".vlist-scrollbar")).toBeNull();
      configured.destroy();
    } finally { container.remove(); }
  });
}

it("config uses an injected native factory for native scrolling", () => {
  const container = createContainer();
  const list = createVListFromConfig({ container, factory: createNative,
    items: createTestItems(100), item: { height: 40, template: simpleTemplate } });
  try {
    list.scrollToIndex(20);
    const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
    expect(viewport.style.touchAction).not.toBe("pan-x pinch-zoom");
    expect(viewport.scrollTop).toBe(800);
    expect(list.getScrollPosition()).toBe(800);
  } finally { list.destroy(); container.remove(); }
});

for (const name of ["carousel", "sortable"]) {
  it(`default core rejects ${name} before setup or DOM creation`, () => {
    const container = createContainer();
    let setups = 0;
    try {
      expect(() => createVList({ container, items: createTestItems(1),
        item: { height: 40, template: simpleTemplate },
      }, [{ name, setup() { setups++; } }])).toThrow('createVList from "vlist/native"');
      expect(setups).toBe(0);
      expect(container.children).toHaveLength(0);
    } finally { container.remove(); }
  });
}

it("default core rejects horizontal RTL before creating DOM", () => {
  const container = createContainer();
  container.style.direction = "rtl";
  try {
    expect(() => createVList({ container, orientation: "horizontal", items: createTestItems(1),
      item: { width: 40, template: simpleTemplate },
    })).toThrow('RTL horizontal lists require createVList from "vlist/native"');
    expect(container.children).toHaveLength(0);
  } finally { container.remove(); }
});

// Compile-time migration boundary: this function is deliberately never called.
function removedTypes() {
  const item = {height:40, template:simpleTemplate};
  // @ts-expect-error mode no longer exists in either entry
  createVList({container:"#list", item, scroll:{mode:"synthetic"}});
  // @ts-expect-error bounded no longer exists in the native entry
  createNative({container:"#list", item, scroll:{mode:"bounded"}});
  // @ts-expect-error runway is not a native public option
  createNative({container:"#list", item, scroll:{runway:2}});
  // @ts-expect-error native scrollbar strings are not core options
  createVList({container:"#list", item, scroll:{scrollbar:"none"}});
  // @ts-expect-error config convenience also removes mode
  createVListFromConfig({container:"#list", item, scroll:{mode:"native"}});
  // @ts-expect-error config convenience also removes runway
  createVListFromConfig({container:"#list", item, scroll:{runway:2}});
  type Exports = typeof import("../../src/index");
  // @ts-expect-error scale is no longer exported
  type RemovedScale = Exports["scale"];
  type Context = import("../../src/core/types").PluginContext;
  // @ts-expect-error use setScrollSource
  type RemovedSetter = Context["setScrollFns"];
  // @ts-expect-error use setScrollSource
  type RemovedDisable = Context["disableDefaultScroll"];
}
