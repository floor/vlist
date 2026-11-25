import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { registerDOM, unregisterDOM } from "../../helpers/dom";
import { createPluginMockContext } from "../../helpers/plugin-context";
import { scrollbar } from "../../../src/plugins/scrollbar/plugin";
import { scrollbarGutter } from "../../../src/plugins/scrollbar/scrollbar";

beforeAll(() => { registerDOM(); });
afterAll(() => { unregisterDOM(); });

describe("scrollbarGutter", () => {
  it("is classic when the bar takes width and overlay when it does not", () => {
    expect(scrollbarGutter({ offsetWidth: 100, clientWidth: 85 })).toBe(true);
    expect(scrollbarGutter({ offsetWidth: 100, clientWidth: 100 })).toBe(false);
    expect(scrollbarGutter({ offsetWidth: 0, clientWidth: 0 })).toBe(false);
  });
});

describe("classic table scrollbar", () => {
  const gutterOf = (el: HTMLElement, fallback: PropertyDescriptor | undefined): number => {
    if (el.style.overflow === "scroll") return 0;
    const get = fallback?.get;
    return get ? get.call(el) : 0;
  };

  const withProbe = (gutter: number, run: () => void): void => {
    const proto = HTMLElement.prototype;
    const offset = Object.getOwnPropertyDescriptor(proto, "offsetWidth");
    const client = Object.getOwnPropertyDescriptor(proto, "clientWidth");
    Object.defineProperty(proto, "offsetWidth", {
      configurable: true,
      get() { return this.style.overflow === "scroll" ? 40 + gutter : gutterOf(this, offset); },
    });
    Object.defineProperty(proto, "clientWidth", {
      configurable: true,
      get() { return this.style.overflow === "scroll" ? 40 : gutterOf(this, client); },
    });
    try { run(); }
    finally {
      if (offset) Object.defineProperty(proto, "offsetWidth", offset);
      if (client) Object.defineProperty(proto, "clientWidth", client);
    }
  };

  const mount = (table: boolean) => {
    const plugin = scrollbar<{ id: number }>();
    const ctx = createPluginMockContext([{ id: 1 }]);
    if (table) ctx.dom.root.setAttribute("role", "grid");
    plugin.setup!(ctx.ctx);
    const track = ctx.dom.root.querySelector(".vlist-scrollbar") as HTMLElement;
    return { plugin, ctx, track };
  };

  it("hides the custom vertical track on a classic table and keeps it on overlay", () => {
    withProbe(15, () => {
      const classic = mount(true);
      classic.ctx.engineState.totalSize = 4000;
      classic.plugin.hooks!.onResize!(420, 240);
      expect(classic.ctx.dom.viewport.classList.contains("vlist-viewport--custom-scrollbar")).toBe(true);
      expect(classic.track.style.display).toBe("none");
      classic.plugin.destroy!();
      classic.ctx.cleanup();
    });
    withProbe(0, () => {
      const overlay = mount(true);
      overlay.ctx.engineState.totalSize = 4000;
      overlay.plugin.hooks!.onResize!(420, 240);
      expect(overlay.ctx.dom.viewport.classList.contains("vlist-viewport--custom-scrollbar")).toBe(true);
      expect(overlay.track.style.display).not.toBe("none");
      overlay.plugin.destroy!();
      overlay.ctx.cleanup();
    });
  });

  it("keeps the custom track on a classic list that is not a table", () => {
    withProbe(15, () => {
      const plain = mount(false);
      expect(plain.ctx.dom.viewport.classList.contains("vlist-viewport--custom-scrollbar")).toBe(true);
      plain.plugin.destroy!();
      plain.ctx.cleanup();
    });
  });

  it("rechecks on resize and does not recheck while scrolling", () => {
    let probes = 0;
    const append = document.body.append.bind(document.body);
    document.body.append = ((node: Node) => {
      if (node instanceof HTMLElement && node.style.overflow === "scroll") probes += 1;
      return append(node);
    }) as typeof document.body.append;
    try {
      withProbe(15, () => {
        const { plugin, ctx } = mount(true);
        expect(probes).toBe(1);
        plugin.hooks!.onAfterScroll!(20, 1);
        plugin.hooks!.onAfterScroll!(40, 1);
        expect(probes).toBe(1);
        plugin.hooks!.onResize!(420, 240);
        expect(probes).toBe(2);
        plugin.destroy!();
        ctx.cleanup();
      });
    } finally {
      document.body.append = append;
    }
  });
});
