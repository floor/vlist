import { registerDOM, unregisterDOM } from "../helpers/dom";
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { capturePrototypeGeometry } from "../helpers/geometry";
import { createVList } from "../../src/core/create";
import { createContainer, simpleTemplate, type TestItem } from "../helpers/factory";
import { a11y } from "../../src/plugins/a11y/plugin";

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() {
      return 400;
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
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

const makeItems = (n: number): TestItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
    value: i + 1,
  }));

const items1M = makeItems(1_000_000);
const items100 = items1M.slice(0, 100);

describe("1M rows (synthetic compression) + a11y() — End/Home & focus across compression", () => {
  it.serial("clamps focused index and aria-activedescendant when shrinking from 1M rows at End to 100 rows", async () => {
    const container = createContainer({ width: 300, height: 400 });
    const list = createVList<TestItem>(
      {
        container,
        items: items1M,
        item: { height: 48, template: simpleTemplate },
      },
      [a11y()],
    );
    try {
      await tick(50);
      const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
      const content = container.querySelector(".vlist-content") as HTMLElement;
      // Match real browser scrollTop clamping against content.style.height (MAX_VIRTUAL_SIZE = 16,777,216px).
      let rawScrollTop = 0;
      Object.defineProperty(viewport, "scrollTop", {
        configurable: true,
        get() {
          return rawScrollTop;
        },
        set(v: number) {
          const maxH = parseFloat(content.style.height) || 16_777_216;
          rawScrollTop = Math.max(0, Math.min(v, Math.max(0, maxH - 400)));
        },
      });
      const press = (key: string): void => {
        content.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
      };

      // Jump to End of 1,000,000-row compressed list (index 999,999 at 47,999,600px).
      press("End");
      expect(content.getAttribute("aria-activedescendant")).toBe("vlist-item-999999");
      expect(container.querySelector("#vlist-item-999999")?.classList.contains("vlist-item--focused")).toBe(true);

      // Shrink from 1,000,000 rows (synthetic) to 100 rows (native decompression).
      list.setItems(items100);
      await tick(200);

      // Focus must survive decompression by clamping to the new last item (index 99),
      // rather than stranding aria-activedescendant="vlist-item-999999" on a nonexistent element.
      const activeId = content.getAttribute("aria-activedescendant");
      expect(activeId).toBe("vlist-item-99");
      expect(container.querySelector(`#${activeId}`)).not.toBeNull();
      expect(container.querySelector(".vlist-item--focused")?.getAttribute("data-index")).toBe("99");
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it.serial("preserves bottom-aligned scroll position when pressing End then ArrowUp while native-to-synthetic swap is pending", async () => {
    const container = createContainer({ width: 300, height: 400 });
    const list = createVList<TestItem>(
      {
        container,
        items: items100,
        item: { height: 48, template: simpleTemplate },
      },
      [a11y()],
    );
    try {
      await tick(50);
      const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
      const content = container.querySelector(".vlist-content") as HTMLElement;
      // Match real browser scrollTop clamping against content.style.height (MAX_VIRTUAL_SIZE = 16,777,216px).
      let rawScrollTop = 0;
      Object.defineProperty(viewport, "scrollTop", {
        configurable: true,
        get() {
          return rawScrollTop;
        },
        set(v: number) {
          const maxH = parseFloat(content.style.height) || 16_777_216;
          rawScrollTop = Math.max(0, Math.min(v, Math.max(0, maxH - 400)));
        },
      });
      const press = (key: string): void => {
        content.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
      };

      // Start a scroll so isScrolling === true, then grow to 1,000,000 rows so swapInput is deferred (pending === true).
      list.scrollToIndex(10);
      list.setItems(items1M);

      // Press End (target 47,999,600px, where rows 999,991..999,999 are all inside the 400px viewport),
      // then press ArrowUp (to 999,998, which is already in view at 47,999,600px).
      press("End");
      press("ArrowUp");

      await tick(200);

      // Because row 999,998 (offset 47,999,904..47,999,952) is already inside [47,999,600, 48,000,000],
      // ArrowUp from 999,999 should keep scrollPosition at 47,999,600 instead of scrolling up to 47,999,552.
      expect(list.getScrollPosition()).toBe(47_999_600);
    } finally {
      list.destroy();
      container.remove();
    }
  });
});
