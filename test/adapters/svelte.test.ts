// test/adapters/svelte.test.ts
/**
 * Tests for the Svelte action adapter (vlist/svelte)
 *
 * The Svelte adapter is a plain function following the Svelte action contract:
 *   (node: HTMLElement, options) => { update?, destroy? }
 *
 * No Svelte runtime is needed — we test the action directly with JSDOM.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { JSDOM } from "jsdom";

import {
  vlist,
  onVListEvent,
  type VListActionOptions,
  type VListActionConfig,
} from "../../src/adapters/svelte";
import type { VListItem, VList } from "../../src/types";

// =============================================================================
// JSDOM Setup
// =============================================================================

let dom: JSDOM;
let document: Document;
let container: HTMLElement;

const setupDOM = () => {
  dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="root"></div></body></html>',
    {
      url: "http://localhost/",
      pretendToBeVisual: true,
    },
  );
  document = dom.window.document;

  // Inject globals for vlist internals that rely on browser APIs
  (globalThis as any).window = dom.window;
  (globalThis as any).document = document;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).Element = dom.window.Element;
  (globalThis as any).MutationObserver = dom.window.MutationObserver;
  (globalThis as any).MouseEvent = dom.window.MouseEvent;
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(cb, 0);
  (globalThis as any).cancelAnimationFrame = clearTimeout;
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // JSDOM doesn't implement Element.prototype.scrollTo — patch it globally
  // so vlist's internal elements (scroll container etc.) also get the mock.
  if (!dom.window.Element.prototype.scrollTo) {
    dom.window.Element.prototype.scrollTo = function () {};
  }

  container = document.createElement("div");
  container.style.height = "400px";
  container.style.overflow = "auto";
  Object.defineProperty(container, "clientHeight", { value: 400 });
  Object.defineProperty(container, "clientWidth", { value: 400 });
  document.body.appendChild(container);
};

const teardownDOM = () => {
  if (container && container.parentNode) {
    container.parentNode.removeChild(container);
  }
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Element;
  delete (globalThis as any).MutationObserver;
  delete (globalThis as any).MouseEvent;
  delete (globalThis as any).requestAnimationFrame;
  delete (globalThis as any).cancelAnimationFrame;
  delete (globalThis as any).ResizeObserver;
};

// =============================================================================
// Test Helpers
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
}

const createItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
  }));

const createConfig = (items: TestItem[]): VListActionConfig<TestItem> => ({
  item: {
    height: 40,
    template: (item: TestItem) => `<div class="item">${item.name}</div>`,
  },
  items,
});

// =============================================================================
// Tests
// =============================================================================

describe("vlist Svelte action", () => {
  beforeEach(setupDOM);
  afterEach(teardownDOM);

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe("lifecycle", () => {
    it("should create a vlist instance on the provided node", () => {
      const items = createItems(20);
      const options: VListActionOptions<TestItem> = {
        config: createConfig(items),
      };

      const action = vlist(container, options);

      // The action should have attached vlist DOM to the container
      expect(container.children.length).toBeGreaterThan(0);

      action.destroy?.();
    });

    it("should return an object with update and destroy methods", () => {
      const items = createItems(5);
      const options: VListActionOptions<TestItem> = {
        config: createConfig(items),
      };

      const action = vlist(container, options);

      expect(typeof action.update).toBe("function");
      expect(typeof action.destroy).toBe("function");

      action.destroy?.();
    });

    it("should clean up DOM on destroy", () => {
      const items = createItems(10);
      const options: VListActionOptions<TestItem> = {
        config: createConfig(items),
      };

      const action = vlist(container, options);

      // vlist creates child elements
      expect(container.children.length).toBeGreaterThan(0);

      action.destroy?.();

      // After destroy, container should be emptied
      expect(container.children.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // onInstance callback
  // ---------------------------------------------------------------------------

  describe("onInstance callback", () => {
    it("should call onInstance with the vlist instance on mount", () => {
      const items = createItems(10);
      let capturedInstance: VList<TestItem> | null = null;

      const options: VListActionOptions<TestItem> = {
        config: createConfig(items),
        onInstance: (inst) => {
          capturedInstance = inst;
        },
      };

      const action = vlist(container, options);

      expect(capturedInstance).not.toBeNull();
      expect(typeof capturedInstance!.scrollToIndex).toBe("function");
      expect(typeof capturedInstance!.setItems).toBe("function");
      expect(typeof capturedInstance!.destroy).toBe("function");
      expect(typeof capturedInstance!.on).toBe("function");

      action.destroy?.();
    });

    it("should provide a working instance via onInstance", () => {
      const items = createItems(50);
      let instance: VList<TestItem> | null = null;

      const options: VListActionOptions<TestItem> = {
        config: createConfig(items),
        onInstance: (inst) => {
          instance = inst;
        },
      };

      const action = vlist(container, options);

      // Verify the instance exposes items
      expect(instance).not.toBeNull();
      expect(instance!.total).toBe(50);

      action.destroy?.();
    });

    it("should call onInstance again on update if provided", () => {
      const items = createItems(10);
      const calls: VList<TestItem>[] = [];

      const options: VListActionOptions<TestItem> = {
        config: createConfig(items),
        onInstance: (inst) => {
          calls.push(inst);
        },
      };

      const action = vlist(container, options);

      expect(calls.length).toBe(1);

      // Update with new options that also have onInstance
      action.update?.({
        config: createConfig(createItems(20)),
        onInstance: (inst) => {
          calls.push(inst);
        },
      });

      // onInstance should have been called again
      expect(calls.length).toBe(2);

      // The instance should be the same (stable reference)
      expect(calls[0]).toBe(calls[1]);

      action.destroy?.();
    });
  });

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  describe("update", () => {
    it("should update items when update is called with new items", () => {
      const initialItems = createItems(10);
      let instance: VList<TestItem> | null = null;

      const options: VListActionOptions<TestItem> = {
        config: createConfig(initialItems),
        onInstance: (inst) => {
          instance = inst;
        },
      };

      const action = vlist(container, options);

      expect(instance!.total).toBe(10);

      // Simulate Svelte reactivity by calling update
      const newItems = createItems(25);
      action.update?.({
        config: createConfig(newItems),
      });

      expect(instance!.total).toBe(25);

      action.destroy?.();
    });

    it("should handle update with empty items", () => {
      const initialItems = createItems(10);
      let instance: VList<TestItem> | null = null;

      const options: VListActionOptions<TestItem> = {
        config: createConfig(initialItems),
        onInstance: (inst) => {
          instance = inst;
        },
      };

      const action = vlist(container, options);

      expect(instance!.total).toBe(10);

      action.update?.({
        config: createConfig([]),
      });

      expect(instance!.total).toBe(0);

      action.destroy?.();
    });

    it("should handle multiple sequential updates", () => {
      const initialItems = createItems(5);
      let instance: VList<TestItem> | null = null;

      const options: VListActionOptions<TestItem> = {
        config: createConfig(initialItems),
        onInstance: (inst) => {
          instance = inst;
        },
      };

      const action = vlist(container, options);

      for (let i = 1; i <= 5; i++) {
        const count = i * 10;
        action.update?.({
          config: createConfig(createItems(count)),
        });
        expect(instance!.total).toBe(count);
      }

      action.destroy?.();
    });

    it("should not break when update has no items", () => {
      const items = createItems(10);
      let instance: VList<TestItem> | null = null;

      const options: VListActionOptions<TestItem> = {
        config: createConfig(items),
        onInstance: (inst) => {
          instance = inst;
        },
      };

      const action = vlist(container, options);

      // Update config without items (e.g., adapter-based config)
      const adapterConfig: VListActionConfig<TestItem> = {
        item: {
          height: 40,
          template: (item: TestItem) => `<div>${item.name}</div>`,
        },
        // No items property
      };

      // Should not throw
      action.update?.({ config: adapterConfig });

      // Instance should still be valid
      expect(instance).not.toBeNull();

      action.destroy?.();
    });
  });

  // ---------------------------------------------------------------------------
  // Instance methods via onInstance
  // ---------------------------------------------------------------------------

  describe("instance methods", () => {
    it("should allow scrollToIndex through instance", () => {
      const items = createItems(100);
      let instance: VList<TestItem> | null = null;

      const action = vlist(container, {
        config: createConfig(items),
        onInstance: (inst) => {
          instance = inst;
        },
      });

      expect(instance).not.toBeNull();

      // Should not throw
      instance!.scrollToIndex(50);

      action.destroy?.();
    });

    it("should allow getSelected through instance with selection mode", () => {
      const items = createItems(20);
      let instance: VList<TestItem> | null = null;

      const action = vlist(container, {
        config: {
          ...createConfig(items),
          selection: { mode: "multiple" },
        },
        onInstance: (inst) => {
          instance = inst;
        },
      });

      expect(instance).not.toBeNull();
      expect(instance!.getSelected()).toEqual([]);

      instance!.select(1, 2, 3);
      expect(instance!.getSelected()).toEqual([1, 2, 3]);

      action.destroy?.();
    });
  });

  // ---------------------------------------------------------------------------
  // onVListEvent helper
  // ---------------------------------------------------------------------------

  describe("onVListEvent", () => {
    it("should subscribe to events and return an unsubscribe function", () => {
      const items = createItems(20);
      let instance: VList<TestItem> | null = null;

      const action = vlist(container, {
        config: {
          ...createConfig(items),
          selection: { mode: "single" },
        },
        onInstance: (inst) => {
          instance = inst;
        },
      });

      const selectionChanges: Array<{ selected: Array<string | number> }> = [];

      const unsub = onVListEvent(instance!, "selection:change", (payload) => {
        selectionChanges.push({ selected: payload.selected });
      });

      expect(typeof unsub).toBe("function");

      // Trigger a selection
      instance!.select(1);
      expect(selectionChanges.length).toBe(1);
      expect(selectionChanges[0]!.selected).toEqual([1]);

      // Unsubscribe
      unsub();

      // This should not add to selectionChanges
      instance!.select(2);
      expect(selectionChanges.length).toBe(1);

      action.destroy?.();
    });

    it("should return a callable unsubscribe even for valid events", () => {
      const items = createItems(10);
      let instance: VList<TestItem> | null = null;

      const action = vlist(container, {
        config: createConfig(items),
        onInstance: (inst) => {
          instance = inst;
        },
      });

      const unsub = onVListEvent(instance!, "scroll", () => {});

      // Should not throw when called
      expect(() => unsub()).not.toThrow();

      action.destroy?.();
    });
  });

  // ---------------------------------------------------------------------------
  // Edge Cases
  // ---------------------------------------------------------------------------

  describe("edge cases", () => {
    it("should handle action with zero items", () => {
      const options: VListActionOptions<TestItem> = {
        config: createConfig([]),
      };

      const action = vlist(container, options);

      // Should not throw
      expect(container.children.length).toBeGreaterThan(0);

      action.destroy?.();
    });

    it("should handle large item count", () => {
      const items = createItems(10000);
      let instance: VList<TestItem> | null = null;

      const action = vlist(container, {
        config: createConfig(items),
        onInstance: (inst) => {
          instance = inst;
        },
      });

      expect(instance!.total).toBe(10000);

      action.destroy?.();
    });

    it("should work without onInstance callback", () => {
      const items = createItems(10);

      const action = vlist(container, {
        config: createConfig(items),
        // No onInstance
      });

      // Should still work — just no way to get instance from outside
      expect(container.children.length).toBeGreaterThan(0);

      action.destroy?.();
    });

    it("should handle variable height items", () => {
      const items = createItems(30);
      let instance: VList<TestItem> | null = null;

      const config: VListActionConfig<TestItem> = {
        item: {
          height: (index: number) => (index % 2 === 0 ? 40 : 60),
          template: (item: TestItem) => `<div>${item.name}</div>`,
        },
        items,
      };

      const action = vlist(container, {
        config,
        onInstance: (inst) => {
          instance = inst;
        },
      });

      expect(instance!.total).toBe(30);

      action.destroy?.();
    });
  });
});
