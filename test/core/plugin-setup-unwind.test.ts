// test/core/plugin-setup-unwind.test.ts
//
// A construction that throws after plugin setup must undo what setup did.
//
// `createVList([page(), carousel()])` is rejected -- but only after both
// plugins have set up, because the incompatibility is known from flags their
// setups raise. page's setup binds a `resize` listener on window. Since no
// list is returned, nothing could destroy it, so the listener outlived its
// context. Under a per-file DOM that was invisible: re-registering Happy DOM
// rebuilt window between files. With one DOM for the whole process it
// surfaced as a throwing listener in an unrelated file's resize test.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createContainer, createTestItems, simpleTemplate, type TestItem } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import { page } from "../../src/plugins/page";
import { carousel } from "../../src/plugins/carousel";

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

describe("a throw after plugin setup unwinds the plugins", () => {
  it("leaves no resize listener on window when page() + carousel() is rejected", () => {
    const added: string[] = [];
    const removed: string[] = [];
    const origAdd = window.addEventListener.bind(window);
    const origRemove = window.removeEventListener.bind(window);
    (window as any).addEventListener = (t: string, fn: any, o?: any) => { added.push(t); return origAdd(t, fn, o); };
    (window as any).removeEventListener = (t: string, fn: any, o?: any) => { removed.push(t); return origRemove(t, fn, o); };
    const container = createContainer({ width: 300, height: 400 });
    try {
      expect(() =>
        createVList<TestItem>(
          { container, items: createTestItems(10), item: { height: 40, template: simpleTemplate } },
          [page(), carousel()],
        ),
      ).toThrow(/page\(\) is not compatible with the carousel plugin/);

      // The root was built before setup; a construction that fails returns
      // nothing, so the caller's container must be as it was.
      expect(container.childElementCount).toBe(0);

      const addedResize = added.filter((t) => t === "resize").length;
      const removedResize = removed.filter((t) => t === "resize").length;
      // setup did bind one; the unwind must have unbound it. Unbinding twice
      // is what happens (the plugin's destroy and a destroy handler both
      // clean up), and removeEventListener is idempotent, so >= is the honest
      // assertion; the dispatch below is the one that proves the leak is gone.
      expect(addedResize).toBeGreaterThan(0);
      expect(removedResize).toBeGreaterThanOrEqual(addedResize);

      // And the proof that matters: a resize on window no longer reaches a
      // listener whose context is gone.
      expect(() => window.dispatchEvent(new Event("resize"))).not.toThrow();
    } finally {
      (window as any).addEventListener = origAdd;
      (window as any).removeEventListener = origRemove;
      container.remove();
    }
  });
});
