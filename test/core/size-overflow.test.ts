/**
 * vlist v2 — Content Size Overflow Warning Tests
 *
 * Verifies that an error event is emitted when content size exceeds
 * the browser's 16M pixel limit without a scale plugin active.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createTestItems, createContainer, simpleTemplate } from "../helpers/factory";
import type { TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import { MAX_VIRTUAL_SIZE } from "../../src/constants";
import type { VList } from "../../src/core/types";

// =============================================================================
// DOM Setup
// =============================================================================

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  setupDOM();
  origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});
afterAll(() => {
  if (origClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", origClientHeight);
  if (origClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", origClientWidth);
  teardownDOM();
});

// =============================================================================
// Helpers
// =============================================================================

let container: HTMLElement;
let list: VList<TestItem> | null;

beforeEach(() => {
  container = createContainer({ width: 300, height: 500 });
  list = null;
});
afterEach(() => {
  list?.destroy();
  container.remove();
});

// =============================================================================
// Overflow warning
// =============================================================================

describe("content size overflow warning", () => {
  it("should emit error when content exceeds MAX_VIRTUAL_SIZE", () => {
    const errors: Array<{ error: Error; context: string }> = [];

    // Start small, subscribe, then grow past the limit
    list = createVList<TestItem>(
      { container, items: createTestItems(10), item: { height: 40, template: simpleTemplate } },
      [],
    );
    list.on("error", (e) => errors.push(e));

    // 500K items × 40px = 20M pixels > 16M
    list.setItems(createTestItems(500_000));

    expect(errors.length).toBe(1);
    expect(errors[0]!.context).toBe("content:size:overflow");
    expect(errors[0]!.error.message).toContain("16000000");
    expect(errors[0]!.error.message).toContain("scale()");
  });

  it("should not emit error when content is under MAX_VIRTUAL_SIZE", () => {
    const errors: Array<{ error: Error; context: string }> = [];

    // 100 items × 40px = 4000 pixels (well under limit)
    list = createVList<TestItem>(
      { container, items: createTestItems(100), item: { height: 40, template: simpleTemplate } },
      [],
    );
    list.on("error", (e) => errors.push(e));
    list.setItems(createTestItems(100));

    expect(errors.length).toBe(0);
  });

  it("should emit error only once (not on every setItems)", () => {
    const errors: Array<{ error: Error; context: string }> = [];

    const bigItems = createTestItems(500_000);

    // Start small so we can subscribe before the warning fires
    list = createVList<TestItem>(
      { container, items: createTestItems(10), item: { height: 40, template: simpleTemplate } },
      [],
    );
    list.on("error", (e) => errors.push(e));

    // Multiple setItems calls — warning should fire once max
    list.setItems(bigItems);
    list.setItems(bigItems);
    list.setItems(bigItems);

    // Only 1 error emitted (deduplicated)
    expect(errors.length).toBe(1);
  });

  it("should not emit when totalSize is exactly at the limit", () => {
    const errors: Array<{ error: Error; context: string }> = [];

    // Exactly 16M pixels: 400K × 40px = 16,000,000 — not over, so no warning
    const items = createTestItems(400_000);

    list = createVList<TestItem>(
      { container, items, item: { height: 40, template: simpleTemplate } },
      [],
    );
    list.on("error", (e) => errors.push(e));
    list.setItems(items);

    expect(errors.length).toBe(0);
  });

  it("MAX_VIRTUAL_SIZE constant is 16 million", () => {
    expect(MAX_VIRTUAL_SIZE).toBe(16_000_000);
  });
});
