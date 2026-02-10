/**
 * vlist - DOM Utilities
 * DOM structure creation, container resolution, and content height/width management
 *
 * These are pure DOM utilities shared between the full vlist and the
 * lightweight core. They have zero dependencies on compression, heights,
 * or any other vlist internals.
 *
 * Axis-aware: supports both vertical (default) and horizontal scrolling.
 * When horizontal, the scroll axis is swapped — content width replaces
 * content height, and items flow left-to-right instead of top-to-bottom.
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
  horizontal?: boolean,
): DOMStructure => {
  // Root element
  const root = document.createElement("div");
  root.className = `${classPrefix}`;
  root.setAttribute("role", "listbox");
  root.setAttribute("tabindex", "0");

  if (horizontal) {
    root.classList.add(`${classPrefix}--horizontal`);
    root.setAttribute("aria-orientation", "horizontal");
  }

  if (ariaLabel) {
    root.setAttribute("aria-label", ariaLabel);
  }

  // Viewport (scrollable container)
  const viewport = document.createElement("div");
  viewport.className = `${classPrefix}-viewport`;
  viewport.style.height = "100%";
  viewport.style.width = "100%";

  if (horizontal) {
    viewport.style.overflowX = "auto";
    viewport.style.overflowY = "hidden";
  } else {
    viewport.style.overflow = "auto";
  }

  // Content (sets the total scrollable size along the scroll axis)
  const content = document.createElement("div");
  content.className = `${classPrefix}-content`;
  content.style.position = "relative";

  if (horizontal) {
    content.style.height = "100%";
    // width is set dynamically via updateContentSize
  } else {
    content.style.width = "100%";
    // height is set dynamically via updateContentSize
  }

  // Items container (holds rendered items)
  const items = document.createElement("div");
  items.className = `${classPrefix}-items`;
  items.style.position = "relative";

  if (horizontal) {
    items.style.height = "100%";
  } else {
    items.style.width = "100%";
  }

  // Assemble structure
  content.appendChild(items);
  viewport.appendChild(content);
  root.appendChild(viewport);
  container.appendChild(root);

  return { root, viewport, content, items };
};

// =============================================================================
// Content Size (scroll-axis dimension)
// =============================================================================

/**
 * Update content height for virtual scrolling (vertical mode)
 */
export const updateContentHeight = (
  content: HTMLElement,
  totalHeight: number,
): void => {
  content.style.height = `${totalHeight}px`;
};

/**
 * Update content size along the scroll axis.
 * Sets height for vertical mode, width for horizontal mode.
 */
export const updateContentSize = (
  content: HTMLElement,
  totalSize: number,
  horizontal?: boolean,
): void => {
  if (horizontal) {
    content.style.width = `${totalSize}px`;
  } else {
    content.style.height = `${totalSize}px`;
  }
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
