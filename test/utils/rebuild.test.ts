import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createContainer, createTestItems, simpleTemplate } from "../helpers/factory";
import { createVList } from "../../src/native";
import { rebuild } from "../../src/utils/rebuild";
import type { VList, VListPlugin } from "../../src/core/types";
import type { TestItem } from "../helpers/factory";

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

describe("rebuild scroll restore", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 400 });
  });

  afterEach(() => {
    container.remove();
  });

  it("restores the scroll position of a list that never installed snapshots", async () => {
    const items = createTestItems(200);
    const config = {
      container,
      items,
      item: { height: 40, template: simpleTemplate },
    };
    const list = createVList(config);
    list.scrollToIndex(40);
    const position = list.getScrollPosition();
    expect(position).toBeGreaterThan(0);

    const next = await rebuild(list, (snap) => createVList({
      container,
      items,
      item: { height: 40, template: simpleTemplate },
    }, [snap]));

    expect(next.getScrollPosition()).toBe(position);
    next.destroy();
  });
});

// The options and states rebuild handles that nothing above exercises. Two
// commits since the last green run (ea2e3d0, ff8a811) added most of these
// branches while the coverage gate was dark behind a typecheck failure, and
// the file went to 73% without anyone seeing it. Each test below is one branch.
describe("rebuild options", () => {
  let container: HTMLElement;
  const make = (items = createTestItems(60)): VList<TestItem> =>
    createVList<TestItem>({ container, items, item: { height: 40, template: simpleTemplate } });
  const again = (items = createTestItems(60)) => (snap: VListPlugin<TestItem>): VList<TestItem> =>
    createVList<TestItem>({ container, items, item: { height: 40, template: simpleTemplate } }, [snap]);

  beforeEach(() => { container = createContainer({ width: 300, height: 400 }); });
  afterEach(() => { container.remove(); });

  it("with no previous list, a key still installs auto-save on the new one", async () => {
    // captureScroll has nothing to capture, so the plugin is built from the key
    // alone -- the `{ autoSave: key }` branch.
    const next = await rebuild(null, again(), { key: "rebuild-options-key" });
    expect(next.getScrollPosition()).toBe(0);
    expect(typeof (next as { getScrollSnapshot?: unknown }).getScrollSnapshot).toBe("function");
    next.destroy();
  });

  it("pins the old root's size on the hidden new root until it is ready", async () => {
    const previous = make();
    // happy-dom reports a zero rect. Give the old root a real one, which is
    // the case the pin exists for: without it an absolute root has no height
    // and the new list skips its first render.
    previous.element.getBoundingClientRect = () =>
      ({ height: 400, width: 300, top: 0, left: 0, bottom: 400, right: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    let seenDuringReady = "";
    const next = await rebuild(previous, again(), {
      // A custom ready is the only moment the pin is observable: it is cleared
      // before rebuild returns.
      ready: async (list) => { seenDuringReady = `${list.element.style.height}/${list.element.style.width}`; },
    });

    expect(seenDuringReady).toBe("400px/300px");
    expect(next.element.style.height).toBe("");
    expect(next.element.style.width).toBe("");
    next.destroy();
  });

  it("restores again when the ready hook moved the list before the swap", async () => {
    const previous = make(createTestItems(200));
    previous.scrollToIndex(40);
    const position = previous.getScrollPosition();
    expect(position).toBeGreaterThan(0);

    const calls: Array<{ scrollTop: number | undefined; selection: boolean | undefined }> = [];
    let positionInReady = -1;
    const next = await rebuild(previous, (snap) => {
      const list = createVList<TestItem>({ container, items: createTestItems(200), item: { height: 40, template: simpleTemplate } }, [snap]);
      const target = list as unknown as { restoreScroll: (s: { scrollTop?: number }, sel?: boolean) => Promise<void> };
      const original = target.restoreScroll;
      target.restoreScroll = async (s, sel) => { calls.push({ scrollTop: s.scrollTop, selection: sel }); return original.call(list, s, sel); };
      return list;
    }, {
      // The plugin restored during setup. App code in the ready hook then
      // moves the list -- the case the second restore exists for. Inside
      // `create` the restore has not landed yet, so a move there is a no-op;
      // here it is real.
      ready: async (list) => {
        // Let the plugin's own deferred restore land first (it runs on the
        // next frame); only then has the list a position worth moving.
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        positionInReady = list.getScrollPosition();
        list.scrollToIndex(0);
      },
    });

    expect(positionInReady).toBe(position);
    expect(calls).toEqual([{ scrollTop: position, selection: false }]);
    expect(next.getScrollPosition()).toBe(position);
    next.destroy();
  });

  it("waits for the configured delay before swapping", async () => {
    const previous = make();
    const started = performance.now();
    const next = await rebuild(previous, again(), { delay: 30 });
    expect(performance.now() - started).toBeGreaterThanOrEqual(25);
    next.destroy();
  });

  it("crossfades with a single duration and clears every inline style it set", async () => {
    const previous = make();
    const oldRoot = previous.element;
    const started = performance.now();
    const next = await rebuild(previous, again(), { transition: 10 });
    // fadeIn = fadeOut = 10, plus the 50ms settle rebuild adds.
    expect(performance.now() - started).toBeGreaterThanOrEqual(55);
    for (const root of [next.element, oldRoot]) {
      expect(root.style.opacity).toBe("");
      expect(root.style.transition).toBe("");
    }
    expect(next.element.style.visibility).toBe("");
    expect(next.element.style.position).toBe("");
    next.destroy();
  });

  it("crossfades with separate fade-in, fade-out and a fade-out delay", async () => {
    const previous = make();
    const started = performance.now();
    const next = await rebuild(previous, again(), { transition: { fadeIn: 10, fadeOut: 10, fadeOutDelay: 20 } });
    // max(fadeIn, fadeOut + fadeOutDelay) + 50
    expect(performance.now() - started).toBeGreaterThanOrEqual(75);
    expect(next.element.style.opacity).toBe("");
    next.destroy();
  });
});
