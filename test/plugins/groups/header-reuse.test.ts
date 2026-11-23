/**
 * groups() keys a header node by position (`__group_header_${groupIndex}`).
 * After an update that shifts groups, a reused node must show the new group's
 * text. An unchanged header is left as it is.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { registerDOM, unregisterDOM } from "../../helpers/dom";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { createContainer } from "../../helpers/factory";
import { createVList } from "../../../src/core/create";
import type { VList } from "../../../src/core/types";
import type { VListItem } from "../../../src/types";
import { groups } from "../../../src/plugins/groups/plugin";

interface Row extends VListItem {
  id: number;
  group: string;
}

const STOPPED = "Stopped / unavailable";
const DONE = "Done";
const QUEUED = "Queued";

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  registerDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 800; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 300; }, configurable: true });
});
afterAll(() => {
  geometry.restore();
  unregisterDOM();
});
afterAll(() => geometry.assertRestored());

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function rows(spec: Array<[string, number]>, startId = 1): Row[] {
  const out: Row[] = [];
  let id = startId;
  for (const [group, count] of spec) {
    for (let n = 0; n < count; n++) out.push({ id: id++, group });
  }
  return out;
}

function textOf(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Visible content rows, in order: `H:key#data-id` or `I:group#data-id`. */
function sequence(container: HTMLElement): string[] {
  const content = container.querySelector(".vlist-content");
  if (!content) return [];
  return [...content.children].map((el) => {
    const kind = el.classList.contains("vlist-group-header") ? "H" : "I";
    return `${kind}:${textOf(el)}#${el.getAttribute("data-id")}`;
  });
}

/** Items whose text is not the header currently above them. */
function mismatches(container: HTMLElement): string[] {
  const content = container.querySelector(".vlist-content");
  if (!content) return ["no content"];
  const bad: string[] = [];
  let header = "";
  let headerId = "";
  let seenHeader = false;
  for (const el of content.children) {
    if (el.classList.contains("vlist-group-header")) {
      header = textOf(el);
      headerId = el.getAttribute("data-id") ?? "";
      seenHeader = true;
    } else if (seenHeader && el.classList.contains("vlist-item") && textOf(el) !== header) {
      bad.push(`item "${textOf(el)}" under header "${header}" (${headerId})`);
    }
  }
  return bad;
}

function stickyLabel(container: HTMLElement): string {
  const el = container.querySelector(".vlist-sticky-header") as HTMLElement | null;
  if (!el) return "(none)";
  const hidden = el.style.display === "none" || el.style.visibility === "hidden";
  return `${hidden ? "hidden" : "shown"}:${textOf(el)}`;
}

async function mount(spec: Array<[string, number]>, sticky: boolean): Promise<{
  list: VList<Row>;
  container: HTMLElement;
  dispose: () => void;
}> {
  const container = createContainer({ width: 300, height: 800 });
  const list = createVList<Row>(
    {
      container,
      items: rows(spec),
      item: { height: 40, template: (item) => item.group },
    },
    [
      groups<Row>({
        getGroupForIndex: (_index, item) => item?.group ?? "",
        header: { height: 32, template: (key) => key },
        sticky,
      }),
    ],
  );
  await tick();
  return {
    list,
    container,
    dispose(): void {
      list.destroy();
      container.remove();
    },
  };
}

function expectAligned(container: HTMLElement): void {
  expect(mismatches(container), `${sequence(container).join(" | ")} sticky=${stickyLabel(container)}`).toEqual([]);
}

describe("groups() header text after an in-place shift", () => {
  it("starts aligned", async () => {
    const f = await mount([[STOPPED, 2], [DONE, 2]], true);
    try {
      expectAligned(f.container);
    } finally {
      f.dispose();
    }
  });

  it("setItems inserts a group before the existing ones (count changes)", async () => {
    const f = await mount([[STOPPED, 2], [DONE, 2]], true);
    try {
      expectAligned(f.container);
      f.list.setItems(rows([[QUEUED, 2], [STOPPED, 2], [DONE, 2]]));
      await tick();
      expectAligned(f.container);
      expect(stickyLabel(f.container)).toBe(`shown:${QUEUED}`);
    } finally {
      f.dispose();
    }
  });

  it("setItems inserts a group before an existing one (same count)", async () => {
    const f = await mount([[STOPPED, 2], [DONE, 2]], true);
    try {
      expectAligned(f.container);
      f.list.setItems(rows([[QUEUED, 2], [STOPPED, 1], [DONE, 1]]));
      await tick();
      expectAligned(f.container);
    } finally {
      f.dispose();
    }
  });

  it("setItems drops the leading group so Done moves to index 0", async () => {
    const f = await mount([[STOPPED, 2], [DONE, 2]], true);
    try {
      expectAligned(f.container);
      f.list.setItems(rows([[DONE, 2]]));
      await tick();
      expectAligned(f.container);
      expect(stickyLabel(f.container)).toBe(`shown:${DONE}`);
    } finally {
      f.dispose();
    }
  });

  it("prependItems adds a group before the existing ones", async () => {
    const f = await mount([[STOPPED, 2], [DONE, 2]], false);
    try {
      expectAligned(f.container);
      f.list.prependItems(rows([[QUEUED, 2]]));
      await tick();
      expectAligned(f.container);
    } finally {
      f.dispose();
    }
  });

  it("insertItem at 0 starts a new group", async () => {
    const f = await mount([[STOPPED, 2], [DONE, 2]], false);
    try {
      expectAligned(f.container);
      f.list.insertItem({ id: 100, group: QUEUED }, 0);
      await tick();
      expectAligned(f.container);
    } finally {
      f.dispose();
    }
  });

  it("sticky header, scrolled onto Done, then a group is inserted before Done", async () => {
    const f = await mount([[STOPPED, 20], [DONE, 2]], true);
    try {
      expectAligned(f.container);
      const viewport = f.container.querySelector(".vlist-viewport") as HTMLElement;
      viewport.scrollTop = 32 + 20 * 40;
      viewport.dispatchEvent(new Event("scroll"));
      await tick();
      expect(stickyLabel(f.container)).toBe(`shown:${DONE}`);

      f.list.setItems(rows([[STOPPED, 20], [QUEUED, 2], [DONE, 2]]));
      await tick();
      expect(stickyLabel(f.container), sequence(f.container).join(" | ")).toBe(`shown:${QUEUED}`);
      expectAligned(f.container);
    } finally {
      f.dispose();
    }
  });

  it("rewrites a pooled header when it is reused for a different group", async () => {
    const container = createContainer({ width: 300, height: 800 });
    const list = createVList<Row>(
      {
        container,
        items: rows([[STOPPED, 23]]),
        item: { height: 40, template: (item) => item.group },
      },
      [
        groups<Row>({
          getGroupForIndex: (_index, item) => item?.group ?? "",
          header: { height: 32, template: (key) => key },
          sticky: false,
        }),
      ],
    );
    try {
      await tick();
      const content = container.querySelector(".vlist-content") as HTMLElement;
      const header = content.querySelector(".vlist-group-header") as HTMLElement;
      expect(header.getAttribute("data-id")).toBe("__group_header_0");
      header.setAttribute("data-probe", "header");

      const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
      viewport.scrollTop = 160;
      viewport.dispatchEvent(new Event("scroll"));
      await tick();
      expect(header.isConnected).toBe(false);

      list.setItems(rows([[DONE, 23]]));
      await tick();
      viewport.scrollTop = 0;
      viewport.dispatchEvent(new Event("scroll"));
      await tick();

      expect(header.isConnected).toBe(true);
      expect(header.getAttribute("data-id")).toBe("__group_header_0");
      expect(textOf(header)).toBe(DONE);
      expectAligned(container);
    } finally {
      list.destroy();
      container.remove();
    }
  });

  it("does not rewrite an unchanged header on scroll", async () => {
    let writes = 0;
    const container = createContainer({ width: 300, height: 800 });
    const list = createVList<Row>(
      {
        container,
        items: rows([[STOPPED, 40]]),
        item: { height: 40, template: (item) => item.group },
      },
      [
        groups<Row>({
          getGroupForIndex: (_index, item) => item?.group ?? "",
          header: {
            height: 32,
            template: (key) => {
              writes += 1;
              return key;
            },
          },
          sticky: false,
        }),
      ],
    );
    try {
      await tick();
      expectAligned(container);
      const mounted = writes;
      expect(mounted).toBeGreaterThan(0);
      const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
      viewport.scrollTop = 40;
      viewport.dispatchEvent(new Event("scroll"));
      await tick();
      expect(writes).toBe(mounted);
      expectAligned(container);
    } finally {
      list.destroy();
      container.remove();
    }
  });
});
