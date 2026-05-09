/**
 * vlist - ARIA Resolvers Tests
 * Tests for createAriaResolvers: lazy resolution of data-space totals
 * and positions from the groups feature methods map.
 */

import { describe, it, expect } from "bun:test";
import { createAriaResolvers } from "../../src/rendering/aria";

describe("createAriaResolvers", () => {
  it("should fall back to fallbackTotal when _getTotal is not registered", () => {
    const methods = new Map<string, Function>();
    const aria = createAriaResolvers(methods, () => 100);

    expect(aria.getSetSize()).toBe(100);
  });

  it("should use _getTotal when registered", () => {
    const methods = new Map<string, Function>();
    methods.set("_getTotal", () => 229);
    const aria = createAriaResolvers(methods, () => 418);

    expect(aria.getSetSize()).toBe(229);
  });

  it("should fall back to layoutIndex + 1 when _layoutToDataIndex is not registered", () => {
    const methods = new Map<string, Function>();
    const aria = createAriaResolvers(methods, () => 100);

    expect(aria.getPosInSet(0)).toBe(1);
    expect(aria.getPosInSet(5)).toBe(6);
    expect(aria.getPosInSet(99)).toBe(100);
  });

  it("should use _layoutToDataIndex when registered", () => {
    const methods = new Map<string, Function>();
    // Simulate: layout indices 0=header, 1=data0, 2=data1, 3=header, 4=data2
    methods.set("_layoutToDataIndex", (layoutIndex: number) => {
      const map: Record<number, number> = { 1: 0, 2: 1, 4: 2 };
      return map[layoutIndex] ?? -1;
    });
    const aria = createAriaResolvers(methods, () => 100);

    expect(aria.getPosInSet(1)).toBe(1); // data index 0 → posinset 1
    expect(aria.getPosInSet(2)).toBe(2); // data index 1 → posinset 2
    expect(aria.getPosInSet(4)).toBe(3); // data index 2 → posinset 3
  });

  it("should cache the resolved functions (lazy resolution)", () => {
    const methods = new Map<string, Function>();
    let getCalls = 0;
    const originalGet = methods.get.bind(methods);
    methods.get = (key: string) => { getCalls++; return originalGet(key); };

    const aria = createAriaResolvers(methods, () => 50);

    aria.getSetSize();
    aria.getSetSize();
    aria.getSetSize();
    // _getTotal resolved once on first call, cached after
    expect(getCalls).toBe(1);

    aria.getPosInSet(0);
    aria.getPosInSet(1);
    aria.getPosInSet(2);
    // _layoutToDataIndex resolved once on first call, cached after
    expect(getCalls).toBe(2);
  });

  it("should reflect dynamic fallbackTotal changes", () => {
    const methods = new Map<string, Function>();
    let total = 50;
    const aria = createAriaResolvers(methods, () => total);

    expect(aria.getSetSize()).toBe(50);
    total = 200;
    expect(aria.getSetSize()).toBe(200);
  });

  it("should reflect dynamic _getTotal changes", () => {
    const methods = new Map<string, Function>();
    let dataTotal = 100;
    methods.set("_getTotal", () => dataTotal);
    const aria = createAriaResolvers(methods, () => 999);

    expect(aria.getSetSize()).toBe(100);
    dataTotal = 229;
    expect(aria.getSetSize()).toBe(229);
  });
});
