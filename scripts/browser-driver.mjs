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

export async function launchBrowser(opts = {}) {
  const { headless = true, chrome } = opts;
  return puppeteer.launch({
    headless,
    executablePath: findChrome(chrome),
    // The suites drive scroll and pointer input; a shared memory limit small
    // enough to matter shows up as flaky frames rather than a clean failure.
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}
