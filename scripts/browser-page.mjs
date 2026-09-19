/**
 * vlist — page setup for the browser suites.
 *
 * A suite must read nothing from the machine it runs on. Headless Chrome
 * inherits the OS appearance (a dark macOS makes `prefers-color-scheme: dark`
 * match, which flips vlist's `color-scheme` and every system colour), and the
 * synthetic entry reads `prefers-reduced-motion`. Both are pinned here, with
 * the viewport and device scale factor, for every page that asserts on colour
 * or geometry.
 *
 * VLIST_BROWSER_SCHEME=dark runs the suites under the other scheme; they must
 * pass under both.
 */

export const SCHEME = process.env.VLIST_BROWSER_SCHEME ?? "light";

/** The full emulated media list: CDP replaces the list on every call. */
export const mediaFeatures = (forcedColors = false) => [
  { name: "prefers-color-scheme", value: SCHEME },
  { name: "prefers-reduced-motion", value: "no-preference" },
  { name: "forced-colors", value: forcedColors ? "active" : "none" },
];

/** Pin viewport and media on a fresh page, before it navigates. Returns its CDP session. */
export async function pinPage(page, viewport = {}) {
  await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1, ...viewport });
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setEmulatedMedia", { features: mediaFeatures() });
  return cdp;
}

/**
 * Wait for what a fixed sleep only approximates: `frames` rendering updates,
 * then the end of every CSS transition under `selector`. A scroll event, and
 * anything a plugin syncs from it, is dispatched by the frame after the scroll
 * — not after some number of milliseconds — and a transition's start time is
 * resolved by a frame too, so on a busy machine neither has happened yet when a
 * timer fires. Runs in the page.
 */
export const settle = (page, selector = null, frames = 2) => page.evaluate(async (selector, frames) => {
  const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
  for (let i = 0; i < frames; i++) await frame();
  const root = selector ? document.querySelector(selector) : null;
  if (!root) return;
  for (;;) {
    // getAnimations() flushes style, so a transition the last change started is in the list.
    const running = root.getAnimations({ subtree: true }).filter(a => a.playState !== "finished");
    if (!running.length) break;
    await Promise.allSettled(running.map(a => a.finished));
  }
  await frame();
}, selector, frames);
