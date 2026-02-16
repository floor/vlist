/**
 * vlist - Placeholder System Tests
 * Tests for smart placeholder generation, structure analysis, and utility functions
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  createPlaceholderManager,
  isPlaceholderItem,
  filterPlaceholders,
  countRealItems,
  replacePlaceholders,
  type PlaceholderManager,
} from "../../src/plugins/data/placeholder";
import type { VListItem } from "../../src/types";

// =============================================================================
// Test Data
// =============================================================================

interface TestItem extends VListItem {
  id: number;
  name: string;
  email: string;
  age: number;
  active: boolean;
}

interface MixedItem extends VListItem {
  id: number;
  title: string;
  tags: string[];
  meta: Record<string, unknown>;
  count: number;
  visible: boolean;
}

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`,
    age: 20 + i,
    active: i % 2 === 0,
  }));

const createMixedItems = (count: number): MixedItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `Item ${i + 1} with a title`,
    tags: ["tag1", "tag2"],
    meta: { key: "value" },
    count: i * 10,
    visible: true,
  }));

// =============================================================================
// createPlaceholderManager
// =============================================================================

describe("createPlaceholderManager", () => {
  // ===========================================================================
  // Initialization
  // ===========================================================================

  describe("initialization", () => {
    it("should create a placeholder manager with default config", () => {
      const manager = createPlaceholderManager();

      expect(manager).toBeDefined();
      expect(typeof manager.analyzeStructure).toBe("function");
      expect(typeof manager.hasAnalyzedStructure).toBe("function");
      expect(typeof manager.generate).toBe("function");
      expect(typeof manager.generateRange).toBe("function");
      expect(typeof manager.isPlaceholder).toBe("function");
      expect(typeof manager.getPlaceholderKey).toBe("function");
      expect(typeof manager.clear).toBe("function");
    });

    it("should not have analyzed structure initially", () => {
      const manager = createPlaceholderManager();
      expect(manager.hasAnalyzedStructure()).toBe(false);
    });

    it("should return the placeholder flag key", () => {
      const manager = createPlaceholderManager();
      expect(manager.getPlaceholderKey()).toBe("_isPlaceholder");
    });
  });

  // ===========================================================================
  // Structure Analysis
  // ===========================================================================

  describe("analyzeStructure", () => {
    it("should analyze structure from sample items", () => {
      const manager = createPlaceholderManager<TestItem>();
      const items = createTestItems(5);

      manager.analyzeStructure(items);
      expect(manager.hasAnalyzedStructure()).toBe(true);
    });

    it("should not analyze empty items array", () => {
      const manager = createPlaceholderManager<TestItem>();

      manager.analyzeStructure([]);
      expect(manager.hasAnalyzedStructure()).toBe(false);
    });

    it("should not re-analyze if already analyzed", () => {
      const manager = createPlaceholderManager<TestItem>();
      const items = createTestItems(5);

      manager.analyzeStructure(items);
      expect(manager.hasAnalyzedStructure()).toBe(true);

      // Second call should be a no-op (structure already analyzed)
      const differentItems = createTestItems(10);
      manager.analyzeStructure(differentItems);

      // Still analyzed from first call
      expect(manager.hasAnalyzedStructure()).toBe(true);
    });

    it("should not analyze when disabled", () => {
      const manager = createPlaceholderManager<TestItem>({ enabled: false });
      const items = createTestItems(5);

      manager.analyzeStructure(items);
      expect(manager.hasAnalyzedStructure()).toBe(false);
    });

    it("should respect maxSampleSize", () => {
      const manager = createPlaceholderManager<TestItem>({
        maxSampleSize: 3,
      });
      const items = createTestItems(100);

      // Should not crash and should analyze only up to 3 items
      manager.analyzeStructure(items);
      expect(manager.hasAnalyzedStructure()).toBe(true);
    });

    it("should detect string fields", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const placeholder = manager.generate(0);

      // name and email should be masked strings (not empty, not zero)
      expect(typeof (placeholder as any).name).toBe("string");
      expect(typeof (placeholder as any).email).toBe("string");
      expect((placeholder as any).name.length).toBeGreaterThan(0);
      expect((placeholder as any).email.length).toBeGreaterThan(0);
    });

    it("should detect number fields", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const placeholder = manager.generate(0);

      // age is a number field — placeholder value should be 0
      expect((placeholder as any).age).toBe(0);
    });

    it("should detect boolean fields", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const placeholder = manager.generate(0);

      // active is a boolean field — placeholder value should be false
      expect((placeholder as any).active).toBe(false);
    });

    it("should detect array fields", () => {
      const manager = createPlaceholderManager<MixedItem>();
      manager.analyzeStructure(createMixedItems(5));

      const placeholder = manager.generate(0);

      expect(Array.isArray((placeholder as any).tags)).toBe(true);
      expect((placeholder as any).tags).toHaveLength(0);
    });

    it("should detect object fields", () => {
      const manager = createPlaceholderManager<MixedItem>();
      manager.analyzeStructure(createMixedItems(5));

      const placeholder = manager.generate(0);

      expect(typeof (placeholder as any).meta).toBe("object");
      expect((placeholder as any).meta).not.toBeNull();
    });

    it("should skip id and underscore-prefixed fields", () => {
      interface InternalItem extends VListItem {
        id: number;
        _internal: string;
        _cache: number;
        name: string;
      }

      const items: InternalItem[] = [
        { id: 1, _internal: "secret", _cache: 42, name: "Alice" },
        { id: 2, _internal: "hidden", _cache: 99, name: "Bob" },
      ];

      const manager = createPlaceholderManager<InternalItem>();
      manager.analyzeStructure(items);

      const placeholder = manager.generate(0);

      // Internal fields should not be generated from analysis
      expect((placeholder as any)._internal).toBeUndefined();
      expect((placeholder as any)._cache).toBeUndefined();

      // name should be generated
      expect(typeof (placeholder as any).name).toBe("string");
    });
  });

  // ===========================================================================
  // Placeholder Generation
  // ===========================================================================

  describe("generate", () => {
    it("should generate a placeholder with unique id", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const p1 = manager.generate(0);
      const p2 = manager.generate(1);

      expect(typeof p1.id).toBe("string");
      expect(typeof p2.id).toBe("string");
      expect(p1.id).not.toBe(p2.id);
    });

    it("should generate placeholder ids with prefix", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const placeholder = manager.generate(0);
      expect(String(placeholder.id)).toContain("__placeholder_");
    });

    it("should mark placeholders with _isPlaceholder flag", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const placeholder = manager.generate(0);
      expect((placeholder as any)._isPlaceholder).toBe(true);
    });

    it("should generate basic placeholder without structure analysis", () => {
      const manager = createPlaceholderManager<TestItem>();

      // No analyzeStructure call
      const placeholder = manager.generate(0);

      expect(placeholder).toBeDefined();
      expect((placeholder as any)._isPlaceholder).toBe(true);
      // Should have a label field as fallback
      expect(typeof (placeholder as any).label).toBe("string");
      expect((placeholder as any).label.length).toBeGreaterThan(0);
    });

    it("should use custom mask character", () => {
      const manager = createPlaceholderManager<TestItem>({
        maskCharacter: "▒",
      });
      manager.analyzeStructure(createTestItems(5));

      const placeholder = manager.generate(0);
      const nameField = (placeholder as any).name as string;

      expect(nameField).toContain("▒");
      expect(nameField).not.toContain("█");
    });

    it("should use default mask character (█)", () => {
      const manager = createPlaceholderManager<TestItem>({
        randomVariance: false,
      });
      manager.analyzeStructure(createTestItems(5));

      const placeholder = manager.generate(0);
      const nameField = (placeholder as any).name as string;

      expect(nameField).toContain("█");
    });

    it("should generate consistent lengths when randomVariance is false", () => {
      const manager = createPlaceholderManager<TestItem>({
        randomVariance: false,
      });
      manager.analyzeStructure(createTestItems(5));

      const placeholders = Array.from({ length: 10 }, (_, i) =>
        manager.generate(i),
      );

      // With no variance, all name lengths should be the same (average)
      const nameLengths = placeholders.map(
        (p) => ((p as any).name as string).length,
      );
      const uniqueLengths = new Set(nameLengths);
      expect(uniqueLengths.size).toBe(1);
    });

    it("should use custom generator when provided", () => {
      const customGenerator = (index: number): TestItem => ({
        id: index + 1000,
        name: `Custom Placeholder ${index}`,
        email: "loading@example.com",
        age: 0,
        active: false,
      });

      const manager = createPlaceholderManager<TestItem>({ customGenerator });

      const placeholder = manager.generate(5);

      // Custom generator's id is preserved (spread into the result)
      expect(placeholder.id).toBe(1005);
      expect((placeholder as any).name).toBe("Custom Placeholder 5");
      expect((placeholder as any).email).toBe("loading@example.com");
      // _isPlaceholder flag is always added
      expect((placeholder as any)._isPlaceholder).toBe(true);
    });

    it("should store _index on generated placeholders", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const placeholder = manager.generate(42);
      expect((placeholder as any)._index).toBe(42);
    });
  });

  // ===========================================================================
  // generateRange
  // ===========================================================================

  describe("generateRange", () => {
    it("should generate a range of placeholders", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const placeholders = manager.generateRange(0, 4);

      expect(placeholders).toHaveLength(5);
      for (const p of placeholders) {
        expect(manager.isPlaceholder(p)).toBe(true);
      }
    });

    it("should generate placeholders with unique ids", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const placeholders = manager.generateRange(0, 9);
      const ids = placeholders.map((p) => p.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(10);
    });

    it("should handle single item range", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const placeholders = manager.generateRange(5, 5);
      expect(placeholders).toHaveLength(1);
    });

    it("should pass correct indices to generate", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const placeholders = manager.generateRange(10, 12);

      expect((placeholders[0] as any)._index).toBe(10);
      expect((placeholders[1] as any)._index).toBe(11);
      expect((placeholders[2] as any)._index).toBe(12);
    });
  });

  // ===========================================================================
  // isPlaceholder
  // ===========================================================================

  describe("isPlaceholder", () => {
    it("should detect placeholders generated by the manager", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const placeholder = manager.generate(0);
      expect(manager.isPlaceholder(placeholder)).toBe(true);
    });

    it("should return false for real items", () => {
      const manager = createPlaceholderManager<TestItem>();

      const realItem: TestItem = {
        id: 1,
        name: "Real User",
        email: "real@example.com",
        age: 25,
        active: true,
      };

      expect(manager.isPlaceholder(realItem)).toBe(false);
    });

    it("should return false for null", () => {
      const manager = createPlaceholderManager();
      expect(manager.isPlaceholder(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      const manager = createPlaceholderManager();
      expect(manager.isPlaceholder(undefined)).toBe(false);
    });

    it("should return false for primitives", () => {
      const manager = createPlaceholderManager();
      expect(manager.isPlaceholder(42)).toBe(false);
      expect(manager.isPlaceholder("string")).toBe(false);
      expect(manager.isPlaceholder(true)).toBe(false);
    });

    it("should return false for objects without the flag", () => {
      const manager = createPlaceholderManager();
      expect(manager.isPlaceholder({ id: 1, name: "test" })).toBe(false);
    });

    it("should return true for manually flagged objects", () => {
      const manager = createPlaceholderManager();
      const fakeplaceholder = { id: 1, _isPlaceholder: true };
      expect(manager.isPlaceholder(fakeplaceholder)).toBe(true);
    });
  });

  // ===========================================================================
  // clear
  // ===========================================================================

  describe("clear", () => {
    it("should reset analyzed structure", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));
      expect(manager.hasAnalyzedStructure()).toBe(true);

      manager.clear();
      expect(manager.hasAnalyzedStructure()).toBe(false);
    });

    it("should allow re-analysis after clear", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      manager.clear();

      manager.analyzeStructure(createTestItems(10));
      expect(manager.hasAnalyzedStructure()).toBe(true);
    });

    it("should reset id counter", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      // Generate some placeholders
      manager.generate(0);
      manager.generate(1);

      // Clear and re-generate
      manager.clear();
      manager.analyzeStructure(createTestItems(5));

      const placeholder = manager.generate(0);
      // After clear, id counter resets, so id should start from 0 again
      expect(String(placeholder.id)).toBe("__placeholder_0");
    });
  });

  // ===========================================================================
  // Mask text generation
  // ===========================================================================

  describe("mask text generation", () => {
    it("should generate masked text at least 1 character long", () => {
      interface ShortItem extends VListItem {
        id: number;
        x: string;
      }

      const manager = createPlaceholderManager<ShortItem>({
        randomVariance: false,
      });
      manager.analyzeStructure([{ id: 1, x: "a" }]);

      const placeholder = manager.generate(0);
      expect(((placeholder as any).x as string).length).toBeGreaterThanOrEqual(
        1,
      );
    });

    it("should generate variable length text when randomVariance is true", () => {
      interface VarItem extends VListItem {
        id: number;
        text: string;
      }

      const items: VarItem[] = [
        { id: 1, text: "short" },
        { id: 2, text: "this is a much longer string for analysis" },
        { id: 3, text: "medium length text" },
      ];

      const manager = createPlaceholderManager<VarItem>({
        randomVariance: true,
      });
      manager.analyzeStructure(items);

      // Generate many placeholders and check that lengths vary
      const lengths = new Set<number>();
      for (let i = 0; i < 50; i++) {
        const p = manager.generate(i);
        lengths.add(((p as any).text as string).length);
      }

      // With random variance, we should see multiple different lengths
      expect(lengths.size).toBeGreaterThan(1);
    });
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe("edge cases", () => {
    it("should handle items with null/undefined values", () => {
      interface NullableItem extends VListItem {
        id: number;
        name: string | null;
        value: number | undefined;
      }

      const items: NullableItem[] = [
        { id: 1, name: "Alice", value: 10 },
        { id: 2, name: null, value: undefined },
      ];

      const manager = createPlaceholderManager<NullableItem>();
      manager.analyzeStructure(items);

      // Should not crash
      const placeholder = manager.generate(0);
      expect(placeholder).toBeDefined();
      expect((placeholder as any)._isPlaceholder).toBe(true);
    });

    it("should handle items with only id field", () => {
      const items: VListItem[] = [{ id: 1 }, { id: 2 }];

      const manager = createPlaceholderManager();
      manager.analyzeStructure(items);

      // id is skipped, so no field structures — should produce basic placeholder
      const placeholder = manager.generate(0);
      expect(placeholder).toBeDefined();
      expect((placeholder as any)._isPlaceholder).toBe(true);
    });

    it("should handle non-object items in the sample gracefully", () => {
      // Force invalid data through type coercion
      const items = [null, undefined, 42, "string"] as any as VListItem[];

      const manager = createPlaceholderManager();
      // Should not crash — non-object items are skipped
      manager.analyzeStructure(items);

      // May or may not have analyzed depending on filtering
      const placeholder = manager.generate(0);
      expect(placeholder).toBeDefined();
    });
  });
});

// =============================================================================
// Utility Functions
// =============================================================================

describe("isPlaceholderItem", () => {
  it("should return true for placeholder items", () => {
    const item = { id: 1, _isPlaceholder: true };
    expect(isPlaceholderItem(item)).toBe(true);
  });

  it("should return false for real items", () => {
    const item = { id: 1, name: "test" };
    expect(isPlaceholderItem(item)).toBe(false);
  });

  it("should return false for null", () => {
    expect(isPlaceholderItem(null)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isPlaceholderItem(undefined)).toBe(false);
  });

  it("should return false for non-objects", () => {
    expect(isPlaceholderItem(42)).toBe(false);
    expect(isPlaceholderItem("string")).toBe(false);
    expect(isPlaceholderItem(true)).toBe(false);
  });

  it("should return false when _isPlaceholder is not true", () => {
    expect(isPlaceholderItem({ id: 1, _isPlaceholder: false })).toBe(false);
    expect(isPlaceholderItem({ id: 1, _isPlaceholder: "yes" })).toBe(false);
    expect(isPlaceholderItem({ id: 1, _isPlaceholder: 1 })).toBe(false);
  });
});

describe("filterPlaceholders", () => {
  it("should remove placeholder items from array", () => {
    const items = [
      { id: 1, name: "Real 1" },
      { id: "__p_1", _isPlaceholder: true, name: "███" },
      { id: 2, name: "Real 2" },
      { id: "__p_2", _isPlaceholder: true, name: "███" },
      { id: 3, name: "Real 3" },
    ] as any as VListItem[];

    const filtered = filterPlaceholders(items);

    expect(filtered).toHaveLength(3);
    expect(filtered[0]!.id).toBe(1);
    expect(filtered[1]!.id).toBe(2);
    expect(filtered[2]!.id).toBe(3);
  });

  it("should return all items when no placeholders present", () => {
    const items: VListItem[] = [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ];

    const filtered = filterPlaceholders(items);
    expect(filtered).toHaveLength(2);
  });

  it("should return empty array when all items are placeholders", () => {
    const items = [
      { id: "__p_1", _isPlaceholder: true },
      { id: "__p_2", _isPlaceholder: true },
    ] as any as VListItem[];

    const filtered = filterPlaceholders(items);
    expect(filtered).toHaveLength(0);
  });

  it("should handle empty array", () => {
    const filtered = filterPlaceholders([]);
    expect(filtered).toHaveLength(0);
  });
});

describe("countRealItems", () => {
  it("should count non-placeholder, non-undefined items", () => {
    const items = [
      { id: 1, name: "Real" },
      undefined,
      { id: "__p_1", _isPlaceholder: true },
      { id: 2, name: "Also Real" },
      undefined,
    ] as any as (VListItem | undefined)[];

    expect(countRealItems(items)).toBe(2);
  });

  it("should return 0 for empty array", () => {
    expect(countRealItems([])).toBe(0);
  });

  it("should return 0 when all items are undefined", () => {
    expect(countRealItems([undefined, undefined, undefined])).toBe(0);
  });

  it("should return 0 when all items are placeholders", () => {
    const items = [
      { id: "__p_1", _isPlaceholder: true },
      { id: "__p_2", _isPlaceholder: true },
    ] as any as VListItem[];

    expect(countRealItems(items)).toBe(0);
  });

  it("should count all items when none are placeholders", () => {
    const items: VListItem[] = [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
      { id: 3, name: "C" },
    ];

    expect(countRealItems(items)).toBe(3);
  });
});

describe("replacePlaceholders", () => {
  it("should replace placeholders with real items", () => {
    const target = [
      { id: "__p_0", _isPlaceholder: true },
      { id: "__p_1", _isPlaceholder: true },
      { id: "__p_2", _isPlaceholder: true },
    ] as any as (VListItem | undefined)[];

    const newItems: VListItem[] = [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ];

    const replacedCount = replacePlaceholders(target, newItems, 0);

    expect(replacedCount).toBe(2);
    expect(target[0]!.id).toBe(1);
    expect(target[1]!.id).toBe(2);
    // Third item is still a placeholder (not replaced)
    expect((target[2] as any)._isPlaceholder).toBe(true);
  });

  it("should replace undefined slots with real items", () => {
    const target: (VListItem | undefined)[] = [undefined, undefined, undefined];

    const newItems: VListItem[] = [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ];

    const replacedCount = replacePlaceholders(target, newItems, 0);

    // undefined slots don't count as "replaced" placeholders
    expect(replacedCount).toBe(0);
    expect(target[0]!.id).toBe(1);
    expect(target[1]!.id).toBe(2);
    expect(target[2]).toBeUndefined();
  });

  it("should not replace real items", () => {
    const target: (VListItem | undefined)[] = [
      { id: 10, name: "Existing" },
      { id: "__p_1", _isPlaceholder: true } as any,
      undefined,
    ];

    const newItems: VListItem[] = [
      { id: 1, name: "New A" },
      { id: 2, name: "New B" },
      { id: 3, name: "New C" },
    ];

    const replacedCount = replacePlaceholders(target, newItems, 0);

    // First slot has a real item — should NOT be replaced
    expect(target[0]!.id).toBe(10);
    expect((target[0] as any).name).toBe("Existing");

    // Second slot was placeholder — replaced
    expect(target[1]!.id).toBe(2);

    // Third slot was undefined — filled but not counted as placeholder replacement
    expect(target[2]!.id).toBe(3);

    expect(replacedCount).toBe(1);
  });

  it("should handle offset correctly", () => {
    const target: (VListItem | undefined)[] = [
      { id: 1, name: "Keep" },
      { id: 2, name: "Keep" },
      { id: "__p_0", _isPlaceholder: true } as any,
      { id: "__p_1", _isPlaceholder: true } as any,
      undefined,
    ];

    const newItems: VListItem[] = [
      { id: 10, name: "New A" },
      { id: 11, name: "New B" },
      { id: 12, name: "New C" },
    ];

    const replacedCount = replacePlaceholders(target, newItems, 2);

    expect(target[0]!.id).toBe(1);
    expect(target[1]!.id).toBe(2);
    expect(target[2]!.id).toBe(10);
    expect(target[3]!.id).toBe(11);
    expect(target[4]!.id).toBe(12);
    expect(replacedCount).toBe(2);
  });

  it("should return 0 when nothing to replace", () => {
    const target: (VListItem | undefined)[] = [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ];

    const newItems: VListItem[] = [
      { id: 10, name: "New A" },
      { id: 11, name: "New B" },
    ];

    const replacedCount = replacePlaceholders(target, newItems, 0);

    // Real items should not be replaced
    expect(target[0]!.id).toBe(1);
    expect(target[1]!.id).toBe(2);
    expect(replacedCount).toBe(0);
  });

  it("should handle empty new items", () => {
    const target: (VListItem | undefined)[] = [
      { id: "__p_0", _isPlaceholder: true } as any,
    ];

    const replacedCount = replacePlaceholders(target, [], 0);

    expect(replacedCount).toBe(0);
    expect((target[0] as any)._isPlaceholder).toBe(true);
  });
});
