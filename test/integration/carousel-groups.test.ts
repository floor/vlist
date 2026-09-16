/**
 * vlist — carousel with groups
 *
 * Two layout-tier plugins at the same priority, so setup order was array
 * order, and the combination failed differently depending on which the caller
 * happened to write first. Measured before it was declared:
 *
 *   carousel, groups → list.total reported 1012 for ten items (groups builds
 *                      its layout over carousel's 1,010 virtual indices plus
 *                      two headers, and overrides the virtual total)
 *   groups, carousel → total right, layout still built over 1,010 entries,
 *                      rendering started 750px down with six items drawn
 *
 * Mechanically: carousel assigns getTotalSize, getOffset, getSize and
 * indexAtOffset onto the size cache directly; groups calls setSizeConfig, and
 * core's implementation Object.assigns a fresh cache over exactly those four.
 * vlist.io's carousel page had documented the pair as incompatible all along.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { carousel } from "../../src/plugins/carousel/plugin";
import { groups } from "../../src/plugins/groups/plugin";

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  GlobalRegistrator.register();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});

afterAll(() => {
  geometry.restore();
  GlobalRegistrator.unregister();
});

let container: HTMLElement | null = null;

afterEach(() => {
  container?.remove();
  container = null;
});

const groupsConfig = {
  getGroupForIndex: (i: number) => (i < 5 ? "a" : "b"),
  header: { height: 30, template: (group: string) => `<div>${group}</div>` },
};

describe("carousel + groups", () => {
  it("throws at creation in either plugin order", () => {
    container = createContainer({ width: 300, height: 500 });
    const config = {
      container,
      items: createTestItems(10),
      item: { height: 50, template: simpleTemplate },
    };

    expect(() =>
      createVList<TestItem>(config, [carousel<TestItem>(), groups<TestItem>(groupsConfig)]),
    ).toThrow('Plugin "carousel" conflicts with "groups"');

    expect(() =>
      createVList<TestItem>(config, [groups<TestItem>(groupsConfig), carousel<TestItem>()]),
    ).toThrow('Plugin "carousel" conflicts with "groups"');

    expect(container.children.length).toBe(0);
  });

  it("leaves each plugin working on its own", () => {
    container = createContainer({ width: 300, height: 500 });
    const items = createTestItems(10);

    const alone = createVList<TestItem>(
      { container, items, item: { height: 50, template: simpleTemplate } },
      [carousel<TestItem>()],
    );
    expect(alone.total).toBe(10);
    alone.destroy();

    const grouped = createVList<TestItem>(
      { container, items, item: { height: 50, template: simpleTemplate } },
      [groups<TestItem>(groupsConfig)],
    );
    // The public total is the item count. The two headers are layout entries:
    // they render and take space, but list.total is what a consumer counts.
    // This expectation encoded the defect recorded as P9 — I wrote it here in
    // #180, asserting the behaviour rather than the contract.
    expect(grouped.total).toBe(10);
    grouped.destroy();
  });
});
