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
import { scale } from "../../src/plugins/scale/plugin";
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

describe("scale + selection integration", () => {
  describe("selection in scaled mode", () => {
    it("should select items with scale plugin enabled", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: 40, template: simpleTemplate },
        },
        [scale(), selection({ mode: "multiple" })],
      );

      (list as any).select(1, 500, 1000);
      const selected: number[] = (list as any).getSelected();
      expect(selected).toContain(1);
      expect(selected).toContain(500);
      expect(selected).toContain(1000);
    });

    it("should clear selection in scaled mode", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: 40, template: simpleTemplate },
        },
        [scale(), selection({ mode: "multiple" })],
      );

      (list as any).select(1, 2, 3);
      (list as any).clearSelection();
      expect((list as any).getSelected().length).toBe(0);
    });

    it("should toggle selection in scaled mode", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: 40, template: simpleTemplate },
        },
        [scale(), selection({ mode: "multiple" })],
      );

      (list as any).toggleSelect(500);
      expect((list as any).getSelected()).toContain(500);

      (list as any).toggleSelect(500);
      expect((list as any).getSelected()).not.toContain(500);
    });

    it("should emit selection:change with scale", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: 40, template: simpleTemplate },
        },
        [scale(), selection({ mode: "multiple" })],
      );

      const handler = mock(() => {});
      list.on("selection:change" as any, handler);

      (list as any).select(1);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("forced compression with selection", () => {
    it("should handle selection with force-compressed dataset", () => {
      list = createVList(
        {
          container,
          items: createTestItems(100000),
          item: { height: 40, template: simpleTemplate },
        },
        [scale({ force: true }), selection({ mode: "multiple" })],
      );

      (list as any).select(1, 50000, 100000);
      const selected: number[] = (list as any).getSelected();
      expect(selected.length).toBe(3);
    });
  });

  describe("single selection with scale", () => {
    it("should enforce single selection in scaled mode", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: 40, template: simpleTemplate },
        },
        [scale(), selection({ mode: "single" })],
      );

      (list as any).select(100);
      (list as any).select(500);

      const selected: number[] = (list as any).getSelected();
      expect(selected.length).toBe(1);
      expect(selected).toContain(500);
    });
  });

  describe("destroy with scale + selection", () => {
    it("should clean up both plugins on destroy", () => {
      list = createVList(
        {
          container,
          items: createTestItems(1000),
          item: { height: 40, template: simpleTemplate },
        },
        [scale(), selection({ mode: "multiple" })],
      );

      (list as any).selectAll();

      expect(() => {
        list!.destroy();
        list = null;
      }).not.toThrow();
    });
  });
});
