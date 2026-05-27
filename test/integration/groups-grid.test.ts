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
import { groups } from "../../src/plugins/groups/plugin";
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

const getGroup = (index: number): string => {
  if (index < 10) return "Group A";
  if (index < 20) return "Group B";
  return "Group C";
};

describe("groups + selection integration", () => {
  describe("groups with selection", () => {
    it("should create a list with groups and selection", () => {
      list = createVList(
        {
          container,
          items: createTestItems(30),
          item: { height: 40, template: simpleTemplate },
        },
        [
          groups({
            getGroupForIndex: getGroup,
            header: {
              height: 30,
              template: (groupKey) =>
                `<div class="group-header">${groupKey}</div>`,
            },
          }),
          selection({ mode: "multiple" }),
        ],
      );

      expect(list.items.length).toBe(30);
      expect(typeof (list as any).getSelected).toBe("function");
    });

    it("should select items across groups", () => {
      list = createVList(
        {
          container,
          items: createTestItems(30),
          item: { height: 40, template: simpleTemplate },
        },
        [
          groups({
            getGroupForIndex: getGroup,
            header: {
              height: 30,
              template: (groupKey) =>
                `<div class="group-header">${groupKey}</div>`,
            },
          }),
          selection({ mode: "multiple" }),
        ],
      );

      (list as any).select(1, 15, 25);
      const selected: number[] = (list as any).getSelected();
      expect(selected).toContain(1);
      expect(selected).toContain(15);
      expect(selected).toContain(25);
    });

    it("should clear selection across groups", () => {
      list = createVList(
        {
          container,
          items: createTestItems(30),
          item: { height: 40, template: simpleTemplate },
        },
        [
          groups({
            getGroupForIndex: getGroup,
            header: {
              height: 30,
              template: (groupKey) =>
                `<div class="group-header">${groupKey}</div>`,
            },
          }),
          selection({ mode: "multiple" }),
        ],
      );

      (list as any).selectAll();
      (list as any).clearSelection();
      expect((list as any).getSelected().length).toBe(0);
    });
  });

  describe("groups rendering", () => {
    it("should render group header elements", () => {
      list = createVList(
        {
          container,
          items: createTestItems(30),
          item: { height: 40, template: simpleTemplate },
        },
        [
          groups({
            getGroupForIndex: getGroup,
            header: {
              height: 30,
              template: (groupKey) =>
                `<div class="group-header">${groupKey}</div>`,
            },
          }),
        ],
      );

      const headers = list.element.querySelectorAll(".group-header");
      expect(headers.length).toBeGreaterThan(0);
    });

    it("should render items alongside group headers", () => {
      list = createVList(
        {
          container,
          items: createTestItems(30),
          item: { height: 40, template: simpleTemplate },
        },
        [
          groups({
            getGroupForIndex: getGroup,
            header: {
              height: 30,
              template: (groupKey) =>
                `<div class="group-header">${groupKey}</div>`,
            },
          }),
        ],
      );

      const items = list.element.querySelectorAll("[data-index]");
      expect(items.length).toBeGreaterThan(0);
    });
  });

  describe("destroy with groups", () => {
    it("should clean up groups + selection on destroy", () => {
      list = createVList(
        {
          container,
          items: createTestItems(30),
          item: { height: 40, template: simpleTemplate },
        },
        [
          groups({
            getGroupForIndex: getGroup,
            header: {
              height: 30,
              template: (groupKey) =>
                `<div class="group-header">${groupKey}</div>`,
            },
          }),
          selection({ mode: "multiple" }),
        ],
      );

      (list as any).selectAll();

      expect(() => {
        list!.destroy();
        list = null;
      }).not.toThrow();
    });
  });
});
