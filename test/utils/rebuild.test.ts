import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { setupDOM, teardownDOM } from "../helpers/dom";
import { createContainer, createTestItems, simpleTemplate } from "../helpers/factory";
import { createVList } from "../../src/native";
import { rebuild } from "../../src/utils/rebuild";

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
