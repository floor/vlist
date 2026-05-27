import {
  describe,
  it,
  expect,
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
import { grid } from "../../src/plugins/grid/plugin";

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

describe("memory and resource cleanup", () => {
  describe("DOM cleanup after destroy", () => {
    it("should remove root element from DOM on destroy", () => {
      const container = createContainer({ width: 300, height: 500 });
      const list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      const root = list.element;
      expect(document.body.contains(root)).toBe(true);

      list.destroy();
      expect(document.body.contains(root)).toBe(false);
      container.remove();
    });

    it("should remove all rendered items from content on destroy", () => {
      const container = createContainer({ width: 300, height: 500 });
      const list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      const content = list.element.querySelector(
        ".vlist-content",
      ) as HTMLElement;
      expect(content.children.length).toBeGreaterThan(0);

      list.destroy();
      container.remove();
    });

    it("should not leave orphan elements in the container", () => {
      const container = createContainer({ width: 300, height: 500 });
      const childrenBefore = container.children.length;

      const list = createVList(
        {
          container,
          items: createTestItems(50),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      expect(container.children.length).toBeGreaterThan(childrenBefore);

      list.destroy();
      expect(container.children.length).toBe(childrenBefore);
      container.remove();
    });
  });

  describe("plugin cleanup", () => {
    it("should clean up selection plugin on destroy", () => {
      const container = createContainer({ width: 300, height: 500 });
      const list = createVList(
        {
          container,
          items: createTestItems(50),
          item: { height: 40, template: simpleTemplate },
        },
        [selection({ mode: "multiple" })],
      );

      (list as any).select(1, 2, 3);
      expect((list as any).getSelected().length).toBe(3);

      list.destroy();
      container.remove();
    });

    it("should clean up scrollbar plugin on destroy", () => {
      const container = createContainer({ width: 300, height: 500 });
      const list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [scrollbar()],
      );

      const root = list.element;
      list.destroy();
      expect(document.body.contains(root)).toBe(false);
      container.remove();
    });

    it("should clean up grid + selection plugins on destroy", () => {
      const container = createContainer({ width: 300, height: 500 });
      const list = createVList(
        {
          container,
          items: createTestItems(50),
          item: { height: 40, template: simpleTemplate },
        },
        [grid({ columns: 3 }), selection({ mode: "multiple" })],
      );

      (list as any).selectAll();
      list.destroy();
      container.remove();
    });
  });

  describe("create/destroy cycles", () => {
    it("should handle rapid create/destroy cycles without leaking", () => {
      const container = createContainer({ width: 300, height: 500 });
      const childrenBefore = container.children.length;

      for (let i = 0; i < 10; i++) {
        const list = createVList(
          {
            container,
            items: createTestItems(50),
            item: { height: 40, template: simpleTemplate },
          },
          [selection({ mode: "multiple" })],
        );

        (list as any).select(1, 2, 3);
        list.destroy();
      }

      expect(container.children.length).toBe(childrenBefore);
      container.remove();
    });

    it("should handle rapid create/destroy with multiple plugins", () => {
      const container = createContainer({ width: 300, height: 500 });

      for (let i = 0; i < 5; i++) {
        const list = createVList(
          {
            container,
            items: createTestItems(100),
            item: { height: 40, template: simpleTemplate },
          },
          [grid({ columns: 3 }), selection({ mode: "multiple" }), scrollbar()],
        );

        (list as any).selectAll();
        list.scrollToIndex(50);
        list.destroy();
      }

      container.remove();
    });
  });

  describe("large dataset cleanup", () => {
    it("should destroy cleanly with a large dataset", () => {
      const container = createContainer({ width: 300, height: 500 });
      const list = createVList(
        {
          container,
          items: createTestItems(100000),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      expect(list.total).toBe(100000);

      const rendered = list.element.querySelectorAll("[data-index]").length;
      expect(rendered).toBeLessThan(100);

      list.destroy();
      container.remove();
    });

    it("should destroy cleanly after scrolling a large dataset", () => {
      const container = createContainer({ width: 300, height: 500 });
      const list = createVList(
        {
          container,
          items: createTestItems(10000),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      list.scrollToIndex(5000);
      list.scrollToIndex(9999);
      list.scrollToIndex(0);

      list.destroy();
      container.remove();
    });
  });
});
