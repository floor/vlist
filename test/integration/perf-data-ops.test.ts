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
import type { VList } from "../../src/core/types";
import {
  createTestItems,
  createContainer,
  simpleTemplate,
  type TestItem,
} from "../helpers/factory";
import { grid } from "../../src/plugins/grid/plugin";
import { selection } from "../../src/plugins/selection/plugin";
import { scrollbar } from "../../src/plugins/scrollbar/plugin";
import { groups } from "../../src/plugins/groups/plugin";
import { snapshots } from "../../src/plugins/snapshots/plugin";

let origClientHeight: PropertyDescriptor | undefined;
let origClientWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  GlobalRegistrator.register();
  origClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  );
  origClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    get() {
      return 500;
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
  if (origClientHeight)
    Object.defineProperty(
      HTMLElement.prototype,
      "clientHeight",
      origClientHeight,
    );
  if (origClientWidth)
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      origClientWidth,
    );
  GlobalRegistrator.unregister();
});

function measure(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

const CI_MULT = process.env.CI ? 5 : 1;

function simulateScroll(viewport: HTMLElement, scrollTop: number): void {
  Object.defineProperty(viewport, "scrollTop", {
    value: scrollTop,
    writable: true,
    configurable: true,
  });
  viewport.dispatchEvent(new Event("scroll", { bubbles: false }));
}

function getViewport(el: HTMLElement): HTMLElement {
  return el.querySelector<HTMLElement>(".vlist-viewport")!;
}

const getGroup = (index: number): string => {
  if (index < 3000) return "Group A";
  if (index < 6000) return "Group B";
  return "Group C";
};

// =============================================================================
// Initialization with plugins
// =============================================================================

describe("performance — initialization with plugins", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 500 });
  });
  afterEach(() => {
    container.remove();
  });

  it("10K with grid inits in under 100ms", () => {
    const items = createTestItems(10_000);
    let list: VList<TestItem> | null = null;

    const elapsed = measure(() => {
      list = createVList(
        {
          container,
          items,
          item: { height: 50, template: simpleTemplate },
        },
        [grid({ columns: 3 })],
      );
    });

    expect(elapsed).toBeLessThan(100 * CI_MULT);
    list!.destroy();
  });

  it("10K with selection + scrollbar inits in under 100ms", () => {
    const items = createTestItems(10_000);
    let list: VList<TestItem> | null = null;

    const elapsed = measure(() => {
      list = createVList(
        {
          container,
          items,
          item: { height: 50, template: simpleTemplate },
        },
        [selection({ mode: "multiple" }), scrollbar()],
      );
    });

    expect(elapsed).toBeLessThan(100 * CI_MULT);
    list!.destroy();
  });

  it("10K grouped list inits in under 200ms", () => {
    const items = createTestItems(10_000);
    let list: VList<TestItem> | null = null;

    const elapsed = measure(() => {
      list = createVList(
        {
          container,
          items,
          item: { height: 50, template: simpleTemplate },
        },
        [
          groups({
            getGroupForIndex: getGroup,
            header: {
              height: 30,
              template: (groupKey) =>
                `<div class="group-header">${groupKey}</div>`,
            },
          }),
        ],
      );
    });

    expect(elapsed).toBeLessThan(200 * CI_MULT);
    list!.destroy();
  });

  it("10K with all features inits in under 200ms", () => {
    const items = createTestItems(10_000);
    let list: VList<TestItem> | null = null;

    const elapsed = measure(() => {
      list = createVList(
        {
          container,
          items,
          item: { height: 50, template: simpleTemplate },
        },
        [
          grid({ columns: 3 }),
          selection({ mode: "multiple" }),
          scrollbar(),
          snapshots(),
        ],
      );
    });

    expect(elapsed).toBeLessThan(200 * CI_MULT);
    list!.destroy();
  });
});

// =============================================================================
// Render cycles
// =============================================================================

describe("performance — render cycles", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 500 });
  });
  afterEach(() => {
    container.remove();
  });

  it("scroll render cycle under 5ms for 10K items", () => {
    const list = createVList(
      {
        container,
        items: createTestItems(10_000),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const viewport = getViewport(container);
    // Warm up
    simulateScroll(viewport, 100);

    const start = performance.now();
    simulateScroll(viewport, 500);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5 * CI_MULT);
    list.destroy();
  });

  it("scroll render cycle under 5ms for 100K items", () => {
    const list = createVList(
      {
        container,
        items: createTestItems(100_000),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const viewport = getViewport(container);
    simulateScroll(viewport, 100);

    const start = performance.now();
    simulateScroll(viewport, 5000);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5 * CI_MULT);
    list.destroy();
  });

  it("grid scroll render cycle under 20ms", () => {
    const list = createVList(
      {
        container,
        items: createTestItems(10_000),
        item: { height: 50, template: simpleTemplate },
      },
      [grid({ columns: 3 })],
    );

    const viewport = getViewport(container);
    simulateScroll(viewport, 100);

    const start = performance.now();
    simulateScroll(viewport, 500);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(20 * CI_MULT);
    list.destroy();
  });

  it("100 consecutive scroll events under 100ms", () => {
    const list = createVList(
      {
        container,
        items: createTestItems(10_000),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const viewport = getViewport(container);

    const start = performance.now();
    for (let i = 1; i <= 100; i++) {
      simulateScroll(viewport, i * 50);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100 * CI_MULT);
    list.destroy();
  });

  it("100 consecutive scroll events with selection under 100ms", () => {
    const list = createVList(
      {
        container,
        items: createTestItems(10_000),
        item: { height: 50, template: simpleTemplate },
      },
      [selection({ mode: "multiple" })],
    );

    (list as any).select(1, 2, 3, 4, 5);

    const viewport = getViewport(container);

    const start = performance.now();
    for (let i = 1; i <= 100; i++) {
      simulateScroll(viewport, i * 50);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100 * CI_MULT);
    list.destroy();
  });

});

// =============================================================================
// Data operations extended
// =============================================================================

describe("performance — data operations extended", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 500 });
  });
  afterEach(() => {
    container.remove();
  });

  it("100K setItems in under 500ms", () => {
    const list = createVList(
      {
        container,
        items: createTestItems(100),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const newItems = createTestItems(100_000);

    const elapsed = measure(() => {
      list.setItems(newItems);
    });

    expect(elapsed).toBeLessThan(500 * CI_MULT);
    list.destroy();
  });

  it("updateItem in under 1ms", () => {
    const list = createVList(
      {
        container,
        items: createTestItems(10_000),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const elapsed = measure(() => {
      list.updateItem(500, { name: "Updated" });
    });

    expect(elapsed).toBeLessThan(1 * CI_MULT);
    list.destroy();
  });

  it("removeItem in under 5ms for 10K list", () => {
    const list = createVList(
      {
        container,
        items: createTestItems(10_000),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const elapsed = measure(() => {
      list.removeItem(5000);
    });

    expect(elapsed).toBeLessThan(5 * CI_MULT);
    list.destroy();
  });

  it("100 sequential updateItem calls under 20ms", () => {
    const list = createVList(
      {
        container,
        items: createTestItems(10_000),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const elapsed = measure(() => {
      for (let i = 1; i <= 100; i++) {
        list.updateItem(i, { name: `Updated ${i}` });
      }
    });

    expect(elapsed).toBeLessThan(20 * CI_MULT);
    list.destroy();
  });

  it("rapid setItems replacements under 100ms", () => {
    const list = createVList(
      {
        container,
        items: createTestItems(1000),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    const elapsed = measure(() => {
      for (let i = 0; i < 10; i++) {
        list.setItems(createTestItems(1000, (i + 1) * 1000));
      }
    });

    expect(elapsed).toBeLessThan(100 * CI_MULT);
    list.destroy();
  });
});

// =============================================================================
// Destroy with plugins
// =============================================================================

describe("performance — destroy with plugins", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 500 });
  });
  afterEach(() => {
    container.remove();
  });

  it("destroy with all features under 20ms", () => {
    const list = createVList(
      {
        container,
        items: createTestItems(10_000),
        item: { height: 50, template: simpleTemplate },
      },
      [
        grid({ columns: 3 }),
        selection({ mode: "multiple" }),
        scrollbar(),
        snapshots(),
      ],
    );

    (list as any).selectAll();
    list.scrollToIndex(100);

    const elapsed = measure(() => {
      list.destroy();
    });

    expect(elapsed).toBeLessThan(20 * CI_MULT);
  });
});

// =============================================================================
// Data operations — setItems edge cases
// =============================================================================

describe("data operations — setItems edge cases", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 500 });
  });
  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("setItems with empty array clears list", () => {
    list = createVList(
      {
        container,
        items: createTestItems(50),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    expect(list.total).toBe(50);

    list.setItems([]);

    expect(list.total).toBe(0);
    expect(list.items.length).toBe(0);
  });

  it("setItems after clear works correctly", () => {
    list = createVList(
      {
        container,
        items: createTestItems(50),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    list.setItems([]);
    expect(list.total).toBe(0);

    const newItems = createTestItems(30, 100);
    list.setItems(newItems);

    expect(list.total).toBe(30);
    expect(list.items.length).toBe(30);
    expect(list.items[0]!.id).toBe(100);
  });

  it("multiple setItems calls work correctly", () => {
    list = createVList(
      {
        container,
        items: createTestItems(10),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    list.setItems(createTestItems(20, 100));
    expect(list.total).toBe(20);

    list.setItems(createTestItems(5, 200));
    expect(list.total).toBe(5);

    list.setItems(createTestItems(100, 300));
    expect(list.total).toBe(100);
    expect(list.items[0]!.id).toBe(300);
  });

  it("setItems with single item works", () => {
    list = createVList(
      {
        container,
        items: createTestItems(50),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    list.setItems([{ id: 999, name: "Only item" }]);

    expect(list.total).toBe(1);
    expect(list.items[0]!.id).toBe(999);
    expect(list.items[0]!.name).toBe("Only item");
  });
});

// =============================================================================
// Data operations — mutation sequences
// =============================================================================

describe("data operations — mutation sequences", () => {
  let container: HTMLElement;
  let list: VList<TestItem> | null = null;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 500 });
  });
  afterEach(() => {
    if (list) {
      list.destroy();
      list = null;
    }
    container.remove();
  });

  it("remove until empty leaves total=0", () => {
    const items = createTestItems(5);
    list = createVList(
      {
        container,
        items,
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    for (let i = 5; i >= 1; i--) {
      list.removeItem(i);
    }

    expect(list.total).toBe(0);
    expect(list.items.length).toBe(0);
  });

  it("appendItems then removeItem leaves correct total", () => {
    list = createVList(
      {
        container,
        items: createTestItems(10),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    list.appendItems(createTestItems(5, 100));
    expect(list.total).toBe(15);

    list.removeItem(100);
    expect(list.total).toBe(14);

    list.removeItem(101);
    expect(list.total).toBe(13);
  });

  it("prependItems then setItems replaces all", () => {
    list = createVList(
      {
        container,
        items: createTestItems(10),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    list.prependItems(createTestItems(5, 100));
    expect(list.total).toBe(15);

    const replacement = createTestItems(3, 500);
    list.setItems(replacement);
    expect(list.total).toBe(3);
    expect(list.items[0]!.id).toBe(500);
  });

  it("rapid append+remove interleaving", () => {
    list = createVList(
      {
        container,
        items: createTestItems(10),
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    for (let i = 0; i < 20; i++) {
      list.appendItems([{ id: 1000 + i, name: `Appended ${i}` }]);
      if (i % 3 === 0) {
        list.removeItem(1000 + i);
      }
    }

    // 10 original + 20 appended - 7 removed (i=0,3,6,9,12,15,18)
    expect(list.total).toBe(23);
  });

  it("updateItem on every item in 100-item list", () => {
    const items = createTestItems(100);
    list = createVList(
      {
        container,
        items,
        item: { height: 50, template: simpleTemplate },
      },
      [],
    );

    for (let i = 1; i <= 100; i++) {
      list.updateItem(i, { name: `Updated ${i}` });
    }

    expect(list.items[0]!.name).toBe("Updated 1");
    expect(list.items[99]!.name).toBe("Updated 100");
    expect(list.total).toBe(100);
  });
});
