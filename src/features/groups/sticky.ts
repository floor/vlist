/**
 * vlist - Sticky Header
 * Manages a floating header element that "sticks" to the top of the viewport
 * and transitions smoothly when the next group's header approaches.
 *
 * The sticky header sits above the viewport (not overlaying it). Inside the
 * fixed-height container, a "slider" div holds two header slots: the current
 * header and (during transitions) the next header. The push-out effect is
 * achieved by translating the slider upward so the current header exits the
 * top while the next header enters from the bottom — all clipped by the
 * container's overflow: hidden.
 *
 * Layout:
 *   .vlist (root, position: relative)
 *   ├── .vlist-sticky-header (position: absolute, top: 0, overflow: hidden)
 *   │   └── .sticky-slider (translated during push transition)
 *   │       ├── [current header content]
 *   │       └── [next header content]  (only during transition)
 *   └── .vlist-viewport (margin-top: headerHeight, height: calc(100% - headerHeight))
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
 * @param stickyOffset - Extra offset (e.g. table header height)
 * @returns StickyHeader instance
 */
export const createStickyHeader = (
  root: HTMLElement,
  layout: GroupLayout,
  sizeCache: SizeCache,
  config: GroupsConfig,
  classPrefix: string,
  horizontal: boolean = false,
  stickyOffset: number = 0,
): StickyHeader => {
  // =========================================================================
  // DOM Setup
  // =========================================================================

  // Container — fixed size, overflow hidden, clips the slider
  const container = document.createElement("div");
  container.className = `${classPrefix}-sticky-header`;
  container.setAttribute("role", "presentation");
  container.setAttribute("aria-hidden", "true");

  container.style.position = "absolute";
  container.style.zIndex = "5";
  container.style.pointerEvents = "none";
  container.style.overflow = "hidden";

  if (horizontal) {
    container.style.top = "0";
    container.style.bottom = "0";
    container.style.left = stickyOffset ? `${stickyOffset}px` : "0";
  } else {
    container.style.top = stickyOffset ? `${stickyOffset}px` : "0";
  }

  // Slider — holds current (and optionally next) header, translated for push effect
  const slider = document.createElement("div");
  slider.style.willChange = "transform";
  container.appendChild(slider);

  // Current header slot
  const currentSlot = document.createElement("div");
  slider.appendChild(currentSlot);

  // Next header slot (used during push transition)
  const nextSlot = document.createElement("div");
  // Not appended yet — added only during transition

  // Insert container as first child of root
  root.insertBefore(container, root.firstChild);

  // Track current state to avoid redundant DOM updates
  let currentGroupIndex = -1;
  let nextGroupIndex = -1;
  let isVisible = false;
  let lastTranslateValue = 0;
  let isTransitioning = false;

  // =========================================================================
  // Content Rendering
  // =========================================================================

  /**
   * Render a header template into a target element.
   */
  const renderInto = (target: HTMLElement, groupIndex: number): void => {
    const groups = layout.groups;
    if (groupIndex < 0 || groupIndex >= groups.length) {
      target.textContent = "";
      return;
    }

    const group = groups[groupIndex]!;
    const result = config.headerTemplate(group.key, group.groupIndex);

    if (typeof result === "string") {
      target.innerHTML = result;
    } else {
      target.replaceChildren(result);
    }
  };

  /**
   * Set the current group header.
   */
  const setCurrentGroup = (groupIndex: number): void => {
    if (groupIndex === currentGroupIndex) return;
    currentGroupIndex = groupIndex;

    const groups = layout.groups;
    if (groupIndex < 0 || groupIndex >= groups.length) {
      currentSlot.textContent = "";
      return;
    }

    // Set container size to match header height
    const headerSize = layout.getHeaderHeight(groupIndex);
    if (horizontal) {
      container.style.width = `${headerSize}px`;
      currentSlot.style.width = `${headerSize}px`;
    } else {
      container.style.height = `${headerSize}px`;
      currentSlot.style.height = `${headerSize}px`;
    }

    renderInto(currentSlot, groupIndex);
  };

  /**
   * Prepare the next header slot for the push transition.
   */
  const prepareNextGroup = (groupIndex: number): void => {
    if (groupIndex === nextGroupIndex && isTransitioning) return;
    nextGroupIndex = groupIndex;

    const headerSize = layout.getHeaderHeight(groupIndex);
    if (horizontal) {
      nextSlot.style.width = `${headerSize}px`;
    } else {
      nextSlot.style.height = `${headerSize}px`;
    }

    renderInto(nextSlot, groupIndex);

    // Append next slot if not already in the slider
    if (!isTransitioning) {
      slider.appendChild(nextSlot);
      isTransitioning = true;
    }
  };

  /**
   * Complete the transition: next becomes current.
   */
  const completeTransition = (): void => {
    if (!isTransitioning) return;

    // Copy next content into current slot
    const nextGroupIdx = nextGroupIndex;
    currentGroupIndex = -1; // Force re-render
    setCurrentGroup(nextGroupIdx);

    // Remove next slot from DOM and reset slider
    if (nextSlot.parentNode === slider) {
      slider.removeChild(nextSlot);
    }
    nextSlot.textContent = "";
    nextGroupIndex = -1;
    isTransitioning = false;

    // Reset slider position
    lastTranslateValue = 0;
    slider.style.transform = "";
  };

  /**
   * End transition without completing (e.g. user scrolled back).
   */
  const cancelTransition = (): void => {
    if (!isTransitioning) return;

    if (nextSlot.parentNode === slider) {
      slider.removeChild(nextSlot);
    }
    nextSlot.textContent = "";
    nextGroupIndex = -1;
    isTransitioning = false;

    lastTranslateValue = 0;
    slider.style.transform = "";
  };

  // =========================================================================
  // Position Calculations
  // =========================================================================

  /**
   * Update the sticky header based on the current scroll position.
   *
   * 1. Determine which group is "current" (the group whose header has
   *    scrolled past the top/left edge of the viewport).
   * 2. Check if the next group's inline header is approaching the sticky
   *    header area.
   * 3. If so, prepare the next header in the slider and translate both
   *    to create the push-out effect.
   */
  const update = (scrollPosition: number): void => {
    const groups = layout.groups;

    if (groups.length === 0) {
      hide();
      return;
    }

    // Edge case: if scrollPosition is before the first header, hide
    const firstHeaderOffset = sizeCache.getOffset(groups[0]!.headerLayoutIndex);
    if (scrollPosition < firstHeaderOffset) {
      hide();
      return;
    }

    // Binary search: find the last group whose header offset <= scrollPosition.
    let lo = 0;
    let hi = groups.length - 1;

    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (sizeCache.getOffset(groups[mid]!.headerLayoutIndex) <= scrollPosition) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    const activeGroupIdx = lo;

    // Show and set the current group
    if (!isVisible) {
      show();
    }
    setCurrentGroup(activeGroupIdx);

    // Check if the next group's inline header is approaching
    const activeHeaderSize = layout.getHeaderHeight(activeGroupIdx);
    const nextGroupIdx = activeGroupIdx + 1;

    if (nextGroupIdx < groups.length) {
      const nextHeaderOffset = sizeCache.getOffset(
        groups[nextGroupIdx]!.headerLayoutIndex,
      );
      const distance = nextHeaderOffset - scrollPosition;

      if (distance < activeHeaderSize) {
        // Next header is pushing — prepare the transition
        prepareNextGroup(nextGroupIdx);

        // Calculate translation: 0 when distance = activeHeaderSize,
        // -activeHeaderSize when distance = 0
        const translateOffset = distance - activeHeaderSize;

        if (translateOffset !== lastTranslateValue) {
          lastTranslateValue = translateOffset;
          const transformValue = Math.round(translateOffset);
          slider.style.transform = horizontal
            ? `translateX(${transformValue}px)`
            : `translateY(${transformValue}px)`;
        }
      } else {
        // Next header is far away — cancel any in-progress transition
        if (isTransitioning) {
          cancelTransition();
        }
      }
    } else {
      // No next group — cancel transition if active
      if (isTransitioning) {
        cancelTransition();
      }
    }

    // If the active group changed and we were transitioning to it,
    // complete the transition
    if (
      isTransitioning &&
      activeGroupIdx === nextGroupIndex
    ) {
      completeTransition();
    }
  };

  // =========================================================================
  // Visibility
  // =========================================================================

  const show = (): void => {
    if (isVisible) return;
    isVisible = true;
    container.style.display = "";
  };

  const hide = (): void => {
    if (!isVisible) return;
    isVisible = false;
    container.style.display = "none";
    currentGroupIndex = -1;
    nextGroupIndex = -1;
    lastTranslateValue = 0;
    slider.style.transform = "";
    if (isTransitioning) {
      if (nextSlot.parentNode === slider) {
        slider.removeChild(nextSlot);
      }
      nextSlot.textContent = "";
      isTransitioning = false;
    }
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
      setCurrentGroup(prevGroup);
    }
  };

  // =========================================================================
  // Destroy
  // =========================================================================

  const destroy = (): void => {
    container.remove();
    currentGroupIndex = -1;
    nextGroupIndex = -1;
    isVisible = false;
    isTransitioning = false;
  };

  // =========================================================================
  // Initial state: hidden until first scroll update
  // =========================================================================

  container.style.display = "none";

  return {
    update,
    refresh,
    show,
    hide,
    destroy,
  };
};