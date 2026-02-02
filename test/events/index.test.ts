/**
 * vlist - Event Emitter Tests
 * Tests for the lightweight event system
 */

import { describe, it, expect, mock } from "bun:test";
import { createEmitter } from "../../src/events";

// Test event types
interface TestEvents {
  click: { x: number; y: number };
  change: { value: string };
  empty: Record<string, never>;
  data: { items: number[] };
}

describe("createEmitter", () => {
  it("should create an emitter instance", () => {
    const emitter = createEmitter<TestEvents>();

    expect(emitter).toBeDefined();
    expect(typeof emitter.on).toBe("function");
    expect(typeof emitter.off).toBe("function");
    expect(typeof emitter.emit).toBe("function");
    expect(typeof emitter.once).toBe("function");
    expect(typeof emitter.clear).toBe("function");
    expect(typeof emitter.listenerCount).toBe("function");
  });
});

describe("on / emit", () => {
  it("should call handler when event is emitted", () => {
    const emitter = createEmitter<TestEvents>();
    const handler = mock(() => {});

    emitter.on("click", handler);
    emitter.emit("click", { x: 10, y: 20 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it("should call multiple handlers for same event", () => {
    const emitter = createEmitter<TestEvents>();
    const handler1 = mock(() => {});
    const handler2 = mock(() => {});

    emitter.on("click", handler1);
    emitter.on("click", handler2);
    emitter.emit("click", { x: 5, y: 15 });

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it("should not call handlers for different events", () => {
    const emitter = createEmitter<TestEvents>();
    const clickHandler = mock(() => {});
    const changeHandler = mock(() => {});

    emitter.on("click", clickHandler);
    emitter.on("change", changeHandler);
    emitter.emit("click", { x: 0, y: 0 });

    expect(clickHandler).toHaveBeenCalledTimes(1);
    expect(changeHandler).not.toHaveBeenCalled();
  });

  it("should handle events with no listeners", () => {
    const emitter = createEmitter<TestEvents>();

    // Should not throw
    expect(() => emitter.emit("click", { x: 0, y: 0 })).not.toThrow();
  });

  it("should pass correct payload to handler", () => {
    const emitter = createEmitter<TestEvents>();
    let receivedPayload: { items: number[] } | null = null;

    emitter.on("data", (payload) => {
      receivedPayload = payload;
    });
    emitter.emit("data", { items: [1, 2, 3] });

    expect(receivedPayload).toEqual({ items: [1, 2, 3] });
  });
});

describe("off", () => {
  it("should remove handler", () => {
    const emitter = createEmitter<TestEvents>();
    const handler = mock(() => {});

    emitter.on("click", handler);
    emitter.off("click", handler);
    emitter.emit("click", { x: 0, y: 0 });

    expect(handler).not.toHaveBeenCalled();
  });

  it("should only remove specified handler", () => {
    const emitter = createEmitter<TestEvents>();
    const handler1 = mock(() => {});
    const handler2 = mock(() => {});

    emitter.on("click", handler1);
    emitter.on("click", handler2);
    emitter.off("click", handler1);
    emitter.emit("click", { x: 0, y: 0 });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it("should handle removing non-existent handler", () => {
    const emitter = createEmitter<TestEvents>();
    const handler = mock(() => {});

    // Should not throw
    expect(() => emitter.off("click", handler)).not.toThrow();
  });
});

describe("unsubscribe function", () => {
  it("should return unsubscribe function from on()", () => {
    const emitter = createEmitter<TestEvents>();
    const handler = mock(() => {});

    const unsubscribe = emitter.on("click", handler);

    expect(typeof unsubscribe).toBe("function");
  });

  it("should unsubscribe when called", () => {
    const emitter = createEmitter<TestEvents>();
    const handler = mock(() => {});

    const unsubscribe = emitter.on("click", handler);
    emitter.emit("click", { x: 0, y: 0 });
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    emitter.emit("click", { x: 1, y: 1 });
    expect(handler).toHaveBeenCalledTimes(1); // Still 1, not called again
  });
});

describe("once", () => {
  it("should call handler only once", () => {
    const emitter = createEmitter<TestEvents>();
    const handler = mock(() => {});

    emitter.once("click", handler);
    emitter.emit("click", { x: 0, y: 0 });
    emitter.emit("click", { x: 1, y: 1 });
    emitter.emit("click", { x: 2, y: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ x: 0, y: 0 });
  });

  it("should return unsubscribe function", () => {
    const emitter = createEmitter<TestEvents>();
    const handler = mock(() => {});

    const unsubscribe = emitter.once("click", handler);
    unsubscribe();
    emitter.emit("click", { x: 0, y: 0 });

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("clear", () => {
  it("should clear all listeners for specific event", () => {
    const emitter = createEmitter<TestEvents>();
    const handler1 = mock(() => {});
    const handler2 = mock(() => {});
    const changeHandler = mock(() => {});

    emitter.on("click", handler1);
    emitter.on("click", handler2);
    emitter.on("change", changeHandler);

    emitter.clear("click");

    emitter.emit("click", { x: 0, y: 0 });
    emitter.emit("change", { value: "test" });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
    expect(changeHandler).toHaveBeenCalledTimes(1);
  });

  it("should clear all listeners when no event specified", () => {
    const emitter = createEmitter<TestEvents>();
    const clickHandler = mock(() => {});
    const changeHandler = mock(() => {});

    emitter.on("click", clickHandler);
    emitter.on("change", changeHandler);

    emitter.clear();

    emitter.emit("click", { x: 0, y: 0 });
    emitter.emit("change", { value: "test" });

    expect(clickHandler).not.toHaveBeenCalled();
    expect(changeHandler).not.toHaveBeenCalled();
  });
});

describe("listenerCount", () => {
  it("should return correct listener count", () => {
    const emitter = createEmitter<TestEvents>();

    expect(emitter.listenerCount("click")).toBe(0);

    emitter.on("click", () => {});
    expect(emitter.listenerCount("click")).toBe(1);

    emitter.on("click", () => {});
    expect(emitter.listenerCount("click")).toBe(2);
  });

  it("should return 0 for events with no listeners", () => {
    const emitter = createEmitter<TestEvents>();

    expect(emitter.listenerCount("click")).toBe(0);
    expect(emitter.listenerCount("change")).toBe(0);
  });

  it("should update after removing listeners", () => {
    const emitter = createEmitter<TestEvents>();
    const handler = () => {};

    emitter.on("click", handler);
    expect(emitter.listenerCount("click")).toBe(1);

    emitter.off("click", handler);
    expect(emitter.listenerCount("click")).toBe(0);
  });
});

describe("error handling", () => {
  it("should continue calling handlers if one throws", () => {
    const emitter = createEmitter<TestEvents>();
    const errorHandler = mock(() => {
      throw new Error("Test error");
    });
    const successHandler = mock(() => {});

    // Suppress console.error for this test
    const originalError = console.error;
    console.error = mock(() => {});

    emitter.on("click", errorHandler);
    emitter.on("click", successHandler);

    // Should not throw
    expect(() => emitter.emit("click", { x: 0, y: 0 })).not.toThrow();

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(successHandler).toHaveBeenCalledTimes(1);

    // Restore console.error
    console.error = originalError;
  });

  it("should log error when handler throws", () => {
    const emitter = createEmitter<TestEvents>();
    const mockConsoleError = mock(() => {});
    const originalError = console.error;
    console.error = mockConsoleError;

    emitter.on("click", () => {
      throw new Error("Handler error");
    });
    emitter.emit("click", { x: 0, y: 0 });

    expect(mockConsoleError).toHaveBeenCalled();

    // Restore console.error
    console.error = originalError;
  });
});

describe("type safety", () => {
  it("should enforce correct payload types", () => {
    const emitter = createEmitter<TestEvents>();

    // These should compile without errors
    emitter.on("click", (payload) => {
      const x: number = payload.x;
      const y: number = payload.y;
      expect(typeof x).toBe("number");
      expect(typeof y).toBe("number");
    });

    emitter.on("change", (payload) => {
      const value: string = payload.value;
      expect(typeof value).toBe("string");
    });

    emitter.emit("click", { x: 10, y: 20 });
    emitter.emit("change", { value: "test" });
  });
});

describe("multiple emitter instances", () => {
  it("should maintain separate state for each instance", () => {
    const emitter1 = createEmitter<TestEvents>();
    const emitter2 = createEmitter<TestEvents>();
    const handler1 = mock(() => {});
    const handler2 = mock(() => {});

    emitter1.on("click", handler1);
    emitter2.on("click", handler2);

    emitter1.emit("click", { x: 0, y: 0 });

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).not.toHaveBeenCalled();
  });
});
