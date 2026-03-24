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
      throw new Error(`[vlist/builder] Container not found: ${container}`);
    return el;
  }
  return container;
};

// =============================================================================
// DOM Structure Factory
// =============================================================================

export const createDOMStructure = (
  container: HTMLElement,
  classPrefix: string,
  ariaLabel?: string,
  horizontal?: boolean,
  accessible?: boolean,
): DOMStructure => {
  const root = document.createElement("div");
  root.className = classPrefix;
  if (horizontal) root.classList.add(`${classPrefix}--horizontal`);
  if (accessible !== false) root.setAttribute("tabindex", "0");

  const viewport = document.createElement("div");
  viewport.className = `${classPrefix}-viewport`;
  viewport.setAttribute("tabindex", "-1");
  if (horizontal) {
    viewport.style.overflowX = "auto";
    viewport.style.overflowY = "hidden";
  } else {
    viewport.style.overflow = "auto";
  }
  viewport.style.height = "100%";
  viewport.style.width = "100%";

  const content = document.createElement("div");
  content.className = `${classPrefix}-content`;
  content.style.position = "relative";
  if (horizontal) {
    content.style.height = "100%";
    // Width will be set dynamically based on total items * width
  } else {
    content.style.width = "100%";
  }

  const items = document.createElement("div");
  items.className = `${classPrefix}-items`;
  items.setAttribute("role", "listbox");
  if (ariaLabel) items.setAttribute("aria-label", ariaLabel);
  if (horizontal) items.setAttribute("aria-orientation", "horizontal");
  items.style.position = "relative";
  if (horizontal) {
    items.style.height = "100%";
  } else {
    items.style.width = "100%";
  }

  // Visually-hidden ARIA live region for announcing visible range changes (#13b)
  const liveRegion = document.createElement("div");
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("aria-atomic", "true");
  liveRegion.setAttribute("role", "status");
  liveRegion.className = `${classPrefix}-live`;
  liveRegion.style.position = "absolute";
  liveRegion.style.width = "1px";
  liveRegion.style.height = "1px";
  liveRegion.style.padding = "0";
  liveRegion.style.margin = "-1px";
  liveRegion.style.overflow = "hidden";
  liveRegion.style.clip = "rect(0,0,0,0)";
  liveRegion.style.whiteSpace = "nowrap";
  liveRegion.style.border = "0";

  content.appendChild(items);
  viewport.appendChild(content);
  root.appendChild(liveRegion);
  root.appendChild(viewport);
  container.appendChild(root);

  return { root, viewport, content, items, liveRegion };
};
