/**
 * Tree plugin — standalone keyboard tests (no selection plugin)
 *
 * Covers the fallback keyboard handler: ArrowDown/Up, Home/End, Enter,
 * type-ahead, *, and focus management via focusin/focusout.
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

function makeTree(): TreeItem[] {
  return [
    { id: "1", name: "src", children: [
      { id: "1.1", name: "core", children: [
        { id: "1.1.1", name: "create.ts", children: [] },
        { id: "1.1.2", name: "pipeline.ts", children: [] },
      ]},
      { id: "1.2", name: "plugins", children: [] },
    ]},
    { id: "2", name: "test", children: [] },
    { id: "3", name: "README.md", children: [] },
  ];
}

beforeAll(() => { GlobalRegistrator.register(); });
afterAll(() => { GlobalRegistrator.unregister(); });

function setup(expandedIds: string[] = []) {
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

function fireKey(handler: (e: KeyboardEvent) => void, key: string, opts?: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  handler(event);
  return event;
}

function getFocusedId(dom: { content: HTMLElement }): string | null {
  const desc = dom.content.getAttribute("aria-activedescendant");
  if (!desc) return null;
  const el = dom.content.querySelector(`#${desc}`) as HTMLElement | null;
  return el?.getAttribute("data-id") ?? null;
}

// =============================================================================
// ArrowDown / ArrowUp navigation
// =============================================================================

describe("tree keyboard (standalone) — ArrowDown/Up", () => {
  test("Home focuses first node", () => {
    const { keydownHandlers, dom, cleanup } = setup(["1"]);
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");

    expect(getFocusedId(dom)).toBe("1");
    cleanup();
  });

  test("ArrowDown moves focus to next visible node", () => {
    const { keydownHandlers, dom, cleanup } = setup(["1"]);
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");
    fireKey(handler, "ArrowDown");

    expect(getFocusedId(dom)).toBe("1.1");
    cleanup();
  });

  test("ArrowUp moves focus to previous visible node", () => {
    const { keydownHandlers, dom, cleanup } = setup(["1"]);
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");
    fireKey(handler, "ArrowDown");
    fireKey(handler, "ArrowDown");
    fireKey(handler, "ArrowUp");

    expect(getFocusedId(dom)).toBe("1.1");
    cleanup();
  });

  test("End moves focus to last visible node", () => {
    const { keydownHandlers, dom, cleanup } = setup(["1"]);
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");
    fireKey(handler, "End");

    expect(getFocusedId(dom)).toBe("3");
    cleanup();
  });

  test("ArrowDown at last node does not wrap", () => {
    const { keydownHandlers, dom, cleanup } = setup();
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");
    fireKey(handler, "End");
    fireKey(handler, "ArrowDown");

    expect(getFocusedId(dom)).toBe("3");
    cleanup();
  });

  test("ArrowUp at first node stays put", () => {
    const { keydownHandlers, dom, cleanup } = setup();
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");
    fireKey(handler, "ArrowUp");

    expect(getFocusedId(dom)).toBe("1");
    cleanup();
  });
});

// =============================================================================
// ArrowRight / ArrowLeft tree-specific
// =============================================================================

describe("tree keyboard (standalone) — ArrowRight/Left", () => {
  test("ArrowRight on collapsed node expands it", () => {
    const { keydownHandlers, methods, cleanup } = setup();
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");
    fireKey(handler, "ArrowRight");

    const isExpanded = methods.get("isExpanded") as (id: string) => boolean;
    expect(isExpanded("1")).toBe(true);
    cleanup();
  });

  test("ArrowRight on expanded node moves to first child", () => {
    const { keydownHandlers, dom, cleanup } = setup(["1"]);
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");
    fireKey(handler, "ArrowRight");

    expect(getFocusedId(dom)).toBe("1.1");
    cleanup();
  });

  test("ArrowRight on leaf is no-op", () => {
    const { keydownHandlers, dom, cleanup } = setup();
    const handler = keydownHandlers[0]!;
    fireKey(handler, "End");
    const before = getFocusedId(dom);
    fireKey(handler, "ArrowRight");

    expect(getFocusedId(dom)).toBe(before);
    cleanup();
  });

  test("ArrowLeft on expanded node collapses it", () => {
    const { keydownHandlers, methods, cleanup } = setup(["1"]);
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");
    fireKey(handler, "ArrowLeft");

    const isExpanded = methods.get("isExpanded") as (id: string) => boolean;
    expect(isExpanded("1")).toBe(false);
    cleanup();
  });

  test("ArrowLeft on collapsed child moves to parent", () => {
    const { keydownHandlers, dom, cleanup } = setup(["1"]);
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");
    fireKey(handler, "ArrowDown");
    expect(getFocusedId(dom)).toBe("1.1");

    fireKey(handler, "ArrowLeft");
    expect(getFocusedId(dom)).toBe("1");
    cleanup();
  });

  test("ArrowLeft on root node with no parent is no-op", () => {
    const { keydownHandlers, dom, cleanup } = setup();
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");
    fireKey(handler, "ArrowLeft");

    expect(getFocusedId(dom)).toBe("1");
    cleanup();
  });
});

// =============================================================================
// Enter
// =============================================================================

describe("tree keyboard (standalone) — Enter", () => {
  test("Enter emits item:click", () => {
    const emitted: unknown[] = [];
    const items = makeTree();
    const testCtx = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });
    const origEmit = (testCtx.ctx as any).emitter.emit;
    (testCtx.ctx as any).emitter.emit = (event: string, ...args: unknown[]) => {
      if (event === "item:click") emitted.push(args[0]);
      origEmit.call((testCtx.ctx as any).emitter, event, ...args);
    };

    tree<TreeItem>().setup!(testCtx.ctx);
    testCtx.engineState.containerSize = 400;
    testCtx.ctx.forceRender();

    const handler = testCtx.keydownHandlers[0]!;
    fireKey(handler, "Home");
    fireKey(handler, "Enter");

    expect(emitted.length).toBe(1);
    expect((emitted[0] as any).item.id).toBe("1");
    testCtx.cleanup();
  });
});

// =============================================================================
// * (expand siblings)
// =============================================================================

describe("tree keyboard (standalone) — asterisk", () => {
  test("* expands all collapsed siblings at same level", () => {
    const items: TreeItem[] = [
      { id: "a", name: "folder-a", children: [
        { id: "a1", name: "a-child", children: [] },
      ]},
      { id: "b", name: "folder-b", children: [
        { id: "b1", name: "b-child", children: [] },
      ]},
      { id: "c", name: "leaf", children: [] },
    ];
    const testCtx = createPluginMockContext<TreeItem>(items, {
      containerHeight: 400,
      itemSize: 32,
    });
    tree<TreeItem>().setup!(testCtx.ctx);
    testCtx.engineState.containerSize = 400;
    testCtx.ctx.forceRender();

    const handler = testCtx.keydownHandlers[0]!;
    fireKey(handler, "Home");
    fireKey(handler, "*");

    const isExpanded = testCtx.methods.get("isExpanded") as (id: string) => boolean;
    expect(isExpanded("a")).toBe(true);
    expect(isExpanded("b")).toBe(true);
    testCtx.cleanup();
  });
});

// =============================================================================
// Type-ahead
// =============================================================================

describe("tree keyboard (standalone) — type-ahead", () => {
  test("typing a character jumps to matching node", () => {
    const { keydownHandlers, dom, cleanup } = setup(["1"]);
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");

    fireKey(handler, "p");
    expect(getFocusedId(dom)).toBe("1.2");

    cleanup();
  });

  test("multi-character prefix narrows match", () => {
    const { keydownHandlers, dom, cleanup } = setup(["1", "1.1"]);
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");

    fireKey(handler, "p");
    fireKey(handler, "i");
    expect(getFocusedId(dom)).toBe("1.1.2");

    cleanup();
  });

  test("type-ahead wraps around to beginning", () => {
    const { keydownHandlers, dom, cleanup } = setup();
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");
    fireKey(handler, "End");

    fireKey(handler, "s");
    expect(getFocusedId(dom)).toBe("1");

    cleanup();
  });

  test("modifier keys do not trigger type-ahead", () => {
    const { keydownHandlers, dom, cleanup } = setup(["1"]);
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");
    const before = getFocusedId(dom);

    fireKey(handler, "a", { ctrlKey: true });
    expect(getFocusedId(dom)).toBe(before);

    cleanup();
  });
});

// =============================================================================
// preventDefault
// =============================================================================

describe("tree keyboard — preventDefault", () => {
  test("handled keys call preventDefault", () => {
    const { keydownHandlers, cleanup } = setup(["1"]);
    const handler = keydownHandlers[0]!;
    fireKey(handler, "Home");

    for (const key of ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End", "*"]) {
      const event = fireKey(handler, key);
      expect(event.defaultPrevented).toBe(true);
    }
    cleanup();
  });
});
