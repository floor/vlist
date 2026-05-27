/**
 * vlist v2 — EngineState Tests
 * Tests for createEngineState: initial values, resizeCapacity, clear.
 */

import { describe, it, expect } from "bun:test";
import { createEngineState } from "../../src/core/state";

describe("createEngineState", () => {
  it("creates state with correct initial capacity", () => {
    const state = createEngineState(50);
    expect(state.capacity).toBe(50);
    expect(state.visibleIndices.length).toBe(50);
    expect(state.visibleOffsets.length).toBe(50);
    expect(state.visibleSizes.length).toBe(50);
  });

  it("initializes scalar fields to defaults", () => {
    const state = createEngineState(10);
    expect(state.visibleCount).toBe(0);
    expect(state.startIndex).toBe(0);
    expect(state.totalSize).toBe(0);
    expect(state.scrollPosition).toBe(0);
    expect(state.prevScrollPosition).toBe(0);
    expect(state.scrollDirection).toBe(0);
    expect(state.containerSize).toBe(0);
    expect(state.crossSize).toBe(0);
    expect(state.totalItems).toBe(0);
    expect(state.prevRangeStart).toBe(0);
    expect(state.prevRangeEnd).toBe(-1);
    expect(state.renderPending).toBe(false);
    expect(state.initialized).toBe(false);
    expect(state.destroyed).toBe(false);
    expect(state.isCompressed).toBe(false);
    expect(state.compressionRatio).toBe(1);
    expect(state.prevAriaTotal).toBe(-1);
  });
});

describe("resizeCapacity", () => {
  it("grows buffers when needed capacity exceeds current", () => {
    const state = createEngineState(10);
    expect(state.capacity).toBe(10);

    // containerSize=500, minItemSize=20 → needed = ceil(500/20) + 4*2 = 33
    state.resizeCapacity(500, 20);
    expect(state.capacity).toBeGreaterThan(10);
    expect(state.visibleIndices.length).toBe(state.capacity);
    expect(state.visibleOffsets.length).toBe(state.capacity);
    expect(state.visibleSizes.length).toBe(state.capacity);
  });

  it("preserves existing data when growing", () => {
    const state = createEngineState(10);
    state.visibleIndices[0] = 42;
    state.visibleOffsets[0] = 100.5;
    state.visibleSizes[0] = 50.0;
    state.visibleCount = 1;

    state.resizeCapacity(1000, 20);

    expect(state.visibleIndices[0]).toBe(42);
    expect(state.visibleOffsets[0]).toBe(100.5);
    expect(state.visibleSizes[0]).toBe(50.0);
    expect(state.visibleCount).toBe(1);
  });

  it("does not shrink when needed capacity is within current", () => {
    const state = createEngineState(100);
    const originalCapacity = state.capacity;

    state.resizeCapacity(200, 50); // needed = ceil(200/50) + 8 = 12
    expect(state.capacity).toBe(originalCapacity);
  });

  it("no-ops when minItemSize is zero or negative", () => {
    const state = createEngineState(10);
    state.resizeCapacity(500, 0);
    expect(state.capacity).toBe(10);

    state.resizeCapacity(500, -1);
    expect(state.capacity).toBe(10);
  });

  it("no-ops when containerSize is zero or negative", () => {
    const state = createEngineState(10);
    state.resizeCapacity(0, 50);
    expect(state.capacity).toBe(10);

    state.resizeCapacity(-100, 50);
    expect(state.capacity).toBe(10);
  });

  it("accounts for custom overscan", () => {
    const state = createEngineState(10);
    // containerSize=100, minItemSize=50 → needed = ceil(100/50) + overscan*2
    // overscan=10 → needed = 2 + 20 = 22, newCapacity = 30
    state.resizeCapacity(100, 50, 10);
    expect(state.capacity).toBeGreaterThanOrEqual(30);
  });
});

describe("clear", () => {
  it("resets visibleCount and startIndex to zero", () => {
    const state = createEngineState(50);
    state.visibleCount = 25;
    state.startIndex = 10;

    state.clear();

    expect(state.visibleCount).toBe(0);
    expect(state.startIndex).toBe(0);
  });

  it("does not affect buffers or capacity", () => {
    const state = createEngineState(50);
    state.visibleIndices[0] = 99;
    state.visibleCount = 1;

    state.clear();

    expect(state.capacity).toBe(50);
    expect(state.visibleIndices[0]).toBe(99);
  });
});
