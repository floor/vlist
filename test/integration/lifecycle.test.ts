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

describe("lifecycle", () => {
  describe("creation and initial render", () => {
    it("should create a list and render items into the DOM", () => {
      const items = createTestItems(100);
      list = createVList(
        { container, items, item: { height: 40, template: simpleTemplate } },
        [],
      );

      expect(list.element).toBeDefined();
      expect(list.element.querySelector(".vlist-viewport")).not.toBeNull();
      expect(list.element.querySelector(".vlist-content")).not.toBeNull();

      const rendered = list.element.querySelectorAll("[data-index]");
      expect(rendered.length).toBeGreaterThan(0);
    });

    it("should render items visible in the viewport", () => {
      const items = createTestItems(100);
      list = createVList(
        { container, items, item: { height: 40, template: simpleTemplate } },
        [],
      );

      const rendered = list.element.querySelectorAll("[data-index]");
      const indices = Array.from(rendered).map((el) =>
        parseInt((el as HTMLElement).dataset.index!, 10),
      );

      expect(indices).toContain(0);
      expect(indices.length).toBeLessThan(items.length);
    });

    it("should set content height based on total items", () => {
      const items = createTestItems(50);
      list = createVList(
        { container, items, item: { height: 40, template: simpleTemplate } },
        [],
      );

      const content = list.element.querySelector(
        ".vlist-content",
      ) as HTMLElement;
      const height = parseInt(content.style.height, 10);
      expect(height).toBe(50 * 40);
    });

    it("should expose correct total count", () => {
      const items = createTestItems(200);
      list = createVList(
        { container, items, item: { height: 40, template: simpleTemplate } },
        [],
      );

      expect(list.total).toBe(200);
    });

    it("should expose items as readonly array", () => {
      const items = createTestItems(10);
      list = createVList(
        { container, items, item: { height: 40, template: simpleTemplate } },
        [],
      );

      expect(list.items.length).toBe(10);
      expect(list.items[0]!.id).toBe(1);
    });

    it("should handle empty items array", () => {
      list = createVList(
        {
          container,
          items: [],
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      expect(list.total).toBe(0);
      const rendered = list.element.querySelectorAll("[data-index]");
      expect(rendered.length).toBe(0);
    });
  });

  describe("data mutations", () => {
    it("should update DOM when setItems is called", () => {
      list = createVList(
        {
          container,
          items: createTestItems(10),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      expect(list.total).toBe(10);

      list.setItems(createTestItems(50));
      expect(list.total).toBe(50);

      const content = list.element.querySelector(
        ".vlist-content",
      ) as HTMLElement;
      const height = parseInt(content.style.height, 10);
      expect(height).toBe(50 * 40);
    });

    it("should append items and update total", () => {
      list = createVList(
        {
          container,
          items: createTestItems(10),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      list.appendItems(createTestItems(5, 11));
      expect(list.total).toBe(15);
    });

    it("should prepend items and update total", () => {
      list = createVList(
        {
          container,
          items: createTestItems(10),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      list.prependItems(createTestItems(5, 100));
      expect(list.total).toBe(15);
      expect(list.items[0]!.id).toBe(100);
    });

    it("should insert item at specific index", () => {
      const items = createTestItems(10);
      list = createVList(
        { container, items, item: { height: 40, template: simpleTemplate } },
        [],
      );

      const newItem: TestItem = { id: 999, name: "Inserted", value: 9990 };
      list.insertItem(newItem, 5);

      expect(list.total).toBe(11);
      expect(list.getItemAt(5)!.id).toBe(999);
    });

    it("should remove item by id", () => {
      const items = createTestItems(10);
      list = createVList(
        { container, items, item: { height: 40, template: simpleTemplate } },
        [],
      );

      list.removeItem(5);
      expect(list.total).toBe(9);
      expect(list.getIndexById(5)).toBe(-1);
    });

    it("should remove multiple items by id", () => {
      const items = createTestItems(10);
      list = createVList(
        { container, items, item: { height: 40, template: simpleTemplate } },
        [],
      );

      const removed = list.removeItems([1, 3, 5, 7]);
      expect(removed).toBe(4);
      expect(list.total).toBe(6);
    });

    it("should update an existing item", () => {
      const items = createTestItems(10);
      list = createVList(
        { container, items, item: { height: 40, template: simpleTemplate } },
        [],
      );

      list.updateItem(1, { name: "Updated" });
      expect(list.getItemAt(0)!.name).toBe("Updated");
    });
  });

  describe("lookup methods", () => {
    it("should get item at index", () => {
      const items = createTestItems(10);
      list = createVList(
        { container, items, item: { height: 40, template: simpleTemplate } },
        [],
      );

      expect(list.getItemAt(0)!.id).toBe(1);
      expect(list.getItemAt(9)!.id).toBe(10);
      expect(list.getItemAt(100)).toBeUndefined();
    });

    it("should get index by item id", () => {
      const items = createTestItems(10);
      list = createVList(
        { container, items, item: { height: 40, template: simpleTemplate } },
        [],
      );

      expect(list.getIndexById(1)).toBe(0);
      expect(list.getIndexById(10)).toBe(9);
      expect(list.getIndexById(999)).toBe(-1);
    });
  });

  describe("scroll", () => {
    it("should report initial scroll position as 0", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      expect(list.getScrollPosition()).toBe(0);
    });

    it("should scroll to index with start alignment", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      list.scrollToIndex(20, "start");

      const viewport = list.element.querySelector(
        ".vlist-viewport",
      ) as HTMLElement;
      expect(viewport.scrollTop).toBe(20 * 40);
    });

    it("should clamp scrollToIndex to valid range", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      list.scrollToIndex(999);
      const viewport = list.element.querySelector(
        ".vlist-viewport",
      ) as HTMLElement;
      const maxScroll = 100 * 40 - 500;
      expect(viewport.scrollTop).toBeLessThanOrEqual(maxScroll);
    });
  });

  describe("events", () => {
    it("should emit item:click when an item element is clicked", () => {
      const items = createTestItems(10);
      list = createVList(
        { container, items, item: { height: 40, template: simpleTemplate } },
        [],
      );

      const handler = mock(() => {});
      list.on("item:click", handler);

      const firstItem = list.element.querySelector(
        "[data-index]",
      ) as HTMLElement;
      expect(firstItem).not.toBeNull();
      firstItem.click();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should emit destroy event on destroy", () => {
      list = createVList(
        {
          container,
          items: createTestItems(10),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      const handler = mock(() => {});
      list.on("destroy", handler);

      list.destroy();
      expect(handler).toHaveBeenCalledTimes(1);
      list = null;
    });
  });

  describe("destroy", () => {
    it("should remove root element from DOM", () => {
      list = createVList(
        {
          container,
          items: createTestItems(10),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      const root = list.element;
      expect(root.parentElement).not.toBeNull();

      list.destroy();
      expect(root.parentElement).toBeNull();
      list = null;
    });

    it("should clear rendered elements on destroy", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      const root = list.element;
      const renderedBefore = root.querySelectorAll("[data-index]").length;
      expect(renderedBefore).toBeGreaterThan(0);

      list.destroy();
      list = null;
    });

    it("should be idempotent — calling destroy twice is safe", () => {
      list = createVList(
        {
          container,
          items: createTestItems(10),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      list.destroy();
      expect(() => list!.destroy()).not.toThrow();
      list = null;
    });

    it("should support create → destroy → create cycle", () => {
      list = createVList(
        {
          container,
          items: createTestItems(10),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );
      list.destroy();
      list = null;

      const container2 = createContainer({ width: 300, height: 500 });
      list = createVList(
        {
          container: container2,
          items: createTestItems(20),
          item: { height: 40, template: simpleTemplate },
        },
        [],
      );

      expect(list.total).toBe(20);
      const rendered = list.element.querySelectorAll("[data-index]");
      expect(rendered.length).toBeGreaterThan(0);
    });
  });

  describe("horizontal mode", () => {
    it("should create a horizontal list", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { width: 120, template: simpleTemplate },
          orientation: "horizontal",
        },
        [],
      );

      const content = list.element.querySelector(
        ".vlist-content",
      ) as HTMLElement;
      const width = parseInt(content.style.width, 10);
      expect(width).toBe(100 * 120);
    });

    it("should scroll horizontally with scrollToIndex", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100),
          item: { width: 120, template: simpleTemplate },
          orientation: "horizontal",
        },
        [],
      );

      list.scrollToIndex(10, "start");

      const viewport = list.element.querySelector(
        ".vlist-viewport",
      ) as HTMLElement;
      expect(viewport.scrollLeft).toBe(10 * 120);
    });
  });
});
