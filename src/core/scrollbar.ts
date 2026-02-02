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
 * - CSS variables for customization
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
 */
export const createScrollbar = (
  viewport: HTMLElement,
  onScroll: ScrollCallback,
  config: ScrollbarConfig = {},
  classPrefix = "vlist",
): Scrollbar => {
  const {
    autoHide = DEFAULT_AUTO_HIDE,
    autoHideDelay = DEFAULT_AUTO_HIDE_DELAY,
    minThumbSize = DEFAULT_MIN_THUMB_SIZE,
  } = config;

  // State
  let totalHeight = 0;
  let containerHeight = 0;
  let thumbHeight = 0;
  let maxThumbTravel = 0;
  let isDragging = false;
  let dragStartY = 0;
  let dragStartScrollPosition = 0;
  let currentScrollPosition = 0;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;
  let isVisible = false;
  let animationFrameId: number | null = null;
  let lastRequestedPosition: number | null = null;

  // DOM elements
  const track = document.createElement("div");
  const thumb = document.createElement("div");

  // =============================================================================
  // DOM Setup
  // =============================================================================

  const setupDOM = (): void => {
    track.className = `${classPrefix}-scrollbar`;
    thumb.className = `${classPrefix}-scrollbar-thumb`;

    track.appendChild(thumb);
    viewport.appendChild(track);
  };

  // =============================================================================
  // Visibility
  // =============================================================================

  const show = (): void => {
    if (totalHeight <= containerHeight) return;

    // Clear any pending hide
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }

    if (!isVisible) {
      track.classList.add(`${classPrefix}-scrollbar--visible`);
      isVisible = true;
    }

    // Schedule auto-hide
    if (autoHide && !isDragging) {
      hideTimeout = setTimeout(hide, autoHideDelay);
    }
  };

  const hide = (): void => {
    if (isDragging) return;

    track.classList.remove(`${classPrefix}-scrollbar--visible`);
    isVisible = false;
  };

  // =============================================================================
  // Size & Position Calculations
  // =============================================================================

  const updateBounds = (newTotalHeight: number, newContainerHeight: number): void => {
    totalHeight = newTotalHeight;
    containerHeight = newContainerHeight;

    // Check if scrollbar is needed
    const needsScrollbar = totalHeight > containerHeight;
    track.style.display = needsScrollbar ? "" : "none";

    if (!needsScrollbar) {
      hide();
      return;
    }

    // Calculate thumb size (proportional to visible content)
    const scrollRatio = containerHeight / totalHeight;
    thumbHeight = Math.max(minThumbSize, scrollRatio * containerHeight);
    thumb.style.height = `${thumbHeight}px`;

    // Calculate max thumb travel distance
    maxThumbTravel = containerHeight - thumbHeight;

    // Update position with current scroll
    updatePosition(currentScrollPosition);
  };

  const updatePosition = (scrollTop: number): void => {
    currentScrollPosition = scrollTop;

    if (totalHeight <= containerHeight || maxThumbTravel <= 0) return;

    // Calculate scroll percentage
    const maxScroll = totalHeight - containerHeight;
    const scrollRatio = Math.min(1, Math.max(0, scrollTop / maxScroll));

    // Position thumb
    const thumbPosition = scrollRatio * maxThumbTravel;
    thumb.style.transform = `translateY(${thumbPosition}px)`;
  };

  // =============================================================================
  // Track Click Handler
  // =============================================================================

  const handleTrackClick = (e: MouseEvent): void => {
    // Ignore clicks on thumb
    if (e.target === thumb) return;

    const trackRect = track.getBoundingClientRect();
    const clickY = e.clientY - trackRect.top;

    // Center thumb at click position
    const targetThumbCenter = clickY;
    const targetThumbTop = targetThumbCenter - thumbHeight / 2;

    // Clamp to valid range
    const clampedThumbTop = Math.max(0, Math.min(targetThumbTop, maxThumbTravel));

    // Convert to scroll position
    const scrollRatio = clampedThumbTop / maxThumbTravel;
    const maxScroll = totalHeight - containerHeight;
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
    dragStartY = e.clientY;
    dragStartScrollPosition = currentScrollPosition;

    track.classList.add(`${classPrefix}-scrollbar--dragging`);

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent): void => {
    if (!isDragging) return;

    const deltaY = e.clientY - dragStartY;

    // Convert thumb movement to scroll movement
    const scrollRatio = maxThumbTravel > 0 ? deltaY / maxThumbTravel : 0;
    const maxScroll = totalHeight - containerHeight;
    const deltaScroll = scrollRatio * maxScroll;

    const newPosition = Math.max(
      0,
      Math.min(dragStartScrollPosition + deltaScroll, maxScroll),
    );

    // Update thumb immediately for responsive feel
    const thumbRatio = newPosition / maxScroll;
    const thumbPosition = thumbRatio * maxThumbTravel;
    thumb.style.transform = `translateY(${thumbPosition}px)`;

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

    // Schedule auto-hide
    if (autoHide) {
      hideTimeout = setTimeout(hide, autoHideDelay);
    }

    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  };

  // =============================================================================
  // Viewport Hover Handlers (show on hover)
  // =============================================================================

  const handleViewportEnter = (): void => {
    show();
  };

  const handleViewportLeave = (): void => {
    if (!isDragging) {
      // Start hide timer
      if (autoHide) {
        if (hideTimeout) clearTimeout(hideTimeout);
        hideTimeout = setTimeout(hide, autoHideDelay);
      }
    }
  };

  // =============================================================================
  // Cleanup
  // =============================================================================

  const destroy = (): void => {
    // Clear timers
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }

    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    // Remove event listeners
    track.removeEventListener("click", handleTrackClick);
    thumb.removeEventListener("mousedown", handleThumbMouseDown);
    viewport.removeEventListener("mouseenter", handleViewportEnter);
    viewport.removeEventListener("mouseleave", handleViewportLeave);
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);

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
  thumb.addEventListener("mousedown", handleThumbMouseDown);
  viewport.addEventListener("mouseenter", handleViewportEnter);
  viewport.addEventListener("mouseleave", handleViewportLeave);

  // =============================================================================
  // Public API
  // =============================================================================

  return {
    show,
    hide,
    updateBounds,
    updatePosition,
    isVisible: () => isVisible,
    destroy,
  };
};
