import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createVList } from "../../src/core/create";
import {
  createTestItems,
  createContainer,
  simpleTemplate,
} from "../helpers/factory";

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  GlobalRegistrator.register();
  origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => 500, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => 300, configurable: true });
});

afterAll(() => {
  if (origClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", origClientHeight);
  if (origClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", origClientWidth);
  GlobalRegistrator.unregister();
});

describe("config validation", () => {
  let container: HTMLElement;

  beforeEach(() => { container = createContainer({ width: 300, height: 500 }); });
  afterEach(() => { container.remove(); });

  // ── item.height ──────────────────────────────────────────────────

  it("should throw on negative height", () => {
    expect(() =>
      createVList(
        { container, items: [], item: { height: -5, template: simpleTemplate } },
      ),
    ).toThrow("vlist: item.height must be a positive number, got -5");
  });

  it("should throw on zero height", () => {
    expect(() =>
      createVList(
        { container, items: [], item: { height: 0, template: simpleTemplate } },
      ),
    ).toThrow("vlist: item.height must be a positive number, got 0");
  });

  it("should throw on NaN height", () => {
    expect(() =>
      createVList(
        { container, items: [], item: { height: NaN, template: simpleTemplate } },
      ),
    ).toThrow("vlist: item.height must be a positive number, got NaN");
  });

  it("should throw on Infinity height", () => {
    expect(() =>
      createVList(
        { container, items: [], item: { height: Infinity, template: simpleTemplate } },
      ),
    ).toThrow("vlist: item.height must be a positive number, got Infinity");
  });

  it("should throw on negative Infinity height", () => {
    expect(() =>
      createVList(
        { container, items: [], item: { height: -Infinity, template: simpleTemplate } },
      ),
    ).toThrow("vlist: item.height must be a positive number, got -Infinity");
  });

  // ── item.width (horizontal) ──────────────────────────────────────

  it("should throw on negative width", () => {
    expect(() =>
      createVList(
        { container, items: [], item: { width: -10, template: simpleTemplate }, orientation: "horizontal" },
      ),
    ).toThrow("vlist: item.width must be a positive number, got -10");
  });

  it("should throw on zero width", () => {
    expect(() =>
      createVList(
        { container, items: [], item: { width: 0, template: simpleTemplate }, orientation: "horizontal" },
      ),
    ).toThrow("vlist: item.width must be a positive number, got 0");
  });

  // ── item.estimatedHeight ─────────────────────────────────────────

  it("should throw on negative estimatedHeight", () => {
    expect(() =>
      createVList(
        { container, items: [], item: { estimatedHeight: -1, template: simpleTemplate } },
      ),
    ).toThrow("vlist: item.estimatedHeight must be a positive number, got -1");
  });

  it("should throw on zero estimatedHeight", () => {
    expect(() =>
      createVList(
        { container, items: [], item: { estimatedHeight: 0, template: simpleTemplate } },
      ),
    ).toThrow("vlist: item.estimatedHeight must be a positive number, got 0");
  });

  // ── item.estimatedWidth ──────────────────────────────────────────

  it("should throw on negative estimatedWidth", () => {
    expect(() =>
      createVList(
        { container, items: [], item: { estimatedWidth: -1, template: simpleTemplate }, orientation: "horizontal" },
      ),
    ).toThrow("vlist: item.estimatedWidth must be a positive number, got -1");
  });

  // ── item.gap ─────────────────────────────────────────────────────

  it("should throw on negative gap", () => {
    expect(() =>
      createVList(
        { container, items: [], item: { height: 40, gap: -5, template: simpleTemplate } },
      ),
    ).toThrow("vlist: item.gap must be a non-negative number, got -5");
  });

  // ── overscan ─────────────────────────────────────────────────────

  it("should throw on negative overscan", () => {
    expect(() =>
      createVList(
        { container, items: [], item: { height: 40, template: simpleTemplate }, overscan: -1 },
      ),
    ).toThrow("vlist: overscan must be a non-negative number, got -1");
  });

  // ── valid configs do NOT throw ───────────────────────────────────

  it("should NOT throw with valid config", () => {
    let list: ReturnType<typeof createVList> | undefined;
    expect(() => {
      list = createVList(
        { container, items: createTestItems(5), item: { height: 40, template: simpleTemplate } },
      );
    }).not.toThrow();
    list?.destroy();
  });

  it("should NOT throw when height is omitted (uses default)", () => {
    let list: ReturnType<typeof createVList> | undefined;
    expect(() => {
      list = createVList(
        { container, items: createTestItems(5), item: { template: simpleTemplate } },
      );
    }).not.toThrow();
    list?.destroy();
  });

  it("should NOT throw when height is a function", () => {
    let list: ReturnType<typeof createVList> | undefined;
    expect(() => {
      list = createVList(
        { container, items: createTestItems(5), item: { height: (index: number) => 30 + index, template: simpleTemplate } },
      );
    }).not.toThrow();
    list?.destroy();
  });

  it("should NOT throw with zero gap", () => {
    let list: ReturnType<typeof createVList> | undefined;
    expect(() => {
      list = createVList(
        { container, items: createTestItems(5), item: { height: 40, gap: 0, template: simpleTemplate } },
      );
    }).not.toThrow();
    list?.destroy();
  });

  it("should NOT throw with zero overscan", () => {
    let list: ReturnType<typeof createVList> | undefined;
    expect(() => {
      list = createVList(
        { container, items: createTestItems(5), item: { height: 40, template: simpleTemplate }, overscan: 0 },
      );
    }).not.toThrow();
    list?.destroy();
  });
});
