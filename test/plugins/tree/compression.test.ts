/**
 * Tree plugin — compression path tests
 *
 * Simulates the scale plugin's compression state to verify the tree
 * renderer uses compressed range/position calculations when active.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createPluginMockContext } from "../../helpers/plugin-context";
import { tree } from "../../../src/plugins/tree/plugin";
import type { VListItem } from "../../../src/types";

interface TreeItem extends VListItem {
  id: string;
  name: string;
  children: TreeItem[];
}

function makeLargeTree(count: number): TreeItem[] {
  const items: TreeItem[] = [];
  for (let i = 0; i < count; i++) {
    items.push({ id: `r${i}`, name: `root-${i}`, children: [] });
  }
  return items;
}

beforeAll(() => { GlobalRegistrator.register(); });
afterAll(() => { GlobalRegistrator.unregister(); });

describe("tree plugin — compression path", () => {
  test("renders correctly when scale compression is active", () => {
    const items = makeLargeTree(100);
    const testCtx = createPluginMockContext<TreeItem>(items, {
      containerHeight: 300,
      itemSize: 32,
    });

    testCtx.ctx.registerMethod("_scale:getCompression", () => ({
      isCompressed: true,
      actualSize: 100 * 32,
      virtualSize: 2000,
      ratio: 2000 / (100 * 32),
    }));

    tree<TreeItem>().setup!(testCtx.ctx);
    testCtx.engineState.containerSize = 300;
    testCtx.ctx.forceRender();

    const renderedItems = testCtx.dom.content.querySelectorAll("[role='treeitem']");
    expect(renderedItems.length).toBeGreaterThan(0);

    testCtx.cleanup();
  });

  test("compressed items have transform positions", () => {
    const items = makeLargeTree(50);
    const testCtx = createPluginMockContext<TreeItem>(items, {
      containerHeight: 300,
      itemSize: 32,
    });

    testCtx.ctx.registerMethod("_scale:getCompression", () => ({
      isCompressed: true,
      actualSize: 50 * 32,
      virtualSize: 1000,
      ratio: 1000 / (50 * 32),
    }));

    tree<TreeItem>().setup!(testCtx.ctx);
    testCtx.engineState.containerSize = 300;
    testCtx.ctx.forceRender();

    const firstItem = testCtx.dom.content.querySelector("[role='treeitem']") as HTMLElement;
    expect(firstItem).not.toBeNull();
    expect(firstItem.style.transform).toContain("translate");

    testCtx.cleanup();
  });

  test("non-compressed path uses sizeCache offsets directly", () => {
    const items = makeLargeTree(20);
    const testCtx = createPluginMockContext<TreeItem>(items, {
      containerHeight: 300,
      itemSize: 32,
    });

    tree<TreeItem>().setup!(testCtx.ctx);
    testCtx.engineState.containerSize = 300;
    testCtx.ctx.forceRender();

    const firstItem = testCtx.dom.content.querySelector("[data-id='r0']") as HTMLElement;
    expect(firstItem).not.toBeNull();
    expect(firstItem.style.transform).toBe("translate(0, 0px)");

    testCtx.cleanup();
  });

  test("compression resolves lazily on first render", () => {
    const items = makeLargeTree(10);
    const testCtx = createPluginMockContext<TreeItem>(items, {
      containerHeight: 300,
      itemSize: 32,
    });

    tree<TreeItem>().setup!(testCtx.ctx);

    testCtx.ctx.registerMethod("_scale:getCompression", () => ({
      isCompressed: true,
      actualSize: 10 * 32,
      virtualSize: 200,
      ratio: 200 / (10 * 32),
    }));

    testCtx.engineState.containerSize = 300;
    testCtx.ctx.forceRender();

    const renderedItems = testCtx.dom.content.querySelectorAll("[role='treeitem']");
    expect(renderedItems.length).toBeGreaterThan(0);

    testCtx.cleanup();
  });
});
