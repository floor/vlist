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
import { scale } from "../../src/plugins/scale/plugin";
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

describe("scale + scrollbar integration", () => {
  describe("scale with custom scrollbar", () => {
    it("should create a list with both scale and scrollbar", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: 40, template: simpleTemplate },
        },
        [scale(), scrollbar()],
      );

      expect(list.total).toBe(1000);
    });

    it("should render a scrollbar element", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: 40, template: simpleTemplate },
        },
        [scrollbar()],
      );

      const scrollbarEl = list.element.querySelector(
        "[class*='scrollbar']",
      );
      expect(scrollbarEl).not.toBeNull();
    });

    it("should position items correctly with scale plugin", () => {
      list = createVList(
        {
          container,
          items: createTestItems(500),
          item: { height: 40, template: simpleTemplate },
        },
        [scale(), scrollbar()],
      );

      const rendered = list.element.querySelectorAll("[data-index]");
      expect(rendered.length).toBeGreaterThan(0);
    });
  });

  describe("scrollbar with large datasets", () => {
    it("should handle scrollbar with 10K items", () => {
      list = createVList(
        {
          container,
          items: createTestItems(10000),
          item: { height: 40, template: simpleTemplate },
        },
        [scrollbar()],
      );

      expect(list.total).toBe(10000);
      list.scrollToIndex(5000);
    });

    it("should handle scrollbar with scale for very large datasets", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100000),
          item: { height: 40, template: simpleTemplate },
        },
        [scale({ force: true }), scrollbar()],
      );

      expect(list.total).toBe(100000);
    });
  });

  describe("destroy with scale + scrollbar", () => {
    it("should clean up both plugins on destroy", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: 40, template: simpleTemplate },
        },
        [scale(), scrollbar()],
      );

      const root = list.element;
      expect(() => {
        list!.destroy();
        list = null;
      }).not.toThrow();
      expect(document.body.contains(root)).toBe(false);
    });
  });
});
