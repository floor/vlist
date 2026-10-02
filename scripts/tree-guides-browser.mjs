/** tree() connector guides paint exactly as in 3.1.0, at every display scale.
 *
 * FLO-244 rewrote how a row's guide gradient is spelled and moved the last
 * child's elbow into the stylesheet. Spellings that read the same can still
 * rasterize differently: with a transparent stop at 0 in front of a line at
 * column 0, Chromium at 150% and 175% drops that line's half-covered device
 * pixel. Happy-dom paints nothing, so this has to be measured in a browser.
 *
 * At each device pixel ratio the fixture renders a connector-lines tree, takes
 * a screenshot, then writes onto every row what 3.1.0 wrote inline (its guide
 * gradient, computed here by a port of its function, and its elbow) and takes
 * another. They must be identical. Then the elbow: the stylesheet must draw one
 * (a last child differs from the same row with `--vlist-tree-elbow: none`), and
 * that override, which themes used in 3.1.0, must still remove it.
 *
 * Build first. Uses scripts/browser-driver.mjs; VLIST_BROWSER_DRIVER overrides
 * it with another module exporting launchBrowser.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const driver = process.env.VLIST_BROWSER_DRIVER ?? resolve(import.meta.dir, "browser-driver.mjs");
const { launchBrowser } = await import(resolve(driver));
const root = resolve(import.meta.dir, "..");

const RATIOS = [1, 1.25, 1.5, 1.75, 2];
// Indent, horizontal offset and paddingStart. A spelling difference shows only
// where a guide's left edge falls between device pixels, so these include the
// cases where the reviewed FLO-244 head (a45aaec) differed from 3.1.0.
const SCENARIOS = [[24, 0, 0], [24, 0, 12], [17, 0, 0], [13.5, 0, 0], [20, 7, 0]];

const page = (indent, left, pad) => `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-tree.css">
<style>
  body { margin: 0; font: 14px system-ui, sans-serif; background: #fff; color: #000; }
  #host { width: 320px; height: 640px; margin-left: ${left}px; --vlist-tree-line: #d00; }
  /* Labels out of the picture: only the guides are compared, not text rendering. */
  .vlist-tree-node { color: transparent; }
  /* Full-strength guides, so a lost device pixel is a large difference. */
  .vlist--tree-lines .vlist-tree-node::before, .vlist--tree-lines .vlist-tree-node::after { opacity: 1; }
</style>
<div id="host"></div>
<script type="module">
  import { createVList, tree } from "/index.js";
  const n = (id, children = []) => ({ id, name: id, children });
  // Depths to 5, an expanded last child, an only child, a last root with children.
  const items = [
    n("A", [n("A1", [n("A1a"), n("A1b", [n("A1b1", [n("A1b1x", [n("A1b1x1")])]), n("A1b2")])]), n("A2", [n("A2a")])]),
    n("B", [n("B1"), n("B2", [n("B2a"), n("B2b")])]),
    n("C", [n("C1", [n("C1a")])]),
  ];
  createVList({ container: "#host", items, item: { height: 28, template: (i) => i.name } },
    [tree({ connectorLines: true, expanded: true, indent: ${indent}, paddingStart: ${pad} })]);

  // 3.1.0's inline values, from the tree's shape.
  const info = new Map();
  (function walk(list, depth, parent) {
    list.forEach((item, i) => {
      info.set(item.id, { depth, last: i === list.length - 1, parent });
      walk(item.children, depth + 1, item.id);
    });
  })(items, 0, null);
  const C = "var(--vlist-tree-line, currentColor)";
  function guides310(id, step) {
    const { depth, last } = info.get(id);
    if (depth === 0) return "none";
    const through = [];
    for (let p = info.get(id).parent; p !== null && info.get(p).parent !== null; p = info.get(p).parent) through.push(!info.get(p).last);
    through.reverse();
    const stops = [];
    for (let column = 0; column <= (last ? depth - 2 : depth - 1); column++) {
      if (column < depth - 1 && !through[column]) continue;
      const x = column * step;
      if (stops.length > 0 || x > 0) stops.push("transparent " + x + "px");
      stops.push(C + " " + x + "px", C + " " + (x + 1) + "px", "transparent " + (x + 1) + "px");
    }
    return stops.length === 0 ? "none" : "linear-gradient(to right, " + stops.join(", ") + ")";
  }
  window.as310 = () => {
    for (const row of document.querySelectorAll("#host [data-id]")) {
      const { depth, last } = info.get(row.dataset.id);
      row.style.setProperty("--vlist-tree-guides", guides310(row.dataset.id, ${indent}));
      row.style.setProperty("--vlist-tree-elbow", depth > 0 && last ? "linear-gradient(" + C + ", " + C + ")" : "none");
    }
  };
  window.reset = () => {
    for (const row of document.querySelectorAll("#host [data-id]")) row.style.removeProperty("--vlist-tree-elbow");
  };
  window.ready = true;
</script>`;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/") {
      const q = new URL(req.url).searchParams;
      return new Response(page(Number(q.get("indent") ?? 20), Number(q.get("left") ?? 0), Number(q.get("pad") ?? 0)), { headers: { "Content-Type": "text/html" } });
    }
    if (["/index.js", "/vlist.css", "/vlist-tree.css"].includes(path)) {
      return new Response(Bun.file(root + "/dist" + path), {
        headers: { "Content-Type": path.endsWith(".css") ? "text/css" : "text/javascript" },
      });
    }
    return new Response("", { status: 404 });
  },
});

console.log("tree-guides fixture: " + server.url.href);

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// Chromium does not always rasterize the same gradient to the same pixels: in
// about one load in six, either spelling comes out a little different. So each
// case is loaded LOADS times and the usual rendering of each side is compared.
const LOADS = 3;
const hash = (png) => createHash("sha1").update(png).digest("hex");
const usual = (hashes) => {
  const counts = new Map();
  for (const h of hashes) counts.set(h, (counts.get(h) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
};

// A screenshot taken once the element has stopped changing: two consecutive
// frames identical. A single capture can land while the list is still settling,
// which reads as a difference that is not there.
async function stableShot(page, handle) {
  let previous = await handle.screenshot();
  for (let i = 0; i < 20; i++) {
    await settle(page);
    const next = await handle.screenshot();
    if (Buffer.compare(previous, next) === 0) return next;
    previous = next;
  }
  throw new Error("the fixture never stopped changing");
}

if (!process.argv.includes("--serve")) {
  let browser;
  try {
    browser = await launchBrowser();
    console.log(await browser.version());
    for (const [indent, left, pad] of SCENARIOS) {
      for (const ratio of RATIOS) {
        const current = [];
        const reference = [];
        for (let load = 0; load < LOADS; load++) {
          const page = await browser.newPage();
          await page.setViewport({ width: 400, height: 680, deviceScaleFactor: ratio });
          await page.goto(`${server.url.href}?indent=${indent}&left=${left}&pad=${pad}`);
          await page.waitForFunction(() => window.ready);
          await page.evaluate(() => document.fonts.ready);
          const host = await page.$("#host");
          const rows = await page.evaluate(() => document.querySelectorAll("#host [data-id]").length);
          assert.equal(rows, 18, "every node must be on screen");

          current.push(hash(await stableShot(page, host)));
          await page.evaluate(() => window.as310());
          reference.push(hash(await stableShot(page, host)));
          await page.close();
        }
        assert.equal(usual(current), usual(reference), `guides (indent ${indent}, offset ${left}px, paddingStart ${pad}) at ${ratio}x must paint as 3.1.0 did`);
      }
      console.log(`PASS guides (indent ${indent}, offset ${left}px, paddingStart ${pad}) paint as in 3.1.0 at ${RATIOS.join(", ")}x`);
    }

    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 680, deviceScaleFactor: 1 });
    await page.goto(`${server.url.href}?indent=24&left=0`);
    await page.waitForFunction(() => window.ready);
    await settle(page);
    const lastChild = await page.$('#host [data-id="A1b2"]');
    const withElbow = await stableShot(page, lastChild);
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = ".vlist-tree-node::before { --vlist-tree-elbow: none; }";
      document.head.append(style);
    });
    const themedOff = await stableShot(page, lastChild);
    assert(Buffer.compare(withElbow, themedOff) !== 0, "the stylesheet must draw a last child's elbow, and --vlist-tree-elbow: none must remove it");
    console.log("PASS the stylesheet draws the elbow, and --vlist-tree-elbow still overrides it");
  } finally {
    await browser?.close();
    server.stop(true);
  }
}
