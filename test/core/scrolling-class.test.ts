/**
 * vlist v2 - Scrolling Class Toggle Tests
 *
 * Tests that the `{classPrefix}--scrolling` class is correctly toggled
 * on the root element during scroll activity:
 * - Not present initially
 * - Added on scroll event
 * - Added on wheel event
 * - Removed on idle (after timeout)
 * - Uses custom classPrefix
 * - Removed on destroy
 * - Not redundantly added on rapid scroll events
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { setupDOM, teardownDOM, useFakeTimers } from "../helpers/dom";
import { createContainer, createTestItems, simpleTemplate } from "../helpers/factory";
import { createVList } from "../../src/core/create";
import { SCROLL_IDLE_TIMEOUT } from "../../src/constants";

beforeAll(() => setupDOM());
afterAll(() => teardownDOM());

describe("scrolling class toggle", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer({ width: 300, height: 500 });
  });

  afterEach(() => {
    container.remove();
  });

  it("root element does NOT have scrolling class initially", () => {
    const list = createVList({
      container,
      items: createTestItems(100),
      item: { height: 40, template: simpleTemplate },
    });

    expect(list.element.classList.contains("vlist--scrolling")).toBe(false);
    list.destroy();
  });

  it("scrolling class is added on scroll event", () => {
    const list = createVList({
      container,
      items: createTestItems(100),
      item: { height: 40, template: simpleTemplate },
    });

    const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
    viewport.scrollTop = 100;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(list.element.classList.contains("vlist--scrolling")).toBe(true);
    list.destroy();
  });

  it("scrolling class is removed on idle (after timeout)", (done) => {
    const list = createVList({
      container,
      items: createTestItems(100),
      item: { height: 40, template: simpleTemplate },
      scroll: { idleTimeout: 50 },
    });

    const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
    viewport.scrollTop = 100;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(list.element.classList.contains("vlist--scrolling")).toBe(true);

    setTimeout(() => {
      expect(list.element.classList.contains("vlist--scrolling")).toBe(false);
      list.destroy();
      done();
    }, 100);
  });

  it("scrolling class uses custom classPrefix", () => {
    const list = createVList({
      container,
      items: createTestItems(100),
      item: { height: 40, template: simpleTemplate },
      classPrefix: "mylist",
    });

    const viewport = list.element.querySelector(".mylist-viewport") as HTMLElement;
    viewport.scrollTop = 100;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(list.element.classList.contains("mylist--scrolling")).toBe(true);
    expect(list.element.classList.contains("vlist--scrolling")).toBe(false);
    list.destroy();
  });

  it("scrolling class is removed on destroy", () => {
    const list = createVList({
      container,
      items: createTestItems(100),
      item: { height: 40, template: simpleTemplate },
    });

    const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
    viewport.scrollTop = 100;
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(list.element.classList.contains("vlist--scrolling")).toBe(true);

    const rootEl = list.element;
    list.destroy();

    expect(rootEl.classList.contains("vlist--scrolling")).toBe(false);
  });

  it("rapid scroll events don't add the class multiple times", () => {
    const list = createVList({
      container,
      items: createTestItems(100),
      item: { height: 40, template: simpleTemplate },
    });

    const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;

    // Spy on classList.add to count calls
    let addCallCount = 0;
    const origAdd = list.element.classList.add.bind(list.element.classList);
    list.element.classList.add = (...args: string[]) => {
      if (args[0] === "vlist--scrolling") addCallCount++;
      origAdd(...args);
    };

    // Fire multiple scroll events rapidly
    for (let i = 1; i <= 5; i++) {
      viewport.scrollTop = i * 50;
      viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    }

    // The class should only be added once despite 5 scroll events
    expect(addCallCount).toBe(1);
    expect(list.element.classList.contains("vlist--scrolling")).toBe(true);
    list.destroy();
  });

  it("scrolling class is added on wheel event", () => {
    const list = createVList({
      container,
      items: createTestItems(100),
      item: { height: 40, template: simpleTemplate },
    });

    const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;

    // Need scrollHeight > clientHeight for wheel handler to activate
    Object.defineProperty(viewport, "scrollHeight", { value: 5000, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 500, configurable: true });

    viewport.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 50, bubbles: true, cancelable: true }),
    );

    expect(list.element.classList.contains("vlist--scrolling")).toBe(true);
    list.destroy();
  });

  it("scrolling class is removed after idle following wheel event", (done) => {
    const list = createVList({
      container,
      items: createTestItems(100),
      item: { height: 40, template: simpleTemplate },
      scroll: { idleTimeout: 50 },
    });

    const viewport = list.element.querySelector(".vlist-viewport") as HTMLElement;
    Object.defineProperty(viewport, "scrollHeight", { value: 5000, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 500, configurable: true });

    viewport.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 50, bubbles: true, cancelable: true }),
    );

    expect(list.element.classList.contains("vlist--scrolling")).toBe(true);

    setTimeout(() => {
      expect(list.element.classList.contains("vlist--scrolling")).toBe(false);
      list.destroy();
      done();
    }, 100);
  });
});
