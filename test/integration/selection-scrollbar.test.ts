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
import { selection } from "../../src/plugins/selection/plugin";
import { scrollbar } from "../../src/plugins/scrollbar/plugin";

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

describe("selection + scrollbar integration", () => {
  describe("selection with custom scrollbar", () => {
    it("should create a list with both selection and scrollbar", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [selection({ mode: "multiple" }), scrollbar()],
      );

      expect(list.total).toBe(100);
      expect(typeof (list as any).getSelected).toBe("function");
    });

    it("should select items with scrollbar present", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [selection({ mode: "multiple" }), scrollbar()],
      );

      (list as any).select(1, 50, 100);
      const selected: number[] = (list as any).getSelected();
      expect(selected).toContain(1);
      expect(selected).toContain(50);
      expect(selected).toContain(100);
    });

    it("should support keyboard navigation with scrollbar", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
          interactive: true,
        },
        [selection({ mode: "multiple" }), scrollbar()],
      );

      (list as any).selectNext();
      const selected: number[] = (list as any).getSelected();
      expect(selected.length).toBeGreaterThan(0);
    });

    it("should select all with scrollbar present", () => {
      list = createVList(
        {
          container,
          items: createTestItems(50),
          item: { height: 40, template: simpleTemplate },
        },
        [selection({ mode: "multiple" }), scrollbar()],
      );

      (list as any).selectAll();
      expect((list as any).getSelected().length).toBe(50);
    });

    it("should emit selection:change with scrollbar present", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [selection({ mode: "multiple" }), scrollbar()],
      );

      const handler = mock(() => {});
      list.on("selection:change" as any, handler);

      (list as any).select(1);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("scrollToIndex with selection", () => {
    it("should scroll to selected item", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [selection({ mode: "single" }), scrollbar()],
      );

      (list as any).select(80);
      list.scrollToIndex(79, "center");

      const viewport = list.element.querySelector(
        ".vlist-viewport",
      ) as HTMLElement;
      expect(viewport.scrollTop).toBeGreaterThan(0);
    });
  });

  describe("destroy with selection + scrollbar", () => {
    it("should clean up both plugins on destroy", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [selection({ mode: "multiple" }), scrollbar()],
      );

      (list as any).selectAll();

      const root = list.element;
      expect(() => {
        list!.destroy();
        list = null;
      }).not.toThrow();
      expect(document.body.contains(root)).toBe(false);
    });
  });
});
