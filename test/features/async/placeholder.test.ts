/**
 * vlist - Placeholder System Tests
 * Tests for per-item length profile placeholders, structure analysis, and utility functions
 */

import { describe, it, expect } from "bun:test";
import {
  createPlaceholderManager,
  isPlaceholderItem,
  filterPlaceholders,
  countRealItems,
  type PlaceholderManager,
} from "../../../src/features/async/placeholder";
import type { VListItem } from "../../../src/types";

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

const createTestItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`,
    age: 20 + i,
    active: i % 2 === 0,
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
      expect(typeof manager.clear).toBe("function");
    });

    it("should not have analyzed structure initially", () => {
      const manager = createPlaceholderManager();
      expect(manager.hasAnalyzedStructure()).toBe(false);
    });
  });

  // ===========================================================================
  // Structure Analysis (per-item length profiles)
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

      // Second call should be a no-op
      const differentItems = createTestItems(10);
      manager.analyzeStructure(differentItems);

      // Still analyzed from first call — placeholders cycle through 5 profiles, not 10
      expect(manager.hasAnalyzedStructure()).toBe(true);
    });

    it("should respect maxSampleSize", () => {
      const manager = createPlaceholderManager<TestItem>({
        maxSampleSize: 3,
      });
      const items = createTestItems(100);

      manager.analyzeStructure(items);
      expect(manager.hasAnalyzedStructure()).toBe(true);

      // With maxSampleSize=3, profiles cycle every 3 items
      // Generate two placeholders at indices 0 and 3 — they should have
      // the same field lengths because they map to the same profile
      const p0 = manager.generate(0);
      const p3 = manager.generate(3);

      expect(((p0 as any).name as string).length).toBe(
        ((p3 as any).name as string).length,
      );
    });

    it("should capture per-item field lengths (not aggregates)", () => {
      interface VarItem extends VListItem {
        id: number;
        text: string;
      }

      const items: VarItem[] = [
        { id: 1, text: "short" }, // length 5
        { id: 2, text: "a much longer string for analysis" }, // length 33
      ];

      const manager = createPlaceholderManager<VarItem>();
      manager.analyzeStructure(items);

      // Placeholder at index 0 uses profile 0 (length 5)
      const p0 = manager.generate(0);
      expect(((p0 as any).text as string).length).toBe(5);

      // Placeholder at index 1 uses profile 1 (length 33)
      const p1 = manager.generate(1);
      expect(((p1 as any).text as string).length).toBe(33);
    });

    it("should cycle through profiles for indices beyond sample size", () => {
      interface VarItem extends VListItem {
        id: number;
        text: string;
      }

      const items: VarItem[] = [
        { id: 1, text: "short" }, // length 5
        { id: 2, text: "much longer text" }, // length 16
      ];

      const manager = createPlaceholderManager<VarItem>();
      manager.analyzeStructure(items);

      // Index 0 → profile 0, index 2 → profile 0 (cycles)
      const p0 = manager.generate(0);
      const p2 = manager.generate(2);
      expect(((p0 as any).text as string).length).toBe(
        ((p2 as any).text as string).length,
      );

      // Index 1 → profile 1, index 3 → profile 1 (cycles)
      const p1 = manager.generate(1);
      const p3 = manager.generate(3);
      expect(((p1 as any).text as string).length).toBe(
        ((p3 as any).text as string).length,
      );
    });

    it("should generate string fields as masked text", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const placeholder = manager.generate(0);

      // name and email should be masked strings
      expect(typeof (placeholder as any).name).toBe("string");
      expect(typeof (placeholder as any).email).toBe("string");
      expect((placeholder as any).name.length).toBeGreaterThan(0);
      expect((placeholder as any).email.length).toBeGreaterThan(0);
    });

    it("should convert non-string fields to their string length", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const placeholder = manager.generate(0);

      // age (number 20) → String("20").length = 2 → "xx"
      // active (boolean true) → String("true").length = 4 → "xxxx"
      expect(typeof (placeholder as any).age).toBe("string");
      expect(typeof (placeholder as any).active).toBe("string");
      expect(((placeholder as any).age as string).length).toBe(2);
      expect(((placeholder as any).active as string).length).toBe(4);
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
      expect((placeholder as any).label.length).toBe(12);
    });

    it("should use custom mask character", () => {
      const manager = createPlaceholderManager<TestItem>({
        maskCharacter: "▒",
      });
      manager.analyzeStructure(createTestItems(5));

      const placeholder = manager.generate(0);
      const nameField = (placeholder as any).name as string;

      expect(nameField).toContain("▒");
      expect(nameField).not.toContain("x");
    });

    it("should use default mask character (x)", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const placeholder = manager.generate(0);
      const nameField = (placeholder as any).name as string;

      expect(nameField).toContain("x");
    });

    it("should store _index on generated placeholders", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const placeholder = manager.generate(42);
      expect((placeholder as any)._index).toBe(42);
    });

    it("should produce mask text at least 1 character long even for empty values", () => {
      interface EmptyItem extends VListItem {
        id: number;
        x: string;
      }

      const manager = createPlaceholderManager<EmptyItem>();
      manager.analyzeStructure([{ id: 1, x: "" }]);

      const placeholder = manager.generate(0);
      // Empty string → length 0 → clamped to 1
      expect(((placeholder as any).x as string).length).toBeGreaterThanOrEqual(
        1,
      );
    });

    it("should generate index-based deterministic IDs", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      const p0 = manager.generate(0);
      const p7 = manager.generate(7);
      const p42 = manager.generate(42);

      expect(String(p0.id)).toBe("__placeholder_0");
      expect(String(p7.id)).toBe("__placeholder_7");
      expect(String(p42.id)).toBe("__placeholder_42");

      // Same index always produces the same ID
      const p7Again = manager.generate(7);
      expect(String(p7Again.id)).toBe(String(p7.id));
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
        expect(isPlaceholderItem(p)).toBe(true);
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

    it("should fall back to basic placeholder after clear without re-analysis", () => {
      const manager = createPlaceholderManager<TestItem>();
      manager.analyzeStructure(createTestItems(5));

      manager.clear();

      // Generate without re-analyzing — should fall back to basic label placeholder
      const placeholder = manager.generate(0);
      expect((placeholder as any).label).toBeDefined();
      expect(typeof (placeholder as any).label).toBe("string");
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

    it("should handle null value as zero-length (clamped to 1)", () => {
      interface NullableItem extends VListItem {
        id: number;
        name: string | null;
      }

      const items: NullableItem[] = [
        { id: 1, name: null },
      ];

      const manager = createPlaceholderManager<NullableItem>();
      manager.analyzeStructure(items);

      const placeholder = manager.generate(0);
      // null → String("") → length 0 → clamped to 1
      expect(((placeholder as any).name as string).length).toBeGreaterThanOrEqual(1);
    });

    it("should handle items with only id field", () => {
      const items: VListItem[] = [{ id: 1 }, { id: 2 }];

      const manager = createPlaceholderManager();
      manager.analyzeStructure(items);

      // id is skipped, so no profiles with fields — should produce basic placeholder
      const placeholder = manager.generate(0);
      expect(placeholder).toBeDefined();
      expect((placeholder as any)._isPlaceholder).toBe(true);
      expect((placeholder as any).label).toBeDefined();
    });

    it("should handle non-object items in the sample gracefully", () => {
      // Force invalid data through type coercion
      const items = [null, undefined, 42, "string"] as any as VListItem[];

      const manager = createPlaceholderManager();
      // Should not crash — non-object items are skipped
      manager.analyzeStructure(items);

      const placeholder = manager.generate(0);
      expect(placeholder).toBeDefined();
    });

    it("should produce realistic variance from real data", () => {
      interface UserItem extends VListItem {
        id: number;
        name: string;
      }

      const items: UserItem[] = [
        { id: 1, name: "Al" },          // length 2
        { id: 2, name: "Elizabeth" },     // length 9
        { id: 3, name: "Bob" },           // length 3
      ];

      const manager = createPlaceholderManager<UserItem>();
      manager.analyzeStructure(items);

      // Each placeholder should have a different name length, cycling through profiles
      const p0 = manager.generate(0); // profile 0 → "Al" length 2
      const p1 = manager.generate(1); // profile 1 → "Elizabeth" length 9
      const p2 = manager.generate(2); // profile 2 → "Bob" length 3

      const lengths = [
        ((p0 as any).name as string).length,
        ((p1 as any).name as string).length,
        ((p2 as any).name as string).length,
      ];

      expect(lengths[0]).toBe(2);
      expect(lengths[1]).toBe(9);
      expect(lengths[2]).toBe(3);
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
      { id: "__p_1", _isPlaceholder: true, name: "xxx" },
      { id: 2, name: "Real 2" },
      { id: "__p_2", _isPlaceholder: true, name: "xxx" },
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