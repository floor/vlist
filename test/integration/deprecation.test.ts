import { afterAll, beforeAll, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/core/create";
import { createVList as createSynthetic } from "../../src/synthetic";
import type { PluginContext } from "../../src/core/types";
import { createContainer } from "../helpers/factory";

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

it("scale warns once per process with the available synthetic migration and 2.x bounded option", () => {
  // A separate process isolates the once-only module state from config-entry tests.
  const result = Bun.spawnSync([process.execPath, "--eval", `
    import {scale} from ${JSON.stringify(new URL("../../src/plugins/scale/plugin.ts", import.meta.url).pathname)};
    import {GlobalRegistrator} from '@happy-dom/global-registrator';
    import {createVListFromConfig} from ${JSON.stringify(new URL("../../src/config.ts", import.meta.url).pathname)};
    GlobalRegistrator.register();
    const messages=[];
    console.warn=message=>messages.push(message);
    for (const mode of [undefined, 'bounded']) {
      const host=document.createElement('div');document.body.append(host);
      const list=createVListFromConfig({container:host,items:[{id:1}],item:{height:40,template:()=>''},scroll:{mode}});
      list.destroy();host.remove();
    }
    const implicit=messages.length;
    scale().setup();
    scale().setup();
    process.stdout.write(JSON.stringify({messages,implicit}));
    GlobalRegistrator.unregister();
  `]);
  expect(result.exitCode).toBe(0);
  const { messages, implicit } = JSON.parse(result.stdout.toString());
  expect(implicit).toBe(0);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('removed in vlist 3.0');
  expect(messages[0]).toContain('scroll: { mode: "synthetic" }');
  expect(messages[0]).toContain('vlist/synthetic');
  expect(messages[0]).toContain('bounded remains available in 2.x');
  expect(messages[0]).toContain('https://vlist.io/docs/rfcs/RFC-014-Scroll-Input-Model');
});

it("core and synthetic entry default/native/bounded configurations emit no warnings", () => {
  const original = console.warn;
  const warnings: unknown[] = [];
  console.warn = value => warnings.push(value);
  try {
    for (const create of [createVList, createSynthetic]) {
      for (const mode of [undefined, "native", "bounded"] as const) {
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

it("deprecated external scroll hooks still install a writer and disable viewport input", () => {
  const host = createContainer();
  let position = 0;
  let ctx!: PluginContext<{ id: number }>;
  const list = createVList({ container: host, items: [{ id: 1 }],
    item: { height: 40, template: () => "row" },
  }, [{ name: "external", setup(c) {
    ctx = c;
    c.setScrollFns(() => position, px => { position = px; });
    c.disableDefaultScroll();
  } }]);
  try {
    ctx.dom.viewport.scrollTop = 123;
    ctx.dom.viewport.dispatchEvent(new Event("scroll"));
    expect(ctx.getState().scrollPosition).toBe(0);
    ctx.scrollTo(200);
    expect(position).toBe(200);
    expect(list.getScrollPosition()).toBe(200);
  } finally { list.destroy(); host.remove(); }
});
