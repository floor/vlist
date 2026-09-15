import { afterAll, beforeAll, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/core/create";
import { createVList as createNative } from "../../src/native";
import { createVList as createSynthetic } from "../../src/synthetic";
import type { PluginContext } from "../../src/core/types";
import { createContainer } from "../helpers/factory";

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

it("core, alias and native entry supported configurations emit no warnings", () => {
  const original = console.warn;
  const warnings: unknown[] = [];
  console.warn = value => warnings.push(value);
  try {
    for (const create of [createVList, createSynthetic, createNative]) {
      for (const mode of (create === createNative ? [undefined, "native", "bounded"] : [undefined, "synthetic"]) as (undefined | "native" | "bounded" | "synthetic")[]) {
        const host = createContainer();
        const list = create({ container: host, items: [{ id: 1 }],
          item: { height: 40, template: () => "row" }, scroll: { mode },
        });
        list.destroy(); host.remove();
      }
    }
    expect(warnings).toHaveLength(0);
  } finally { console.warn = original; }
});

it("removed legacy scroll hooks are absent from the plugin context", () => {
  const host = createContainer();
  const list = createVList({ container: host, items: [{ id: 1 }],
    item: { height: 40, template: () => "row" },
  }, [{ name: "inspect", setup(ctx) {
    expect(ctx).not.toHaveProperty("setScrollFns");
    expect(ctx).not.toHaveProperty("disableDefaultScroll");
  } }]);
  list.destroy(); host.remove();
});
