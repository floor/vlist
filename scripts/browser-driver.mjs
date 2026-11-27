/**
 * vlist — Chrome launcher for the browser suites.
 *
 * The suites take their launcher from VLIST_BROWSER_DRIVER so a richer local
 * driver can be substituted (vlist.io/scripts/debug/core.mjs). This is the
 * in-repo default, so CI and a plain checkout can run them with nothing but a
 * Chrome on the machine: puppeteer-core ships no browser of its own, and the
 * GitHub runner images already carry one.
 *
 * Set CHROME_PATH to point at a specific binary.
 *
 * VLIST_SCROLLBARS selects the scrollbar mode. `overlay` enables
 * OverlayScrollbar and leaves scrollbars visible: the gutter is 0 and a thumb
 * is painted. `classic` turns that feature off and leaves scrollbars visible,
 * so the gutter is the bar's column. Unset keeps the launcher default, which
 * hides scrollbars (a zero gutter with nothing painted). Hiding scrollbars is
 * not the overlay mode. An explicit `scrollbars` option wins over the env var.
 */

import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

export function findChrome(override) {
  const candidate = override ?? CHROME_PATHS.find((p) => p && existsSync(p));
  if (!candidate) {
    throw new Error(
      `Chrome not found. Searched:\n${CHROME_PATHS.filter(Boolean).join("\n")}\n` +
        `Set CHROME_PATH to the binary.`,
    );
  }
  return candidate;
}

const SCROLLBAR_MODES = new Set(["default", "overlay", "classic"]);

export function scrollbarMode(override) {
  const raw = override ?? process.env.VLIST_SCROLLBARS;
  const mode = raw ? raw : "default";
  if (!SCROLLBAR_MODES.has(mode)) {
    throw new Error(`VLIST_SCROLLBARS must be default, overlay, or classic (got ${mode})`);
  }
  return mode;
}

export async function launchBrowser(opts = {}) {
  const { headless = true, chrome, scrollbars } = opts;
  const mode = scrollbarMode(scrollbars);
  // The suites drive scroll and pointer input; a shared memory limit small
  // enough to matter shows up as flaky frames rather than a clean failure.
  const args = ["--no-sandbox", "--disable-dev-shm-usage"];
  if (mode === "overlay") args.push("--enable-features=OverlayScrollbar");
  if (mode === "classic") args.push("--disable-features=OverlayScrollbar");
  const browser = await puppeteer.launch({
    headless,
    executablePath: findChrome(chrome),
    ignoreDefaultArgs: mode === "default" ? undefined : ["--hide-scrollbars"],
    args,
  });
  // Branded Chrome starts GoogleUpdater, which inherits the stdio pipes and
  // outlives the browser by minutes. A suite that has closed its browser is
  // done: do not let those pipes hold the process, and the next suite, open.
  const child = browser.process();
  for (const stream of [child?.stdin, child?.stdout, child?.stderr]) stream?.unref?.();
  return browser;
}
