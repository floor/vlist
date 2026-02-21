/**
 * vlist - Sticky Header
 * Manages a floating header element that "sticks" to the top of the viewport
 * and transitions smoothly when the next group's header approaches.
 *
 * The sticky header is a separate DOM element positioned absolutely at the
 * top of the root container. It overlays the scrolling content and shows
 * the current group's header. When the next group's inline header scrolls
 * into view, the sticky header is pushed upward to create the classic
 * iOS Contacts-style transition effect.
 *
 * Layout:
 *   .vlist (root, position: relative)
 *   ├── .vlist-sticky-header (position: absolute, top: 0, z-index: 5)
 *   │   └── (content rendered by headerTemplate)
 *   └── .vlist-viewport
 *       └── .vlist-content
 *           └── .vlist-items
 */

import type { GroupLayout, GroupsConfig, StickyHeader } from "./types";
import type { SizeCache } from "../../rendering/sizes";

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a sticky header manager.
 *
 * @param root - The vlist root element (.vlist) — sticky header is appended here
 * @param layout - Group layout for index/group resolution
 * @param sizeCache - The LAYOUT size cache (includes headers)
 * @param config - Groups configuration (headerTemplate, headerHeight)
 * @param classPrefix - CSS class prefix (default: 'vlist')
 * @param horizontal - Whether using horizontal scrolling mode
 * @returns StickyHeader instance
 */
export const createStickyHeader = (
  root: HTMLElement,
  layout: GroupLayout,
  sizeCache: SizeCache,
  config: GroupsConfig,
  classPrefix: string,
  horizontal: boolean = false,
): StickyHeader => {
  // =========================================================================
  // DOM Setup
  // =========================================================================

  const element = document.createElement("div");
  element.className = `${classPrefix}-sticky-header`;
  element.setAttribute("role", "presentation");
  element.setAttribute("aria-hidden", "true");

  // Position absolutely at top (vertical) or left (horizontal) of root
  element.style.position = "absolute";
  element.style.zIndex = "5";
  element.style.pointerEvents = "none";
  element.style.willChange = "transform";
  element.style.overflow = "hidden";

  if (horizontal) {
    // Horizontal mode: stick to left edge
    element.style.top = "0";
    element.style.bottom = "0";
    element.style.left = "0";
  } else {
    // Vertical mode: stick to top edge
    element.style.top = "0";
    element.style.left = "0";
    element.style.right = "0";
  }

  // Insert as first child of root so it renders above the viewport
  root.insertBefore(element, root.firstChild);

  // Track current state to avoid redundant DOM updates
  let currentGroupIndex = -1;
  let isVisible = false;
  let lastTransformY = 0;

  // =========================================================================
  // Content Rendering
  // =========================================================================

  /**
   * Render the header template for a group and apply it to the sticky element.
   */
  const renderGroup = (groupIndex: number): void => {
    if (groupIndex === currentGroupIndex) return;
    currentGroupIndex = groupIndex;

    const groups = layout.groups;
    if (groupIndex < 0 || groupIndex >= groups.length) {
      element.textContent = "";
      return;
    }

    const group = groups[groupIndex]!;
    const result = config.headerTemplate(group.key, group.groupIndex);

    // Set the size of the sticky header to match the group's header size
    const headerSize = layout.getHeaderHeight(groupIndex);
    if (horizontal) {
      element.style.width = `${headerSize}px`;
    } else {
      element.style.height = `${headerSize}px`;
    }

    if (typeof result === "string") {
      element.innerHTML = result;
    } else {
      element.replaceChildren(result);
    }
  };

  // =========================================================================
  // Position Calculations
  // =========================================================================

  /**
   * Update the sticky header based on the current scroll position.
   *
   * 1. Determine which group is "current" (the group whose header has
   *    scrolled past the top/left edge of the viewport).
   * 2. Check if the next group's inline header is within the viewport,
   *    about to push the sticky header upward/leftward.
   * 3. Apply translateY (vertical) or translateX (horizontal) for the push-out effect.
   */
  const update = (scrollPosition: number): void => {
    const groups = layout.groups;

    if (groups.length === 0) {
      hide();
      return;
    }

    // Find which group header is at or above the current scroll position.
    // Walk backward from the last group whose header offset <= scrollPosition.
    let activeGroupIdx = 0;

    for (let i = groups.length - 1; i >= 0; i--) {
      const headerOffset = sizeCache.getOffset(groups[i]!.headerLayoutIndex);
      if (headerOffset <= scrollPosition) {
        activeGroupIdx = i;
        break;
      }
    }

    // Edge case: if scrollPosition is before the first header, show the first group
    const firstHeaderOffset = sizeCache.getOffset(groups[0]!.headerLayoutIndex);
    if (scrollPosition < firstHeaderOffset) {
      hide();
      return;
    }

    // Show the sticky header for the active group
    if (!isVisible) {
      show();
    }
    renderGroup(activeGroupIdx);

    // Determine the push-out offset.
    // If there's a next group, check how close its inline header is
    // to the top/left edge of the viewport.
    const activeHeaderSize = layout.getHeaderHeight(activeGroupIdx);
    let translateOffset = 0;

    const nextGroupIdx = activeGroupIdx + 1;
    if (nextGroupIdx < groups.length) {
      const nextHeaderOffset = sizeCache.getOffset(
        groups[nextGroupIdx]!.headerLayoutIndex,
      );
      const distance = nextHeaderOffset - scrollPosition;

      if (distance < activeHeaderSize) {
        // The next header is pushing the sticky header up/left
        translateOffset = distance - activeHeaderSize;
      }
    }

    // Apply transform only if it changed (avoid layout thrash)
    if (translateOffset !== lastTransformY) {
      lastTransformY = translateOffset;
      if (translateOffset === 0) {
        element.style.transform = "";
      } else {
        const transformValue = Math.round(translateOffset);
        element.style.transform = horizontal
          ? `translateX(${transformValue}px)`
          : `translateY(${transformValue}px)`;
      }
    }
  };

  // =========================================================================
  // Visibility
  // =========================================================================

  const show = (): void => {
    if (isVisible) return;
    isVisible = true;
    element.style.display = "";
  };

  const hide = (): void => {
    if (!isVisible) return;
    isVisible = false;
    element.style.display = "none";
    currentGroupIndex = -1;
    lastTransformY = 0;
    element.style.transform = "";
  };

  // =========================================================================
  // Refresh
  // =========================================================================

  /**
   * Force refresh the sticky header content.
   * Useful after items change and groups are recomputed.
   */
  const refresh = (): void => {
    const prevGroup = currentGroupIndex;
    currentGroupIndex = -1; // Force re-render
    if (prevGroup >= 0) {
      renderGroup(prevGroup);
    }
  };

  // =========================================================================
  // Destroy
  // =========================================================================

  const destroy = (): void => {
    element.remove();
    currentGroupIndex = -1;
    isVisible = false;
  };

  // =========================================================================
  // Initial state: hidden until first scroll update
  // =========================================================================

  element.style.display = "none";

  return {
    update,
    refresh,
    show,
    hide,
    destroy,
  };
};
