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
import { async as asyncPlugin } from "../../src/plugins/async/plugin";
import { page } from "../../src/plugins/page/plugin";
import { createContainer, simpleTemplate, type TestItem } from "../helpers/factory";
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
  window.scrollTo = (() => {}) as any;
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

function createMockAdapter(
  total: number = 200,
): VListAdapter<TestItem> & { readCalls: Array<{ offset: number; limit: number }> } {
  const readCalls: Array<{ offset: number; limit: number }> = [];
  return {
    readCalls,
    read: mock(async ({ offset, limit }) => {
      readCalls.push({ offset, limit });
      const items: TestItem[] = [];
      const end = Math.min(offset + limit, total);
      for (let i = offset; i < end; i++) {
        items.push({ id: i + 1, name: `Item ${i + 1}`, value: (i + 1) * 10 });
      }
      return { items, total, hasMore: end < total };
    }),
  };
}

function createDelayedAdapter(
  total: number = 200,
  delayMs: number = 50,
): VListAdapter<TestItem> & { readCalls: Array<{ offset: number; limit: number }> } {
  const readCalls: Array<{ offset: number; limit: number }> = [];
  return {
    readCalls,
    read: mock(async ({ offset, limit }) => {
      readCalls.push({ offset, limit });
      await new Promise((r) => setTimeout(r, delayMs));
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

describe("async + page integration", () => {
  describe("async data loading", () => {
    it("should load initial data chunk on creation", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [asyncPlugin({ adapter }), page()],
      );

      await waitForLoad(list);
      expect(adapter.read).toHaveBeenCalled();
      expect(list.total).toBeGreaterThan(0);
    });

    it("should report correct total from adapter response", async () => {
      const adapter = createMockAdapter(250);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [asyncPlugin({ adapter, total: 250 })],
      );

      await waitForLoad(list);
      expect(list.total).toBe(250);
    });

    it("should render placeholder items before data loads", () => {
      const adapter = createDelayedAdapter(100, 1000);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [asyncPlugin({ adapter, total: 100 })],
      );

      expect(list.total).toBe(100);
    });

    it("should replace placeholders after data arrives", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [asyncPlugin({ adapter, total: 100 })],
      );

      await waitForLoad(list);

      const rendered = list.element.querySelectorAll("[data-index]");
      expect(rendered.length).toBeGreaterThan(0);

      const firstItem = rendered[0] as HTMLElement;
      expect(firstItem.textContent).toContain("Item 1");
    });
  });

  describe("async with page (window scroll)", () => {
    it("should work with page plugin for window scroll mode", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [asyncPlugin({ adapter }), page()],
      );

      await waitForLoad(list);
      expect(adapter.read).toHaveBeenCalled();
      expect(list.total).toBeGreaterThan(0);
    });

    it("should support page plugin with scroll padding", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [
          asyncPlugin({ adapter }),
          page({ scrollPadding: { top: 60, bottom: 20 } }),
        ],
      );

      await waitForLoad(list);
      expect(list.total).toBe(100);
    });
  });

  describe("reload", () => {
    it("should reload data via the reload method", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [asyncPlugin({ adapter })],
      );

      await waitForLoad(list);
      const callsBefore = adapter.readCalls.length;

      (list as any).reload();
      await waitForLoad(list);

      expect(adapter.readCalls.length).toBeGreaterThan(callsBefore);
    });
  });

  describe("autoLoad", () => {
    it("should suppress initial load when autoLoad is false", () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [asyncPlugin({ adapter, autoLoad: false, total: 100 })],
      );

      expect(adapter.readCalls.length).toBe(0);
    });

    it("should allow manual load after autoLoad: false", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [asyncPlugin({ adapter, autoLoad: false, total: 100 })],
      );

      expect(adapter.readCalls.length).toBe(0);

      (list as any).loadVisibleRange();
      await waitForLoad(list);

      expect(adapter.readCalls.length).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    it("should handle adapter errors gracefully", async () => {
      const adapter: VListAdapter<TestItem> = {
        read: mock(async () => {
          throw new Error("Network error");
        }),
      };

      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [asyncPlugin({ adapter, total: 100 })],
      );

      const ref = list;
      await new Promise<void>((resolve) => {
        ref.on("error" as any, () => resolve());
        setTimeout(resolve, 50);
      });
      expect(ref.total).toBe(100);
    });
  });

  describe("destroy with async", () => {
    it("should clean up async resources on destroy", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [asyncPlugin({ adapter })],
      );

      await waitForLoad(list);

      expect(() => {
        list!.destroy();
        list = null;
      }).not.toThrow();
    });

    it("should not trigger loads after destroy", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [asyncPlugin({ adapter })],
      );

      await waitForLoad(list);
      const callsBeforeDestroy = adapter.readCalls.length;

      list.destroy();
      list = null;

      await new Promise((r) => setTimeout(r, 50));
      expect(adapter.readCalls.length).toBe(callsBeforeDestroy);
    });
  });
});
