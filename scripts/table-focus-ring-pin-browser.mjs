/** Focused row's ring across pinned columns (floor/vlist#116 item 3). Build
 * first. Uses scripts/browser-driver.mjs; VLIST_BROWSER_DRIVER overrides it
 * with another module exporting launchBrowser.
 *
 * The ring is the row's `outline`, drawn 2px inside the row box. A pinned body
 * cell is an opaque positioned child at z-index 2, so it paints over that
 * outline across its own width, and when the row scrolls under the pin the
 * outline's outer edge sits on the scrolled-away row box. The fix carries the
 * ring on the pinned cells themselves: top and bottom on every pinned cell,
 * the outer vertical on the outermost one (`:first-child` for a left pin,
 * `:last-child` for a right pin), the same 2px at the same place as the
 * outline.
 *
 * This gate reads pixels, not declarations: it focuses a row, screenshots the
 * page, and samples the ring at the row's outer edges and across the pinned
 * cell at scrollLeft 0 and at the far end, left pin, both pins, and RTL. The
 * ring colour is read from the row's computed outline, so it follows the
 * page's scheme (run with VLIST_BROWSER_SCHEME=dark to cover the dark theme).
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pinPage, settle } from './browser-page.mjs';

const root = resolve(import.meta.dir, '../dist');
const html = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/vlist.css"><link rel="stylesheet" href="/vlist-table.css">
<style>body{margin:8px}.host{width:640px;height:300px;margin-bottom:8px}</style>
<div id="ltr" class="host"></div>
<div id="both" class="host"></div>
<div id="rtl" class="host" dir="rtl"></div>
<script type="module">
import {createVList,table,columnPin,selection} from '/index.js';
const items=Array.from({length:60},(_,i)=>({id:i,name:'Item '+i,size:(i*37)+' B',modified:'Nov '+(i+1)+', 2026',kind:['Doc','Tool','Folder'][i%3]}));
const columns=[{key:'name',label:'Name',width:260},{key:'size',label:'Size',width:260},{key:'modified',label:'Modified',width:260},{key:'kind',label:'Kind',width:260}];
const make=(host,pins)=>createVList({container:host,items,item:{height:28,template:i=>'<span>'+i.name+'</span>'}},[
  table({rowHeight:28,columns,features:[columnPin({pins})]}),
  selection({mode:'single'}),
]);
window.lists={ltr:make('#ltr',{name:'left'}),both:make('#both',{name:'left',kind:'right'}),rtl:make('#rtl',{name:'left'})};
window.focusRoot=(host)=>{
  const root=document.querySelector(host+' .vlist');
  root.focus();
  return !!document.activeElement&&root.contains(document.activeElement);
};
window.setScroll=(host,x)=>{
  const vp=document.querySelector(host+' .vlist-viewport');
  vp.scrollLeft=x;
  vp.dispatchEvent(new Event('scroll'));
};
window.geometry=(host)=>{
  const vp=document.querySelector(host+' .vlist-viewport');
  const vr=vp.getBoundingClientRect();
  const row=document.querySelector(host+' .vlist-table-row.vlist-item--focused');
  if(!row)return{row:null};
  const rr=row.getBoundingClientRect();
  const cs=getComputedStyle(row);
  const pin=row.querySelector('.vlist-table-cell--pin-left');
  const pinR=row.querySelector('.vlist-table-cell--pin-right');
  const pr=pin&&pin.getBoundingClientRect();
  const prr=pinR&&pinR.getBoundingClientRect();
  const other=[...document.querySelectorAll(host+' .vlist-table-row')].find(r=>!r.classList.contains('vlist-item--focused')&&r.getBoundingClientRect().height>0).getBoundingClientRect();
  return{
    outlineColor:cs.outlineColor,outlineWidth:cs.outlineWidth,
    viewport:{left:vr.left,right:vr.right,scrollLeft:vp.scrollLeft,max:vp.scrollWidth-vp.clientWidth},
    row:{left:rr.left,right:rr.right,top:rr.top,bottom:rr.bottom,height:rr.height},
    pin:pr&&{left:pr.left,right:pr.right,top:pr.top,bottom:pr.bottom,width:pr.width},
    pinRight:prr&&{left:prr.left,right:prr.right,top:prr.top,bottom:prr.bottom,width:prr.width},
    pinShadow:pin&&getComputedStyle(pin).boxShadow,
    plain:{left:other.left,right:other.right,top:other.top,bottom:other.bottom},
  };
};
window.ready=true;
</script>`;

const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
  const path = new URL(req.url).pathname;
  if (path === '/') return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  if (['/index.js', '/vlist.css', '/vlist-table.css'].includes(path)) return new Response(Bun.file(root + path));
  return new Response('', { status: 404 });
} });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0;
let skips = 0;
const pass = (msg, extra) => { passes++; console.log('PASS', msg, extra === undefined ? '' : JSON.stringify(extra)); };

/** Screenshot the viewport and read single pixels at CSS-pixel points (DPR 1). */
const samplePixels = async (page, points) => {
  const b64 = await page.screenshot({ encoding: 'base64' });
  return page.evaluate(async (b64, points) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const out = {};
    for (const p of points) {
      const d = ctx.getImageData(p.x, p.y, 1, 1).data;
      out[p.name] = 'rgb(' + d[0] + ', ' + d[1] + ', ' + d[2] + ')';
    }
    return out;
  }, b64, points);
};

/** Points on the focused row: over the pinned cell, its outer vertical, an
 * unpinned span, and (both pins) the right pin's outer vertical. */
const ringPoints = (g) => {
  const row = g.row;
  if (!row || !g.pin) return null;
  const x = Math.round(g.pin.left + Math.min(40, g.pin.width / 2));
  const middle = Math.round((g.pin.top + g.pin.bottom) / 2);
  // Bands are sampled where the outline's -2px offset puts them: the top and
  // bottom of the row box, which is what the cell's segment has to reproduce.
  // (A bordered row's bottom border lies outside its cells; the cell's 1px
  // segment there and the outline's last pixel complete the same 2px band.)
  const points = [
    { name: 'pinTop', x, y: Math.round(row.top) + 1 },
    { name: 'pinBottom', x, y: Math.round(row.bottom) - 2 },
    { name: 'outerLeft', x: Math.round(g.pin.left) + 1, y: middle },
  ];
  const spanX = Math.round(Math.min(g.pin.right + 60, g.viewport.right - 60));
  if (spanX > Math.round(g.pin.right) + 4 && spanX < Math.round(g.viewport.right) - 4) {
    points.push({ name: 'spanTop', x: spanX, y: Math.round(row.top) + 1 });
  }
  if (g.pinRight) {
    points.push({
      name: 'outerRight',
      x: Math.round(g.pinRight.right) - 2,
      y: Math.round((g.pinRight.top + g.pinRight.bottom) / 2),
    });
  }
  return points;
};

let browser;
try {
  const driver = process.env.VLIST_BROWSER_DRIVER ?? resolve(import.meta.dir, 'browser-driver.mjs');
  browser = await (await import(resolve(driver))).launchBrowser();
  console.log(await browser.version());
  const page = await browser.newPage();
  await pinPage(page, { width: 760, height: 960 });
  await page.goto(server.url.href);
  await page.waitForFunction(() => window.ready);
  await settle(page);
  await wait(100);

  for (const host of ['#ltr', '#both', '#rtl']) {
    const focused = await page.evaluate((host) => window.focusRoot(host), host);
    assert(focused, `${host}: the table root takes focus`);
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowDown'); await settle(page, host); }

    for (const phase of ['start', 'end']) {
      await page.evaluate((host, phase) => {
        const g = window.geometry(host);
        const dir = getComputedStyle(document.querySelector(host + ' .vlist-viewport')).direction;
        const max = Math.round(g.viewport.max);
        const target = phase === 'start' ? 0 : dir === 'rtl' ? -max : max;
        window.setScroll(host, target);
      }, host, phase);
      await settle(page, host);
      await wait(200);

      const g = await page.evaluate((host) => window.geometry(host), host);
      const points = ringPoints(g);
      assert(points, `${host}/${phase}: a focused row with a pinned cell`);
      assert.equal(g.outlineWidth, '2px', `${host}/${phase}: the row's ring is 2px (${g.outlineWidth})`);

      // A second row that is not focused: its pin must not show the ring.
      points.push({ name: 'unfocused', x: points[0].x, y: Math.round(g.plain.top) + 1 });

      const px = await samplePixels(page, points);
      const ring = g.outlineColor;
      const where = { host, phase, scrollLeft: Math.round(g.viewport.scrollLeft), pin: g.pin, row: g.row, viewport: g.viewport, ring, px };

      assert.notEqual(px.unfocused, ring, `${host}/${phase}: an unfocused row's pinned cell shows no ring: ${JSON.stringify(where)}`);
      assert.equal(px.pinTop, ring, `${host}/${phase}: the ring runs along the row's top edge over the pinned cell: ${JSON.stringify(where)}`);
      assert.equal(px.pinBottom, ring, `${host}/${phase}: the ring runs along the row's bottom edge over the pinned cell: ${JSON.stringify(where)}`);
      assert.equal(px.outerLeft, ring, `${host}/${phase}: the ring's left edge sits on the pinned cell, not the scrolled-away row box: ${JSON.stringify(where)}`);
      if (px.spanTop !== undefined) {
        assert.equal(px.spanTop, ring, `${host}/${phase}: the ring still runs over the unpinned span: ${JSON.stringify(where)}`);
      }
      if (px.outerRight !== undefined) {
        assert.equal(px.outerRight, ring, `${host}/${phase}: the ring's right edge sits on the right-pinned cell: ${JSON.stringify(where)}`);
      }
      pass(`${host} @ ${phase}: ring across the pinned column and at its outer edge`, { scrollLeft: Math.round(g.viewport.scrollLeft), px, ring });
    }
  }
  console.log('SUMMARY', JSON.stringify({ passes, skips }));
  assert.equal(skips, 0, 'no skipped checks');
} finally {
  await browser?.close();
  server.stop(true);
}
