/**
 * vlist — useFakeTimers() isolation tests
 *
 * A clock can be installed while another one is still active: a suite whose
 * teardown throws before it restores, or concurrent tests in one file that
 * yield a macrotask while the clock is installed. Restoring the older clock
 * must not put the real timers back under the newer one's feet, and the last
 * restore must leave the real timers behind — not an earlier fake.
 *
 * The scenarios are serial: they share the process-global timer slots.
 */

import { describe, it, expect } from "bun:test";
import { useFakeTimers } from "./dom";

describe("useFakeTimers", () => {
  it.serial("restoring an older clock out of order leaves the newer one in charge", () => {
    const start = globalThis.setTimeout;
    const outer = useFakeTimers();
    const inner = useFakeTimers();

    try {
      // Out of order: `inner` was installed after `outer`, so `outer` is not
      // the active clock. Restoring it must not hand the slots back to the
      // real timers while `inner` still owns them.
      outer.restore();

      let fired = false;
      setTimeout(() => {
        fired = true;
      }, 0);
      inner.tick(0);
      expect(fired).toBe(true);
    } finally {
      inner.restore();
    }

    // And the last restore must leave exactly the timers that were there
    // before the first install — never `outer`'s fake.
    expect(globalThis.setTimeout).toBe(start);
  });

  it.serial("restoring the newer clock first hands the slots back to the older one", () => {
    const start = globalThis.setTimeout;
    const outer = useFakeTimers();
    const inner = useFakeTimers();

    try {
      inner.restore(); // the top of the stack goes first

      let fired = false;
      setTimeout(() => {
        fired = true;
      }, 0);
      outer.tick(0);
      expect(fired).toBe(true);
    } finally {
      outer.restore();
    }

    expect(globalThis.setTimeout).toBe(start);
  });

  it.serial("a restore is idempotent and puts back the timers it replaced", () => {
    const start = globalThis.setTimeout;
    const timers = useFakeTimers();
    timers.restore();
    expect(globalThis.setTimeout).toBe(start);

    // A second restore must not clobber whatever is installed now.
    timers.restore();
    expect(globalThis.setTimeout).toBe(start);
  });
});
