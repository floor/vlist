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
import { data as dataPlugin } from "../../src/plugins/data/plugin";
import { snapshots } from "../../src/plugins/snapshots/plugin";
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
  sessionStorage.clear();
});

afterEach(() => {
  if (list) {
    list.destroy();
    list = null;
  }
  container.remove();
});

describe("async + snapshots integration", () => {
  describe("snapshot capture", () => {
    it("should capture scroll snapshot after async load", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [dataPlugin({ adapter }), snapshots()],
      );

      await waitForLoad(list);

      const snapshot = (list as any).getScrollSnapshot();
      expect(snapshot).toBeDefined();
      expect(typeof snapshot.index).toBe("number");
      expect(typeof snapshot.total).toBe("number");
    });

    it("should capture snapshot with selection state", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [
          dataPlugin({ adapter }),
          selection({ mode: "multiple" }),
          snapshots(),
        ],
      );

      await waitForLoad(list);

      (list as any).select(1, 5, 10);
      const snapshot = (list as any).getScrollSnapshot();
      expect(snapshot.selectedIds).toBeDefined();
      expect(snapshot.selectedIds).toContain(1);
      expect(snapshot.selectedIds).toContain(5);
      expect(snapshot.selectedIds).toContain(10);
    });
  });

  describe("snapshot restore", () => {
    it("should restore scroll position from snapshot", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [dataPlugin({ adapter }), snapshots()],
      );

      await waitForLoad(list);

      const snapshot = (list as any).getScrollSnapshot();
      (list as any).restoreScroll(snapshot);

      expect(list.getScrollPosition()).toBeDefined();
    });
  });

  describe("auto-save with async", () => {
    it("should auto-save to sessionStorage when key is provided", async () => {
      const storageKey = "test-async-snapshots-autosave";
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [dataPlugin({ adapter }), snapshots({ autoSave: storageKey })],
      );

      await waitForLoad(list);

      (list as any)._saveSnapshot();
      const stored = sessionStorage.getItem(storageKey);
      expect(stored).not.toBeNull();
    });

    it("should restore from sessionStorage on creation", async () => {
      const storageKey = "test-async-snapshots-restore-" + Date.now();
      const adapter = createMockAdapter(100);

      const container1 = createContainer({ width: 300, height: 500 });
      const list1 = createVList(
        { container: container1, item: { height: 40, template: simpleTemplate } },
        [dataPlugin({ adapter }), snapshots({ autoSave: storageKey })],
      );

      await waitForLoad(list1);
      (list1 as any)._saveSnapshot();
      list1.destroy();
      container1.remove();

      const container2 = createContainer({ width: 300, height: 500 });
      const list2 = createVList(
        { container: container2, item: { height: 40, template: simpleTemplate } },
        [dataPlugin({ adapter }), snapshots({ autoSave: storageKey })],
      );

      await waitForLoad(list2);

      expect(list2.total).toBeGreaterThan(0);
      list2.destroy();
      container2.remove();
      sessionStorage.removeItem(storageKey);
    });
  });

  describe("snapshot with selection restore", () => {
    it("should restore selection from snapshot", async () => {
      const adapter = createMockAdapter(100);
      list = createVList(
        { container, item: { height: 40, template: simpleTemplate } },
        [
          dataPlugin({ adapter }),
          selection({ mode: "multiple" }),
          snapshots(),
        ],
      );

      await waitForLoad(list);
      (list as any).select(1, 5, 10);

      const snapshot = (list as any).getScrollSnapshot();

      (list as any).clearSelection();
      expect((list as any).getSelected().length).toBe(0);

      (list as any).restoreScroll(snapshot, true);

      const selected: number[] = (list as any).getSelected();
      expect(selected).toContain(1);
      expect(selected).toContain(5);
      expect(selected).toContain(10);
    });
  });
});
