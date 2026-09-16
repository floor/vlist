/**
 * vlist — A plugin rejecting the list's configuration
 *
 * Two failures look alike from inside `createVList` and must not behave alike.
 *
 * A plugin that *throws while wiring itself* is a fault: it is caught, reported
 * as an `error` event, and the remaining plugins still set up, so one bad plugin
 * cannot take the list down. A plugin that *cannot serve this configuration at
 * all* — `table()` under `reverse`, `masonry()` under `reverse` — is a
 * programming error, and returning a plausible-looking list that silently isn't
 * a table is worse than failing.
 *
 * Those had collapsed into one behaviour: making setup errors observable
 * wrapped every setup in a catch, so the rejections became an `error` event
 * fired before `createVList` returns, which no caller can hear. The list came
 * back half wired, rendering ordinary rows.
 *
 * The rejections now run in `validateConfig()`, beside the declared-conflict
 * check and outside the catch. The last test here pins the other half of the
 * boundary, so neither behaviour can be "fixed" by breaking the other.
 */

import { describe, it, expect, mock, beforeAll, afterAll, afterEach } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/core/create";
import type { VList, VListPlugin, PluginContext } from "../../src/core/types";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { table } from "../../src/plugins/table/plugin";
import { masonry } from "../../src/plugins/masonry/plugin";

let geometry: ReturnType<typeof capturePrototypeGeometry>;
/** The last test throws from setup on purpose; core logs that, which is expected. */
let consoleError: typeof console.error;

beforeAll(() => {
  GlobalRegistrator.register();
  consoleError = console.error;
  console.error = mock(() => {});
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 400; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 300; }, configurable: true });
});
afterAll(() => {
  console.error = consoleError;
  geometry.restore();
  GlobalRegistrator.unregister();
});
afterAll(() => geometry.assertRestored());

let list: VList<TestItem> | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  list?.destroy();
  list = null;
  container?.remove();
  container = null;
});

const COLUMNS = [{ key: "id" as const, label: "ID", width: 100 }];

function build(extra: Record<string, unknown>, plugins: VListPlugin<TestItem>[]): VList<TestItem> {
  container = createContainer({ width: 300, height: 400 });
  return createVList<TestItem>(
    { container, items: createTestItems(20), item: { height: 40, template: simpleTemplate }, ...extra },
    plugins,
  );
}

describe("a plugin that cannot serve the configuration", () => {
  it("throws for table() under reverse, at createVList", () => {
    // Was: no throw, and a list rendering 15 ordinary rows.
    expect(() => build({ reverse: true }, [table({ columns: COLUMNS, rowHeight: 40 })]))
      .toThrow("cannot be used with reverse mode");
  });

  it("throws for table() under horizontal orientation, at createVList", () => {
    expect(() => build({ orientation: "horizontal" }, [table({ columns: COLUMNS, rowHeight: 40 })]))
      .toThrow("cannot be used with horizontal orientation");
  });

  it("throws for masonry() under reverse, at createVList", () => {
    expect(() => build({ reverse: true }, [masonry({ columns: 2 })]))
      .toThrow("cannot be combined with reverse mode");
  });

  it("still builds when the configuration is supported", () => {
    list = build({}, [table({ columns: COLUMNS, rowHeight: 40 })]);
    expect(container!.querySelectorAll("[data-index]").length).toBeGreaterThan(0);
  });
});

describe("a plugin that throws while wiring itself", () => {
  it("is reported, not fatal, and the plugins after it still set up", () => {
    const seen: string[] = [];
    const listener: VListPlugin<TestItem> = {
      name: "listener",
      priority: 1,
      setup(ctx: PluginContext<TestItem>): void {
        ctx.emitter.on("error", (e: { context: string }) => seen.push(e.context));
      },
    };
    const boom: VListPlugin<TestItem> = {
      name: "boom",
      priority: 10,
      setup(): void { throw new Error("kaboom"); },
    };
    let laterRan = false;
    const later: VListPlugin<TestItem> = {
      name: "later",
      priority: 20,
      setup(): void { laterRan = true; },
    };

    // The other half of the boundary: a fault is absorbed, a rejection is not.
    expect(() => { list = build({}, [listener, boom, later]); }).not.toThrow();
    expect(seen).toContain("plugin:setup:boom");
    expect(laterRan).toBe(true);
  });
});
