import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createTreeLayout } from "../../../src/plugins/tree/layout";
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

const getChildren = (item: TreeItem): TreeItem[] => item.children;

beforeAll(() => { GlobalRegistrator.register(); });
afterAll(() => { GlobalRegistrator.unregister(); });

// =============================================================================
// Rebuild
// =============================================================================

describe("createTreeLayout — rebuild", () => {
  test("flattens all collapsed tree to root items only", () => {
    const layout = createTreeLayout(getChildren, new Set());
    layout.rebuild(makeTree());

    expect(layout.totalVisible).toBe(3);
    expect(layout.flatNodes.map((n) => n.id)).toEqual(["1", "2", "3"]);
  });

  test("flattens with some nodes expanded", () => {
    const layout = createTreeLayout(getChildren, new Set(["1"]));
    layout.rebuild(makeTree());

    expect(layout.totalVisible).toBe(5);
    expect(layout.flatNodes.map((n) => n.id)).toEqual(["1", "1.1", "1.2", "2", "3"]);
  });

  test("deeply expanded nodes show full subtree", () => {
    const layout = createTreeLayout(getChildren, new Set(["1", "1.1"]));
    layout.rebuild(makeTree());

    expect(layout.totalVisible).toBe(7);
    expect(layout.flatNodes.map((n) => n.id)).toEqual([
      "1", "1.1", "1.1.1", "1.1.2", "1.2", "2", "3",
    ]);
  });

  test("sets correct depth on each node", () => {
    const layout = createTreeLayout(getChildren, new Set(["1", "1.1"]));
    layout.rebuild(makeTree());

    expect(layout.flatNodes.map((n) => n.depth)).toEqual([0, 1, 2, 2, 1, 0, 0]);
  });

  test("sets correct parentId on each node", () => {
    const layout = createTreeLayout(getChildren, new Set(["1", "1.1"]));
    layout.rebuild(makeTree());

    expect(layout.flatNodes.map((n) => n.parentId)).toEqual([
      null, "1", "1.1", "1.1", "1", null, null,
    ]);
  });

  test("sets hasChildren and childCount correctly", () => {
    const layout = createTreeLayout(getChildren, new Set(["1"]));
    layout.rebuild(makeTree());

    const src = layout.flatNodes[0]!;
    expect(src.hasChildren).toBe(true);
    expect(src.childCount).toBe(2);

    const readme = layout.flatNodes[4]!;
    expect(readme.hasChildren).toBe(false);
    expect(readme.childCount).toBe(0);
  });

  test("sets siblingCount and positionInSiblings correctly", () => {
    const layout = createTreeLayout(getChildren, new Set(["1"]));
    layout.rebuild(makeTree());

    expect(layout.flatNodes[0]!.siblingCount).toBe(3);
    expect(layout.flatNodes[0]!.positionInSiblings).toBe(0);

    expect(layout.flatNodes[1]!.siblingCount).toBe(2);
    expect(layout.flatNodes[1]!.positionInSiblings).toBe(0);

    expect(layout.flatNodes[2]!.siblingCount).toBe(2);
    expect(layout.flatNodes[2]!.positionInSiblings).toBe(1);
  });

  test("builds correct idToIndex map", () => {
    const layout = createTreeLayout(getChildren, new Set(["1"]));
    layout.rebuild(makeTree());

    expect(layout.idToIndex.get("1")).toBe(0);
    expect(layout.idToIndex.get("1.1")).toBe(1);
    expect(layout.idToIndex.get("1.2")).toBe(2);
    expect(layout.idToIndex.get("2")).toBe(3);
    expect(layout.idToIndex.get("3")).toBe(4);
  });
});

// =============================================================================
// Expand / Collapse
// =============================================================================

describe("createTreeLayout — expand/collapse", () => {
  test("expand inserts children into flatNodes", () => {
    const layout = createTreeLayout(getChildren, new Set());
    layout.rebuild(makeTree());
    expect(layout.totalVisible).toBe(3);

    const inserted = layout.expand("1");
    expect(inserted).toBe(2);
    expect(layout.totalVisible).toBe(5);
    expect(layout.flatNodes.map((n) => n.id)).toEqual(["1", "1.1", "1.2", "2", "3"]);
  });

  test("collapse removes subtree from flatNodes", () => {
    const layout = createTreeLayout(getChildren, new Set(["1", "1.1"]));
    layout.rebuild(makeTree());
    expect(layout.totalVisible).toBe(7);

    const removed = layout.collapse("1");
    expect(removed).toBe(4);
    expect(layout.totalVisible).toBe(3);
    expect(layout.flatNodes.map((n) => n.id)).toEqual(["1", "2", "3"]);
  });

  test("collapse preserves expand state of descendants", () => {
    const layout = createTreeLayout(getChildren, new Set(["1", "1.1"]));
    layout.rebuild(makeTree());

    layout.collapse("1");
    expect(layout.expandedIds.has("1.1")).toBe(true);

    layout.expand("1");
    expect(layout.flatNodes.map((n) => n.id)).toEqual([
      "1", "1.1", "1.1.1", "1.1.2", "1.2", "2", "3",
    ]);
  });

  test("expand returns 0 for leaf nodes", () => {
    const layout = createTreeLayout(getChildren, new Set());
    layout.rebuild(makeTree());

    expect(layout.expand("3")).toBe(0);
  });

  test("expand returns 0 for already-expanded nodes", () => {
    const layout = createTreeLayout(getChildren, new Set(["1"]));
    layout.rebuild(makeTree());

    expect(layout.expand("1")).toBe(0);
  });

  test("collapse returns 0 for already-collapsed nodes", () => {
    const layout = createTreeLayout(getChildren, new Set());
    layout.rebuild(makeTree());

    expect(layout.collapse("1")).toBe(0);
  });

  test("updates idToIndex after expand", () => {
    const layout = createTreeLayout(getChildren, new Set());
    layout.rebuild(makeTree());

    layout.expand("1");
    expect(layout.idToIndex.get("1.1")).toBe(1);
    expect(layout.idToIndex.get("1.2")).toBe(2);
    expect(layout.idToIndex.get("2")).toBe(3);
  });

  test("expandAll expands every node with children", () => {
    const layout = createTreeLayout(getChildren, new Set());
    layout.rebuild(makeTree());

    layout.expandAll(makeTree());
    expect(layout.totalVisible).toBe(9);
    expect(layout.flatNodes.map((n) => n.id)).toEqual([
      "1", "1.1", "1.1.1", "1.1.2", "1.2", "1.2.1", "2", "2.1", "3",
    ]);
  });

  test("collapseAll collapses everything", () => {
    const layout = createTreeLayout(getChildren, new Set(["1", "1.1", "2"]));
    layout.rebuild(makeTree());

    layout.collapseAll();
    expect(layout.totalVisible).toBe(3);
    expect(layout.expandedIds.size).toBe(0);
  });

  test("expandTo expands all ancestors of a deep node", () => {
    const layout = createTreeLayout(getChildren, new Set());
    layout.rebuild(makeTree());

    layout.expandTo("1.1.2");
    expect(layout.expandedIds.has("1")).toBe(true);
    expect(layout.expandedIds.has("1.1")).toBe(true);
    expect(layout.idToIndex.get("1.1.2")).toBeDefined();
  });
});

// =============================================================================
// Subtree size
// =============================================================================

describe("createTreeLayout — getSubtreeSize", () => {
  test("returns 0 for leaf nodes", () => {
    const layout = createTreeLayout(getChildren, new Set(["1"]));
    layout.rebuild(makeTree());

    const coreIdx = layout.idToIndex.get("1.1")!;
    expect(layout.getSubtreeSize(coreIdx)).toBe(0);
  });

  test("returns correct count for expanded node", () => {
    const layout = createTreeLayout(getChildren, new Set(["1", "1.1"]));
    layout.rebuild(makeTree());

    const srcIdx = layout.idToIndex.get("1")!;
    expect(layout.getSubtreeSize(srcIdx)).toBe(4);
  });
});

// =============================================================================
// Mutations
// =============================================================================

describe("createTreeLayout — mutations", () => {
  test("addChild adds a child to an expanded parent", () => {
    const layout = createTreeLayout(getChildren, new Set(["1"]));
    layout.rebuild(makeTree());

    layout.addChild("1", { id: "1.3", name: "utils", children: [] } as TreeItem);
    expect(layout.idToIndex.get("1.3")).toBeDefined();
  });

  test("addChild throws on duplicate id", () => {
    const layout = createTreeLayout(getChildren, new Set(["1"]));
    layout.rebuild(makeTree());

    expect(() => {
      layout.addChild("1", { id: "1.1", name: "dup", children: [] } as TreeItem);
    }).toThrow("duplicate id");
  });

  test("removeNode removes node and subtree", () => {
    const layout = createTreeLayout(getChildren, new Set(["1", "1.1"]));
    layout.rebuild(makeTree());

    const removed = layout.removeNode("1.1");
    expect(removed).toBe(3);
    expect(layout.idToIndex.has("1.1")).toBe(false);
    expect(layout.idToIndex.has("1.1.1")).toBe(false);
  });

  test("moveNode reparents a node", () => {
    const layout = createTreeLayout(getChildren, new Set(["1", "2"]));
    layout.rebuild(makeTree());

    layout.moveNode("1.2", "2");
    expect(layout.flatNodes.some((n) => n.id === "1.2" && n.parentId === "2")).toBe(true);
  });

  test("moveNode throws when moving to own descendant", () => {
    const layout = createTreeLayout(getChildren, new Set(["1", "1.1"]));
    layout.rebuild(makeTree());

    expect(() => {
      layout.moveNode("1", "1.1");
    }).toThrow("descendant");
  });

  test("moveNode detects cycle through collapsed subtree", () => {
    const layout = createTreeLayout(getChildren, new Set());
    layout.rebuild(makeTree());

    expect(() => {
      layout.moveNode("1", "1.1.1");
    }).toThrow("descendant");
  });

  test("rebuild throws on duplicate ids", () => {
    const items: TreeItem[] = [
      { id: "1", name: "a", children: [
        { id: "1", name: "dup", children: [] },
      ]},
    ];
    const layout = createTreeLayout(getChildren, new Set(["1"]));
    expect(() => layout.rebuild(items)).toThrow("duplicate id");
  });

  test("rebuild detects duplicates inside collapsed subtrees", () => {
    const items: TreeItem[] = [
      { id: "1", name: "a", children: [
        { id: "2", name: "b", children: [
          { id: "2", name: "dup-inside-collapsed", children: [] },
        ]},
      ]},
    ];
    const layout = createTreeLayout(getChildren, new Set());
    expect(() => layout.rebuild(items)).toThrow("duplicate id");
  });
});
