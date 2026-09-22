/**
 * Wrap-fold helpers: re-key the mounted map and shift the render window.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { rekeyRendered, shiftWindow, applyWrapFold } from "../../src/core/fold";
import { createEngineState } from "../../src/core/state";

beforeAll(() => { setupDOM(); });
afterAll(() => { teardownDOM(); });

const wrap = {
  lapSize: () => 50,
  itemsPerLap: () => 10,
  home: () => 0,
  thresholdLaps: 1,
};

describe("rekeyRendered", () => {
  it("moves map keys, rewrites virtual ids, and follows aria-activedescendant", () => {
    const content = document.createElement("div");
    const a = document.createElement("div");
    const b = document.createElement("div");
    a.id = "vlist-item-40";
    a.setAttribute("data-index", "0");
    a.setAttribute("aria-posinset", "1");
    b.id = "vlist-item-41";
    b.setAttribute("data-index", "1");
    content.append(a, b);
    content.setAttribute("aria-activedescendant", "vlist-item-41");
    const rendered = new Map<number, HTMLElement>([[40, a], [41, b]]);

    rekeyRendered(rendered, 15, "vlist", content);

    expect(rendered.get(25)).toBe(a);
    expect(rendered.get(26)).toBe(b);
    expect(rendered.has(40)).toBe(false);
    expect(a.id).toBe("vlist-item-25");
    expect(b.id).toBe("vlist-item-26");
    expect(a.getAttribute("data-index")).toBe("0");
    expect(a.getAttribute("aria-posinset")).toBe("1");
    expect(content.getAttribute("aria-activedescendant")).toBe("vlist-item-26");
    expect(content.firstChild).toBe(a);
  });

  it("shifts keys backward when the fold is negative", () => {
    const content = document.createElement("div");
    const el = document.createElement("div");
    el.id = "vlist-item-10";
    content.append(el);
    content.setAttribute("aria-activedescendant", "vlist-item-10");
    const rendered = new Map<number, HTMLElement>([[10, el]]);

    rekeyRendered(rendered, -15, "vlist", content);

    expect(rendered.get(25)).toBe(el);
    expect(el.id).toBe("vlist-item-25");
    expect(content.getAttribute("aria-activedescendant")).toBe("vlist-item-25");
  });

  it("resolves aria-activedescendant after all ids rewrite when ranges overlap", () => {
    const content = document.createElement("div");
    const a = document.createElement("div");
    const b = document.createElement("div");
    a.id = "vlist-item-10";
    b.id = "vlist-item-11";
    content.append(a, b);
    document.body.append(content);
    content.setAttribute("aria-activedescendant", "vlist-item-11");
    const rendered = new Map<number, HTMLElement>([[11, b], [10, a]]);

    try {
      rekeyRendered(rendered, -1, "vlist", content);

      expect(a.id).toBe("vlist-item-11");
      expect(b.id).toBe("vlist-item-12");
      expect(content.getAttribute("aria-activedescendant")).toBe("vlist-item-12");
      expect(document.getElementById("vlist-item-12")).toBe(b);
    } finally {
      content.remove();
    }
  });

  it("rewrites ids for a prefix that contains '-content'", () => {
    const content = document.createElement("div");
    content.className = "my-content-content";
    const el = document.createElement("div");
    el.id = "my-content-item-40";
    content.append(el);
    content.setAttribute("aria-activedescendant", "my-content-item-40");
    const rendered = new Map<number, HTMLElement>([[40, el]]);

    rekeyRendered(rendered, 10, "my-content", content);

    expect(rendered.get(30)).toBe(el);
    expect(el.id).toBe("my-content-item-30");
    expect(content.getAttribute("aria-activedescendant")).toBe("my-content-item-30");
  });

  it("re-toggles oddClass when the virtual-index shift is odd", () => {
    const content = document.createElement("div");
    const even = document.createElement("div");
    const odd = document.createElement("div");
    even.id = "vlist-item-40";
    odd.id = "vlist-item-41";
    odd.classList.add("vlist-item--odd");
    const rendered = new Map<number, HTMLElement>([[40, even], [41, odd]]);

    rekeyRendered(rendered, 15, "vlist", content, "vlist-item--odd");

    expect(even.id).toBe("vlist-item-25");
    expect(odd.id).toBe("vlist-item-26");
    expect(even.classList.contains("vlist-item--odd")).toBe(true);
    expect(odd.classList.contains("vlist-item--odd")).toBe(false);
  });

  it("leaves oddClass alone when the virtual-index shift is even", () => {
    const content = document.createElement("div");
    const even = document.createElement("div");
    const odd = document.createElement("div");
    even.id = "vlist-item-40";
    odd.id = "vlist-item-41";
    odd.classList.add("vlist-item--odd");
    const rendered = new Map<number, HTMLElement>([[40, even], [41, odd]]);

    rekeyRendered(rendered, 10, "vlist", content, "vlist-item--odd");

    expect(even.classList.contains("vlist-item--odd")).toBe(false);
    expect(odd.classList.contains("vlist-item--odd")).toBe(true);
  });

  it("does not add a stripe class when oddClass is omitted", () => {
    const content = document.createElement("div");
    const el = document.createElement("div");
    el.id = "vlist-item-40";
    const rendered = new Map<number, HTMLElement>([[40, el]]);

    rekeyRendered(rendered, 15, "vlist", content);

    expect(el.classList.contains("vlist-item--odd")).toBe(false);
  });

  it("rekeys a smaller window after a larger one", () => {
    const content = document.createElement("div");
    const wide = [0, 1, 2].map((index) => {
      const el = document.createElement("div");
      el.id = `vlist-item-${index}`;
      return el;
    });
    const wideMap = new Map<number, HTMLElement>(wide.map((el, index) => [index, el]));
    rekeyRendered(wideMap, 3, "vlist", content);
    expect([...wideMap.keys()]).toEqual([-3, -2, -1]);

    const only = document.createElement("div");
    only.id = "vlist-item-8";
    const narrow = new Map<number, HTMLElement>([[8, only]]);
    rekeyRendered(narrow, 2, "vlist", content);

    expect(narrow.size).toBe(1);
    expect(narrow.get(6)).toBe(only);
    expect(only.id).toBe("vlist-item-6");
    expect(wide[0]!.id).toBe("vlist-item--3");
  });

  it("no-ops when the index shift is zero", () => {
    const content = document.createElement("div");
    const el = document.createElement("div");
    el.id = "vlist-item-4";
    const rendered = new Map<number, HTMLElement>([[4, el]]);
    rekeyRendered(rendered, 0, "vlist", content);
    expect(rendered.get(4)).toBe(el);
    expect(el.id).toBe("vlist-item-4");
  });
});

describe("shiftWindow", () => {
  it("shifts range keys, visible indices and offsets, and prevBaseOffset", () => {
    const state = createEngineState(10);
    state.visibleCount = 3;
    state.startIndex = 40;
    state.prevRangeStart = 40;
    state.prevRangeEnd = 42;
    state.prevBaseOffset = 2000;
    state.visibleIndices[0] = 40;
    state.visibleIndices[1] = 41;
    state.visibleIndices[2] = 42;
    state.visibleOffsets[0] = 2000;
    state.visibleOffsets[1] = 2050;
    state.visibleOffsets[2] = 2100;
    state.visibleSizes[0] = 50;

    shiftWindow(state, 15, 750);

    expect(state.startIndex).toBe(25);
    expect(state.prevRangeStart).toBe(25);
    expect(state.prevRangeEnd).toBe(27);
    expect(state.prevBaseOffset).toBe(1250);
    expect(state.visibleIndices[0]).toBe(25);
    expect(state.visibleIndices[1]).toBe(26);
    expect(state.visibleIndices[2]).toBe(27);
    expect(state.visibleOffsets[0]).toBe(1250);
    expect(state.visibleOffsets[1]).toBe(1300);
    expect(state.visibleOffsets[2]).toBe(1350);
    expect(state.visibleSizes[0]).toBe(50);
  });

  it("no-ops when both deltas are zero", () => {
    const state = createEngineState(4);
    state.startIndex = 10;
    state.prevBaseOffset = 100;
    shiftWindow(state, 0, 0);
    expect(state.startIndex).toBe(10);
    expect(state.prevBaseOffset).toBe(100);
  });
});

describe("applyWrapFold", () => {
  it("uses the passed class prefix rather than parsing the content class", () => {
    const content = document.createElement("div");
    content.className = "vlist-content";
    const el = document.createElement("div");
    el.id = "vlist-item-40";
    content.append(el);
    content.setAttribute("aria-activedescendant", "vlist-item-40");
    const rendered = new Map<number, HTMLElement>([[40, el]]);
    const state = createEngineState(4);
    state.visibleCount = 1;
    state.startIndex = 40;
    state.prevRangeStart = 40;
    state.prevRangeEnd = 40;
    state.prevBaseOffset = 2000;
    state.visibleIndices[0] = 40;
    state.visibleOffsets[0] = 2000;

    applyWrapFold(wrap, 150, state, content, rendered, "vlist");

    expect(rendered.get(10)).toBe(el);
    expect(el.id).toBe("vlist-item-10");
    expect(content.getAttribute("aria-activedescendant")).toBe("vlist-item-10");
    expect(state.startIndex).toBe(10);
    expect(state.prevBaseOffset).toBe(1850);
  });

  it("rewrites ids when classPrefix contains '-content'", () => {
    const content = document.createElement("div");
    content.className = "my-content-content";
    const el = document.createElement("div");
    el.id = "my-content-item-40";
    content.append(el);
    content.setAttribute("aria-activedescendant", "my-content-item-40");
    const rendered = new Map<number, HTMLElement>([[40, el]]);
    const state = createEngineState(4);
    state.visibleCount = 1;
    state.startIndex = 40;
    state.visibleIndices[0] = 40;

    applyWrapFold(wrap, 150, state, content, rendered, "my-content");

    expect(rendered.get(10)).toBe(el);
    expect(el.id).toBe("my-content-item-10");
    expect(content.getAttribute("aria-activedescendant")).toBe("my-content-item-10");
  });

  it("forwards oddClass so an odd lap count flips stripe parity", () => {
    const content = document.createElement("div");
    const el = document.createElement("div");
    el.id = "vlist-item-40";
    const rendered = new Map<number, HTMLElement>([[40, el]]);
    const state = createEngineState(4);
    state.visibleCount = 1;
    state.startIndex = 40;
    state.visibleIndices[0] = 40;

    applyWrapFold(
      { ...wrap, itemsPerLap: () => 5 },
      150,
      state,
      content,
      rendered,
      "vlist",
      "vlist-item--odd",
    );

    expect(el.id).toBe("vlist-item-25");
    expect(el.classList.contains("vlist-item--odd")).toBe(true);
  });
});
