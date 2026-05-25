/**
 * vlist v2 — DOM Structure
 * Container resolution and DOM scaffold creation.
 */

import type { DOMStructure } from "./types";

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
  horizontal: boolean,
  interactive: boolean,
  ariaLabel?: string,
): DOMStructure {
  const rootCls = horizontal ? `${classPrefix} ${classPrefix}--horizontal` : classPrefix;
  const vpStyle = horizontal
    ? "overflow-x:auto;overflow-y:hidden;height:100%;width:100%"
    : "overflow:auto;height:100%;width:100%";
  const cStyle = horizontal ? "position:relative;height:100%" : "position:relative;width:100%";

  let cAttrs = ` role="${interactive ? "listbox" : "list"}"`;
  if (interactive) cAttrs += ' tabindex="0"';
  if (ariaLabel) cAttrs += ` aria-label="${ariaLabel.replace(/"/g, "&quot;")}"`;
  if (horizontal) cAttrs += ' aria-orientation="horizontal"';

  container.insertAdjacentHTML("beforeend",
    `<div class="${rootCls}"><div class="${classPrefix}-viewport" style="${vpStyle}" tabindex="-1"><div class="${classPrefix}-content" style="${cStyle}"${cAttrs}></div></div></div>`,
  );

  const root = container.lastElementChild as HTMLElement;
  const viewport = root.firstElementChild as HTMLElement;
  const content = viewport.firstElementChild as HTMLElement;

  return { root, viewport, content };
}
