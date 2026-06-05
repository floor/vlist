import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createPluginMockContext } from "../../helpers/plugin-context";
import { tree } from "../../../src/plugins/tree/plugin";
import type { TreePluginConfig } from "../../../src/plugins/tree/types";
import { selection } from "../../../src/plugins/selection/plugin";
import type { SelectionPluginConfig } from "../../../src/plugins/selection/plugin";
import type { VListItem } from "../../../src/types";

interface TreeItem extends VListItem {
  id: string;
  name: string;
  children: TreeItem[];
}

function makeTree(): TreeItem[] {
  return [
    {
      id: "1", name: "src", children: [
        { id: "1.1", name: "core", children: [
          { id: "1.1.1", name: "create.ts", children: [] },
          { id: "1.1.2", name: "pipeline.ts", children: [] },
        ]},
        { id: "1.2", name: "plugins", children: [
          { id: "1.2.1", name: "tree", children: [] },
        ]},
      ],
    },
    { id: "2", name: "test", children: [
      { id: "2.1", name: "core", children: [] },
    ]},
    { id: "3", name: "README.md", children: [] },
  ];
}

beforeAll(() => { GlobalRegistrator.register(); });
afterAll(() => { GlobalRegistrator.unregister(); });

// =============================================================================
// Factory
// =============================================================================

describe("tree plugin — factory", () => {
  test("has correct name, priority, and conflicts", () => {
    const plugin = tree();
    expect(plugin.name).toBe("tree");
    expect(plugin.priority).toBe(10);
    expect(plugin.conflicts).toEqual(["groups", "grid", "masonry", "table"]);
  });
});

// =============================================================================
// Setup
// =============================================================================

describe("tree plugin — setup", () => {
  test("replaces render function", () => {
    const items = makeTree();
    const mock = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>().setup!(mock.ctx);

    expect(mock.renderFnReplaced).toBe(true);
    mock.cleanup();
  });

  test("registers tree methods", () => {
    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>().setup!(ctx);

    expect(methods.has("expand")).toBe(true);
    expect(methods.has("collapse")).toBe(true);
    expect(methods.has("toggle")).toBe(true);
    expect(methods.has("expandAll")).toBe(true);
    expect(methods.has("collapseAll")).toBe(true);
    expect(methods.has("expandTo")).toBe(true);
    expect(methods.has("getExpanded")).toBe(true);
    expect(methods.has("isExpanded")).toBe(true);
    expect(methods.has("addChild")).toBe(true);
    expect(methods.has("moveNode")).toBe(true);
    expect(methods.has("getTreeLayout")).toBe(true);
    cleanup();
  });

  test("registers layout index converters", () => {
    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>().setup!(ctx);

    const l2d = methods.get("_layoutToDataIndex") as (i: number) => number;
    const d2l = methods.get("_dataToLayoutIndex") as (i: number) => number;
    expect(l2d(5)).toBe(5);
    expect(d2l(5)).toBe(5);
    cleanup();
  });

  test("defaults to children: 'children' when no config given", () => {
    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>({ expanded: true }).setup!(ctx);

    const layout = (methods.get("getTreeLayout") as () => { totalVisible: number })();
    expect(layout.totalVisible).toBe(9);
    cleanup();
  });

  test("respects custom children accessor", () => {
    const items = [
      { id: "a", name: "root", subItems: [{ id: "b", name: "child", subItems: [] }] },
    ] as any[];
    const { ctx, methods, cleanup } = createPluginMockContext(items);
    tree({ children: (item: any) => item.subItems ?? [], expanded: true }).setup!(ctx);

    const layout = (methods.get("getTreeLayout") as () => { totalVisible: number })();
    expect(layout.totalVisible).toBe(2);
    cleanup();
  });

  test("supports initial expanded as ID array", () => {
    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>({ expanded: ["1"] }).setup!(ctx);

    const isExpanded = methods.get("isExpanded") as (id: string) => boolean;
    expect(isExpanded("1")).toBe(true);
    expect(isExpanded("2")).toBe(false);
    cleanup();
  });

  test("supports initial expanded as predicate", () => {
    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>({ expanded: (item: TreeItem) => item.name === "src" }).setup!(ctx);

    const isExpanded = methods.get("isExpanded") as (id: string) => boolean;
    expect(isExpanded("1")).toBe(true);
    expect(isExpanded("2")).toBe(false);
    cleanup();
  });
});

// =============================================================================
// Expand / Collapse methods
// =============================================================================

describe("tree plugin — expand/collapse", () => {
  test("expand method makes children visible", () => {
    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>().setup!(ctx);

    const expand = methods.get("expand") as (id: string) => void;
    expand("1");

    const layout = (methods.get("getTreeLayout") as () => { totalVisible: number })();
    expect(layout.totalVisible).toBe(5);
    cleanup();
  });

  test("collapse method hides subtree", () => {
    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>({ expanded: ["1", "1.1"] }).setup!(ctx);

    const collapse = methods.get("collapse") as (id: string) => void;
    collapse("1");

    const layout = (methods.get("getTreeLayout") as () => { totalVisible: number })();
    expect(layout.totalVisible).toBe(3);
    cleanup();
  });

  test("toggle method toggles expand state", () => {
    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>().setup!(ctx);

    const toggle = methods.get("toggle") as (id: string) => void;
    const isExpanded = methods.get("isExpanded") as (id: string) => boolean;

    toggle("1");
    expect(isExpanded("1")).toBe(true);

    toggle("1");
    expect(isExpanded("1")).toBe(false);
    cleanup();
  });

  test("expandAll expands every node", () => {
    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>().setup!(ctx);

    const expandAll = methods.get("expandAll") as () => void;
    expandAll();

    const layout = (methods.get("getTreeLayout") as () => { totalVisible: number })();
    expect(layout.totalVisible).toBe(9);
    cleanup();
  });

  test("collapseAll collapses every node", () => {
    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>({ expanded: true }).setup!(ctx);

    const collapseAll = methods.get("collapseAll") as () => void;
    collapseAll();

    const layout = (methods.get("getTreeLayout") as () => { totalVisible: number })();
    expect(layout.totalVisible).toBe(3);
    cleanup();
  });

  test("getExpanded returns expanded IDs", () => {
    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>({ expanded: ["1", "1.1"] }).setup!(ctx);

    const getExpanded = methods.get("getExpanded") as () => (string | number)[];
    const expanded = getExpanded();
    expect(expanded).toContain("1");
    expect(expanded).toContain("1.1");
    expect(expanded.length).toBe(2);
    cleanup();
  });

  test("expandTo expands ancestors and makes target visible", () => {
    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>().setup!(ctx);

    const expandTo = methods.get("expandTo") as (id: string) => void;
    expandTo("1.1.2");

    const isExpanded = methods.get("isExpanded") as (id: string) => boolean;
    expect(isExpanded("1")).toBe(true);
    expect(isExpanded("1.1")).toBe(true);
    cleanup();
  });
});

// =============================================================================
// Rendering & ARIA
// =============================================================================

describe("tree plugin — rendering", () => {
  test("renders items with role=treeitem after first render", () => {
    const items = makeTree();
    const { ctx, dom, engineState, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 300,
      itemSize: 32,
    });
    tree<TreeItem>({ expanded: ["1"] }).setup!(ctx);

    engineState.containerSize = 300;
    ctx.forceRender();

    const treeItems = dom.content.querySelectorAll("[role='treeitem']");
    expect(treeItems.length).toBeGreaterThan(0);
    cleanup();
  });

  test("sets role=tree on content element after render", () => {
    const items = makeTree();
    const { ctx, dom, engineState, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 300,
      itemSize: 32,
    });
    tree<TreeItem>().setup!(ctx);

    engineState.containerSize = 300;
    ctx.forceRender();

    expect(dom.content.getAttribute("role")).toBe("tree");
    cleanup();
  });

  test("sets aria-level on tree items", () => {
    const items = makeTree();
    const { ctx, dom, engineState, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });
    tree<TreeItem>({ expanded: ["1"] }).setup!(ctx);

    engineState.containerSize = 400;
    ctx.forceRender();

    const treeItems = Array.from(dom.content.querySelectorAll("[role='treeitem']"));
    const levels = treeItems.map((el) => el.getAttribute("aria-level"));
    expect(levels).toContain("1");
    expect(levels).toContain("2");
    cleanup();
  });

  test("sets aria-expanded on nodes with children", () => {
    const items = makeTree();
    const { ctx, dom, engineState, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });
    tree<TreeItem>({ expanded: ["1"] }).setup!(ctx);

    engineState.containerSize = 400;
    ctx.forceRender();

    const srcEl = dom.content.querySelector("[data-id='1']") as HTMLElement;
    expect(srcEl.getAttribute("aria-expanded")).toBe("true");

    const coreEl = dom.content.querySelector("[data-id='1.1']") as HTMLElement;
    expect(coreEl.getAttribute("aria-expanded")).toBe("false");
    cleanup();
  });

  test("leaves do not have aria-expanded", () => {
    const items = makeTree();
    const { ctx, dom, engineState, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });
    tree<TreeItem>().setup!(ctx);

    engineState.containerSize = 400;
    ctx.forceRender();

    const readmeEl = dom.content.querySelector("[data-id='3']") as HTMLElement;
    expect(readmeEl.hasAttribute("aria-expanded")).toBe(false);
    cleanup();
  });

  test("sets aria-setsize and aria-posinset correctly", () => {
    const items = makeTree();
    const { ctx, dom, engineState, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });
    tree<TreeItem>({ expanded: ["1"] }).setup!(ctx);

    engineState.containerSize = 400;
    ctx.forceRender();

    const srcEl = dom.content.querySelector("[data-id='1']") as HTMLElement;
    expect(srcEl.getAttribute("aria-setsize")).toBe("3");
    expect(srcEl.getAttribute("aria-posinset")).toBe("1");

    const coreEl = dom.content.querySelector("[data-id='1.1']") as HTMLElement;
    expect(coreEl.getAttribute("aria-setsize")).toBe("2");
    expect(coreEl.getAttribute("aria-posinset")).toBe("1");
    cleanup();
  });

  test("applies indent via paddingLeft", () => {
    const items = makeTree();
    const { ctx, dom, engineState, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });
    tree<TreeItem>({ expanded: ["1"], indent: 20 }).setup!(ctx);

    engineState.containerSize = 400;
    ctx.forceRender();

    const srcEl = dom.content.querySelector("[data-id='1']") as HTMLElement;
    expect(srcEl.style.paddingLeft).toBe("0px");

    const coreEl = dom.content.querySelector("[data-id='1.1']") as HTMLElement;
    expect(coreEl.style.paddingLeft).toBe("20px");
    cleanup();
  });

  test("adds tree CSS classes on root and items", () => {
    const items = makeTree();
    const { ctx, dom, engineState, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });
    tree<TreeItem>({ expanded: ["1"] }).setup!(ctx);

    engineState.containerSize = 400;
    ctx.forceRender();

    expect(dom.root.classList.contains("vlist--tree")).toBe(true);

    const srcEl = dom.content.querySelector("[data-id='1']") as HTMLElement;
    expect(srcEl.classList.contains("vlist-tree-node")).toBe(true);
    expect(srcEl.classList.contains("vlist-tree-node--expanded")).toBe(true);

    const readmeEl = dom.content.querySelector("[data-id='3']") as HTMLElement;
    expect(readmeEl.classList.contains("vlist-tree-node--leaf")).toBe(true);
    cleanup();
  });
});

// =============================================================================
// Keyboard
// =============================================================================

describe("tree plugin — keyboard", () => {
  function setupWithKeyboard(expandedIds: string[] = []) {
    const items = makeTree();
    const testCtx = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });
    tree<TreeItem>({ expanded: expandedIds }).setup!(testCtx.ctx);
    testCtx.engineState.containerSize = 400;
    testCtx.ctx.forceRender();
    return testCtx;
  }

  function fireKey(handler: (e: KeyboardEvent) => void, key: string): void {
    const event = new KeyboardEvent("keydown", { key, bubbles: true });
    handler(event);
  }

  test("ArrowRight on collapsed node expands it", () => {
    const { keydownHandlers, methods, cleanup } = setupWithKeyboard();

    // Simulate focus on first item (need internal focus tracking)
    // Tree's internal focus starts at -1, so first we need to focus
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");

    const isExpanded = methods.get("isExpanded") as (id: string) => boolean;
    fireKey(handler, "ArrowRight");
    expect(isExpanded("1")).toBe(true);
    cleanup();
  });

  test("ArrowLeft on expanded node collapses it", () => {
    const { keydownHandlers, methods, cleanup } = setupWithKeyboard(["1"]);

    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");

    const isExpanded = methods.get("isExpanded") as (id: string) => boolean;
    expect(isExpanded("1")).toBe(true);

    fireKey(handler, "ArrowLeft");
    expect(isExpanded("1")).toBe(false);
    cleanup();
  });
});

// =============================================================================
// Mutations via plugin methods
// =============================================================================

describe("tree plugin — mutations", () => {
  test("addChild adds a child node", () => {
    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>({ expanded: ["1"] }).setup!(ctx);

    const addChild = methods.get("addChild") as (parentId: string, item: TreeItem) => void;
    addChild("1", { id: "1.3", name: "utils", children: [] });

    const layout = (methods.get("getTreeLayout") as () => { totalVisible: number; flatNodes: { id: string }[] })();
    expect(layout.flatNodes.some((n) => n.id === "1.3")).toBe(true);
    cleanup();
  });

  test("moveNode reparents a node", () => {
    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>({ expanded: ["1", "2"] }).setup!(ctx);

    const moveNode = methods.get("moveNode") as (id: string, newParentId: string) => void;
    moveNode("1.2", "2");

    const layout = (methods.get("getTreeLayout") as () => { flatNodes: { id: string; parentId: string | null }[] })();
    const movedNode = layout.flatNodes.find((n) => n.id === "1.2");
    expect(movedNode?.parentId).toBe("2");
    cleanup();
  });
});

// =============================================================================
// Core integration: removeItem returns -1 for missing IDs
// =============================================================================

describe("tree plugin — removeItem return value", () => {
  test("returns -1 when node not found", () => {
    const items = makeTree();
    const { ctx, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>().setup!(ctx);

    const result = ctx.removeItemById("nonexistent");
    expect(result).toBe(-1);
    cleanup();
  });

  test("returns positive count when node found", () => {
    const items = makeTree();
    const { ctx, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>({ expanded: true }).setup!(ctx);

    const result = ctx.removeItemById("3");
    expect(result).toBeGreaterThan(0);
    cleanup();
  });
});

// =============================================================================
// Core integration: appendItems triggers tree rebuild
// =============================================================================

describe("tree plugin — appendItems detection", () => {
  test("detects in-place array mutation via length change", () => {
    const items = makeTree();
    const { ctx, methods, engineState, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });
    tree<TreeItem>().setup!(ctx);
    engineState.containerSize = 400;
    ctx.forceRender();

    const layoutBefore = (methods.get("getTreeLayout") as () => { totalVisible: number })();
    const countBefore = layoutBefore.totalVisible;

    items.push({ id: "new-root", name: "new", children: [] } as TreeItem);
    ctx.forceRender();

    const layoutAfter = (methods.get("getTreeLayout") as () => { totalVisible: number })();
    expect(layoutAfter.totalVisible).toBe(countBefore + 1);
    cleanup();
  });
});

// =============================================================================
// parentId mode
// =============================================================================

describe("tree plugin — parentId mode", () => {
  test("builds tree from flat items with parentId", () => {
    const items = [
      { id: "1", name: "root", parentId: null },
      { id: "2", name: "child-a", parentId: "1" },
      { id: "3", name: "child-b", parentId: "1" },
      { id: "4", name: "grandchild", parentId: "2" },
    ] as any[];

    const { ctx, methods, cleanup } = createPluginMockContext(items);
    tree({ parentId: "parentId", expanded: true }).setup!(ctx);

    const layout = (methods.get("getTreeLayout") as () => { totalVisible: number })();
    expect(layout.totalVisible).toBe(4);
    cleanup();
  });

  test("moveNode updates parentId property so re-sync preserves the move", () => {
    const items = [
      { id: "1", name: "root-a", parentId: null },
      { id: "2", name: "child", parentId: "1" },
      { id: "3", name: "root-b", parentId: null },
    ] as any[];

    const { ctx, methods, cleanup } = createPluginMockContext(items);
    tree({ parentId: "parentId", expanded: true }).setup!(ctx);

    const moveNode = methods.get("moveNode") as (id: string, newParentId: string) => void;
    moveNode("2", "3");

    const moved = items.find((i: any) => i.id === "2");
    expect(moved.parentId).toBe("3");

    cleanup();
  });

  test("addChild sets parentId property on new item", () => {
    const items = [
      { id: "1", name: "root", parentId: null },
    ] as any[];

    const { ctx, methods, cleanup } = createPluginMockContext(items);
    tree({ parentId: "parentId", expanded: true }).setup!(ctx);

    const addChild = methods.get("addChild") as (parentId: string, item: any) => void;
    const newItem = { id: "2", name: "child" } as any;
    addChild("1", newItem);

    expect(newItem.parentId).toBe("1");
    cleanup();
  });

  test("removeItem in parentId mode removes from raw items array", () => {
    const items = [
      { id: "1", name: "root", parentId: null },
      { id: "2", name: "child", parentId: "1" },
      { id: "3", name: "leaf", parentId: null },
    ] as any[];

    const { ctx, cleanup } = createPluginMockContext(items);
    tree({ parentId: "parentId", expanded: true }).setup!(ctx);

    ctx.removeItemById("2");
    expect(items.find((i: any) => i.id === "2")).toBeUndefined();
    cleanup();
  });

  test("parentId function returning undefined treats nodes as roots", () => {
    const items = [
      { id: "1", name: "root", pid: undefined },
      { id: "2", name: "child", pid: "1" },
    ] as any[];

    const { ctx, methods, cleanup } = createPluginMockContext(items);
    tree({ parentId: (item: any) => item.pid, expanded: true }).setup!(ctx);

    const layout = (methods.get("getTreeLayout") as () => { totalVisible: number })();
    expect(layout.totalVisible).toBe(2);
    cleanup();
  });
});

// =============================================================================
// Focus adjustment on collapse
// =============================================================================

describe("tree plugin — focus adjustment on collapse", () => {
  test("focus moves to collapsed node when focused item was in subtree", () => {
    const items = makeTree();
    const { ctx, dom, engineState, keydownHandlers, methods, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });
    tree<TreeItem>({ expanded: ["1", "1.1"] }).setup!(ctx);
    engineState.containerSize = 400;
    ctx.forceRender();

    const handler = keydownHandlers[0]!;
    const fireKey = (key: string) => handler(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

    fireKey("Home");
    fireKey("ArrowDown");
    fireKey("ArrowDown");
    fireKey("ArrowDown");

    const desc = dom.content.getAttribute("aria-activedescendant");
    const focusedEl = desc ? dom.content.querySelector(`#${desc}`) as HTMLElement : null;
    expect(focusedEl?.getAttribute("data-id")).toBe("1.1.2");

    const collapse = methods.get("collapse") as (id: string) => void;
    collapse("1.1");

    const descAfter = dom.content.getAttribute("aria-activedescendant");
    const focusedAfter = descAfter ? dom.content.querySelector(`#${descAfter}`) as HTMLElement : null;
    expect(focusedAfter?.getAttribute("data-id")).toBe("1.1");

    cleanup();
  });

  test("focus shifts back when collapsed subtree was before focused item", () => {
    const items = makeTree();
    const { ctx, dom, engineState, keydownHandlers, methods, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });
    tree<TreeItem>({ expanded: ["1", "1.1"] }).setup!(ctx);
    engineState.containerSize = 400;
    ctx.forceRender();

    const handler = keydownHandlers[0]!;
    const fireKey = (key: string) => handler(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

    fireKey("Home");
    fireKey("End");

    const collapse = methods.get("collapse") as (id: string) => void;
    collapse("1.1");

    const descAfter = dom.content.getAttribute("aria-activedescendant");
    const focusedAfter = descAfter ? dom.content.querySelector(`#${descAfter}`) as HTMLElement : null;
    expect(focusedAfter?.getAttribute("data-id")).toBe("3");

    cleanup();
  });
});

// =============================================================================
// tree + selection — click handler interaction
// =============================================================================

describe("tree + selection — click handler", () => {
  function setup(
    items: TreeItem[],
    treeOpts: TreePluginConfig<TreeItem> = {},
    selOpts: SelectionPluginConfig = { mode: "single" },
  ) {
    const mock = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });

    tree<TreeItem>(treeOpts).setup!(mock.ctx);
    selection<TreeItem>(selOpts).setup!(mock.ctx);

    mock.engineState.containerSize = 400;
    mock.ctx.forceRender();

    function clickItem(id: string): void {
      const el = mock.dom.content.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
      if (!el) throw new Error(`[data-id="${id}"] not found`);
      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: el });
      for (const handler of mock.clickHandlers) handler(event);
    }

    const getSelected = mock.methods.get("getSelected") as () => (string | number)[];
    const selectedEls = () =>
      Array.from(mock.dom.content.querySelectorAll(".vlist-item--selected"))
        .map((el) => el.getAttribute("data-id"));
    const focusedEls = () =>
      Array.from(mock.dom.content.querySelectorAll(".vlist-item--focused"))
        .map((el) => el.getAttribute("data-id"));

    return { mock, clickItem, getSelected, selectedEls, focusedEls };
  }

  test("click selects item at correct flat index, not root-array index", () => {
    // With expanded: ["1","1.1"], flat layout is:
    //   0:"1", 1:"1.1", 2:"1.1.1", 3:"1.1.2", 4:"1.2", 5:"2", 6:"2.1", 7:"3"
    // Root array is: [0:"1", 1:"2", 2:"3"]
    // Clicking "1.1.2" (flat idx 3) must select "1.1.2", not root[3] (undefined).
    // Clicking "2" (flat idx 5) must select "2", not root[5] (undefined).
    const { mock, clickItem, getSelected, selectedEls } = setup(
      makeTree(), { expanded: ["1", "1.1"] },
    );

    clickItem("1.1.2");
    expect(getSelected()).toEqual(["1.1.2"]);
    expect(selectedEls()).toContain("1.1.2");

    clickItem("2");
    expect(getSelected()).toEqual(["2"]);
    expect(selectedEls()).toContain("2");

    mock.cleanup();
  });

  test("click on deep nested node selects it, not its root-index alias", () => {
    const { mock, clickItem, getSelected, selectedEls } = setup(
      makeTree(), { expanded: ["1", "1.1"] },
    );

    // "1.1.1" is at flat index 2, root[2] is "3" (README)
    clickItem("1.1.1");
    expect(getSelected()).toEqual(["1.1.1"]);
    expect(selectedEls()).toContain("1.1.1");

    mock.cleanup();
  });

  test("clicking same node twice in single mode keeps it selected", () => {
    const items: TreeItem[] = [
      { id: "a", name: "a", children: [] },
      { id: "b", name: "b", children: [] },
    ];

    const { mock, clickItem, getSelected } = setup(items);

    clickItem("a");
    expect(getSelected()).toEqual(["a"]);

    clickItem("a");
    expect(getSelected()).toEqual(["a"]);

    mock.cleanup();
  });

  test("expandOnClick folder toggles keep it selected every click", () => {
    const items: TreeItem[] = [
      { id: "a", name: "folder", children: [
        { id: "b", name: "child", children: [] },
      ]},
      { id: "c", name: "file", children: [] },
    ];

    const { mock, clickItem, getSelected, selectedEls } = setup(
      items, { expandOnClick: true },
    );

    for (let i = 0; i < 4; i++) {
      clickItem("a");
      expect(getSelected()).toContain("a");
      expect(selectedEls()).toContain("a");
    }

    mock.cleanup();
  });

  test("collapsing pre-expanded folder applies focused CSS class", () => {
    const items: TreeItem[] = [
      { id: "a", name: "folder", children: [
        { id: "b", name: "child", children: [] },
      ]},
      { id: "c", name: "file", children: [] },
    ];

    const { mock, clickItem, selectedEls, focusedEls } = setup(
      items,
      { expandOnClick: true, expanded: ["a"] },
      { mode: "single", followFocus: true, focusOnClick: true },
    );

    clickItem("a");
    expect(selectedEls()).toContain("a");
    expect(focusedEls()).toContain("a");

    mock.cleanup();
  });

  test("alternating clicks between folder and leaf always select clicked item", () => {
    const items: TreeItem[] = [
      { id: "a", name: "folder", children: [
        { id: "b", name: "child", children: [] },
      ]},
      { id: "c", name: "file", children: [] },
    ];

    const { mock, clickItem, getSelected } = setup(
      items, { expandOnClick: true },
    );

    // Click "a" first to expand it, making "b" visible
    clickItem("a");
    expect(getSelected()).toEqual(["a"]);

    clickItem("c");
    expect(getSelected()).toEqual(["c"]);

    clickItem("b");
    expect(getSelected()).toEqual(["b"]);

    clickItem("a");
    expect(getSelected()).toEqual(["a"]);

    mock.cleanup();
  });

  test("registers _getLoadedItem method", () => {
    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items);
    tree<TreeItem>({ expanded: ["1"] }).setup!(ctx);

    expect(methods.has("_getLoadedItem")).toBe(true);

    const getItem = methods.get("_getLoadedItem") as (i: number) => TreeItem | undefined;
    expect(getItem(0)?.id).toBe("1");
    expect(getItem(1)?.id).toBe("1.1");
    expect(getItem(2)?.id).toBe("1.2");
    expect(getItem(3)?.id).toBe("2");
    expect(getItem(4)?.id).toBe("3");

    cleanup();
  });
});
