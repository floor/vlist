/**
 * The plugin method bus: public names are a contract, internal underscore names
 * are the cross-plugin protocol, and a scroll requested before the list has a
 * total lands on the layout the plugins rebuild for the new items.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createContainer, createTestItems, simpleTemplate } from "../helpers";
import { createVList } from "../../src/core/create";
import { grid } from "../../src/plugins/grid";
import { masonry } from "../../src/plugins/masonry";
import { groups } from "../../src/plugins/groups";
import type { PluginContext, VListPlugin } from "../../src/core/types";
import type { VListItem } from "../../src/types";

interface TestItem extends VListItem {
  id: number;
}

let container: HTMLElement;
let consoleError: typeof console.error;

beforeAll(setupDOM);
afterAll(teardownDOM);
beforeEach(() => {
  container = createContainer({ width: 300, height: 500 });
  consoleError = console.error;
  console.error = mock(() => {});
});
afterEach(() => {
  console.error = consoleError;
  container.remove();
});

/** Captures the error event, which fires before createVList returns. */
const errorSpy = (): { plugin: VListPlugin<TestItem>; calls: { error: Error; context: string }[] } => {
  const calls: { error: Error; context: string }[] = [];
  return {
    calls,
    plugin: {
      name: "error-listener",
      priority: 0,
      setup(ctx: PluginContext<TestItem>): void {
        ctx.emitter.on("error", (payload: never) => calls.push(payload as unknown as { error: Error; context: string }));
      },
    },
  };
};

describe("method bus — public names", () => {
  it("rejects a second plugin claiming a public name", () => {
    const spy = errorSpy();
    const first: VListPlugin<TestItem> = { name: "first", setup: (ctx) => ctx.hooks.method("doThing", () => "first") };
    const second: VListPlugin<TestItem> = { name: "second", setup: (ctx) => ctx.hooks.method("doThing", () => "second") };

    const list = createVList<TestItem>(
      { container, items: createTestItems(5) as TestItem[], item: { height: 40, template: simpleTemplate } },
      [spy.plugin, first, second],
    );

    const failure = spy.calls.find((c) => c.context === "plugin:setup:second");
    expect(failure).toBeDefined();
    expect(failure!.error.message).toContain('duplicate method "doThing"');
    // The first plugin keeps the name; the loser does not overwrite it.
    expect((list as unknown as { doThing(): string }).doThing()).toBe("first");
    list.destroy();
  });

  it("reports a failed setup on the console as well as the event", () => {
    const boom: VListPlugin<TestItem> = { name: "boom", setup: () => { throw new Error("kaboom"); } };
    const list = createVList<TestItem>(
      { container, items: createTestItems(5) as TestItem[], item: { height: 40, template: simpleTemplate } },
      [boom],
    );
    expect(console.error).toHaveBeenCalled();
    list.destroy();
  });

  it("allows plugins to override an internal underscore name", () => {
    const spy = errorSpy();
    const provider: VListPlugin<TestItem> = { name: "provider", setup: (ctx) => ctx.hooks.method("_shared", () => "provider") };
    const overrider: VListPlugin<TestItem> = { name: "overrider", setup: (ctx) => ctx.hooks.method("_shared", () => "overrider") };
    let seen: unknown;
    const reader: VListPlugin<TestItem> = {
      name: "reader", priority: 90,
      setup: (ctx) => { seen = (ctx.hooks.get("_shared") as (() => string) | undefined)?.(); },
    };

    const list = createVList<TestItem>(
      { container, items: createTestItems(5) as TestItem[], item: { height: 40, template: simpleTemplate } },
      [spy.plugin, provider, overrider, reader],
    );

    expect(spy.calls.filter((c) => c.context.startsWith("plugin:setup:"))).toHaveLength(0);
    expect(seen).toBe("overrider");
    list.destroy();
  });

  it("keeps internal methods off the public instance", () => {
    const provider: VListPlugin<TestItem> = {
      name: "provider",
      setup: (ctx) => {
        ctx.hooks.method("_secret", () => 42);
        ctx.hooks.method("publicThing", () => 1);
      },
    };
    const list = createVList<TestItem>(
      { container, items: createTestItems(5) as TestItem[], item: { height: 40, template: simpleTemplate } },
      [provider],
    );
    expect("_secret" in (list as unknown as Record<string, unknown>)).toBe(false);
    expect("publicThing" in (list as unknown as Record<string, unknown>)).toBe(true);
    list.destroy();
  });
});

describe("method bus — a scroll held before the total is known", () => {
  const scenarios: Array<[string, () => VListPlugin<TestItem>[]]> = [
    ["no plugins", () => []],
    ["grid", () => [grid<TestItem>({ columns: 4 })]],
    ["masonry", () => [masonry<TestItem>({ columns: 4 })]],
    ["groups", () => [groups<TestItem>({ getGroupForIndex: (i: number) => `g${Math.floor(i / 10)}`, header: { height: 30, template: (key: string) => key } })]],
  ];

  for (const [label, makePlugins] of scenarios) {
    it(`lands where the same request lands with items present: ${label}`, () => {
      const held = createVList<TestItem>(
        { container, item: { height: 100, template: simpleTemplate } },
        makePlugins(),
      );
      held.scrollToIndex(300, "start");
      held.setItems(createTestItems(400) as TestItem[]);
      const heldPosition = held.getScrollPosition();
      held.destroy();

      const second = createContainer({ width: 300, height: 500 });
      const direct = createVList<TestItem>(
        { container: second, items: createTestItems(400) as TestItem[], item: { height: 100, template: simpleTemplate } },
        makePlugins(),
      );
      direct.scrollToIndex(300, "start");
      const directPosition = direct.getScrollPosition();
      direct.destroy();
      second.remove();

      expect(heldPosition).toBe(directPosition);
      expect(heldPosition).toBeGreaterThan(0);
    });
  }
});
