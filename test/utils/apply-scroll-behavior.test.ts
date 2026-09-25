/**
 * vlist — scroll behavior shared by layout plugins
 * Core animates `{ behavior: "smooth" }` with SCROLL_DURATION when duration
 * is omitted and forwards easing. grid(), groups() and masonry() go through
 * this helper so they do the same.
 */

import { describe, it, expect } from "bun:test";
import { SCROLL_DURATION } from "../../src/constants";
import { applyScrollBehavior } from "../../src/utils/apply-scroll-behavior";

type Call = {
  kind: "to" | "smooth";
  position: number;
  duration?: number;
  // `| undefined` explicitly: exactOptionalPropertyTypes is on, and the
  // smoothTo stub records `easing` whether or not one was passed.
  easing?: ((t: number) => number) | undefined;
};

function target() {
  const calls: Call[] = [];
  return {
    calls,
    to(position: number): void {
      calls.push({ kind: "to", position });
    },
    smoothTo(position: number, duration: number, easing?: (t: number) => number): void {
      calls.push({ kind: "smooth", position, duration, easing });
    },
  };
}

describe("applyScrollBehavior", () => {
  it("animates a smooth call that omits duration, using the core default", () => {
    const scroll = target();
    applyScrollBehavior(scroll, 2500, "smooth");
    expect(scroll.calls).toEqual([
      { kind: "smooth", position: 2500, duration: SCROLL_DURATION, easing: undefined },
    ]);
  });

  it("forwards an explicit duration and easing", () => {
    const scroll = target();
    const easing = (t: number): number => t;
    applyScrollBehavior(scroll, 100, "smooth", 80, easing);
    expect(scroll.calls).toEqual([
      { kind: "smooth", position: 100, duration: 80, easing },
    ]);
  });

  it("keeps an explicit duration of 0", () => {
    const scroll = target();
    applyScrollBehavior(scroll, 100, "smooth", 0);
    expect(scroll.calls[0]).toEqual({ kind: "smooth", position: 100, duration: 0, easing: undefined });
  });

  it("jumps when behavior is omitted or auto", () => {
    const scroll = target();
    applyScrollBehavior(scroll, 40);
    applyScrollBehavior(scroll, 50, "auto");
    expect(scroll.calls).toEqual([
      { kind: "to", position: 40 },
      { kind: "to", position: 50 },
    ]);
  });
});
