/**
 * vlist - Sticky Header
 * Manages a floating header element that "sticks" to the top of the viewport
 * and transitions smoothly when the next group's header approaches.
 *
 * The sticky header sits above the viewport (not overlaying it). Inside the
 * fixed-size container, a "slider" div holds two header slots: the current
 * header and (during transitions) the next header. The push-out effect is
 * achieved by translating the slider so the current header exits while the
 * next header enters — all clipped by the container's overflow: hidden.
 *
 * Layout:
 *   .vlist (root, position: relative)
 *   ├── .vlist-sticky-header (position: absolute, top: 0, overflow: hidden)
 *   │   └── .sticky-slider (translated during push transition)
 *   │       ├── [current header content]
 *   │       └── [next header content]  (only during transition)
 *   └── .vlist-viewport (margin-top: headerSize, height: calc(100% - headerSize))
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
 * @param stickyOffset - Extra offset (e.g. table header size)
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
  // Helpers
  // =========================================================================

  /** Orientation-aware style setters. */
  const setMainSize = horizontal
    ? (el: HTMLElement, px: number): void => { el.style.width = `${px}px`; }
    : (el: HTMLElement, px: number): void => { el.style.height = `${px}px`; };

  const setCrossSize = horizontal
    ? (el: HTMLElement, v: string): void => { el.style.height = v; }
    : (el: HTMLElement, v: string): void => { el.style.width = v; };

  const translateFn = horizontal
    ? (px: number): string => `translateX(${px}px)`
    : (px: number): string => `translateY(${px}px)`;

  /** Detach an element from the slider if it's currently attached. */
  const detach = (el: HTMLElement | null): void => {
    if (el && el.parentNode === slider) slider.removeChild(el);
  };

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

  // Slider — holds current (and optionally next) header, translated for push
  const slider = document.createElement("div");
  slider.style.willChange = "transform";
  const initialSize = layout.groups.length > 0 ? layout.getHeaderHeight(0) : 0;
  setCrossSize(slider, "100%");
  setMainSize(slider, initialSize);
  container.appendChild(slider);

  // Direct references to the rendered header elements inside the slider.
  // No wrapper divs — the template output is appended directly with
  // size set on the element itself.
  let currentEl: HTMLElement | null = null;
  let nextEl: HTMLElement | null = null;

  // Insert container as first child of root
  root.insertBefore(container, root.firstChild);

  // =========================================================================
  // Cached state
  // =========================================================================

  // Snapshot of layout.groups — refreshed only in refresh() / rebuild paths.
  // Avoids a property access + readonly-array dereference on every scroll tick.
  let groups = layout.groups;

  // Track current state to avoid redundant DOM updates
  let currentGroupIndex = -1;
  let currentHeaderSize = 0; // cached size of the active group's header
  let nextGroupIndex = -1;
  let isVisible = false;
  let lastTranslateValue = 0;
  let isTransitioning = false;

  // =========================================================================
  // Content Rendering
  // =========================================================================

  /**
   * Render a header template and return the element with size set.
   */
  const renderHeader = (groupIndex: number): HTMLElement | null => {
    if (groupIndex < 0 || groupIndex >= groups.length) return null;

    const group = groups[groupIndex]!;
    const result = config.headerTemplate(group.key, group.groupIndex);
    const headerSize = layout.getHeaderHeight(groupIndex);

    let el: HTMLElement;
    if (typeof result === "string") {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = result;
      el = (wrapper.firstElementChild as HTMLElement) ?? wrapper;
      // If innerHTML produced a text node or multiple nodes, use the wrapper
      if (el === wrapper && wrapper.childNodes.length > 0) {
        el.style.cssText = "";
      }
    } else {
      el = result;
    }

    // Set size directly on the rendered element — no wrapper div
    setMainSize(el, headerSize);

    return el;
  };

  /**
   * Set the current group header.
   */
  const setCurrentGroup = (groupIndex: number): void => {
    if (groupIndex === currentGroupIndex) return;
    currentGroupIndex = groupIndex;

    // Remove old current element
    detach(currentEl);
    currentEl = null;
    currentHeaderSize = 0;

    if (groupIndex < 0 || groupIndex >= groups.length) return;

    // Set container and slider size to match header size
    const headerSize = layout.getHeaderHeight(groupIndex);
    currentHeaderSize = headerSize;
    setMainSize(container, headerSize);
    setMainSize(slider, headerSize);

    currentEl = renderHeader(groupIndex);
    if (currentEl) {
      // Insert at the beginning of slider (before any next element)
      slider.insertBefore(currentEl, slider.firstChild);
    }
  };

  /**
   * Prepare the next header for the push transition.
   */
  const prepareNextGroup = (groupIndex: number): void => {
    if (groupIndex === nextGroupIndex && isTransitioning) return;
    nextGroupIndex = groupIndex;

    // Remove old next element if present
    detach(nextEl);

    nextEl = renderHeader(groupIndex);
    if (nextEl) {
      slider.appendChild(nextEl);
    }
    isTransitioning = true;
  };

  // =========================================================================
  // Transition management
  // =========================================================================

  /** Reset slider transform to identity. */
  const resetSlider = (): void => {
    lastTranslateValue = 0;
    slider.style.transform = "";
  };

  /**
   * Complete the transition: next becomes current.
   */
  const completeTransition = (): void => {
    if (!isTransitioning) return;

    detach(currentEl);

    // Next becomes current
    currentEl = nextEl;
    currentGroupIndex = nextGroupIndex;
    currentHeaderSize = currentGroupIndex >= 0
      ? layout.getHeaderHeight(currentGroupIndex)
      : 0;
    nextEl = null;
    nextGroupIndex = -1;
    isTransitioning = false;

    resetSlider();
  };

  /**
   * End transition without completing (e.g. user scrolled back).
   */
  const cancelTransition = (): void => {
    if (!isTransitioning) return;

    detach(nextEl);
    nextEl = null;
    nextGroupIndex = -1;
    isTransitioning = false;

    resetSlider();
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

    // Binary search: find the last group whose header has fully scrolled
    // past the viewport edge.  The sticky header sits ABOVE the viewport,
    // so we offset by each group's header size — the group doesn't become
    // "active" until its inline header is completely above the viewport.
    let lo = 0;
    let hi = groups.length - 1;

    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      const midOffset = sizeCache.getOffset(groups[mid]!.headerLayoutIndex);
      const midSize = layout.getHeaderHeight(mid);
      if (midOffset + midSize <= scrollPosition) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    const activeGroupIdx = lo;

    // Show and set the current group
    if (!isVisible) show();
    setCurrentGroup(activeGroupIdx);

    // Check if the next group's inline header is approaching the
    // viewport edge (= trailing edge of the sticky header area).
    const nextGroupIdx = activeGroupIdx + 1;

    if (nextGroupIdx < groups.length) {
      const nextHeaderOffset = sizeCache.getOffset(
        groups[nextGroupIdx]!.headerLayoutIndex,
      );
      // distance = pixels from viewport edge to the inline header.
      // Positive: header is below viewport edge.
      // Zero: header is at viewport edge (= trailing edge of sticky area).
      // Negative: header has scrolled past viewport edge.
      const distance = nextHeaderOffset - scrollPosition;

      if (distance <= 0 && distance > -currentHeaderSize) {
        // Inline header is at or past viewport edge — push transition.
        // translateOffset goes from 0 (just arrived) to -currentHeaderSize
        // (fully pushed out).
        prepareNextGroup(nextGroupIdx);

        if (distance !== lastTranslateValue) {
          lastTranslateValue = distance;
          slider.style.transform = translateFn(Math.round(distance));
        }
      } else if (distance <= -currentHeaderSize) {
        // Transition complete — next group is fully past.
        // The binary search already switched the active group,
        // so just clean up.
        if (isTransitioning) completeTransition();
      } else {
        // Next header is still below viewport edge — no transition
        if (isTransitioning) cancelTransition();
      }
    } else {
      // No next group — cancel transition if active
      if (isTransitioning) cancelTransition();
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

    // Tear down current header
    detach(currentEl);
    currentEl = null;
    currentGroupIndex = -1;
    currentHeaderSize = 0;

    // Tear down any in-flight transition
    cancelTransition();
  };

  // =========================================================================
  // Refresh
  // =========================================================================

  /**
   * Force refresh the sticky header content.
   * Useful after items change and groups are recomputed.
   */
  const refresh = (): void => {
    // Re-snapshot groups in case layout was rebuilt
    groups = layout.groups;

    const prevGroup = currentGroupIndex;
    currentGroupIndex = -1; // Force re-render
    currentHeaderSize = 0;
    if (prevGroup >= 0) {
      setCurrentGroup(prevGroup);
    }
  };

  // =========================================================================
  // Destroy
  // =========================================================================

  const destroy = (): void => {
    container.remove();
    currentEl = null;
    nextEl = null;
    currentGroupIndex = -1;
    currentHeaderSize = 0;
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