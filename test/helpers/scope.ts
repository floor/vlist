/**
 * vlist/test/helpers — Per-test ownership
 *
 * Under `bun test --concurrent` the tests of one file interleave at every
 * `await`. A list kept in a module-level array and destroyed from `afterEach`
 * is then destroyed by whichever test finishes first, under the feet of the
 * ones still waiting. A scope belongs to one test: what the test creates it
 * registers here, and `scoped()` disposes it in a `finally` when that test —
 * and only that test — is over.
 *
 *   it("…", scoped(async (scope) => {
 *     const { list, container } = makeList(scope, …);
 *     …
 *   }));
 */

export interface TestScope {
  /** Register a list and its container; both go when the test ends. */
  own<L extends { destroy(): void }>(list: L, container?: HTMLElement): L;
  /** Register any other cleanup (a restored global, a removed node). */
  defer(cleanup: () => void): void;
}

/** Wrap a test body so everything it registers is torn down in `finally`. */
export function scoped(
  body: (scope: TestScope) => void | Promise<void>,
): () => Promise<void> {
  return async (): Promise<void> => {
    const cleanups: Array<() => void> = [];
    const scope: TestScope = {
      own(list, container) {
        cleanups.push(() => {
          list.destroy();
          container?.remove();
        });
        return list;
      },
      defer(cleanup) {
        cleanups.push(cleanup);
      },
    };
    try {
      await body(scope);
    } finally {
      // Last registered, first undone.
      for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!();
    }
  };
}

/**
 * Wait for a condition instead of for a duration. A fixed `setTimeout` races
 * every other test sharing the event loop; this resolves on the first turn the
 * condition holds and only fails after `timeout`.
 */
export async function waitFor(
  condition: () => boolean,
  what: string,
  timeout: number = 3000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`waitFor: timed out waiting for ${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}
