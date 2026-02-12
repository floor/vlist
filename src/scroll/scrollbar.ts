/**
 * vlist - Custom Scrollbar
 * Provides visual scroll indication for compressed mode where native scrollbar is hidden
 *
 * Features:
 * - Visual track and thumb
 * - Thumb size proportional to visible content
 * - Click on track to jump to position
 * - Drag thumb to scroll
 * - Auto-hide after idle (optional)
 * - Show on hover with configurable hover zone (optional)
 * - CSS variables for customization
 * - Horizontal mode support (direction-aware axis)
 */

// =============================================================================
// Types
// =============================================================================

/** Scrollbar configuration */
export interface ScrollbarConfig {
  /** Enable scrollbar (default: true when compressed) */
  enabled?: boolean;

  /** Auto-hide scrollbar after idle (default: true) */
  autoHide?: boolean;

  /** Auto-hide delay in milliseconds (default: 1000) */
  autoHideDelay?: number;

  /** Minimum thumb size in pixels (default: 30) */
  minThumbSize?: number;

  /**
   * Show scrollbar when hovering near the scrollbar edge (default: true).
   * When true, an invisible hover zone is placed along the scrollbar edge.
   * Moving the mouse into this zone reveals the scrollbar; it stays visible
   * as long as the cursor remains over the zone or the track.
   */
  showOnHover?: boolean;

  /**
   * Width of the invisible hover zone in pixels (default: 16).
   * Only used when `showOnHover` is true.
   * A wider zone makes the scrollbar easier to discover;
   * a narrower zone avoids interference with content near the edge.
   */
  hoverZoneWidth?: number;

  /**
   * Show scrollbar when the mouse enters the list viewport (default: true).
   * When false, the scrollbar only appears on scroll or when hovering
   * near the scrollbar edge (if `showOnHover` is true).
   */
  showOnViewportEnter?: boolean;
}

/** Scrollbar instance */
export interface Scrollbar {
  /** Show the scrollbar */
  show: () => void;

  /** Hide the scrollbar */
  hide: () => void;

  /** Update scrollbar dimensions based on content/container size */
  updateBounds: (totalHeight: number, containerHeight: number) => void;

  /** Update thumb position based on scroll position */
  updatePosition: (scrollTop: number) => void;

  /** Check if scrollbar is visible */
  isVisible: () => boolean;

  /** Destroy and cleanup */
  destroy: () => void;
}

/** Callback for scroll position changes */
export type ScrollCallback = (position: number) => void;

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_AUTO_HIDE = true;
const DEFAULT_AUTO_HIDE_DELAY = 1000;
const DEFAULT_MIN_THUMB_SIZE = 30;
const DEFAULT_SHOW_ON_HOVER = true;
const DEFAULT_HOVER_ZONE_WIDTH = 16;
const DEFAULT_SHOW_ON_VIEWPORT_ENTER = true;

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a scrollbar instance
 *
 * @param viewport - The viewport element to attach scrollbar to
 * @param onScroll - Callback when scrollbar interaction causes scroll
 * @param config - Scrollbar configuration
 * @param classPrefix - CSS class prefix (default: 'vlist')
 * @param horizontal - Whether the scrollbar is horizontal (default: false)
 */
export const createScrollbar = (
  viewport: HTMLElement,
  onScroll: ScrollCallback,
  config: ScrollbarConfig = {},
  classPrefix = "vlist",
  horizontal = false,
): Scrollbar => {
  const {
    autoHide = DEFAULT_AUTO_HIDE,
    autoHideDelay = DEFAULT_AUTO_HIDE_DELAY,
    minThumbSize = DEFAULT_MIN_THUMB_SIZE,
    showOnHover = DEFAULT_SHOW_ON_HOVER,
    hoverZoneWidth = DEFAULT_HOVER_ZONE_WIDTH,
    showOnViewportEnter = DEFAULT_SHOW_ON_VIEWPORT_ENTER,
  } = config;

  // State
  let totalSize = 0;
  let containerSize = 0;
  let thumbSize = 0;
  let maxThumbTravel = 0;
  let isDragging = false;
  let isHovering = false;
  let dragStartPos = 0;
  let dragStartScrollPosition = 0;
  let currentScrollPosition = 0;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;
  let visible = false;
  let animationFrameId: number | null = null;
  let lastRequestedPosition: number | null = null;

  // Axis helpers — select CSS property / mouse coordinate once
  const thumbSizeProp = horizontal ? "width" : "height";
  const translateFn = horizontal ? "translateX" : "translateY";
  const mousePos = horizontal
    ? (e: MouseEvent) => e.clientX
    : (e: MouseEvent) => e.clientY;
  const rectStart = horizontal ? "left" : "top";

  // DOM elements
  const track = document.createElement("div");
  const thumb = document.createElement("div");
  const hoverZone = showOnHover ? document.createElement("div") : null;

  // =============================================================================
  // DOM Setup
  // =============================================================================

  const setupDOM = (): void => {
    track.className = `${classPrefix}-scrollbar`;
    thumb.className = `${classPrefix}-scrollbar-thumb`;

    if (horizontal) {
      track.classList.add(`${classPrefix}-scrollbar--horizontal`);
    }

    track.appendChild(thumb);
    viewport.appendChild(track);

    // Hover zone — always pointer-events:auto so mouseenter fires
    // even when the track is hidden (opacity:0 / pointer-events:none)
    if (hoverZone) {
      hoverZone.className = `${classPrefix}-scrollbar-hover`;
      if (horizontal) {
        hoverZone.classList.add(`${classPrefix}-scrollbar-hover--horizontal`);
        hoverZone.style.height = `${hoverZoneWidth}px`;
      } else {
        hoverZone.style.width = `${hoverZoneWidth}px`;
      }
      viewport.appendChild(hoverZone);
    }
  };

  // =============================================================================
  // Hide timeout helpers
  // =============================================================================

  const clearHideTimeout = (): void => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  };

  const scheduleHide = (): void => {
    if (!autoHide) return;
    clearHideTimeout();
    hideTimeout = setTimeout(hide, autoHideDelay);
  };

  // =============================================================================
  // Visibility
  // =============================================================================

  /**
   * Show the scrollbar.
   * When called from scroll events, auto-hide is scheduled (unless hovering).
   * When called from hover events, no auto-hide is scheduled.
   */
  const show = (): void => {
    if (totalSize <= containerSize) return;

    clearHideTimeout();

    if (!visible) {
      track.classList.add(`${classPrefix}-scrollbar--visible`);
      visible = true;
    }

    // Schedule auto-hide only if not hovering and not dragging
    if (autoHide && !isDragging && !isHovering) {
      scheduleHide();
    }
  };

  const hide = (): void => {
    if (isDragging || isHovering) return;

    track.classList.remove(`${classPrefix}-scrollbar--visible`);
    visible = false;
  };

  // =============================================================================
  // Size & Position Calculations
  // =============================================================================

  const updateBounds = (
    newTotalSize: number,
    newContainerSize: number,
  ): void => {
    totalSize = newTotalSize;
    containerSize = newContainerSize;

    // Check if scrollbar is needed
    const needsScrollbar = totalSize > containerSize;
    track.style.display = needsScrollbar ? "" : "none";

    if (!needsScrollbar) {
      hide();
      return;
    }

    // Calculate thumb size (proportional to visible content)
    const scrollRatio = containerSize / totalSize;
    thumbSize = Math.max(minThumbSize, scrollRatio * containerSize);
    thumb.style[thumbSizeProp] = `${thumbSize}px`;

    // Calculate max thumb travel distance
    maxThumbTravel = containerSize - thumbSize;

    // Update position with current scroll
    updatePosition(currentScrollPosition);
  };

  const updatePosition = (scrollTop: number): void => {
    currentScrollPosition = scrollTop;

    if (totalSize <= containerSize || maxThumbTravel <= 0) return;

    // Calculate scroll percentage
    const maxScroll = totalSize - containerSize;
    const scrollRatio = Math.min(1, Math.max(0, scrollTop / maxScroll));

    // Position thumb
    const thumbPosition = scrollRatio * maxThumbTravel;
    thumb.style.transform = `${translateFn}(${thumbPosition}px)`;
  };

  // =============================================================================
  // Track Click Handler
  // =============================================================================

  const handleTrackClick = (e: MouseEvent): void => {
    // Ignore clicks on thumb
    if (e.target === thumb) return;

    const trackRect = track.getBoundingClientRect();
    const clickPos = mousePos(e) - trackRect[rectStart];

    // Center thumb at click position
    const targetThumbCenter = clickPos;
    const targetThumbStart = targetThumbCenter - thumbSize / 2;

    // Clamp to valid range
    const clampedThumbStart = Math.max(
      0,
      Math.min(targetThumbStart, maxThumbTravel),
    );

    // Convert to scroll position
    const scrollRatio = clampedThumbStart / maxThumbTravel;
    const maxScroll = totalSize - containerSize;
    const targetScrollPosition = scrollRatio * maxScroll;

    onScroll(targetScrollPosition);
    show();
  };

  // =============================================================================
  // Thumb Drag Handlers
  // =============================================================================

  const handleThumbMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();

    isDragging = true;
    dragStartPos = mousePos(e);
    dragStartScrollPosition = currentScrollPosition;

    // Cancel any hide while dragging
    clearHideTimeout();

    track.classList.add(`${classPrefix}-scrollbar--dragging`);

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent): void => {
    if (!isDragging) return;

    const delta = mousePos(e) - dragStartPos;

    // Convert thumb movement to scroll movement
    const scrollRatio = maxThumbTravel > 0 ? delta / maxThumbTravel : 0;
    const maxScroll = totalSize - containerSize;
    const deltaScroll = scrollRatio * maxScroll;

    const newPosition = Math.max(
      0,
      Math.min(dragStartScrollPosition + deltaScroll, maxScroll),
    );

    // Update thumb immediately for responsive feel
    const thumbRatio = newPosition / maxScroll;
    const thumbPosition = thumbRatio * maxThumbTravel;
    thumb.style.transform = `${translateFn}(${thumbPosition}px)`;

    // Throttle scroll callback with RAF
    lastRequestedPosition = newPosition;

    if (animationFrameId === null) {
      animationFrameId = requestAnimationFrame(() => {
        if (lastRequestedPosition !== null) {
          onScroll(lastRequestedPosition);
        }
        animationFrameId = null;
      });
    }
  };

  const handleMouseUp = (): void => {
    isDragging = false;

    // Cancel pending RAF
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    // Apply final position
    if (lastRequestedPosition !== null) {
      onScroll(lastRequestedPosition);
      lastRequestedPosition = null;
    }

    track.classList.remove(`${classPrefix}-scrollbar--dragging`);

    // Schedule auto-hide only if not hovering
    if (autoHide && !isHovering) {
      scheduleHide();
    }

    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  };

  // =============================================================================
  // Viewport Hover Handlers (show on hover)
  // =============================================================================

  const handleViewportEnter = (): void => {
    if (showOnViewportEnter) {
      show();
    }
  };

  const handleViewportLeave = (): void => {
    if (!isDragging) {
      isHovering = false;
      if (autoHide) {
        scheduleHide();
      }
    }
  };

  // =============================================================================
  // Scrollbar Hover Handlers (keep visible while hovering over scrollbar area)
  //
  // Both the track and the hover zone set isHovering = true.
  // While isHovering is true, show() will NOT schedule auto-hide,
  // and hide() will refuse to run.
  // =============================================================================

  const handleScrollbarAreaEnter = (): void => {
    isHovering = true;
    clearHideTimeout();
    show();
  };

  const handleScrollbarAreaLeave = (): void => {
    isHovering = false;
    if (!isDragging && autoHide) {
      scheduleHide();
    }
  };

  // =============================================================================
  // Cleanup
  // =============================================================================

  const destroy = (): void => {
    // Clear timers
    clearHideTimeout();

    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    // Remove event listeners
    track.removeEventListener("click", handleTrackClick);
    track.removeEventListener("mouseenter", handleScrollbarAreaEnter);
    track.removeEventListener("mouseleave", handleScrollbarAreaLeave);
    thumb.removeEventListener("mousedown", handleThumbMouseDown);
    viewport.removeEventListener("mouseenter", handleViewportEnter);
    viewport.removeEventListener("mouseleave", handleViewportLeave);
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);

    if (hoverZone) {
      hoverZone.removeEventListener("mouseenter", handleScrollbarAreaEnter);
      hoverZone.removeEventListener("mouseleave", handleScrollbarAreaLeave);
      if (hoverZone.parentNode) {
        hoverZone.parentNode.removeChild(hoverZone);
      }
    }

    // Remove DOM elements
    if (track.parentNode) {
      track.parentNode.removeChild(track);
    }
  };

  // =============================================================================
  // Initialize
  // =============================================================================

  setupDOM();

  // Attach event listeners
  track.addEventListener("click", handleTrackClick);
  track.addEventListener("mouseenter", handleScrollbarAreaEnter);
  track.addEventListener("mouseleave", handleScrollbarAreaLeave);
  thumb.addEventListener("mousedown", handleThumbMouseDown);
  viewport.addEventListener("mouseenter", handleViewportEnter);
  viewport.addEventListener("mouseleave", handleViewportLeave);

  if (hoverZone) {
    hoverZone.addEventListener("mouseenter", handleScrollbarAreaEnter);
    hoverZone.addEventListener("mouseleave", handleScrollbarAreaLeave);
  }

  // =============================================================================
  // Public API
  // =============================================================================

  return {
    show,
    hide,
    updateBounds,
    updatePosition,
    isVisible: () => visible,
    destroy,
  };
};
