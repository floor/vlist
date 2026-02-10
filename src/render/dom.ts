/**
 * vlist - DOM Utilities
 * DOM structure creation, container resolution, and content height management
 *
 * These are pure DOM utilities shared between the full vlist and the
 * lightweight core. They have zero dependencies on compression, heights,
 * or any other vlist internals.
 */

// =============================================================================
// Types
// =============================================================================

/** DOM structure created by createDOMStructure */
export interface DOMStructure {
  root: HTMLElement;
  viewport: HTMLElement;
  content: HTMLElement;
  items: HTMLElement;
}

// =============================================================================
// Container Resolution
// =============================================================================

/**
 * Resolve container from selector or element
 */
export const resolveContainer = (
  container: HTMLElement | string,
): HTMLElement => {
  if (typeof container === "string") {
    const element = document.querySelector<HTMLElement>(container);
    if (!element) {
      throw new Error(`[vlist] Container not found: ${container}`);
    }
    return element;
  }
  return container;
};

// =============================================================================
// DOM Structure
// =============================================================================

/**
 * Create the vlist DOM structure
 *
 * Builds the nested element hierarchy:
 *   root (listbox, keyboard-focusable)
 *     └─ viewport (scrollable container)
 *         └─ content (sets total scrollable height)
 *             └─ items (holds rendered item elements)
 */
export const createDOMStructure = (
  container: HTMLElement,
  classPrefix: string,
  ariaLabel?: string,
): DOMStructure => {
  // Root element
  const root = document.createElement("div");
  root.className = `${classPrefix}`;
  root.setAttribute("role", "listbox");
  root.setAttribute("tabindex", "0");

  if (ariaLabel) {
    root.setAttribute("aria-label", ariaLabel);
  }

  // Viewport (scrollable container)
  const viewport = document.createElement("div");
  viewport.className = `${classPrefix}-viewport`;
  viewport.style.overflow = "auto";
  viewport.style.height = "100%";
  viewport.style.width = "100%";

  // Content (sets the total scrollable height)
  const content = document.createElement("div");
  content.className = `${classPrefix}-content`;
  content.style.position = "relative";
  content.style.width = "100%";

  // Items container (holds rendered items)
  const items = document.createElement("div");
  items.className = `${classPrefix}-items`;
  items.style.position = "relative";
  items.style.width = "100%";

  // Assemble structure
  content.appendChild(items);
  viewport.appendChild(content);
  root.appendChild(viewport);
  container.appendChild(root);

  return { root, viewport, content, items };
};

// =============================================================================
// Content Height
// =============================================================================

/**
 * Update content height for virtual scrolling
 */
export const updateContentHeight = (
  content: HTMLElement,
  totalHeight: number,
): void => {
  content.style.height = `${totalHeight}px`;
};

// =============================================================================
// Container Dimensions
// =============================================================================

/**
 * Get container dimensions
 */
export const getContainerDimensions = (
  viewport: HTMLElement,
): { width: number; height: number } => ({
  width: viewport.clientWidth,
  height: viewport.clientHeight,
});
