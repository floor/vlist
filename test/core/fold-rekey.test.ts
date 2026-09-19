/**
 * A wrap fold re-keys mounted elements instead of recreating the viewport.
 *
 * Crossing a lap boundary also crosses one item boundary for a fixed-size
 * spec, so one row may enter and one may leave. Without the re-key every
 * lookup misses and the whole window is re-templated.
 *
 * Each test owns its list and tears it down in `finally` so the file is
 * safe under `bun test --concurrent`. Focus tests are serial: they read
 * `document.activeElement`, which is one-per-process.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import { createVList as createSynthetic } from "../../src/synthetic";
import { createBoundedScrollHandler } from "../../src/core/runway";
import { carousel } from "../../src/plugins/carousel/plugin";
import type { PluginContext, VListPlugin } from "../../src/core/types";
import type { VListItem } from "../../src/types";

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  setupDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 400 });
});
afterAll(() => { geometry.restore(); teardownDOM(); });
afterAll(() => geometry.assertRestored());

function listbox<T extends VListItem>(): VListPlugin<T> {
  return { name: "listbox", setup(ctx) { ctx.dom.enableListbox(); } };
}

function mounted(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("[data-index]")];
}

function keptCount(before: HTMLElement[], after: HTMLElement[]): number {
  const seen = new Set(before);
  let kept = 0;
  for (const el of after) if (seen.has(el)) kept++;
  return kept;
}

function simulateScroll(viewport: HTMLElement, scrollTop: number): void {
  Object.defineProperty(viewport, "scrollTop", { value: scrollTop, writable: true, configurable: true });
  viewport.dispatchEvent(new Event("scroll", { bubbles: false }));
}

function wrapPlugin(realTotal: number): VListPlugin<{ id: number }> {
  const step = 50;
  const virtualTotal = realTotal * 11;
  const lapSize = step * realTotal;
  const mod = (i: number): number => ((i % realTotal) + realTotal) % realTotal;
  return {
    name: "wrap-test",
    priority: 10,
    setup(ctx): void {
      const es = ctx.getState();
      ctx.items.setGetFn((i) => ctx.items.all()[mod(i)]);
      ctx.sizes.cache.getTotalSize = (): number => virtualTotal * step;
      ctx.sizes.cache.getOffset = (index): number => index * step;
      ctx.sizes.cache.getSize = (): number => step;
      ctx.sizes.cache.indexAtOffset = (off): number =>
        Math.max(0, Math.min(Math.floor(off / step), virtualTotal - 1));
      ctx.sizes.cache.getTotal = (): number => virtualTotal;
      es.totalItems = virtualTotal;
      ctx.items.setTotalFn(() => realTotal);
      ctx.items.setIndexMapFn(mod);
      ctx.scroll.setBoundedWrap({
        lapSize: () => lapSize,
        itemsPerLap: () => realTotal,
        home: () => 5 * lapSize,
        thresholdLaps: 3,
      }, createBoundedScrollHandler);
      ctx.hooks.method("jump", (px: number) => ctx.scroll.to(px));
    },
  };
}

type Create = typeof createVList | typeof createSynthetic;

function fixture(
  create: Create,
  opts: {
    plugins?: VListPlugin<{ id: number }>[];
    classPrefix?: string;
    striped?: boolean;
    count?: number;
    height?: number;
    template?: (item: { id: number }) => string | HTMLElement;
  } = {},
): {
  host: HTMLElement;
  list: ReturnType<Create>;
  ctx: PluginContext<{ id: number }>;
  dispose(): void;
} {
  const host = document.createElement("div");
  document.body.append(host);
  let ctx!: PluginContext<{ id: number }>;
  const list = create({
    container: host,
    ...(opts.classPrefix ? { classPrefix: opts.classPrefix } : {}),
    items: Array.from({ length: opts.count ?? 10 }, (_, id) => ({ id })),
    item: {
      height: opts.height ?? 100,
      ...(opts.striped ? { striped: true as const } : {}),
      template: opts.template ?? ((item) => String(item.id)),
    },
  }, [...(opts.plugins ?? [carousel({ variant: "free", snap: false }), listbox()]), { name: "inspect", setup(c) { ctx = c; } }]);
  return {
    host,
    list,
    ctx,
    dispose(): void {
      list.destroy();
      host.remove();
    },
  };
}

const entries = [["native", createVList], ["synthetic", createSynthetic]] as const;

for (const [entry, create] of entries) for (const direction of [1, -1] as const) {
  test(`${entry}: a ${direction > 0 ? "forward" : "reverse"} fold re-keys mounted elements`, () => {
    let templates = 0;
    const f = fixture(create, {
      template: (item) => { templates++; return String(item.id); },
    });
    try {
      f.ctx.scroll.to(direction > 0 ? 89980 : 10020);
      const before = mounted(f.host);
      expect(before.length).toBeGreaterThan(0);
      const snapshot = before.map((el) => ({
        el,
        publicIndex: el.getAttribute("data-index"),
        posinset: el.getAttribute("aria-posinset"),
        id: el.id,
      }));
      const tracked = snapshot[snapshot.length >> 1]!;
      f.ctx.dom.content.setAttribute("aria-activedescendant", tracked.id);
      templates = 0;
      const added: Node[] = [];
      const removed: Node[] = [];
      const observer = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type !== "childList") continue;
          added.push(...r.addedNodes);
          removed.push(...r.removedNodes);
        }
      });
      observer.observe(f.ctx.dom.content, { childList: true });

      f.ctx.dom.viewport.dispatchEvent(new WheelEvent("wheel", {
        deltaY: direction * 40, cancelable: true,
      }));
      for (const r of observer.takeRecords()) {
        if (r.type !== "childList") continue;
        added.push(...r.addedNodes);
        removed.push(...r.removedNodes);
      }
      observer.disconnect();

      expect(f.list.getScrollPosition()).toBe(direction > 0 ? 50020 : 49980);
      const after = mounted(f.host);
      const kept = keptCount(before, after);
      expect(removed.filter((n) => added.includes(n))).toEqual([]);
      expect(kept).toBeGreaterThanOrEqual(before.length - 2);
      expect(templates).toBeLessThan(3);

      expect(tracked.el.isConnected).toBe(true);
      expect(tracked.el.getAttribute("data-index")).toBe(tracked.publicIndex);
      expect(tracked.el.getAttribute("aria-posinset")).toBe(tracked.posinset);
      expect(tracked.el.id).not.toBe(tracked.id);
      expect(tracked.el.id.startsWith("vlist-item-")).toBe(true);
      expect(f.ctx.dom.content.getAttribute("aria-activedescendant")).toBe(tracked.el.id);
    } finally {
      f.dispose();
    }
  });
}

for (const [entry, create] of entries) {
  // Serial: `document.activeElement` is one-per-process.
  test.serial(`${entry}: focus inside an item survives a fold`, () => {
    const f = fixture(create, {
      plugins: [carousel({ variant: "free", snap: false })],
      template: (item) => {
        const root = document.createElement("div");
        root.append(String(item.id));
        const input = document.createElement("input");
        input.className = "keep-focus";
        root.append(input);
        return root;
      },
    });
    try {
      f.ctx.scroll.to(89980);
      const rows = mounted(f.host);
      const item = rows[rows.length >> 1]!;
      const input = item.querySelector<HTMLInputElement>(".keep-focus")!;
      input.focus();

      f.ctx.dom.viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, cancelable: true }));

      expect(f.list.getScrollPosition()).toBe(50020);
      expect(item.isConnected).toBe(true);
      expect(input.isConnected).toBe(true);
      expect(f.host.contains(input)).toBe(true);
      if (document.activeElement === input || document.activeElement === item) {
        expect(item.contains(document.activeElement)).toBe(true);
      }
    } finally {
      f.dispose();
    }
  });
}

test("native wrap plugin: a forced fold re-keys instead of remounting", () => {
  const f = fixture(createVList, {
    plugins: [wrapPlugin(5), listbox()],
    count: 5,
    height: 50,
  });
  try {
    const viewport = f.host.querySelector<HTMLElement>(".vlist-viewport")!;
    (f.list as unknown as { jump(px: number): void }).jump(5 * 250);
    simulateScroll(viewport, 500);
    simulateScroll(viewport, 500);

    const before = mounted(f.host);
    const tracked = before[before.length >> 1]!;
    const publicIndex = tracked.getAttribute("data-index");
    const oldId = tracked.id;
    simulateScroll(viewport, 500);

    expect(f.list.getScrollPosition()).toBe(1250);
    const after = mounted(f.host);
    expect(keptCount(before, after)).toBeGreaterThanOrEqual(before.length - 6);
    expect(tracked.isConnected).toBe(true);
    expect(tracked.getAttribute("data-index")).toBe(publicIndex);
    expect(tracked.id).not.toBe(oldId);
  } finally {
    f.dispose();
  }
});

test("synthetic wrap plugin: a forced fold re-keys instead of remounting", () => {
  const f = fixture(createSynthetic, {
    plugins: [wrapPlugin(5), listbox()],
    count: 5,
    height: 50,
  });
  try {
    f.ctx.scroll.to(5 * 250 + 3 * 250 - 20);
    const before = mounted(f.host);
    const tracked = before[before.length >> 1]!;
    const publicIndex = tracked.getAttribute("data-index");
    const oldId = tracked.id;
    f.ctx.dom.viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, cancelable: true }));

    expect(f.list.getScrollPosition()).toBe(1270);
    const after = mounted(f.host);
    expect(keptCount(before, after)).toBeGreaterThanOrEqual(before.length - 2);
    expect(tracked.isConnected).toBe(true);
    expect(tracked.getAttribute("data-index")).toBe(publicIndex);
    expect(tracked.id).not.toBe(oldId);
  } finally {
    f.dispose();
  }
});

test("a classPrefix containing '-content' still rewrites ids on a fold", () => {
  const f = fixture(createVList, { classPrefix: "my-content" });
  try {
    f.ctx.scroll.to(89980);
    const before = mounted(f.host);
    const tracked = before[before.length >> 1]!;
    expect(tracked.id.startsWith("my-content-item-")).toBe(true);
    f.ctx.dom.content.setAttribute("aria-activedescendant", tracked.id);
    const oldId = tracked.id;

    f.ctx.dom.viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, cancelable: true }));

    expect(f.list.getScrollPosition()).toBe(50020);
    expect(tracked.isConnected).toBe(true);
    expect(tracked.id).not.toBe(oldId);
    expect(tracked.id.startsWith("my-content-item-")).toBe(true);
    expect(f.ctx.dom.content.getAttribute("aria-activedescendant")).toBe(tracked.id);
  } finally {
    f.dispose();
  }
});

test("odd realTotal, odd lap fold: stripe parity follows the new virtual index", () => {
  const f = fixture(createSynthetic, {
    plugins: [wrapPlugin(5), listbox()],
    count: 5,
    height: 50,
    striped: true,
  });
  try {
    f.ctx.scroll.to(5 * 250 + 3 * 250 - 20);
    const before = mounted(f.host);
    const tracked = before[before.length >> 1]!;
    const wasOdd = tracked.classList.contains("vlist-item--odd");
    f.ctx.dom.viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, cancelable: true }));

    expect(f.list.getScrollPosition()).toBe(1270);
    expect(tracked.isConnected).toBe(true);
    expect(tracked.classList.contains("vlist-item--odd")).toBe(!wasOdd);
    const prefix = "vlist-item-";
    for (const el of mounted(f.host)) {
      const vi = Number(el.id.slice(prefix.length));
      expect(Number.isInteger(vi)).toBe(true);
      expect(el.classList.contains("vlist-item--odd")).toBe((vi & 1) === 1);
    }
  } finally {
    f.dispose();
  }
});
