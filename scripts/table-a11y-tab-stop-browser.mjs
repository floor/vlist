/** The grid is a tab stop with table() + a11y() (#352).
 *
 * Real Tab, Shift+Tab, real clicks and real key presses, in five
 * configurations — A table(), B table()+a11y(), C table()+selection(),
 * D table()+a11y()+selection(), E plain list + a11y() — and in the six
 * layouts that have an a11y() click path. Before the fix, B's grid root had
 * no tabindex: the only tab stop inside the table was the Name header, a
 * click focused the viewport, and the header's ArrowDown left focus on the
 * header. C, D and E must be identical before and after; the before/after
 * tables come from running this script against a baseline build:
 *   VLIST_TABSTOP_ROOT=/path/to/next bun scripts/table-a11y-tab-stop-browser.mjs
 * Build first. VLIST_BROWSER_DRIVER supplies launchBrowser (default Chromium).
 */
import { resolve } from "node:path";
const { launchBrowser } = await import(resolve(process.env.VLIST_BROWSER_DRIVER ?? resolve(import.meta.dir, "browser-driver.mjs")));
const { pinPage } = await import(resolve(import.meta.dir, "browser-page.mjs"));
const root = process.env.VLIST_TABSTOP_ROOT ?? resolve(import.meta.dir, "..");

const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-table.css">
<style>body{margin:16px}#host{width:480px;height:360px}</style>
<button id="before">Before</button><div id="host"></div><button id="after">After</button>
<script type="module">
import {createVList,table,grid,groups,tree,masonry,a11y,selection} from '/index.js';
const params = new URLSearchParams(location.search);
const layout = params.get('layout');
const owner = params.get('owner');
window.focusCalls = [];
const origFocus = HTMLElement.prototype.focus;
HTMLElement.prototype.focus = function (...args) { window.focusCalls.push(this); return origFocus.apply(this, args); };
window.markOf = el => {
  if (!el) return null;
  if (el === el.ownerDocument.body) return { id: null, mark: 'body', role: null, label: '', tabindex: null };
  const cls = el.classList;
  return {
    id: el.id || null,
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
    label: el.getAttribute('aria-label') ?? (el.textContent || '').trim().slice(0, 24),
    tabindex: el.getAttribute('tabindex'),
    mark: el.id ? el.id : cls.contains('vlist-table-header-cell') ? 'header-cell'
      : cls.contains('vlist-content') ? 'content'
      : cls.contains('vlist-viewport') ? 'viewport'
      : cls.contains('vlist') ? 'root' : (cls[0] || ''),
  };
};
window.snap = () => {
  const content = document.querySelector('.vlist-content');
  const viewport = document.querySelector('.vlist-viewport');
  const id = content.getAttribute('aria-activedescendant');
  const row = id ? document.getElementById(id) : null;
  const ring = [...content.querySelectorAll('[data-index]')].filter(el => el.className.includes('--focused')).map(el => Number(el.dataset.index));
  const last = window.focusCalls.length ? window.markOf(window.focusCalls[window.focusCalls.length - 1]) : null;
  return { active: window.markOf(document.activeElement), desc: id, descIndex: row ? Number(row.dataset.index) : null,
    ring, scrollTop: Math.round(viewport.scrollTop), last, focusCalls: window.focusCalls.length };
};
window.attrs = () => {
  const q = s => document.querySelector(s);
  const out = {};
  for (const [key, el] of Object.entries({ root: q('.vlist'), viewport: q('.vlist-viewport'), content: q('.vlist-content'), header: q('.vlist-table-header-cell'), row0: q('.vlist-content [data-index="0"]') })) {
    out[key] = el ? { role: el.getAttribute('role'), tabindex: el.getAttribute('tabindex'), label: el.getAttribute('aria-label'), descendant: el.getAttribute('aria-activedescendant') } : null;
  }
  return out;
};
window.stops = () => [...document.querySelectorAll('#host [tabindex]')]
  .map(el => { const m = window.markOf(el); return { mark: m.mark, tabindex: m.tabindex, role: m.role, label: m.label }; });
window.rowPoint = index => {
  const row = document.querySelector('.vlist-content [data-index="' + index + '"]');
  const r = row.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2);
  const y = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(x, y);
  return { x, y, row: window.markOf(row), hit: window.markOf(hit), inside: row.contains(hit) };
};
const items = Array.from({ length: 1000 }, (_, id) => ({ id, name: 'Name ' + id }));
const plugins = [];
if (layout === 'table') plugins.push(table({ rowHeight: 32, columns: [{ key: 'name', label: 'Name', width: 240, sortable: true }] }));
if (layout === 'grid') plugins.push(grid({ columns: 3 }));
if (layout === 'groups') plugins.push(groups({ getGroupForIndex: i => 'G' + Math.floor(i / 1000), header: { height: 30, template: g => g } }));
if (layout === 'tree') plugins.push(tree({ label: 'name' }));
if (layout === 'masonry') plugins.push(masonry({ columns: 3, gap: 8 }));
if (owner === 'a11y' || owner === 'a11y+selection') plugins.push(a11y());
if (owner === 'selection' || owner === 'a11y+selection') plugins.push(selection());
window.list = createVList({ container: '#host', ariaLabel: 'Orders', items, item: { height: 32, template: item => '<span>' + item.name + '</span>' } }, plugins);
window.ready = true;
</script>`;

const server = Bun.serve({ port: 0, fetch(req) {
  const path = new URL(req.url).pathname;
  if (path === "/") return new Response(html, { headers: { "Content-Type": "text/html" } });
  if (["/index.js", "/vlist.css", "/vlist-table.css"].includes(path)) return new Response(Bun.file(`${root}/dist${path}`));
  return new Response("Not found", { status: 404 });
} });
const origin = `http://localhost:${server.port}`;

let checks = 0;
let failures = 0;
/** JSON-equality check; prints both sides so a baseline run reads as a diff. */
function check(label, actual, wanted) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? ` -> ${JSON.stringify(actual)}` : `\n     got  ${JSON.stringify(actual)}\n     want ${JSON.stringify(wanted)}`}`);
}

const MODES = [
  { key: "A", layout: "table", owner: "none" },
  { key: "B", layout: "table", owner: "a11y" },
  { key: "C", layout: "table", owner: "selection" },
  { key: "D", layout: "table", owner: "a11y+selection" },
  { key: "E", layout: "plain", owner: "a11y" },
];
// Tab from Before to After, and back. The only new stop is the grid root,
// which sits before the header cell because the header rowgroup is the root's
// first child and an ancestor is a tab stop before its descendants.
const TAB_ORDER = {
  A: { forward: ["header-cell:columnheader:Name", "after"], back: ["header-cell:columnheader:Name", "before"] },
  B: { forward: ["root:grid:Orders", "header-cell:columnheader:Name", "after"], back: ["header-cell:columnheader:Name", "root:grid:Orders", "before"] },
  C: { forward: ["root:grid:Orders", "header-cell:columnheader:Name", "after"], back: ["header-cell:columnheader:Name", "root:grid:Orders", "before"] },
  D: { forward: ["root:grid:Orders", "header-cell:columnheader:Name", "after"], back: ["header-cell:columnheader:Name", "root:grid:Orders", "before"] },
  E: { forward: ["content:listbox:Orders", "after"], back: ["content:listbox:Orders", "before"] },
};
// The stop Tab reaches first from Before, and whether keys from it move a row.
const LANDING = {
  A: { stop: "header-cell:columnheader:Name", desc: null, ring: [], rows: false },
  B: { stop: "root:grid:Orders", desc: 0, ring: [0], rows: true },
  C: { stop: "root:grid:Orders", desc: 0, ring: [0], rows: true },
  D: { stop: "root:grid:Orders", desc: 0, ring: [0], rows: true },
  E: { stop: "content:listbox:Orders", desc: 0, ring: [0], rows: true },
};
const AX_AT_LANDING = {
  A: { role: "columnheader", name: "Name" },
  B: { role: "grid", name: "Orders" },
  C: { role: "grid", name: "Orders" },
  D: { role: "grid", name: "Orders" },
  E: { role: "listbox", name: "Orders" },
};
// activeElement and the last focus() call after a real click on row 0.
const CLICK = {
  A: { active: "viewport", tabindex: "-1", last: null, desc: null },
  B: { active: "root", tabindex: "0", last: "root", desc: 0 },
  C: { active: "root", tabindex: "0", last: "root", desc: null },
  D: { active: "root", tabindex: "0", last: "root", desc: null },
  E: { active: "content", tabindex: "0", last: "content", desc: 0 },
};

/**
 * Frames, then any transition under `selector`. browser-page.mjs's settle
 * passes two arguments to page.evaluate (Puppeteer's signature); Playwright
 * allows one, so this script speaks the narrower form for every engine —
 * Firefox and WebKit run through a VLIST_BROWSER_DRIVER override.
 */
const settlePage = (page, selector = null) => page.evaluate(async sel => {
  const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
  for (let i = 0; i < 2; i++) await frame();
  const element = sel ? document.querySelector(sel) : null;
  if (!element) return;
  for (;;) {
    const running = element.getAnimations({ subtree: true }).filter(a => a.playState !== "finished");
    if (!running.length) break;
    await Promise.allSettled(running.map(a => a.finished));
  }
  await frame();
}, selector);

const browser = await launchBrowser();
try {
  console.log(await browser.version());
  console.log(`root: ${root}`);
  async function open(layout, owner) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e.stack ?? e)));
    // pinPage pins viewport and media through CDP, which only Chromium has.
    // Firefox and WebKit (VLIST_BROWSER_DRIVER override) get the viewport
    // alone, and the accessibility-tree checks are skipped there.
    const cdp = typeof page.createCDPSession === "function" ? await pinPage(page) : null;
    if (!cdp) await page.setViewportSize?.({ width: 900, height: 700 });
    await page.goto(`${origin}/?layout=${layout}&owner=${encodeURIComponent(owner)}`);
    await page.waitForFunction(() => window.ready);
    await settlePage(page);
    return { page, cdp, errors };
  }
  let axSkipped = false;
  const maybeAx = async (label, cdp, wanted) => {
    if (!cdp) {
      if (!axSkipped) { axSkipped = true; console.log(`SKIP ${label}: no accessibility-tree API on this engine`); }
      return;
    }
    check(label, axFocused(await axNodes(cdp)), wanted);
  };
  const view = s => ({ stop: `${s.active.mark}:${s.active.role}:${s.active.label}`, desc: s.descIndex, ring: s.ring });
  /** Real Tab (or Shift+Tab) from one button to the other; every stop between. */
  async function sweep(page, back) {
    const from = back ? "after" : "before";
    await page.evaluate(id => document.getElementById(id).focus(), from);
    const stops = [];
    const done = back ? "before" : "after";
    for (let i = 0; i < 24; i++) {
      if (back) await page.keyboard.down("Shift");
      await page.keyboard.press("Tab");
      if (back) await page.keyboard.up("Shift");
      const mark = await page.evaluate(() => window.markOf(document.activeElement));
      stops.push(mark.id === "before" || mark.id === "after" ? mark.id : `${mark.mark}:${mark.role}:${mark.label}`);
      if (mark.id === done) return { stops, complete: true };
    }
    return { stops, complete: false };
  }
  /** WebKit's default Tab traversal skips buttons, so the sweep cannot run there. */
  const sweepImpossible = result => !result.complete && result.stops.includes("body:null:");
  async function press(page, key) {
    await page.keyboard.press(key);
    await settlePage(page, "#host");
    return page.evaluate(() => window.snap());
  }
  const axNodes = async cdp => {
    await cdp.send("Accessibility.enable");
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    const prop = (n, name) => n.properties?.find(p => p.name === name)?.value?.value ?? null;
    return nodes.filter(n => ["grid", "listbox", "columnheader", "rowgroup", "tree"].includes(n.role?.value))
      .map(n => ({ role: n.role.value, name: n.name?.value ?? "", focused: prop(n, "focused"), focusable: prop(n, "focusable"), descendant: prop(n, "activedescendant") }));
  };
  const axFocused = rows => {
    const n = rows.find(node => node.focused);
    return n ? { role: n.role, name: n.name } : null;
  };
  const landing = key => {
    const want = LANDING[key];
    return { stop: want.stop, desc: want.desc, ring: want.ring };
  };

  for (const mode of MODES) {
    const { key, layout, owner } = mode;
    // 1. Attributes at rest, tab stops, Tab sweep forward and back.
    {
      const { page, errors } = await open(layout, owner);
      try {
        console.log(`ATTRS ${key} ${JSON.stringify(await page.evaluate(() => window.attrs()))}`);
        console.log(`STOPS ${key} ${JSON.stringify(await page.evaluate(() => window.stops()))}`);
        const forward = await sweep(page, false);
        const back = await sweep(page, true);
        if (sweepImpossible(forward) || sweepImpossible(back)) {
          console.log(`SKIP ${key} tab order: this engine's Tab traversal skips the page's buttons (WebKit's default), so the Before-to-After sweep cannot complete`);
        } else {
          check(`${key} tab order (Tab from Before to After)`, forward.stops, TAB_ORDER[key].forward);
          check(`${key} tab order (Shift+Tab from After to Before)`, back.stops, TAB_ORDER[key].back);
          if (key === "B") {
            check("B grid root is reached exactly once", forward.stops.filter(s => s === "root:grid:Orders").length, 1);
          }
        }
        check(`${key} no pageerror in the tab sweep`, errors, []);
      } finally { await page.close(); }
    }
    // 2. Landing on the first stop, the AX tree there, then ArrowDown/End/Home.
    {
      const { page, cdp, errors } = await open(layout, owner);
      try {
        await page.evaluate(() => document.getElementById("before").focus());
        const landed = await press(page, "Tab");
        check(`${key} Tab lands on the tab stop and rings/leaves the row as expected`, view(landed), landing(key));
        await maybeAx(`${key} focused AX node at the tab stop`, cdp, AX_AT_LANDING[key]);
        const down = await press(page, "ArrowDown");
        const end = await press(page, "End");
        const home = await press(page, "Home");
        const want = LANDING[key];
        check(`${key} ArrowDown from the tab stop`, view(down),
          want.rows ? { stop: want.stop, desc: 1, ring: [1] } : { stop: want.stop, desc: null, ring: [] });
        check(`${key} End from the tab stop`, view(end),
          want.rows ? { stop: want.stop, desc: 999, ring: [999] } : { stop: want.stop, desc: null, ring: [] });
        check(`${key} Home from the tab stop`, view(home), { stop: want.stop, desc: want.desc, ring: want.ring });
        if (want.rows) check(`${key} End scrolls the focused row into view`, end.scrollTop > 0, true);
        check(`${key} no pageerror in the keys`, errors, []);
      } finally { await page.close(); }
    }
    // 3. The header's ArrowDown. E has no header.
    if (layout === "table") {
      const { page, cdp, errors } = await open(layout, owner);
      try {
        await page.evaluate(() => document.getElementById("before").focus());
        let toHeader = await press(page, "Tab");
        if (toHeader.active.mark !== "header-cell") toHeader = await press(page, "Tab");
        check(`${key} Tab reaches the header cell`, view(toHeader), { stop: "header-cell:columnheader:Name", desc: toHeader.descIndex, ring: toHeader.ring });
        const after = await press(page, "ArrowDown");
        const want = LANDING[key];
        check(`${key} header ArrowDown`, view(after),
          want.rows ? { stop: want.stop, desc: 0, ring: [0] } : { stop: want.stop, desc: null, ring: [] });
        if (want.rows) await maybeAx(`${key} focused AX node after header ArrowDown`, cdp, AX_AT_LANDING[key]);
        check(`${key} no pageerror in the header keys`, errors, []);
      } finally { await page.close(); }
    }
    // 4. A real click on row 0, then ArrowDown.
    {
      const { page, errors } = await open(layout, owner);
      try {
        const point = await page.evaluate(() => window.rowPoint(0));
        check(`${key} click point hits row 0`, point.inside, true);
        await page.mouse.click(point.x, point.y);
        await settlePage(page, "#host");
        const clicked = await page.evaluate(() => window.snap());
        const want = CLICK[key];
        check(`${key} click: activeElement is the element the click handler focused`,
          { active: clicked.active.mark, tabindex: clicked.active.tabindex, last: clicked.last?.mark ?? null },
          { active: want.active, tabindex: want.tabindex, last: want.last });
        check(`${key} click: descendant after the click`, clicked.descIndex, want.desc);
        check(`${key} click: no focus ring on the click`, clicked.ring, []);
        const after = await press(page, "ArrowDown");
        check(`${key} ArrowDown after the click`,
          { sameElement: after.active.mark === clicked.active.mark && after.active.role === clicked.active.role, desc: after.descIndex, ring: after.ring },
          { sameElement: true, desc: LANDING[key].rows ? 1 : null, ring: LANDING[key].rows ? [1] : [] });
        check(`${key} no pageerror in the click`, errors, []);
      } finally { await page.close(); }
    }
  }
  // 5. The a11y() click path in every layout focuses an element that can take
  // focus: the content, or the grid root in a table.
  for (const layout of ["plain", "grid", "groups", "tree", "masonry", "table"]) {
    const { page, errors } = await open(layout, "a11y");
    try {
      const expected = layout === "table" ? "root" : "content";
      const point = await page.evaluate(() => window.rowPoint(0));
      await page.mouse.click(point.x, point.y);
      await settlePage(page, "#host");
      const clicked = await page.evaluate(() => window.snap());
      check(`a11y click in ${layout}: focus lands on the tabbable element`,
        { active: clicked.active.mark, tabindex: clicked.active.tabindex, last: clicked.last?.mark ?? null },
        { active: expected, tabindex: "0", last: expected });
      check(`a11y click in ${layout}: no pageerror`, errors, []);
    } finally { await page.close(); }
  }
} finally { await browser.close(); server.stop(true); }

console.log(`SUMMARY checks=${checks} failures=${failures}`);
if (failures > 0) throw new Error(`${failures} of ${checks} checks failed`);
console.log("PASS table + a11y(): the grid is one tab stop, before the header, and every focus path lands on it");
