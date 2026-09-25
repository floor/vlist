/**
 * vlist — DOM Structure
 * Container resolution and DOM scaffold creation.
 */

import type { DOMStructure } from "./types";

// =============================================================================
// Row Content Write
// =============================================================================

const FOCUSABLE = "a[href],button,input,select,textarea,[tabindex]";

/**
 * A row element, carrying the one slot a plugin may use to record that it has
 * processed this row's current content. Zero means "written, nobody has looked
 * at it since"; any other value belongs to whichever plugin wrote it, and only
 * one plugin may (today: `search()`, for its `<mark>`s).
 */
export interface StampableRow extends HTMLElement {
  _stamp?: number;
}

/**
 * Called by every renderer immediately after it writes a row's content.
 *
 * Neutralizes focusable descendants, and voids the row's stamp, so an observer
 * can tell "this row was rewritten" apart from "this row only moved". Node
 * identity cannot tell them apart: `item.template` may return an `HTMLElement`
 * and hand back that same object on a later call, rewritten in place, so the
 * row's child nodes outlive a rewrite that destroyed everything they held. The
 * renderer doing the write is the only one that knows it happened, so it is
 * the one that says so.
 */
export function rowContentWritten(el: HTMLElement): void {
  const nodes = el.querySelectorAll<HTMLElement>(FOCUSABLE);
  for (let i = 0; i < nodes.length; i++) {
    nodes[i]!.setAttribute("tabindex", "-1");
  }
  (el as StampableRow)._stamp = 0;
}

// =============================================================================
// Container Resolution
// =============================================================================

export function resolveContainer(container: HTMLElement | string): HTMLElement {
  if (typeof container === "string") {
    const el = document.querySelector<HTMLElement>(container);
    if (!el) throw new Error(`[vlist] Container not found: ${container}`);
    return el;
  }
  return container;
}

// =============================================================================
// DOM Structure Factory
// =============================================================================

export function createDOMStructure(
  container: HTMLElement,
  classPrefix: string,
  isX: boolean,
  ariaLabel?: string,
): DOMStructure {
  const rootCls = isX ? `${classPrefix} ${classPrefix}--horizontal` : classPrefix;
  const vpStyle = isX
    ? "overflow-x:auto;overflow-y:hidden;height:100%;width:100%"
    : "overflow:auto;height:100%;width:100%";
  // overflow-anchor:none is a non-negotiable constraint for the logical scroll
  // model (RFC-012 G3): it stops the browser's native scroll anchoring from
  // fighting our own anchor-preservation when item sizes change above the
  // viewport. Inline so it holds regardless of class prefix or CSS loading.
  const cStyle = isX
    ? "position:relative;height:100%;overflow-anchor:none"
    : "position:relative;width:100%;overflow-anchor:none";

  let cAttrs = ' role="list"';
  if (ariaLabel) cAttrs += ` aria-label="${ariaLabel.replace(/"/g, "&quot;")}"`;
  if (isX) cAttrs += ' aria-orientation="horizontal"';

  container.insertAdjacentHTML("beforeend",
    `<div class="${rootCls}"><div class="${classPrefix}-viewport" style="${vpStyle}" tabindex="-1"><div class="${classPrefix}-content" style="${cStyle}"${cAttrs}></div></div></div>`,
  );

  const root = container.lastElementChild as HTMLElement;
  const viewport = root.firstElementChild as HTMLElement;
  const content = viewport.firstElementChild as HTMLElement;

  const liveRegion = document.createElement("div");
  liveRegion.className = `${classPrefix}-live`;
  liveRegion.style.cssText =
    "position:absolute;width:1px;height:1px;padding:0;margin:-1px;" +
    "overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("aria-atomic", "true");
  liveRegion.setAttribute("role", "status");
  root.appendChild(liveRegion);

  return { root, viewport, content, liveRegion };
}
