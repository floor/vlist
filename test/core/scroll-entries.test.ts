import { afterAll, beforeAll, expect, it } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createContainer, createTestItems, simpleTemplate } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import { createVList as createAlias } from "../../src/synthetic";
import { createVList as createNative } from "../../src/native";
import { createVListFromConfig } from "../../src/config";

beforeAll(setupDOM);
afterAll(teardownDOM);

it("the deprecated synthetic entry is the exact default factory", () => {
  expect(createAlias).toBe(createVList);
});

for (const mode of [undefined, "synthetic"] as const) {
  it(`core owns logical position with mode ${mode}`, () => {
    const container = createContainer();
    const list = createVList({ container, items: createTestItems(100),
      item: { height: 40, template: simpleTemplate }, scroll: { mode } });
    try {
      const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
      expect(viewport.style.touchAction).toBe("pan-x pinch-zoom");
      list.scrollToIndex(20);
      expect(list.getScrollPosition()).toBe(800);
      expect(viewport.scrollTop).toBe(0);
      expect(container.querySelector<HTMLElement>(".vlist-content")!.style.overflow).toBe("clip");
    } finally { list.destroy(); container.remove(); }
  });
}

for (const mode of ["native", "bounded"] as const) {
  it(`core rejects ${mode} with the native import before creating DOM`, () => {
    const container = createContainer();
    try {
      expect(() => createVList({ container, items: createTestItems(1),
        item: { height: 40, template: simpleTemplate }, scroll: { mode },
      })).toThrow('createVList from "vlist/native"');
      expect(container.children).toHaveLength(0);
    } finally { container.remove(); }
  });
}

it("native rejects synthetic mode with the core import before creating DOM", () => {
  const container = createContainer();
  try {
    expect(() => createNative({ container, items: createTestItems(1),
      item: { height: 40, template: simpleTemplate }, scroll: { mode: "synthetic" },
    })).toThrow('createVList from "vlist"');
    expect(container.children).toHaveLength(0);
  } finally { container.remove(); }
});

it("config uses an injected native factory for native scrolling", () => {
  const container = createContainer();
  const list = createVListFromConfig({ container, factory: createNative,
    items: createTestItems(100), item: { height: 40, template: simpleTemplate } });
  try {
    list.scrollToIndex(20);
    const viewport = container.querySelector<HTMLElement>(".vlist-viewport")!;
    expect(viewport.style.touchAction).not.toBe("pan-x pinch-zoom");
    expect(viewport.scrollTop).toBe(800);
    expect(list.getScrollPosition()).toBe(800);
  } finally { list.destroy(); container.remove(); }
});

for (const name of ["carousel", "sortable"]) {
  it(`default core rejects ${name} before setup or DOM creation`, () => {
    const container = createContainer();
    let setups = 0;
    try {
      expect(() => createVList({ container, items: createTestItems(1),
        item: { height: 40, template: simpleTemplate },
      }, [{ name, setup() { setups++; } }])).toThrow('createVList from "vlist/native"');
      expect(setups).toBe(0);
      expect(container.children).toHaveLength(0);
    } finally { container.remove(); }
  });
}

it("default core rejects horizontal RTL before creating DOM", () => {
  const container = createContainer();
  container.style.direction = "rtl";
  try {
    expect(() => createVList({ container, orientation: "horizontal", items: createTestItems(1),
      item: { width: 40, template: simpleTemplate },
    })).toThrow('RTL horizontal lists require createVList from "vlist/native"');
    expect(container.children).toHaveLength(0);
  } finally { container.remove(); }
});
