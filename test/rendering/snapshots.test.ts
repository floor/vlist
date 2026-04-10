/**
 * vlist/rendering — DOM Structure Snapshot Tests (#14c)
 *
 * Verifies the DOM tree structure (element nesting, roles, classes,
 * attributes) for each major configuration:
 *
 *   1. Base list (vertical)
 *   2. Base list (horizontal)
 *   3. Grid layout (withGrid)
 *   4. Groups layout (withGroups)
 *   5. Masonry layout (withMasonry)
 *   6. Table layout (withTable)
 *
 * These tests catch subtle regressions like missing ARIA attributes,
 * wrong nesting, or changed class names that element-count tests miss.
 *
 * Snapshot format: a serialised HTML-like string of the DOM tree with
 * only structural information (tag, class, role, aria-*, data-*).
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "bun:test";

import { vlist } from "../../src/builder/core";
import type { VList } from "../../src/builder/types";
import type { VListItem } from "../../src/types";
import { withGrid } from "../../src/features/grid/feature";
import { withGroups } from "../../src/features/groups/feature";
import { withMasonry } from "../../src/features/masonry/feature";
import { withTable } from "../../src/features/table/feature";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";

// =============================================================================
// JSDOM Setup
// =============================================================================

beforeAll(() => setupDOM({ width: 300, height: 500 }));
afterAll(() => teardownDOM());

// =============================================================================
// Snapshot Serialiser
// =============================================================================

/** Attributes worth capturing in snapshots (order-stable). */
const SNAPSHOT_ATTRS = [
  "class",
  "role",
  "tabindex",
  "aria-label",
  "aria-live",
  "aria-atomic",
  "aria-orientation",
  "aria-selected",
  "aria-setsize",
  "aria-posinset",
  "aria-colcount",
  "aria-colindex",
  "aria-activedescendant",
  "data-index",
  "data-id",
  "data-group",
  "data-column",
];

/**
 * Serialise an element tree into an indented, attribute-annotated string.
 *
 * Only structural attributes are included — inline styles and dynamic IDs
 * (which change per test run) are excluded so snapshots are stable.
 *
 * @param el       The root element to serialise.
 * @param depth    Current indentation depth.
 * @param maxDepth Maximum depth to recurse (default 6).
 * @param maxItems Maximum child items to include before truncating.
 */
const serialiseDOM = (
  el: Element,
  depth: number = 0,
  maxDepth: number = 6,
  maxItems: number = 20,
): string => {
  const indent = "  ".repeat(depth);
  const tag = el.tagName.toLowerCase();

  // Collect relevant attributes
  const attrs: string[] = [];
  for (const name of SNAPSHOT_ATTRS) {
    const value = el.getAttribute(name);
    if (value !== null) {
      attrs.push(`${name}="${value}"`);
    }
  }

  const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
  const open = `${indent}<${tag}${attrStr}>`;

  if (depth >= maxDepth) {
    return `${open}…</${tag}>`;
  }

  const children = Array.from(el.children);
  if (children.length === 0) {
    return `${open}</${tag}>`;
  }

  const lines: string[] = [open];
  const limit = Math.min(children.length, maxItems);
  for (let i = 0; i < limit; i++) {
    lines.push(serialiseDOM(children[i]!, depth + 1, maxDepth, maxItems));
  }
  if (children.length > maxItems) {
    lines.push(`${"  ".repeat(depth + 1)}… (${children.length - maxItems} more)`);
  }
  lines.push(`${indent}</${tag}>`);
  return lines.join("\n");
};

// =============================================================================
// Helpers
// =============================================================================

const template = (item: TestItem): string =>
  `<span>${item.name}</span>`;

let activeList: VList<TestItem> | null = null;
let activeContainer: HTMLElement | null = null;

afterEach(() => {
  if (activeList) {
    activeList.destroy();
    activeList = null;
  }
  if (activeContainer) {
    activeContainer.remove();
    activeContainer = null;
  }
});

// =============================================================================
// 1. Base list — vertical
// =============================================================================

describe("DOM Snapshots", () => {
  it("base list (vertical) has correct structure", () => {
    activeContainer = createContainer();
    activeList = vlist<TestItem>({
      container: activeContainer,
      item: { height: 40, template },
      items: createTestItems(20),
    }).build();

    const snap = serialiseDOM(activeList.element);

    // Root element
    expect(snap).toContain('<div class="vlist"');
    expect(snap).toContain('tabindex="0"');

    // Viewport
    expect(snap).toContain('class="vlist-viewport"');
    expect(snap).toContain('tabindex="-1"');

    // Content
    expect(snap).toContain('class="vlist-content"');

    // Items container with listbox role
    expect(snap).toContain('class="vlist-items"');
    expect(snap).toContain('role="listbox"');

    // ARIA live region
    expect(snap).toContain('class="vlist-live"');
    expect(snap).toContain('aria-live="polite"');
    expect(snap).toContain('aria-atomic="true"');
    expect(snap).toContain('role="status"');

    // Individual items
    expect(snap).toContain('class="vlist-item"');
    expect(snap).toContain('role="option"');
    expect(snap).toContain('aria-selected="false"');
    expect(snap).toContain('data-index=');
    expect(snap).toContain('data-id=');
    expect(snap).toContain('aria-setsize=');
    expect(snap).toContain('aria-posinset=');
  });

  it("base list nesting: root > (liveRegion + viewport > content > items > item*)", () => {
    activeContainer = createContainer();
    activeList = vlist<TestItem>({
      container: activeContainer,
      item: { height: 40, template },
      items: createTestItems(5),
    }).build();

    const root = activeList.element;

    // root > liveRegion + viewport
    const liveRegion = root.querySelector(".vlist-live");
    expect(liveRegion).not.toBeNull();
    expect(liveRegion!.parentElement).toBe(root);

    const viewport = root.querySelector(".vlist-viewport") as HTMLElement;
    expect(viewport).not.toBeNull();
    expect(viewport!.parentElement).toBe(root);

    // viewport > content > items
    const content = root.querySelector(".vlist-content") as HTMLElement;
    expect(content).not.toBeNull();
    expect(content!.parentElement).toBe(viewport);

    const items = root.querySelector(".vlist-items") as HTMLElement;
    expect(items).not.toBeNull();
    expect(items!.parentElement).toBe(content);

    // items have data-index
    const renderedItems = items!.querySelectorAll("[data-index]");
    expect(renderedItems.length).toBeGreaterThan(0);
    for (const item of renderedItems) {
      expect((item as HTMLElement).parentElement).toBe(items);
      expect(item.getAttribute("role")).toBe("option");
    }
  });

  // ===========================================================================
  // 2. Base list — horizontal
  // ===========================================================================

  it("base list (horizontal) has correct structure and orientation", () => {
    activeContainer = createContainer();
    activeList = vlist<TestItem>({
      container: activeContainer,
      orientation: "horizontal",
      item: { width: 100, height: 40, template },
      items: createTestItems(20),
    }).build();

    const snap = serialiseDOM(activeList.element);

    // Root has horizontal modifier
    expect(snap).toContain('class="vlist vlist--horizontal"');

    // Items container has horizontal orientation
    expect(snap).toContain('aria-orientation="horizontal"');

    // Still has listbox role
    expect(snap).toContain('role="listbox"');
  });

  // ===========================================================================
  // 3. Grid layout
  // ===========================================================================

  it("grid layout has correct structure", () => {
    activeContainer = createContainer();
    activeList = vlist<TestItem>({
      container: activeContainer,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(withGrid({ columns: 3 }))
      .build();

    const root = activeList.element;

    // Root structure still present
    expect(root.querySelector(".vlist-viewport")).not.toBeNull();
    expect(root.querySelector(".vlist-content")).not.toBeNull();
    expect(root.querySelector(".vlist-items")).not.toBeNull();

    // Items rendered
    const renderedItems = root.querySelectorAll("[data-index]");
    expect(renderedItems.length).toBeGreaterThan(0);

    // The items container should have role="listbox" (grid uses listbox, not grid role)
    const itemsContainer = root.querySelector(".vlist-items");
    expect(itemsContainer!.getAttribute("role")).toBe("listbox");

    // Snapshot for visual review — root class includes "vlist" (may have modifiers)
    const snap = serialiseDOM(root);
    expect(snap).toContain('class="vlist');
  });

  // ===========================================================================
  // 4. Groups layout
  // ===========================================================================

  it("groups layout has correct structure with headers", () => {
    const items = createTestItems(12);

    activeContainer = createContainer();
    activeList = vlist<TestItem>({
      container: activeContainer,
      item: { height: 40, template },
      items,
    })
      .use(
        withGroups({
          getGroupForIndex: (index) => (index < 4 ? "A" : index < 8 ? "B" : "C"),
          header: { height: 30, template: (group) => `<strong>${group}</strong>` },
        }),
      )
      .build();

    const root = activeList.element;
    const snap = serialiseDOM(root);

    // Root structure — groups adds --grouped modifier
    expect(snap).toContain('class="vlist');
    expect(snap).toContain('role="listbox"');

    // Should have rendered items (group headers + data items)
    const allRendered = root.querySelectorAll("[data-index]");
    expect(allRendered.length).toBeGreaterThan(0);

    // Verify items container
    const itemsContainer = root.querySelector(".vlist-items");
    expect(itemsContainer).not.toBeNull();
  });

  // ===========================================================================
  // 5. Masonry layout
  // ===========================================================================

  it("masonry layout has correct structure", () => {
    activeContainer = createContainer();
    activeList = vlist<TestItem>({
      container: activeContainer,
      item: {
        height: (index) => 40 + (index % 3) * 20,
        template,
      },
      items: createTestItems(20),
    })
      .use(withMasonry({ columns: 3 }))
      .build();

    const root = activeList.element;
    const snap = serialiseDOM(root);

    // Root structure still present (masonry adds --masonry modifier)
    expect(snap).toContain('class="vlist');
    expect(root.querySelector(".vlist-viewport")).not.toBeNull();
    expect(root.querySelector(".vlist-content")).not.toBeNull();
    expect(root.querySelector(".vlist-items")).not.toBeNull();

    // Masonry items rendered
    const renderedItems = root.querySelectorAll("[data-index]");
    expect(renderedItems.length).toBeGreaterThan(0);

    // Items container role is listbox (masonry doesn't change it)
    const itemsContainer = root.querySelector(".vlist-items");
    expect(itemsContainer!.getAttribute("role")).toBe("listbox");
  });

  // ===========================================================================
  // 6. Table layout
  // ===========================================================================

  it("table layout has correct ARIA grid structure", () => {
    activeContainer = createContainer();
    activeList = vlist<TestItem>({
      container: activeContainer,
      item: { height: 40, template },
      items: createTestItems(20),
    })
      .use(
        withTable({
          columns: [
            { key: "id", label: "ID", width: 60 },
            { key: "name", label: "Name", width: 200 },
          ],
          rowHeight: 40,
        }),
      )
      .build();

    const root = activeList.element;
    const snap = serialiseDOM(root);

    // Table promotes root role to "grid" (set on dom.root itself, not a child)
    expect(root.getAttribute("role")).toBe("grid");

    // Should have aria-colcount
    expect(snap).toContain("aria-colcount=");

    // Table header should exist
    const header = root.querySelector('[class*="table-header"]');
    expect(header).not.toBeNull();

    // Row groups
    const rowGroups = root.querySelectorAll('[role="rowgroup"]');
    expect(rowGroups.length).toBeGreaterThan(0);

    // Grid cells
    const cells = root.querySelectorAll('[role="gridcell"]');
    expect(cells.length).toBeGreaterThan(0);

    // Each cell should have aria-colindex
    for (const cell of cells) {
      expect(cell.getAttribute("aria-colindex")).not.toBeNull();
    }

    // Rows
    const rows = root.querySelectorAll('[role="row"]');
    expect(rows.length).toBeGreaterThan(0);
  });

  // ===========================================================================
  // 7. Aria label propagation
  // ===========================================================================

  it("ariaLabel is set on items container", () => {
    activeContainer = createContainer();
    activeList = vlist<TestItem>({
      container: activeContainer,
      item: { height: 40, template },
      items: createTestItems(5),
      ariaLabel: "Test List",
    }).build();

    const itemsContainer = activeList.element.querySelector(".vlist-items");
    expect(itemsContainer!.getAttribute("aria-label")).toBe("Test List");
  });

  // ===========================================================================
  // 8. Custom class prefix
  // ===========================================================================

  it("custom classPrefix is applied to all elements", () => {
    activeContainer = createContainer();
    activeList = vlist<TestItem>({
      container: activeContainer,
      classPrefix: "mylist",
      item: { height: 40, template },
      items: createTestItems(5),
    }).build();

    const root = activeList.element;
    expect(root.className).toContain("mylist");
    expect(root.querySelector(".mylist-viewport")).not.toBeNull();
    expect(root.querySelector(".mylist-content")).not.toBeNull();
    expect(root.querySelector(".mylist-items")).not.toBeNull();
    expect(root.querySelector(".mylist-live")).not.toBeNull();

    // Items use the custom prefix
    const items = root.querySelectorAll(".mylist-item");
    expect(items.length).toBeGreaterThan(0);
  });

  // ===========================================================================
  // 9. Serialisation stability — full snapshots
  // ===========================================================================

  it("base list snapshot is stable across builds", () => {
    // Build twice with identical config, verify identical snapshots
    const container1 = createContainer();
    const list1 = vlist<TestItem>({
      container: container1,
      item: { height: 40, template },
      items: createTestItems(5),
    }).build();

    const container2 = createContainer();
    const list2 = vlist<TestItem>({
      container: container2,
      item: { height: 40, template },
      items: createTestItems(5),
    }).build();

    // Serialise with stable attrs only (no IDs)
    const snap1 = serialiseDOM(list1.element);
    const snap2 = serialiseDOM(list2.element);

    // Strip per-instance aria IDs (vlist-N-item-N) to compare structure
    const normalise = (s: string) =>
      s.replace(/vlist-\d+-item-\d+/g, "vlist-X-item-X");

    expect(normalise(snap1)).toBe(normalise(snap2));

    list1.destroy();
    list2.destroy();
    container1.remove();
    container2.remove();
  });

  // ===========================================================================
  // 10. Item attributes completeness
  // ===========================================================================

  it("each rendered item has all required ARIA attributes", () => {
    activeContainer = createContainer();
    activeList = vlist<TestItem>({
      container: activeContainer,
      item: { height: 40, template },
      items: createTestItems(10),
    }).build();

    const items = activeList.element.querySelectorAll("[data-index]");
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      const el = item as HTMLElement;

      // Must have role="option"
      expect(el.getAttribute("role")).toBe("option");

      // Must have aria-selected
      expect(el.hasAttribute("aria-selected")).toBe(true);

      // Must have aria-setsize and aria-posinset
      expect(el.hasAttribute("aria-setsize")).toBe(true);
      expect(el.hasAttribute("aria-posinset")).toBe(true);

      // Must have data-index and data-id
      expect(el.hasAttribute("data-index")).toBe(true);
      expect(el.hasAttribute("data-id")).toBe(true);

      // aria-posinset should be index + 1 (1-based)
      const index = parseInt(el.dataset.index!, 10);
      const posinset = parseInt(el.getAttribute("aria-posinset")!, 10);
      expect(posinset).toBe(index + 1);

      // aria-setsize should equal total items
      const setsize = parseInt(el.getAttribute("aria-setsize")!, 10);
      expect(setsize).toBe(10);
    }
  });
});