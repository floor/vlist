/**
 * Tree plugin — async children tests
 *
 * Covers loadChildren flow: loading state, success, error,
 * stale node after rebuild, and dedup of concurrent loads.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createPluginMockContext } from "../../helpers/plugin-context";
import { tree } from "../../../src/plugins/tree/plugin";
import type { VListItem } from "../../../src/types";

interface TreeItem extends VListItem {
  id: string;
  name: string;
  children?: TreeItem[];
}

function makeTree(): TreeItem[] {
  return [
    { id: "1", name: "src", children: [
      { id: "1.1", name: "core", children: [] },
    ]},
    { id: "2", name: "lazy-folder" },
    { id: "3", name: "README.md", children: [] },
  ];
}

beforeAll(() => { GlobalRegistrator.register(); });
afterAll(() => { GlobalRegistrator.unregister(); });

// =============================================================================
// loadChildren — success
// =============================================================================

describe("tree async — loadChildren success", () => {
  test("expand triggers loadChildren for node without children", async () => {
    let loadCalled = false;
    let loadedId: string | undefined;

    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });

    tree<TreeItem>({
      loadChildren: async (item) => {
        loadCalled = true;
        loadedId = item.id as string;
        return [
          { id: "2.1", name: "child-a", children: [] },
          { id: "2.2", name: "child-b", children: [] },
        ];
      },
    }).setup!(ctx);

    ctx.forceRender();

    const expand = methods.get("expand") as (id: string) => void;
    expand("2");

    await new Promise((r) => setTimeout(r, 10));

    expect(loadCalled).toBe(true);
    expect(loadedId).toBe("2");

    const layout = (methods.get("getTreeLayout") as () => { totalVisible: number; flatNodes: { id: string }[] })();
    expect(layout.flatNodes.some((n) => n.id === "2.1")).toBe(true);
    expect(layout.flatNodes.some((n) => n.id === "2.2")).toBe(true);

    cleanup();
  });

  test("node shows loading state during fetch", async () => {
    let resolveLoad!: (children: TreeItem[]) => void;

    const items = makeTree();
    const { ctx, methods, dom, engineState, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });

    tree<TreeItem>({
      loadChildren: () => new Promise((resolve) => { resolveLoad = resolve; }),
    }).setup!(ctx);

    engineState.containerSize = 400;
    ctx.forceRender();

    const expand = methods.get("expand") as (id: string) => void;
    expand("2");

    await new Promise((r) => setTimeout(r, 5));
    ctx.forceRender();

    const loadingEl = dom.content.querySelector(".vlist-tree-node--loading");
    expect(loadingEl).not.toBeNull();

    resolveLoad([{ id: "2.1", name: "child", children: [] }]);
    await new Promise((r) => setTimeout(r, 10));

    cleanup();
  });

  test("loaded children become visible after resolve", async () => {
    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });

    tree<TreeItem>({
      loadChildren: async () => [
        { id: "2.1", name: "child-a", children: [] },
      ],
    }).setup!(ctx);

    ctx.forceRender();

    const expand = methods.get("expand") as (id: string) => void;
    const isExpanded = methods.get("isExpanded") as (id: string) => boolean;

    expand("2");
    await new Promise((r) => setTimeout(r, 10));

    expect(isExpanded("2")).toBe(true);
    const layout = (methods.get("getTreeLayout") as () => { totalVisible: number })();
    expect(layout.totalVisible).toBe(4);

    cleanup();
  });
});

// =============================================================================
// loadChildren — error
// =============================================================================

describe("tree async — loadChildren error", () => {
  test("load error clears loading state", async () => {
    const items = makeTree();
    const emitted: string[] = [];
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });

    const mockCtx = ctx as any;
    const origEmit = mockCtx.emitter.emit;
    mockCtx.emitter.emit = (event: string, ...args: unknown[]) => {
      emitted.push(event);
      origEmit.call(mockCtx.emitter, event, ...args);
    };

    tree<TreeItem>({
      loadChildren: async () => { throw new Error("network failure"); },
    }).setup!(ctx);

    ctx.forceRender();

    const expand = methods.get("expand") as (id: string) => void;
    expand("2");
    await new Promise((r) => setTimeout(r, 10));

    expect(emitted).toContain("tree:load:error");

    const layout = (methods.get("getTreeLayout") as () => { flatNodes: { id: string; loading: boolean }[] })();
    const node = layout.flatNodes.find((n) => n.id === "2");
    expect(node?.loading).toBe(false);

    cleanup();
  });
});

// =============================================================================
// loadChildren — dedup
// =============================================================================

describe("tree async — dedup concurrent loads", () => {
  test("multiple expand calls on same node only trigger one load", async () => {
    let callCount = 0;

    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });

    tree<TreeItem>({
      loadChildren: async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 20));
        return [{ id: "2.1", name: "child", children: [] }];
      },
    }).setup!(ctx);

    ctx.forceRender();

    const expand = methods.get("expand") as (id: string) => void;
    expand("2");
    expand("2");
    expand("2");

    await new Promise((r) => setTimeout(r, 50));

    expect(callCount).toBe(1);
    cleanup();
  });
});

// =============================================================================
// loadChildren — node removed during load
// =============================================================================

describe("tree async — stale node after rebuild", () => {
  test("load resolving after node removal is a no-op", async () => {
    let resolveLoad!: (children: TreeItem[]) => void;

    const items = makeTree();
    const { ctx, methods, cleanup } = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });

    tree<TreeItem>({
      loadChildren: () => new Promise((resolve) => { resolveLoad = resolve; }),
    }).setup!(ctx);

    ctx.forceRender();

    const expand = methods.get("expand") as (id: string) => void;
    expand("2");
    await new Promise((r) => setTimeout(r, 5));

    ctx.removeItemById("2");
    await new Promise((r) => setTimeout(r, 5));

    resolveLoad([{ id: "2.1", name: "child", children: [] }]);
    await new Promise((r) => setTimeout(r, 10));

    const layout = (methods.get("getTreeLayout") as () => { flatNodes: { id: string }[] })();
    expect(layout.flatNodes.some((n) => n.id === "2.1")).toBe(false);

    cleanup();
  });
});
