// src/builder/dom.ts
/**
 * vlist/builder — DOM Structure
 * Container resolution and DOM scaffold creation for the virtual list.
 */

// =============================================================================
// Types
// =============================================================================

export interface DOMStructure {
  root: HTMLElement;
  viewport: HTMLElement;
  content: HTMLElement;
  items: HTMLElement;
  /** Visually-hidden live region for screen reader range announcements */
  liveRegion: HTMLElement;
}

// =============================================================================
// Container Resolution
// =============================================================================

export const resolveContainer = (container: HTMLElement | string): HTMLElement => {
  if (typeof container === "string") {
    const el = document.querySelector<HTMLElement>(container);
    if (!el)
      throw new Error(`[vlist] Container not found: ${container}`);
    return el;
  }
  return container;
};

// =============================================================================
// DOM Structure Factory
// =============================================================================

/** Create a div with className and optional inline styles */
const el = (cls: string, css?: string): HTMLElement => {
  const d = document.createElement("div");
  d.className = cls;
  if (css) d.style.cssText = css;
  return d;
};

export const createDOMStructure = (
  container: HTMLElement,
  classPrefix: string,
  ariaLabel?: string,
  horizontal?: boolean,
  accessible?: boolean,
): DOMStructure => {
  const hz = horizontal;
  const root = el(classPrefix);
  if (hz) root.classList.add(`${classPrefix}--horizontal`);
  if (accessible !== false) root.setAttribute("tabindex", "0");

  const viewport = el(
    `${classPrefix}-viewport`,
    hz
      ? "overflow-x:auto;overflow-y:hidden;height:100%;width:100%"
      : "overflow:auto;height:100%;width:100%",
  );
  viewport.setAttribute("tabindex", "-1");

  const content = el(
    `${classPrefix}-content`,
    hz ? "position:relative;height:100%" : "position:relative;width:100%",
  );

  const items = el(
    `${classPrefix}-items`,
    hz ? "position:relative;height:100%" : "position:relative;width:100%",
  );
  items.setAttribute("role", "listbox");
  if (ariaLabel) items.setAttribute("aria-label", ariaLabel);
  if (hz) items.setAttribute("aria-orientation", "horizontal");

  const liveRegion = el(
    `${classPrefix}-live`,
    "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0",
  );
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("aria-atomic", "true");
  liveRegion.setAttribute("role", "status");

  content.appendChild(items);
  viewport.appendChild(content);
  root.appendChild(liveRegion);
  root.appendChild(viewport);
  container.appendChild(root);

  return { root, viewport, content, items, liveRegion };
};
