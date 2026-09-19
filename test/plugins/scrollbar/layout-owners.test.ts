/**
 * vlist — Scrollbar next to a plugin that owns the layout
 *
 * tree() changes the content size without a scroll or a resize: a folder opens
 * and the list is suddenly longer than the viewport. It asks scrollbar() for
 * its instance so the thumb can follow at once, instead of waiting for the next
 * scroll event to notice.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { setupDOM, teardownDOM } from "../../helpers/dom";
import { advanceTimers } from "../../helpers/timers";
import { createContainer } from "../../helpers/factory";
import { createVList } from "../../../src/core/create";
import type { VList } from "../../../src/core/types";
import type { VListItem } from "../../../src/types";
import { scrollbar } from "../../../src/plugins/scrollbar";
import { tree, type TreeMethods } from "../../../src/plugins/tree";

const WIDTH = 300;
const HEIGHT = 500;
const ROW = 50;

let geometry: ReturnType<typeof capturePrototypeGeometry>;

beforeAll(() => {
  setupDOM();
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get: () => HEIGHT, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get: () => WIDTH, configurable: true });
});
afterAll(() => {
  geometry.restore();
  teardownDOM();
});
// Registered after cleanup: catch a missing or incomplete restore.
afterAll(() => geometry.assertRestored());

interface Node extends VListItem {
  id: string;
  name: string;
  children: Node[];
}

/** Three roots; the first holds forty files. Closed, the tree is 150px tall. */
const nodes = (): Node[] => [
  {
    id: "src",
    name: "src",
    children: Array.from({ length: 40 }, (_, i) => ({ id: `file-${i}`, name: `file-${i}.ts`, children: [] })),
  },
  { id: "test", name: "test", children: [] },
  { id: "readme", name: "README.md", children: [] },
];

let open: Array<{ list: VList<Node>; container: HTMLElement }> = [];
afterEach(() => {
  for (const { list, container } of open) {
    list.destroy();
    container.remove();
  }
  open = [];
});

async function treeWithScrollbar() {
  const container = createContainer({ width: WIDTH, height: HEIGHT });
  const list = createVList<Node>(
    { container, items: nodes(), item: { height: ROW, template: (item) => item.name } },
    [tree<Node>(), scrollbar()],
  );
  open.push({ list, container });
  await advanceTimers(5);
  const track = container.querySelector<HTMLElement>(".vlist-scrollbar")!;
  const thumb = container.querySelector<HTMLElement>(".vlist-scrollbar__thumb")!;
  return { list: list as VList<Node> & TreeMethods, track, thumb };
}

describe("scrollbar + tree — the thumb follows expand and collapse", () => {
  it("has no track while the closed tree fits in the viewport", async () => {
    const { track } = await treeWithScrollbar();
    expect(track.style.display).toBe("none");
  });

  it("shows a thumb sized for the longer list as soon as a folder opens", async () => {
    const { list, track, thumb } = await treeWithScrollbar();

    list.expand("src");

    // 43 rows of 50px in a 500px viewport — no scroll, no resize, no timer.
    expect(list.total).toBe(43);
    expect(track.style.display).toBe("");
    const thumbHeight = parseFloat(thumb.style.height);
    const trackLength = thumbHeight / (HEIGHT / (43 * ROW));
    expect(thumbHeight).toBeGreaterThan(0);
    expect(thumbHeight).toBeLessThan(HEIGHT / 4);
    // The thumb is the viewport's share of the content, scaled to the track.
    expect(trackLength).toBeGreaterThan(HEIGHT - 20);
    expect(trackLength).toBeLessThanOrEqual(HEIGHT);
  });

  it("drops the track again when the folder closes", async () => {
    const { list, track } = await treeWithScrollbar();
    list.expand("src");
    expect(track.style.display).toBe("");

    list.collapse("src");

    expect(track.style.display).toBe("none");
  });
});
