/**
 * vlist — Tree Plugin Edge Paths
 *
 * Configuration and editing branches of tree() that nothing drove through a
 * real list: children and labels read from custom keys, updateItem on a node,
 * the standalone focus ring leaving with the focus, and a parentId tree whose
 * lazily loaded children survive a data swap.
 *
 * Safe under `bun test --concurrent`: each test owns its list and container
 * through `scoped()` and nothing is shared between tests. The focus-ring test
 * dispatches its own FocusEvents and never reads `document.activeElement`.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { advanceTimers } from "../../helpers/timers";
import { scoped, waitFor, type TestScope } from "../../helpers/scope";
import { createContainer } from "../../helpers/factory";
import { createVList } from "../../../src/core/create";
import type { CreateVListConfig, VList } from "../../../src/core/types";
import type { VListItem } from "../../../src/types";
import { tree, type TreeMethods, type TreePluginConfig } from "../../../src/plugins/tree";
import { a11y } from "../../../src/plugins/a11y/plugin";
import { selection } from "../../../src/plugins/selection/plugin";

const WIDTH = 300;
const HEIGHT = 500;

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  setupDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => HEIGHT, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => WIDTH, configurable: true });
});
afterAll(() => {
  geometry.restore();
  teardownDOM();
});
// Registered after cleanup: catch a missing or incomplete restore.
afterAll(() => geometry.assertRestored());

/** Each test owns its tree: `scope` destroys it when that test ends, not before. */
async function makeTree<T extends VListItem>(
  scope: TestScope,
  items: T[],
  config: TreePluginConfig<T>,
  template: CreateVListConfig<T>["item"]["template"],
) {
  const container = createContainer({ width: WIDTH, height: HEIGHT });
  const list = createVList<T>({ container, items, item: { height: 32, template } }, [tree<T>(config)]);
  scope.own(list, container);
  // tree() decides who owns the focus on the microtask after setup.
  await advanceTimers(5);
  const content = container.querySelector<HTMLElement>(".vlist-content")!;
  return { list: list as VList<T> & TreeMethods, container, content };
}

const rowTexts = (container: HTMLElement): string[] =>
  [...container.querySelectorAll<HTMLElement>("[data-index]")]
    .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
    .map((el) => el.textContent ?? "");

function press(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

const focusedText = (container: HTMLElement): string | null =>
  container.querySelector<HTMLElement>(".vlist-item--focused")?.textContent ?? null;

// =============================================================================
// Custom keys
// =============================================================================

describe("tree — children and labels under custom keys", () => {
  interface Doc extends VListItem {
    id: string;
    title: string;
    nodes?: Doc[];
  }

  const docs = (): Doc[] => [
    { id: "guide", title: "Guide", nodes: [
      { id: "intro", title: "Introduction" },
      { id: "setup", title: "Setup" },
    ] },
    { id: "api", title: "Reference" },
    { id: "faq", title: "Questions" },
  ];

  it("reads the children from the configured key", scoped(async (scope) => {
    const { list, container } = await makeTree(scope, docs(), { children: "nodes" }, (item) => item.title);
    expect(rowTexts(container)).toEqual(["Guide", "Reference", "Questions"]);

    list.expand("guide");

    expect(rowTexts(container)).toEqual(["Guide", "Introduction", "Setup", "Reference", "Questions"]);
    // A node without the key is a leaf, not an error.
    expect(container.querySelector('[data-id="api"]')!.hasAttribute("aria-expanded")).toBe(false);
  }));

  it("type-ahead matches against the configured label key", scoped(async (scope) => {
    const { container, content } = await makeTree(scope, docs(), { children: "nodes", label: "title" }, (item) => item.title);
    press(content, "ArrowDown");
    expect(focusedText(container)).toBe("Guide");

    // "q" is the first letter of the title "Questions" — its id is "faq".
    press(content, "q");

    expect(focusedText(container)).toBe("Questions");
  }));

  it("type-ahead matches against a label function", scoped(async (scope) => {
    const { container, content } = await makeTree(
      scope,
      docs(),
      { children: "nodes", label: (item) => `#${item.id}` },
      (item) => item.title,
    );
    press(content, "ArrowDown");

    press(content, "#");
    press(content, "f");

    expect(focusedText(container)).toBe("Questions");
  }));
});

// =============================================================================
// updateItem
// =============================================================================

describe("tree — updateItem", () => {
  interface Node extends VListItem {
    id: string;
    name: string;
    children: Node[];
  }

  const nodes = (): Node[] => [
    { id: "src", name: "src", children: [
      { id: "core", name: "core", children: [] },
      { id: "plugins", name: "plugins", children: [] },
    ] },
    { id: "readme", name: "README.md", children: [] },
  ];

  it("rewrites the node's row in place and keeps the folder open", scoped(async (scope) => {
    const { list, container } = await makeTree(scope, nodes(), { expanded: ["src"] }, (item) => item.name);
    const row = container.querySelector<HTMLElement>('[data-id="core"]')!;
    const changes: unknown[] = [];
    list.on("data:change", (event) => changes.push(event));

    list.updateItem("core", { name: "engine" });

    expect(container.querySelector('[data-id="core"]')).toBe(row);
    expect(row.textContent).toBe("engine");
    expect(rowTexts(container)).toEqual(["src", "engine", "plugins", "README.md"]);
    expect(list.isExpanded("src")).toBe(true);
    expect(changes).toEqual([{ type: "update", id: "core" }]);
  }));

  it("ignores an id the tree does not hold", scoped(async (scope) => {
    const { list, container } = await makeTree(scope, nodes(), { expanded: ["src"] }, (item) => item.name);
    const changes: unknown[] = [];
    list.on("data:change", (event) => changes.push(event));

    list.updateItem("nowhere", { name: "engine" });

    expect(rowTexts(container)).toEqual(["src", "core", "plugins", "README.md"]);
    expect(changes).toEqual([]);
  }));

  it("updates a node that sits inside a closed folder", scoped(async (scope) => {
    const { list, container } = await makeTree(scope, nodes(), {}, (item) => item.name);

    list.updateItem("core", { name: "engine" });
    list.expand("src");

    expect(rowTexts(container)).toEqual(["src", "engine", "plugins", "README.md"]);
  }));
});

// =============================================================================
// Connector lines
// =============================================================================

describe("tree — connector lines", () => {
  interface Node extends VListItem {
    id: string;
    name: string;
    children: Node[];
  }

  const nodes = (): Node[] => [
    { id: "p", name: "p", children: [
      { id: "p1", name: "p1", children: [
        { id: "p1a", name: "p1a", children: [] },
        { id: "p1b", name: "p1b", children: [] },
      ] },
      { id: "p2", name: "p2", children: [
        { id: "p2a", name: "p2a", children: [] },
        { id: "p2b", name: "p2b", children: [] },
      ] },
    ] },
    { id: "q", name: "q", children: [] },
  ];

  // The x of each 1px guide line the row draws, and whether CSS draws its elbow
  // (the --last class): what the row looks like, not how the gradient is spelled.
  const guides = (container: HTMLElement, id: string): { lines: number[]; elbow: boolean } => {
    const row = container.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
    const gradient = row.style.getPropertyValue("--vlist-tree-guides");
    return {
      // A line is a transparent run to x, then the line color to x + 1.
      lines: [...gradient.matchAll(/transparent 0 (\d+)px,var\(--vlist-tree-line, currentColor\) 0 (\d+)px/g)].map((m) => {
        expect(Number(m[2]) - Number(m[1])).toBe(1);
        return Number(m[1]);
      }),
      elbow: row.classList.contains("vlist-tree-node--last"),
    };
  };

  it("closes the last child's branch and drops a finished ancestor guide", scoped(async (scope) => {
    const { list, container } = await makeTree(scope, nodes(), { connectorLines: true, expanded: true }, (item) => item.name);

    expect(list.isExpanded("p")).toBe(true);

    // p1 continues (p2 follows it), so its column runs through p1's children.
    expect(guides(container, "p1a")).toEqual({ lines: [0, 24], elbow: false });
    expect(guides(container, "p1b")).toEqual({ lines: [0], elbow: true });

    // p2 is last: its column ends at p2, so p2's children draw only their own.
    expect(guides(container, "p2a")).toEqual({ lines: [24], elbow: false });
    expect(guides(container, "p2b")).toEqual({ lines: [], elbow: true });

    expect(guides(container, "p1")).toEqual({ lines: [0], elbow: false });
    expect(guides(container, "p2")).toEqual({ lines: [], elbow: true });
  }));

  it("never lets the gradient fade: every stop is a clamped run", scoped(async (scope) => {
    const { container } = await makeTree(scope, nodes(), { connectorLines: true, expanded: true }, (item) => item.name);

    // A stop with its own start position (e.g. "color 24px 25px" after
    // "transparent 0") makes the browser interpolate from the previous stop:
    // a fade from the left edge into the first line. Each stop starts at 0,
    // which clamps it to the end of the stop before it.
    for (const row of container.querySelectorAll<HTMLElement>("[data-id]")) {
      const gradient = row.style.getPropertyValue("--vlist-tree-guides");
      const stops = gradient.replace(/^linear-gradient\(to right,|\)$/g, "").split(/,(?![^(]*\))/);
      for (const stop of stops) {
        expect(stop).toMatch(/^(transparent|var\(--vlist-tree-line, currentColor\)) 0( \d+px)?$/);
      }
    }
  }));

  it("updates the guides when a branch's last child changes", scoped(async (scope) => {
    const { list, container } = await makeTree(scope, nodes(), { connectorLines: true, expanded: true }, (item) => item.name);

    // Removing p2 makes p1 the last child: its column no longer runs through p1a.
    list.removeItem("p2");
    await advanceTimers(5);
    expect(guides(container, "p1")).toEqual({ lines: [], elbow: true });
    expect(guides(container, "p1a")).toEqual({ lines: [24], elbow: false });
  }));
});

// =============================================================================
// tree + a11y keyboard
// =============================================================================

describe("tree + a11y keyboard", () => {
  interface Node extends VListItem {
    id: string;
    name: string;
    children: Node[];
  }

  async function makeA11yTree(scope: TestScope, items: Node[]) {
    const container = createContainer({ width: WIDTH, height: HEIGHT });
    const list = createVList<Node>({
      container,
      items,
      item: { height: 32, template: (item) => item.name },
    }, [tree<Node>(), a11y<Node>()]);
    scope.own(list, container);
    await advanceTimers(5);
    const content = container.querySelector<HTMLElement>(".vlist-content")!;
    return { list: list as VList<Node> & TreeMethods, container, content };
  }

  it("ArrowRight expands the focused folder and ArrowLeft collapses it", scoped(async (scope) => {
    const { list, container, content } = await makeA11yTree(scope, [
      { id: "a", name: "alpha", children: [{ id: "a1", name: "child", children: [] }] },
      { id: "b", name: "beta", children: [] },
    ]);

    press(content, "ArrowDown");
    press(content, "ArrowRight");
    expect(list.isExpanded("a")).toBe(true);
    expect(rowTexts(container)).toEqual(["alpha", "child", "beta"]);

    press(content, "ArrowLeft");
    expect(list.isExpanded("a")).toBe(false);
    expect(rowTexts(container)).toEqual(["alpha", "beta"]);
  }));

  it("* expands the closed sibling folders", scoped(async (scope) => {
    const { list, content } = await makeA11yTree(scope, [
      { id: "a", name: "alpha", children: [{ id: "a1", name: "child", children: [] }] },
      { id: "b", name: "beta", children: [{ id: "b1", name: "other", children: [] }] },
    ]);

    press(content, "ArrowDown");
    press(content, "*");
    expect(list.isExpanded("a")).toBe(true);
    expect(list.isExpanded("b")).toBe(true);
  }));

  function hideFocusVisible(el: HTMLElement): void {
    const orig = el.matches.bind(el);
    el.matches = (selectors: string) => (selectors === ":focus-visible" ? false : orig(selectors));
  }

  function clickRow(container: HTMLElement, content: HTMLElement, id: string): void {
    hideFocusVisible(content);
    hideFocusVisible(container);
    container.querySelector<HTMLElement>(`[data-id="${id}"]`)!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }

  it("ArrowRight after a mouse click expands the clicked folder", scoped(async (scope) => {
    const { list, container, content } = await makeA11yTree(scope, [
      { id: "a", name: "alpha", children: [{ id: "a1", name: "child", children: [] }] },
      { id: "b", name: "beta", children: [] },
    ]);

    clickRow(container, content, "a");
    expect(list.isExpanded("a")).toBe(false);
    expect(focusedText(container)).toBeNull();

    press(content, "ArrowRight");
    expect(list.isExpanded("a")).toBe(true);
    expect(rowTexts(container)).toEqual(["alpha", "child", "beta"]);
  }));

  it("type-ahead after a mouse click starts from the clicked node", scoped(async (scope) => {
    const { container, content } = await makeA11yTree(scope, [
      { id: "a", name: "alpha", children: [] },
      { id: "b", name: "bravo", children: [] },
      { id: "z", name: "zulu", children: [] },
    ]);

    clickRow(container, content, "a");
    press(content, "z");
    expect(focusedText(container)).toBe("zulu");
  }));

  it("ArrowRight after a mouse click expands when selection owns focus", scoped(async (scope) => {
    const container = createContainer({ width: WIDTH, height: HEIGHT });
    const list = createVList<Node>({
      container,
      items: [
        { id: "a", name: "alpha", children: [{ id: "a1", name: "child", children: [] }] },
        { id: "b", name: "beta", children: [] },
      ],
      item: { height: 32, template: (item) => item.name },
    }, [tree<Node>(), selection<Node>()]);
    scope.own(list, container);
    await advanceTimers(5);
    const content = container.querySelector<HTMLElement>(".vlist-content")!;

    clickRow(container, content, "a");
    expect((list as VList<Node> & TreeMethods).isExpanded("a")).toBe(false);

    press(content, "ArrowRight");
    expect((list as VList<Node> & TreeMethods).isExpanded("a")).toBe(true);
    expect(rowTexts(container)).toEqual(["alpha", "child", "beta"]);
  }));

  it("type-ahead moves to the matching node", scoped(async (scope) => {
    const { container, content } = await makeA11yTree(scope, [
      { id: "a", name: "alpha", children: [] },
      { id: "b", name: "bravo", children: [] },
      { id: "z", name: "zulu", children: [] },
    ]);

    press(content, "ArrowDown");
    press(content, "z");
    expect(focusedText(container)).toBe("zulu");
  }));
});

// =============================================================================
// Click, then a key
// =============================================================================

describe("tree — click then arrow", () => {
  interface Node extends VListItem {
    id: string;
    name: string;
    children: Node[];
  }

  it("ArrowDown after a click moves to the next node", scoped(async (scope) => {
    const { container, content } = await makeTree(scope, [
      { id: "a", name: "alpha", children: [] },
      { id: "b", name: "bravo", children: [] },
      { id: "c", name: "charlie", children: [] },
      { id: "d", name: "delta", children: [] },
    ], {}, (item) => item.name);

    // A real mouse click is not :focus-visible. happy-dom reports the
    // programmatic focus() inside the click as visible, which hides the jump.
    const hideFocusVisible = (el: HTMLElement): void => {
      const orig = el.matches.bind(el);
      el.matches = (selectors: string) => (selectors === ":focus-visible" ? false : orig(selectors));
    };
    hideFocusVisible(content);
    hideFocusVisible(container);
    const charlie = container.querySelector<HTMLElement>("[data-id='c']")!;
    charlie.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(focusedText(container)).toBeNull();

    press(content, "ArrowDown");
    expect(focusedText(container)).toBe("delta");
  }));
});

// =============================================================================
// Standalone focus ring
// =============================================================================

describe("tree — the focus ring without a selection plugin", () => {
  interface Node extends VListItem {
    id: string;
    name: string;
    children: Node[];
  }
  const nodes = (): Node[] => [
    { id: "a", name: "alpha", children: [] },
    { id: "b", name: "beta", children: [] },
  ];

  it("leaves with the focus, and stays while focus moves inside the list", scoped(async (scope) => {
    const { list, container, content } = await makeTree(scope, nodes(), {}, (item) => item.name);
    press(content, "ArrowDown");
    expect(focusedText(container)).toBe("alpha");
    expect(content.getAttribute("aria-activedescendant")).toBe("vlist-item-0");

    // Focus moving between two nodes of the same list is not a departure.
    list.element.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: content }));
    expect(focusedText(container)).toBe("alpha");

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    scope.defer(() => outside.remove());
    list.element.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));

    expect(focusedText(container)).toBeNull();
    expect(content.hasAttribute("aria-activedescendant")).toBe(false);
  }));
});

// =============================================================================
// parentId + loadChildren
// =============================================================================

describe("tree — a flat parentId list with lazily loaded children", () => {
  interface Row extends VListItem {
    id: string;
    name: string;
    parentId: string | null;
  }

  const rows = (): Row[] => [
    { id: "inbox", name: "Inbox", parentId: null },
    { id: "work", name: "Work", parentId: "inbox" },
    { id: "archive", name: "Archive", parentId: null },
  ];

  it("keeps the loaded children on screen when the flat list is replaced", scoped(async (scope) => {
    const { list, container } = await makeTree(
      scope,
      rows(),
      {
        parentId: "parentId",
        expanded: ["inbox"],
        loadChildren: async (item) =>
          item.id === "archive" ? [{ id: "2019", name: "2019", parentId: "archive" }] : [],
      },
      (item) => item.name,
    );
    list.expand("archive");
    await waitFor(() => rowTexts(container).includes("2019"), "the lazily loaded child row");
    expect(rowTexts(container)).toEqual(["Inbox", "Work", "Archive", "2019"]);

    // The server sends a fresh flat list: one more folder, still no rows for
    // what was loaded on demand.
    list.setItems([...rows(), { id: "spam", name: "Spam", parentId: null }]);
    await waitFor(() => rowTexts(container).includes("Spam"), "the replaced list to render");

    expect(rowTexts(container)).toEqual(["Inbox", "Work", "Archive", "2019", "Spam"]);
  }));
});
