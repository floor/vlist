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
): DOMStructure => {
  const root = document.createElement("div");
  root.className = classPrefix;
  if (horizontal) root.classList.add(`${classPrefix}--horizontal`);
  root.setAttribute("role", "listbox");
  root.setAttribute("tabindex", "0");
  if (ariaLabel) root.setAttribute("aria-label", ariaLabel);
  if (horizontal) root.setAttribute("aria-orientation", "horizontal");

  const viewport = document.createElement("div");
  viewport.className = `${classPrefix}-viewport`;
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
  items.style.position = "relative";
  if (horizontal) {
    items.style.height = "100%";
  } else {
    items.style.width = "100%";
  }

  content.appendChild(items);
  viewport.appendChild(content);
  root.appendChild(viewport);
  container.appendChild(root);

  return { root, viewport, content, items };
};
