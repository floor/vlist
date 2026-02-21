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
import type { HeightCache } from "../../rendering/sizes";

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a sticky header manager.
 *
 * @param root - The vlist root element (.vlist) — sticky header is appended here
 * @param layout - Group layout for index/group resolution
 * @param heightCache - The LAYOUT height cache (includes headers)
 * @param config - Groups configuration (headerTemplate, headerHeight)
 * @param classPrefix - CSS class prefix (default: 'vlist')
 * @returns StickyHeader instance
 */
export const createStickyHeader = (
  root: HTMLElement,
  layout: GroupLayout,
  heightCache: SizeCache,
  config: GroupsConfig,
  classPrefix: string,
): StickyHeader => {
  // =========================================================================
  // DOM Setup
  // =========================================================================

  const element = document.createElement("div");
  element.className = `${classPrefix}-sticky-header`;
  element.setAttribute("role", "presentation");
  element.setAttribute("aria-hidden", "true");

  // Position absolutely at top of root, above the viewport
  element.style.position = "absolute";
  element.style.top = "0";
  element.style.left = "0";
  element.style.right = "0";
  element.style.zIndex = "5";
  element.style.pointerEvents = "none";
  element.style.willChange = "transform";
  element.style.overflow = "hidden";

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

    // Set the height of the sticky header to match the group's header height
    const headerHeight = layout.getHeaderHeight(groupIndex);
    element.style.height = `${headerHeight}px`;

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
   *    scrolled past the top of the viewport).
   * 2. Check if the next group's inline header is within the viewport,
   *    about to push the sticky header upward.
   * 3. Apply translateY to create the push-out transition effect.
   */
  const update = (scrollTop: number): void => {
    const groups = layout.groups;

    if (groups.length === 0) {
      hide();
      return;
    }

    // Find which group header is at or above the current scroll position.
    // Walk backward from the last group whose header offset <= scrollTop.
    let activeGroupIdx = 0;

    for (let i = groups.length - 1; i >= 0; i--) {
      const headerOffset = heightCache.getOffset(groups[i]!.headerLayoutIndex);
      if (headerOffset <= scrollTop) {
        activeGroupIdx = i;
        break;
      }
    }

    // Edge case: if scrollTop is before the first header, show the first group
    const firstHeaderOffset = heightCache.getOffset(
      groups[0]!.headerLayoutIndex,
    );
    if (scrollTop < firstHeaderOffset) {
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
    // to the top of the viewport.
    const activeHeaderHeight = layout.getHeaderHeight(activeGroupIdx);
    let translateY = 0;

    const nextGroupIdx = activeGroupIdx + 1;
    if (nextGroupIdx < groups.length) {
      const nextHeaderOffset = heightCache.getOffset(
        groups[nextGroupIdx]!.headerLayoutIndex,
      );
      const distance = nextHeaderOffset - scrollTop;

      if (distance < activeHeaderHeight) {
        // The next header is pushing the sticky header up
        translateY = distance - activeHeaderHeight;
      }
    }

    // Apply transform only if it changed (avoid layout thrash)
    if (translateY !== lastTransformY) {
      lastTransformY = translateY;
      element.style.transform =
        translateY === 0 ? "" : `translateY(${Math.round(translateY)}px)`;
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
