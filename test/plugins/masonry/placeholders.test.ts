/**
 * Masonry cells are drawn by the masonry renderer, not the core pipeline, so
 * a placeholder id has to be marked here or the skeleton CSS never applies.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { registerDOM, unregisterDOM } from "../../helpers/dom";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { createVList } from "../../../src/core/create";
import { masonry } from "../../../src/plugins/masonry/plugin";
import { PLACEHOLDER_ID_PREFIX } from "../../../src/constants";
import type { VListItem } from "../../../src/types";

type Card = VListItem & { id: number | string; name: string };

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 240; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 400; }, configurable: true });
});
afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

const cards = (count: number, start: number): Card[] =>
  Array.from({ length: count }, (_, i) => ({ id: start + i, name: `Photo ${start + i}` }));

describe("masonry placeholders", () => {
  it("marks a placeholder cell and fades it in when the item arrives", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const pending: Card[] = Array.from({ length: 8 }, (_, i) => ({
      id: `${PLACEHOLDER_ID_PREFIX}${i}`,
      name: "pending",
    }));
    const list = createVList<Card>(
      {
        container,
        items: pending,
        item: {
          height: 80,
          template: (item) => `<div class="card"><strong>${item.name}</strong><span>subtitle</span></div>`,
        },
      },
      [masonry<Card>({ columns: 2, gap: 0 })],
    );

    try {
      const placeholders = Array.from(container.querySelectorAll<HTMLElement>(".vlist-item--placeholder"));
      expect(placeholders.length).toBeGreaterThan(0);
      for (const cell of placeholders) {
        expect(cell.classList.contains("vlist-masonry-item")).toBe(true);
        expect(cell.getAttribute("data-id")!.startsWith(PLACEHOLDER_ID_PREFIX)).toBe(true);
      }

      list.setItems(cards(8, 0));
      await tick();

      for (const cell of placeholders) {
        expect(cell.isConnected).toBe(true);
        expect(cell.classList.contains("vlist-item--placeholder")).toBe(false);
        expect(cell.classList.contains("vlist-item--replaced")).toBe(true);
        expect(cell.getAttribute("data-id")!.startsWith(PLACEHOLDER_ID_PREFIX)).toBe(false);
      }
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("toggles the class when a pooled cell is reused for a different item", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const items: Card[] = [
      ...Array.from({ length: 8 }, (_, i) => ({ id: `${PLACEHOLDER_ID_PREFIX}${i}`, name: "pending" })),
      ...cards(24, 8),
    ];
    const list = createVList<Card>(
      {
        container,
        items,
        item: { height: 80, template: (item) => String(item.name) },
      },
      [masonry<Card>({ columns: 2, gap: 0 })],
    );

    try {
      const before = Array.from(container.querySelectorAll<HTMLElement>(".vlist-masonry-item"));
      expect(before.some((el) => el.classList.contains("vlist-item--placeholder"))).toBe(true);

      list.scrollToIndex(20);
      await tick();

      const reused = Array.from(container.querySelectorAll<HTMLElement>(".vlist-masonry-item")).find((el) =>
        before.includes(el) && !el.getAttribute("data-id")!.startsWith(PLACEHOLDER_ID_PREFIX));
      expect(reused).toBeDefined();
      expect(reused!.classList.contains("vlist-item--placeholder")).toBe(false);
      expect(reused!.getAttribute("data-id")!.startsWith(PLACEHOLDER_ID_PREFIX)).toBe(false);

      list.scrollToIndex(0);
      await tick();

      const shown = Array.from(container.querySelectorAll<HTMLElement>(".vlist-masonry-item"));
      const placeholderAgain = shown.find((el) =>
        before.includes(el) && el.getAttribute("data-id")!.startsWith(PLACEHOLDER_ID_PREFIX));
      expect(placeholderAgain).toBeDefined();
      expect(placeholderAgain!.classList.contains("vlist-item--placeholder")).toBe(true);
    } finally {
      list.destroy();
      container.remove();
    }
  });
});
