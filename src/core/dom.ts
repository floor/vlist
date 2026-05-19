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

function div(cls: string, css?: string): HTMLElement {
  const d = document.createElement("div");
  d.className = cls;
  if (css) d.style.cssText = css;
  return d;
}

export function createDOMStructure(
  container: HTMLElement,
  classPrefix: string,
  horizontal: boolean,
  interactive: boolean,
  ariaLabel?: string,
): DOMStructure {
  const root = div(classPrefix);
  if (horizontal) root.classList.add(`${classPrefix}--horizontal`);

  const viewport = div(
    `${classPrefix}-viewport`,
    horizontal
      ? "overflow-x:auto;overflow-y:hidden;height:100%;width:100%"
      : "overflow:auto;height:100%;width:100%",
  );
  viewport.setAttribute("tabindex", "-1");

  const content = div(
    `${classPrefix}-content`,
    horizontal ? "position:relative;height:100%" : "position:relative;width:100%",
  );

  content.setAttribute("role", interactive ? "listbox" : "list");
  if (interactive) content.setAttribute("tabindex", "0");
  if (ariaLabel) content.setAttribute("aria-label", ariaLabel);
  if (horizontal) content.setAttribute("aria-orientation", "horizontal");

  viewport.appendChild(content);
  root.appendChild(viewport);
  container.appendChild(root);

  return { root, viewport, content };
}
