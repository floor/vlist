/**
 * Tree plugin — integration tests via createVList
 *
 * Tests the public API surface (getItemAt, getIndexById, total, events)
 * through the real createVList factory, not the mock PluginContext.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { createContainer } from "../../helpers/factory";
import { createVList } from "../../../src/core/create";
import { tree } from "../../../src/plugins/tree/plugin";
import { selection } from "../../../src/plugins/selection/plugin";
import type { VListItem } from "../../../src/types";

interface TreeItem extends VListItem {
  id: string;
  name: string;
  children: TreeItem[];
}

function makeTree(): TreeItem[] {
  return [
    { id: "src", name: "src", children: [
      { id: "core", name: "core", children: [
        { id: "create", name: "create.ts", children: [] },
        { id: "pipeline", name: "pipeline.ts", children: [] },
      ]},
      { id: "plugins", name: "plugins", children: [] },
    ]},
    { id: "test", name: "test", children: [
      { id: "helpers", name: "helpers", children: [] },
    ]},
    { id: "readme", name: "README.md", children: [] },
  ];
}

const template = (item: TreeItem): string => `<div>${item.name}</div>`;

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

describe("tree integration — public API", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 400 });
  });

  afterEach(() => {
    container.remove();
  });

  test("list.total reflects visible (flat) node count", () => {
    const list = createVList<TreeItem>({
      container,
      item: { height: 32, template },
      items: makeTree(),
    }, [tree({ expanded: ["src"] })]);

    expect(list.total).toBe(5);
    list.destroy();
  });

  test("list.total updates after expand/collapse", () => {
    const list = createVList<TreeItem>({
      container,
      item: { height: 32, template },
      items: makeTree(),
    }, [tree()]);

    expect(list.total).toBe(3);

    (list as any).expand("src");
    expect(list.total).toBe(5);

    (list as any).collapse("src");
    expect(list.total).toBe(3);

    list.destroy();
  });

  test("getItemAt returns flat visible items, not raw roots", () => {
    const list = createVList<TreeItem>({
      container,
      item: { height: 32, template },
      items: makeTree(),
    }, [tree({ expanded: ["src"] })]);

    expect(list.getItemAt(0)?.id).toBe("src");
    expect(list.getItemAt(1)?.id).toBe("core");
    expect(list.getItemAt(2)?.id).toBe("plugins");
    expect(list.getItemAt(3)?.id).toBe("test");
    expect(list.getItemAt(4)?.id).toBe("readme");

    list.destroy();
  });

  test("getItemAt returns deeply nested nodes when expanded", () => {
    const list = createVList<TreeItem>({
      container,
      item: { height: 32, template },
      items: makeTree(),
    }, [tree({ expanded: ["src", "core"] })]);

    expect(list.getItemAt(2)?.id).toBe("create");
    expect(list.getItemAt(3)?.id).toBe("pipeline");

    list.destroy();
  });

  test("getIndexById returns flat visible index", () => {
    const list = createVList<TreeItem>({
      container,
      item: { height: 32, template },
      items: makeTree(),
    }, [tree({ expanded: ["src"] })]);

    expect(list.getIndexById("src")).toBe(0);
    expect(list.getIndexById("core")).toBe(1);
    expect(list.getIndexById("plugins")).toBe(2);
    expect(list.getIndexById("test")).toBe(3);
    expect(list.getIndexById("readme")).toBe(4);

    list.destroy();
  });

  test("getIndexById returns -1 for nodes inside collapsed subtrees", () => {
    const list = createVList<TreeItem>({
      container,
      item: { height: 32, template },
      items: makeTree(),
    }, [tree()]);

    expect(list.getIndexById("core")).toBe(-1);
    expect(list.getIndexById("create")).toBe(-1);

    list.destroy();
  });

  test("getIndexById updates after expand", () => {
    const list = createVList<TreeItem>({
      container,
      item: { height: 32, template },
      items: makeTree(),
    }, [tree()]);

    expect(list.getIndexById("core")).toBe(-1);

    (list as any).expand("src");
    expect(list.getIndexById("core")).toBe(1);

    list.destroy();
  });

  test("item:click event delivers correct item for non-root nodes", () => {
    const list = createVList<TreeItem>({
      container,
      item: { height: 32, template },
      items: makeTree(),
    }, [tree({ expanded: ["src", "core"] })]);

    const clicks: { id: string; index: number }[] = [];
    list.on("item:click", ({ item, index }) => {
      clicks.push({ id: item.id as string, index });
    });

    const contentEl = list.element.querySelector(".vlist-content") as HTMLElement;
    const items = contentEl.querySelectorAll("[data-index]");
    const target = Array.from(items).find(
      (el) => el.getAttribute("data-id") === "create",
    ) as HTMLElement | undefined;

    if (target) {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(clicks.length).toBe(1);
      expect(clicks[0]!.id).toBe("create");
    }

    list.destroy();
  });

  test("tree works with selection plugin", () => {
    const list = createVList<TreeItem>({
      container,
      item: { height: 32, template },
      items: makeTree(),
    }, [
      tree({ expanded: ["src"] }),
      selection({ mode: "single" }),
    ]);

    expect(list.total).toBe(5);
    (list as any).select("core");
    const selected = (list as any).getSelected() as string[];
    expect(selected).toContain("core");

    list.destroy();
  });

  test("expandAll / collapseAll via public API", () => {
    const list = createVList<TreeItem>({
      container,
      item: { height: 32, template },
      items: makeTree(),
    }, [tree()]);

    expect(list.total).toBe(3);

    (list as any).expandAll();
    expect(list.total).toBe(8);

    (list as any).collapseAll();
    expect(list.total).toBe(3);

    list.destroy();
  });

  test("addChild adds to visible layout", () => {
    const list = createVList<TreeItem>({
      container,
      item: { height: 32, template },
      items: makeTree(),
    }, [tree({ expanded: ["src"] })]);

    const before = list.total;
    (list as any).addChild("src", { id: "utils", name: "utils", children: [] });
    expect(list.total).toBe(before + 1);
    expect(list.getIndexById("utils")).toBeGreaterThan(-1);

    list.destroy();
  });

  test("removeItem removes node and subtree", () => {
    const list = createVList<TreeItem>({
      container,
      item: { height: 32, template },
      items: makeTree(),
    }, [tree({ expanded: ["src", "core"] })]);

    const before = list.total;
    list.removeItem("core");
    expect(list.total).toBe(before - 3);
    expect(list.getIndexById("core")).toBe(-1);
    expect(list.getIndexById("create")).toBe(-1);

    list.destroy();
  });

  test("insertItem clamps to root array bounds", () => {
    const list = createVList<TreeItem>({
      container,
      item: { height: 32, template },
      items: makeTree(),
    }, [tree({ expanded: ["src"] })]);

    const before = list.total;
    list.insertItem({ id: "new", name: "new.ts", children: [] } as TreeItem, 999);
    expect(list.total).toBe(before + 1);
    expect(list.getIndexById("new")).toBeGreaterThan(-1);

    list.destroy();
  });

  test("async loadChildren with function accessor works via side map", async () => {
    interface CustomItem extends VListItem {
      id: string;
      name: string;
      subs?: CustomItem[];
    }

    const items: CustomItem[] = [
      { id: "root", name: "root" },
    ];

    const list = createVList<CustomItem>({
      container,
      item: { height: 32, template: (item: CustomItem) => `<div>${item.name}</div>` },
      items,
    }, [tree<CustomItem>({
      children: (item: CustomItem) => item.subs ?? [],
      loadChildren: async () => [
        { id: "c1", name: "child-1" },
        { id: "c2", name: "child-2" },
      ],
    })]);

    expect(list.total).toBe(1);
    (list as any).expand("root");
    await new Promise((r) => setTimeout(r, 20));
    expect(list.total).toBe(3);

    list.destroy();
  });

  test("parentId addChild on empty parent persists in raw items", () => {
    const items = [
      { id: "1", name: "root", parentId: null },
      { id: "2", name: "other", parentId: null },
    ] as any[];

    const list = createVList({
      container,
      item: { height: 32, template: (item: any) => `<div>${item.name}</div>` },
      items,
    }, [tree({ parentId: "parentId", expanded: true })]);

    (list as any).addChild("2", { id: "3", name: "child" });
    (list as any).expand("2");

    expect(list.getIndexById("3")).toBeGreaterThan(-1);
    expect(items.some((i: any) => i.id === "3")).toBe(true);

    list.destroy();
  });

  test("parentId removeItem removes subtree from raw items", () => {
    const items = [
      { id: "1", name: "root", parentId: null },
      { id: "2", name: "child", parentId: "1" },
      { id: "3", name: "grandchild", parentId: "2" },
    ] as any[];

    const list = createVList({
      container,
      item: { height: 32, template: (item: any) => `<div>${item.name}</div>` },
      items,
    }, [tree({ parentId: "parentId", expanded: true })]);

    list.removeItem("1");
    expect(items.length).toBe(0);
    expect(list.total).toBe(0);

    list.destroy();
  });

  test("async loadChildren rejects duplicate IDs", async () => {
    const errors: unknown[] = [];
    const items: TreeItem[] = [
      { id: "root", name: "root", children: [] },
    ];

    const list = createVList<TreeItem>({
      container,
      item: { height: 32, template },
      items,
    }, [tree<TreeItem>({
      children: "children",
      loadChildren: async () => [
        { id: "dup", name: "a", children: [] },
        { id: "dup", name: "b", children: [] },
      ],
    })]);

    list.on("tree:load:error", ({ error }) => errors.push(error));

    (list as any).expand("root");
    await new Promise((r) => setTimeout(r, 20));

    expect(errors.length).toBe(1);

    list.destroy();
  });

  test("expand + select via public API keeps selection consistent", () => {
    const items: TreeItem[] = [
      { id: "a", name: "folder", children: [
        { id: "b", name: "child.ts", children: [] },
      ]},
      { id: "c", name: "file.ts", children: [] },
    ];

    const list = createVList<TreeItem>({
      container,
      item: { height: 32, template },
      items,
    }, [
      tree<TreeItem>({ expandOnClick: true }),
      selection({ mode: "single", followFocus: true }),
    ]);

    (list as any).expand("a");
    (list as any).select("a");
    expect((list as any).getSelected()).toContain("a");
    expect((list as any).isExpanded("a")).toBe(true);

    (list as any).collapse("a");
    (list as any).select("a");
    expect((list as any).getSelected()).toContain("a");
    expect((list as any).isExpanded("a")).toBe(false);

    list.destroy();
  });

  test("expand then collapse preserves selection on same folder", () => {
    const items: TreeItem[] = [
      { id: "a", name: "folder", children: [
        { id: "b", name: "child.ts", children: [] },
      ]},
      { id: "c", name: "other.ts", children: [] },
    ];

    const list = createVList<TreeItem>({
      container,
      item: { height: 32, template },
      items,
    }, [
      tree<TreeItem>(),
      selection({ mode: "single" }),
    ]);

    (list as any).expand("a");
    (list as any).select("a");
    expect(list.total).toBe(3);
    expect((list as any).getSelected()).toContain("a");

    (list as any).collapse("a");
    expect(list.total).toBe(2);
    expect((list as any).getSelected()).toContain("a");

    list.destroy();
  });
});
