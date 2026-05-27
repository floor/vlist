import {
  describe,
  it,
  expect,
  mock,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/core/create";
import type { VList } from "../../src/core/types";
import {
  createTestItems,
  createContainer,
  simpleTemplate,
  type TestItem,
} from "../helpers/factory";
import { grid } from "../../src/plugins/grid/plugin";
import { selection } from "../../src/plugins/selection/plugin";

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  GlobalRegistrator.register();
  origClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  );
  origClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() {
      return 500;
    },
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    get() {
      return 300;
    },
    configurable: true,
  });
});
afterAll(() => {
  if (origClientHeight)
    Object.defineProperty(
      HTMLElement.prototype,
      "clientHeight",
      origClientHeight,
    );
  if (origClientWidth)
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      origClientWidth,
    );
  GlobalRegistrator.unregister();
});

let container: HTMLElement;
let list: VList<TestItem> | null = null;

beforeEach(() => {
  container = createContainer({ width: 300, height: 500 });
});

afterEach(() => {
  if (list) {
    list.destroy();
    list = null;
  }
  container.remove();
});

describe("grid + selection integration", () => {
  describe("grid with selection", () => {
    it("should create a grid list with selection enabled", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [grid({ columns: 3 }), selection({ mode: "multiple" })],
      );

      expect(list.items.length).toBe(100);
      expect(typeof (list as any).getSelected).toBe("function");
    });

    it("should select items programmatically in grid mode", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [grid({ columns: 3 }), selection({ mode: "multiple" })],
      );

      (list as any).select(1, 2, 3);
      const selected: number[] = (list as any).getSelected();
      expect(selected).toContain(1);
      expect(selected).toContain(2);
      expect(selected).toContain(3);
    });

    it("should deselect items in grid mode", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [grid({ columns: 3 }), selection({ mode: "multiple" })],
      );

      (list as any).select(1, 2, 3);
      (list as any).deselect(2);

      const selected: number[] = (list as any).getSelected();
      expect(selected).toContain(1);
      expect(selected).not.toContain(2);
      expect(selected).toContain(3);
    });

    it("should toggle selection in grid mode", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [grid({ columns: 3 }), selection({ mode: "multiple" })],
      );

      (list as any).toggleSelect(5);
      expect((list as any).getSelected()).toContain(5);

      (list as any).toggleSelect(5);
      expect((list as any).getSelected()).not.toContain(5);
    });

    it("should select all items in grid mode", () => {
      list = createVList(
        {
          container,
          items: createTestItems(20),
          item: { height: 40, template: simpleTemplate },
        },
        [grid({ columns: 3 }), selection({ mode: "multiple" })],
      );

      (list as any).selectAll();
      expect((list as any).getSelected().length).toBe(20);
    });

    it("should clear selection in grid mode", () => {
      list = createVList(
        {
          container,
          items: createTestItems(20),
          item: { height: 40, template: simpleTemplate },
        },
        [grid({ columns: 3 }), selection({ mode: "multiple" })],
      );

      (list as any).selectAll();
      (list as any).clearSelection();
      expect((list as any).getSelected().length).toBe(0);
    });

    it("should emit selection:change event", () => {
      list = createVList(
        {
          container,
          items: createTestItems(20),
          item: { height: 40, template: simpleTemplate },
        },
        [grid({ columns: 3 }), selection({ mode: "multiple" })],
      );

      const handler = mock(() => {});
      list.on("selection:change" as any, handler);

      (list as any).select(1);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should support single selection mode in grid", () => {
      list = createVList(
        {
          container,
          items: createTestItems(20),
          item: { height: 40, template: simpleTemplate },
        },
        [grid({ columns: 3 }), selection({ mode: "single" })],
      );

      (list as any).select(1);
      (list as any).select(5);

      const selected: number[] = (list as any).getSelected();
      expect(selected.length).toBe(1);
      expect(selected).toContain(5);
    });
  });

  describe("grid layout correctness", () => {
    it("should render items with correct grid positioning", () => {
      list = createVList(
        {
          container,
          items: createTestItems(30),
          item: { height: 40, template: simpleTemplate },
        },
        [grid({ columns: 3 })],
      );

      const rendered = list.element.querySelectorAll("[data-index]");
      expect(rendered.length).toBeGreaterThan(0);
    });

    it("should support grid with gap", () => {
      list = createVList(
        {
          container,
          items: createTestItems(30),
          item: { height: 40, template: simpleTemplate, gap: 8 },
        },
        [grid({ columns: 3, gap: 8 })],
      );

      expect(list.items.length).toBe(30);
    });
  });

  describe("keyboard navigation in grid", () => {
    it("should support selectNext in grid mode", () => {
      list = createVList(
        {
          container,
          items: createTestItems(20),
          item: { height: 40, template: simpleTemplate },
          interactive: true,
        },
        [grid({ columns: 3 }), selection({ mode: "multiple" })],
      );

      (list as any).selectNext();
      const selected: number[] = (list as any).getSelected();
      expect(selected.length).toBeGreaterThan(0);
    });

    it("should support selectPrevious in grid mode", () => {
      list = createVList(
        {
          container,
          items: createTestItems(20),
          item: { height: 40, template: simpleTemplate },
          interactive: true,
        },
        [grid({ columns: 3 }), selection({ mode: "multiple" })],
      );

      (list as any).select(5);
      (list as any).selectPrevious();

      const selected: number[] = (list as any).getSelected();
      expect(selected.length).toBeGreaterThan(0);
    });
  });
});
