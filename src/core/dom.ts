/**
 * vlist v2 — DOM Structure
 * Container resolution and DOM scaffold creation.
 */

import type { DOMStructure } from "./types";

// =============================================================================
// Focusable Descendant Neutralization
// =============================================================================

const FOCUSABLE = "a[href],button,input,select,textarea,[tabindex]";

export function neutralizeFocusable(el: HTMLElement): void {
  const nodes = el.querySelectorAll<HTMLElement>(FOCUSABLE);
  for (let i = 0; i < nodes.length; i++) {
    nodes[i]!.setAttribute("tabindex", "-1");
  }
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
  const cStyle = isX ? "position:relative;height:100%" : "position:relative;width:100%";

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
