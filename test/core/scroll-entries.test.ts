import { afterAll, beforeAll, expect, it } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createContainer, createTestItems, simpleTemplate } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import { createVList as createSynthetic } from "../../src/synthetic";
import { createVList as createNative } from "../../src/native";
import { createBoundedScrollHandler } from "../../src/core/runway";
import { createVListFromConfig } from "../../src/config";

beforeAll(setupDOM);
afterAll(teardownDOM);

it("the deprecated native entry is the exact default factory", () => {
  expect(createNative).toBe(createVList);
});

it("synthetic owns logical position without a mode option", () => {
  const container = createContainer();
  const list = createSynthetic({ container, items: createTestItems(100),
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

for (const [entry, create] of [["core", createVList], ["native", createNative], ["synthetic", createSynthetic]] as const) {
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
  it(`scrollbar ${scrollbar} is accepted by default and rejected by synthetic`, () => {
    const container = createContainer();
    const config = {container, item: {height:40, template:simpleTemplate}, scroll:{scrollbar}};
    try {
      expect(() => createSynthetic(config as any)).toThrow(/scroll.scrollbar.*vlist/);
      expect(container.children).toHaveLength(0);
      expect(() => createVListFromConfig({...config, factory:createSynthetic})).toThrow(/scroll.scrollbar.*vlist/);
      const list = createVList(config);
      expect(container.querySelector(".vlist-viewport")!.classList.contains("vlist-viewport--no-scrollbar")).toBe(scrollbar === "none");
      list.destroy();
      const configured = createVListFromConfig({...config, factory:createNative});
      expect(container.querySelector(".vlist-scrollbar")).toBeNull();
      configured.destroy();
    } finally { container.remove(); }
  });
}

it("config uses an injected synthetic factory for synthetic scrolling", () => {
  const container = createContainer();
  const list = createVListFromConfig({ container, factory: createSynthetic,
    items: createTestItems(100), item: { height: 40, template: simpleTemplate } });
  try {
    list.scrollToIndex(20);
    const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
    expect(viewport.style.touchAction).toBe("pan-x pinch-zoom");
    expect(viewport.scrollTop).toBe(0);
    expect(list.getScrollPosition()).toBe(800);
  } finally { list.destroy(); container.remove(); }
});

it("synthetic entry permits sortable setup", () => {
  const container = createContainer();let setups=0;
  const list=createSynthetic({container,items:createTestItems(1),item:{height:40,template:simpleTemplate}},[{name:"sortable",setup(){setups++;}}]);
  try {expect(setups).toBe(1);expect(container.children.length).toBeGreaterThan(0);}
  finally {list.destroy();container.remove();}
});

it("both entries reject horizontal RTL before creating DOM", () => {
  // Native accepted it and then stayed on the first page, which is worse than
  // refusing: nothing reported the list was not going to scroll.
  const container = createContainer();
  container.style.direction = "rtl";
  try {
    for (const factory of [createSynthetic, createVList]) {
      expect(() => factory({ container, orientation: "horizontal", items: createTestItems(1),
        item: { width: 40, template: simpleTemplate },
      })).toThrow("horizontal RTL lists are not supported");
      expect(container.children).toHaveLength(0);
    }
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
  // Native scrollbar strings are accepted by the default factory.
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

it("native creates the wrap handler supplied by the requesting plugin", () => {
  const container = createContainer();
  let created = 0;
  const list = createNative({container, items:createTestItems(100), item:{height:40,template:simpleTemplate}}, [{
    name:"wrap-owner", setup(ctx) {
      ctx.scroll.setBoundedWrap({lapSize:()=>4000,home:()=>4000,thresholdLaps:2}, config => {
        created++;
        return createBoundedScrollHandler(config);
      });
    },
  }]);
  try { expect(created).toBe(1); }
  finally { list.destroy(); container.remove(); }
});

it("native without carousel excludes the runway implementation", async () => {
  const result = await Bun.build({entrypoints:["native-gate"], target:"browser", format:"esm", minify:true,
    plugins:[{name:"entry",setup(build) {
      build.onResolve({filter:/^native-gate$/},()=>({path:"entry",namespace:"gate"}));
      build.onLoad({filter:/.*/,namespace:"gate"},()=>({loader:"ts",contents:
        `import {createVList} from "${import.meta.dir}/../../src/native.ts";globalThis.factory=createVList;`}));
    }}],
  });
  expect(result.success).toBe(true);
  expect(await result.outputs[0]!.text()).not.toContain(".thresholdLaps");
  const container=createContainer();
  const list=createNative({container,items:createTestItems(1000),item:{height:40,template:simpleTemplate}});
  try {
    expect(container.querySelector<HTMLElement>(".vlist-content")!.style.height).toBe("40000px");
    list.scrollToIndex(500);
    expect(container.querySelector<HTMLElement>(".vlist-viewport")!.scrollTop).toBe(20000);
  } finally {list.destroy();container.remove();}
});
