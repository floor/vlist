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
import { createContainer, simpleTemplate, type TestItem } from "../helpers/factory";
import { data as dataPlugin } from "../../src/plugins/async/plugin";
import { selection } from "../../src/plugins/selection/plugin";
import type { VListAdapter } from "../../src/types";

function waitForLoad(list: VList<TestItem>): Promise<void> {
  return new Promise((resolve) => {
    const unsub = list.on("load:end" as any, () => {
      unsub();
      resolve();
    });
    setTimeout(resolve, 200);
  });
}

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

function createMockAdapter(total: number = 100): VListAdapter<TestItem> {
  return {
    read: mock(async ({ offset, limit }) => {
      const items: TestItem[] = [];
      const end = Math.min(offset + limit, total);
      for (let i = offset; i < end; i++) {
        items.push({ id: i + 1, name: `Item ${i + 1}`, value: (i + 1) * 10 });
      }
      return { items, total, hasMore: end < total };
    }),
  };
}

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

describe("async + selection integration", () => {
  describe("selection with async data", () => {
    it("should select items after async load completes", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [dataPlugin({ adapter }), selection({ mode: "multiple" })],
      );

      await waitForLoad(list);

      (list as any).select(1, 2, 3);
      const selected: number[] = (list as any).getSelected();
      expect(selected).toContain(1);
      expect(selected).toContain(2);
      expect(selected).toContain(3);
    });

    it("should select items before data loads (selection is id-based)", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [dataPlugin({ adapter, total: 100 }), selection({ mode: "multiple" })],
      );

      (list as any).select(5, 10);
      const selected: number[] = (list as any).getSelected();
      expect(selected).toContain(5);
      expect(selected).toContain(10);

      await waitForLoad(list);

      const selectedAfter: number[] = (list as any).getSelected();
      expect(selectedAfter).toContain(5);
      expect(selectedAfter).toContain(10);
    });

    it("should preserve selection across reload", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [dataPlugin({ adapter }), selection({ mode: "multiple" })],
      );

      await waitForLoad(list);

      (list as any).select(1, 5, 10);

      (list as any).reload();
      await waitForLoad(list);

      const selected: number[] = (list as any).getSelected();
      expect(selected).toContain(1);
      expect(selected).toContain(5);
      expect(selected).toContain(10);
    });

    it("should clear selection with async data", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [dataPlugin({ adapter }), selection({ mode: "multiple" })],
      );

      await waitForLoad(list);

      (list as any).select(1, 2, 3);
      (list as any).clearSelection();

      expect((list as any).getSelected().length).toBe(0);
    });

    it("should get selected items when data is loaded", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [dataPlugin({ adapter }), selection({ mode: "multiple" })],
      );

      await waitForLoad(list);

      (list as any).select(1, 2);
      const items: TestItem[] = (list as any).getSelectedItems();
      expect(items.length).toBe(2);
      expect(items[0].id).toBe(1);
      expect(items[1].id).toBe(2);
    });
  });

  describe("selectAll with async", () => {
    it("should select all loaded items", async () => {
      const adapter = createMockAdapter(50);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [dataPlugin({ adapter, total: 50 }), selection({ mode: "multiple" })],
      );

      await waitForLoad(list);

      (list as any).selectAll();
      const selected: number[] = (list as any).getSelected();
      expect(selected.length).toBeGreaterThan(0);
    });
  });

  describe("single selection with async", () => {
    it("should enforce single selection with async data", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [dataPlugin({ adapter }), selection({ mode: "single" })],
      );

      await waitForLoad(list);

      (list as any).select(1);
      (list as any).select(5);

      const selected: number[] = (list as any).getSelected();
      expect(selected.length).toBe(1);
      expect(selected).toContain(5);
    });
  });

  describe("selection events with async", () => {
    it("should emit selection:change with async data", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [dataPlugin({ adapter }), selection({ mode: "multiple" })],
      );

      await waitForLoad(list);

      const handler = mock(() => {});
      list.on("selection:change" as any, handler);

      (list as any).select(1);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
