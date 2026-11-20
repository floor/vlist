/**
 * Directional motion blur. Velocity is passed in: the assertions do not depend
 * on a clock, so the file stays safe under `bun test --concurrent`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createContainer, createTestItems, simpleTemplate } from "../helpers/factory";
import { createVList } from "../../src/native";
import { createMotionBlur } from "../../src/core/motion-blur";
import type { MotionBlurHandle } from "../../src/core/motion-blur";

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

function spread(velocity: number, max = 12): string {
  return Math.min(max, Math.max(1.5, velocity * 0.28)).toFixed(1);
}

function shift(velocity: number, direction: number): string {
  const sign = direction > 0 ? 1 : -1;
  return (sign * Math.min(22, Math.max(4, velocity * 0.55))).toFixed(1);
}

function root(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function filterOf(el: HTMLElement): SVGElement {
  const filter = el.querySelector("filter");
  expect(filter).not.toBeNull();
  return filter as SVGElement;
}

describe("motion blur formulas", () => {
  let el: HTMLElement;
  let motion: MotionBlurHandle;

  beforeEach(() => {
    el = root();
    motion = createMotionBlur(el, "vlist", "y", true)!;
  });

  afterEach(() => {
    motion.destroy();
    el.remove();
  });

  it("builds nothing until the velocity is fast and reliable", () => {
    expect(el.querySelector("svg")).toBeNull();
    expect(el.getAttribute("data-vlist-motion")).toBe("placeholders");
    motion.onVelocity(14, true, 1);
    motion.onVelocity(40, false, 1);
    motion.onVelocity(15, true, 1);
    expect(el.querySelector("svg")).toBeNull();
    expect(el.classList.contains("vlist--fast")).toBe(false);
  });

  it("smears on y: blur, then offset, then 0.7 alpha, trail under the row", () => {
    motion.onVelocity(15.1, true, 1);
    expect(el.classList.contains("vlist--fast")).toBe(true);

    const filter = filterOf(el);
    expect(filter.getAttribute("x")).toBe("-8%");
    expect(filter.getAttribute("y")).toBe("-70%");
    expect(filter.getAttribute("width")).toBe("116%");
    expect(filter.getAttribute("height")).toBe("240%");
    expect(filter.getAttribute("color-interpolation-filters")).toBe("sRGB");

    const names = [...filter.children].map((node) => node.localName);
    expect(names).toEqual(["feGaussianBlur", "feOffset", "feComponentTransfer", "feMerge"]);

    const blur = filter.children[0] as SVGElement;
    const offset = filter.children[1] as SVGElement;
    expect(blur.getAttribute("in")).toBe("SourceGraphic");
    expect(blur.getAttribute("stdDeviation")).toBe("0 4.2");
    expect(spread(15)).toBe("4.2");
    expect(offset.getAttribute("dx")).toBe("0");
    expect(offset.getAttribute("dy")).toBe("8.3");

    const transfer = filter.children[2] as SVGElement;
    expect(transfer.getAttribute("result")).toBe("trail");
    expect(transfer.children[0]!.getAttribute("slope")).toBe("0.7");

    const merge = [...filter.children[3]!.children];
    expect(merge[0]!.getAttribute("in")).toBe("trail");
    expect(merge[1]!.getAttribute("in")).toBe("SourceGraphic");

    const id = filter.id;
    expect(id.startsWith("vlist-motion-")).toBe(true);
    expect(el.style.getPropertyValue("--vlist-motion-filter")).toBe(`url("#${id}")`);
  });

  it("smears on x with the widened region and a horizontal shift", () => {
    motion.destroy();
    motion = createMotionBlur(el, "vlist", "x", true)!;
    motion.onVelocity(20, true, -1);

    const filter = filterOf(el);
    expect(filter.getAttribute("x")).toBe("-70%");
    expect(filter.getAttribute("y")).toBe("-8%");
    expect(filter.getAttribute("width")).toBe("240%");
    expect(filter.getAttribute("height")).toBe("116%");

    const blur = filter.children[0] as SVGElement;
    const offset = filter.children[1] as SVGElement;
    expect(blur.getAttribute("stdDeviation")).toBe(spread(20) + " 0");
    expect(offset.getAttribute("dx")).toBe(shift(20, -1));
    expect(offset.getAttribute("dy")).toBe("0");
    expect(shift(20, 1)).toBe("11.0");
    expect(shift(20, -1)).toBe("-11.0");
    expect(spread(0)).toBe("1.5");
    expect(spread(100)).toBe("12.0");
    expect(shift(0, 1)).toBe("4.0");
    expect(shift(100, 1)).toBe("22.0");
  });

  it("caps the spread at max and uses the caller's threshold", () => {
    motion.destroy();
    motion = createMotionBlur(el, "vlist", "y", { threshold: 30, max: 4, target: "items" })!;
    motion.onVelocity(20, true, 1);
    expect(el.classList.contains("vlist--fast")).toBe(false);
    expect(el.querySelector("svg")).toBeNull();

    motion.onVelocity(100, true, 1);
    expect(el.classList.contains("vlist--fast")).toBe(true);
    expect(el.getAttribute("data-vlist-motion")).toBe("items");
    expect(filterOf(el).children[0]!.getAttribute("stdDeviation")).toBe("0 " + spread(100, 4));
    expect(spread(100, 4)).toBe("4.0");
  });

  it("does not rewrite the filter when the quantised strength is unchanged", () => {
    motion.onVelocity(16, true, 1);
    const blur = filterOf(el).children[0] as SVGElement;
    const offset = filterOf(el).children[1] as SVGElement;
    let blurWrites = 0;
    let shiftWrites = 0;
    const blurSet = blur.setAttribute.bind(blur);
    const shiftSet = offset.setAttribute.bind(offset);
    blur.setAttribute = (name: string, value: string) => {
      if (name === "stdDeviation") blurWrites++;
      blurSet(name, value);
    };
    offset.setAttribute = (name: string, value: string) => {
      if (name === "dy") shiftWrites++;
      shiftSet(name, value);
    };

    motion.onVelocity(16.05, true, 1);
    expect(blurWrites).toBe(0);
    expect(shiftWrites).toBe(0);
    expect(blur.getAttribute("stdDeviation")).toBe("0 " + spread(16));
  });

  it("drops the fast class when the scroll slows or stops, and destroy removes the svg", () => {
    motion.onVelocity(40, true, 1);
    const svg = el.querySelector("svg");
    expect(svg).not.toBeNull();

    motion.onVelocity(3, true, 1);
    expect(el.classList.contains("vlist--fast")).toBe(false);
    expect(el.querySelector("svg")).toBe(svg);

    motion.onVelocity(40, true, -1);
    expect(el.classList.contains("vlist--fast")).toBe(true);
    motion.onVelocity(0, false, 0);
    expect(el.classList.contains("vlist--fast")).toBe(false);

    motion.destroy();
    expect(el.querySelector("svg")).toBeNull();
    expect(el.hasAttribute("data-vlist-motion")).toBe(false);
    expect(el.style.getPropertyValue("--vlist-motion-filter")).toBe("");
    expect(el.classList.contains("vlist--fast")).toBe(false);
  });

  it("gives each list its own filter id", () => {
    const other = root();
    const second = createMotionBlur(other, "rows", "y", true)!;
    motion.onVelocity(40, true, 1);
    second.onVelocity(40, true, 1);
    const a = filterOf(el).id;
    const b = filterOf(other).id;
    expect(a).not.toBe(b);
    expect(b.startsWith("rows-motion-")).toBe(true);
    expect(other.classList.contains("rows--fast")).toBe(true);
    second.destroy();
    other.remove();
  });
});

describe("motion blur on a list", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 200 });
  });

  afterEach(() => {
    container.remove();
  });

  function list(motionBlur?: boolean | { target: "items" }, orientation?: "horizontal") {
    return createVList({
      container,
      items: createTestItems(80),
      item: orientation === "horizontal"
        ? { width: 40, template: simpleTemplate }
        : { height: 40, template: simpleTemplate },
      ...(orientation ? { orientation } : {}),
      ...(motionBlur !== undefined ? { motionBlur } : {}),
      scroll: { idleTimeout: 10_000 },
    });
  }

  it("creates no filter when the option is off", () => {
    const plain = list();
    expect(plain.element.querySelector("svg")).toBeNull();
    expect(plain.element.hasAttribute("data-vlist-motion")).toBe(false);
    plain.destroy();

    const disabled = list(false);
    expect(disabled.element.querySelector("svg")).toBeNull();
    expect(disabled.element.hasAttribute("data-vlist-motion")).toBe(false);
    disabled.destroy();
  });

  it("rejects a target that is not placeholders or items", () => {
    expect(() => createVList({
      container,
      items: createTestItems(4),
      item: { height: 40, template: simpleTemplate },
      motionBlur: { target: "rows" as "items" },
    })).toThrow(/motionBlur.target/);
  });

  it("follows scroll velocity on y, and destroy takes the filter with it", async () => {
    const view = list(true);
    expect(view.element.querySelector("svg")).toBeNull();
    expect(view.element.getAttribute("data-vlist-motion")).toBe("placeholders");

    const viewport = view.element.querySelector(".vlist-viewport") as HTMLElement;
    for (let i = 0; i < 6 && !view.element.classList.contains("vlist--fast"); i++) {
      viewport.scrollTop = viewport.scrollTop > 2000 ? 40 : viewport.scrollTop + 900;
      viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
      if (!view.element.classList.contains("vlist--fast")) await Bun.sleep(20);
    }

    expect(view.element.classList.contains("vlist--fast")).toBe(true);
    const filter = filterOf(view.element);
    expect(filter.getAttribute("y")).toBe("-70%");
    expect(filter.getAttribute("height")).toBe("240%");
    expect(filter.children[0]!.getAttribute("stdDeviation")).toMatch(/^0 \d/);
    expect(filter.children[1]!.getAttribute("dx")).toBe("0");
    expect(filter.children[2]!.children[0]!.getAttribute("slope")).toBe("0.7");

    view.destroy();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("follows scroll velocity on x", async () => {
    const view = list(true, "horizontal");
    const viewport = view.element.querySelector(".vlist-viewport") as HTMLElement;
    for (let i = 0; i < 6 && !view.element.classList.contains("vlist--fast"); i++) {
      viewport.scrollLeft = viewport.scrollLeft > 2000 ? 40 : viewport.scrollLeft + 900;
      viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
      if (!view.element.classList.contains("vlist--fast")) await Bun.sleep(20);
    }

    expect(view.element.classList.contains("vlist--fast")).toBe(true);
    const filter = filterOf(view.element);
    expect(filter.getAttribute("x")).toBe("-70%");
    expect(filter.getAttribute("width")).toBe("240%");
    expect(filter.children[0]!.getAttribute("stdDeviation")).toMatch(/^\d.* 0$/);
    expect(filter.children[1]!.getAttribute("dy")).toBe("0");
    view.destroy();
  });

  it("drops the fast class when scrolling stops", async () => {
    const view = createVList({
      container,
      items: createTestItems(80),
      item: { height: 40, template: simpleTemplate },
      motionBlur: true,
      scroll: { idleTimeout: 40 },
    });
    const viewport = view.element.querySelector(".vlist-viewport") as HTMLElement;
    for (let i = 0; i < 6 && !view.element.classList.contains("vlist--fast"); i++) {
      viewport.scrollTop = viewport.scrollTop > 2000 ? 40 : viewport.scrollTop + 900;
      viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
      if (!view.element.classList.contains("vlist--fast")) await Bun.sleep(20);
    }
    expect(view.element.classList.contains("vlist--fast")).toBe(true);
    await Bun.sleep(80);
    expect(view.element.classList.contains("vlist--fast")).toBe(false);
    expect(view.element.classList.contains("vlist--scrolling")).toBe(false);
    view.destroy();
  });
});

describe("motion blur stylesheet", () => {
  const css = readFileSync(join(import.meta.dir, "../../src/styles/vlist.css"), "utf8");

  it("puts the filter on placeholders by default and leaves the replaced fade alone", () => {
    expect(css).not.toContain("blur(2px)");
    expect(css.match(/\.vlist-item--replaced/g)).toHaveLength(1);
    expect(css).toContain('.vlist--fast[data-vlist-motion="placeholders"] .vlist-item--placeholder');
    expect(css).toContain("filter: var(--vlist-motion-filter)");
    expect(css).toContain("animation: none");
    expect(css).toContain('.vlist--fast[data-vlist-motion="items"] .vlist-item');
  });
});
