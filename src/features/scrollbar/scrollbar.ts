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

import type { ScrollbarPadding } from "../../types";
export type { ScrollbarPadding } from "../../types";

/** Scrollbar configuration */
export interface ScrollbarConfig {
  /** Enable scrollbar (default: true when compressed) */
  enabled?: boolean;

  /** Auto-hide scrollbar after idle (default: true) */
  autoHide?: boolean;

  /** Auto-hide delay in milliseconds (default: 1000) */
  autoHideDelay?: number;

  /**
   * Minimum thumb size in pixels (default: 15).
   * Can also be set globally via the `--vlist-custom-scrollbar-min-thumb-size` CSS variable.
   */
  minThumbSize?: number;

  /**
   * Show scrollbar when hovering near the scrollbar edge (default: true).
   * When true, an invisible hover zone is placed along the scrollbar edge.
   * Moving the mouse into this zone reveals the scrollbar; it stays visible
   * as long as the cursor remains over the zone or the track.
   */
  showOnHover?: boolean;

  /**
   * Width of the edge zone in pixels (default: `wallPadding + 16`).
   * The edge zone covers the scrollbar edge including the padding margin, making
   * the full area clickable regardless of `showOnHover`. When `showOnHover` is
   * true, it also acts as the hover-to-reveal target.
   * Defaults to wall-side padding (`right` for vertical, `bottom` for horizontal)
   * plus 16px reach, so the zone always covers the full inset track plus a
   * comfortable buffer.
   */
  hoverZoneWidth?: number;

  /**
   * Show scrollbar when the mouse enters the list viewport (default: true).
   * When false, the scrollbar only appears on scroll or when hovering
   * near the scrollbar edge (if `showOnHover` is true).
   */
  showOnViewportEnter?: boolean;

  /**
   * Padding between the scrollbar track and the viewport edges (default: 2).
   * Insets the track from the edges so the scrollbar floats rather than sitting flush.
   * Also adjusts the thumb travel range to keep position accurate.
   *
   * Accepts a single number (all sides) or an object for per-side control:
   * `{ top?, right?, bottom?, left? }` — omitted sides default to 2px.
   *
   * Can also be set globally via the `--vlist-custom-scrollbar-padding-{side}` CSS variables.
   */
  padding?: ScrollbarPadding;

  /**
   * Behavior when clicking on the scrollbar track (not the thumb) (default: 'page').
   * - `'page'`  — scrolls by one page (containerSize) toward the clicked position,
   *               matching macOS native scrollbar behavior. Hold to scroll continuously.
   * - `'jump'`  — jumps directly to the clicked position (centers the thumb there).
   */
  clickBehavior?: 'jump' | 'page';
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

const AUTO_HIDE = true;
const AUTO_HIDE_DELAY = 1000;
const MIN_THUMB_SIZE = 15;
const SHOW_ON_HOVER = true;
const HOVER_ZONE_REACH = 16; // px of reach beyond the visible track (added to padding for the default)
const SHOW_ON_VIEWPORT_ENTER = true;
const PADDING = 2;
const TRACK_CLICK_BEHAVIOR = 'page' as const;
const PAGE_SCROLL_INITIAL_DELAY = 350; // ms before continuous scroll starts (matches keyboard repeat)
const PAGE_SCROLL_SPEED_PPS = 12;      // pages per second during held continuous scroll

// =============================================================================
// Padding resolver
// =============================================================================

interface ResolvedPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const resolvePadding = (raw: ScrollbarPadding | undefined): ResolvedPadding => {
  // typeof !== 'object' narrows raw to number | undefined in the true branch,
  // avoiding a narrowing gap that occurs with the equivalent (raw === undefined || typeof raw === 'number') OR form.
  if (typeof raw !== 'object') {
    const v = raw ?? PADDING;
    return { top: v, right: v, bottom: v, left: v };
  }
  return {
    top: raw.top ?? PADDING,
    right: raw.right ?? PADDING,
    bottom: raw.bottom ?? PADDING,
    left: raw.left ?? PADDING,
  };
};

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
    autoHide = AUTO_HIDE,
    autoHideDelay = AUTO_HIDE_DELAY,
    minThumbSize = MIN_THUMB_SIZE,
    showOnHover = SHOW_ON_HOVER,
    showOnViewportEnter = SHOW_ON_VIEWPORT_ENTER,
    clickBehavior = TRACK_CLICK_BEHAVIOR,
  } = config;

  const pad = resolvePadding(config.padding);

  // Axis-aware padding: start/end along the scroll axis, wall-side for hover zone default
  const scrollAxisStartPad = horizontal ? pad.left : pad.top;
  const scrollAxisEndPad   = horizontal ? pad.right : pad.bottom;
  const wallPad            = horizontal ? pad.bottom : pad.right;

  // Hover zone covers wall-gap + fixed reach beyond the track edge
  const hoverZoneWidth = config.hoverZoneWidth ?? (wallPad + HOVER_ZONE_REACH);

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
  let pageClickPos = 0;
  let pageScrollPosition = 0; // internal tracker — updated synchronously each tick
  let repeatTimeout: ReturnType<typeof setTimeout> | null = null;
  let repeatRafId: number | null = null;
  let repeatLastTime: number | null = null;

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
  // Always created: extends click target into the padding margin + handles hover when showOnHover
  const hoverZone = document.createElement("div");

  // =============================================================================
  // DOM Setup
  // =============================================================================

  const setupDOM = (): void => {
    track.className = `${classPrefix}-scrollbar`;
    thumb.className = `${classPrefix}-scrollbar-thumb`;

    if (horizontal) {
      track.classList.add(`${classPrefix}-scrollbar--horizontal`);
    }

    if (config.padding !== undefined) {
      viewport.style.setProperty("--vlist-custom-scrollbar-padding-top",    `${pad.top}px`);
      viewport.style.setProperty("--vlist-custom-scrollbar-padding-right",  `${pad.right}px`);
      viewport.style.setProperty("--vlist-custom-scrollbar-padding-bottom", `${pad.bottom}px`);
      viewport.style.setProperty("--vlist-custom-scrollbar-padding-left",   `${pad.left}px`);
    }

    if (config.minThumbSize !== undefined) {
      track.style.setProperty("--vlist-custom-scrollbar-min-thumb-size", `${minThumbSize}px`);
    }

    track.appendChild(thumb);
    viewport.appendChild(track);

    // Edge zone — covers the padding margin + track area along the scrollbar edge.
    // Always present so clicks in the padding margin are captured regardless of showOnHover.
    // pointer-events:auto so events fire even when the track is hidden (opacity:0).
    hoverZone.className = `${classPrefix}-scrollbar-hover`;
    if (horizontal) {
      hoverZone.classList.add(`${classPrefix}-scrollbar-hover--horizontal`);
      hoverZone.style.height = `${hoverZoneWidth}px`;
    } else {
      hoverZone.style.width = `${hoverZoneWidth}px`;
    }
    viewport.appendChild(hoverZone);
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

    // Effective track length shrinks by the margin on both ends (start + end along scroll axis)
    const trackLength = Math.max(0, containerSize - scrollAxisStartPad - scrollAxisEndPad);

    // Calculate thumb size (proportional to visible content, scaled to track)
    const scrollRatio = containerSize / totalSize;
    thumbSize = Math.max(minThumbSize, scrollRatio * trackLength);
    thumb.style[thumbSizeProp] = `${thumbSize}px`;

    // Calculate max thumb travel distance
    maxThumbTravel = trackLength - thumbSize;

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
  // Track Click Handlers
  // =============================================================================

  // 'jump' — instantly center thumb at clicked position
  const handleTrackClick = (e: MouseEvent): void => {
    if (e.target === thumb || clickBehavior !== 'jump' || maxThumbTravel <= 0) return;

    const maxScroll = totalSize - containerSize;
    const trackRect = track.getBoundingClientRect();
    const clickPos = mousePos(e) - trackRect[rectStart];
    const clampedThumbStart = Math.max(
      0,
      Math.min(clickPos - thumbSize / 2, maxThumbTravel),
    );
    onScroll((clampedThumbStart / maxThumbTravel) * maxScroll);
    show();
  };

  const clearRepeat = (): void => {
    if (repeatTimeout !== null) { clearTimeout(repeatTimeout); repeatTimeout = null; }
    if (repeatRafId !== null) { cancelAnimationFrame(repeatRafId); repeatRafId = null; }
    repeatLastTime = null;
  };

  // Compute direction toward pageClickPos; returns -1 (back), 1 (forward), or 0 (arrived).
  // Caller must provide maxScroll to avoid recomputing it.
  const pageScrollDirection = (maxScroll: number): -1 | 0 | 1 => {
    const thumbCurrentStart =
      maxThumbTravel > 0 ? (pageScrollPosition / maxScroll) * maxThumbTravel : 0;
    if (pageClickPos < thumbCurrentStart) return -1;
    if (pageClickPos >= thumbCurrentStart + thumbSize) return 1;
    return 0;
  };

  // 'page' — immediate first scroll by one containerSize toward click
  const firePageScroll = (): void => {
    const maxScroll = totalSize - containerSize;
    const dir = pageScrollDirection(maxScroll);
    if (dir === 0) { clearRepeat(); return; }
    if (dir === -1) {
      if (pageScrollPosition <= 0) { clearRepeat(); return; }
      const newPos = Math.max(0, pageScrollPosition - containerSize);
      pageScrollPosition = newPos;
      onScroll(newPos);
    } else {
      if (pageScrollPosition >= maxScroll) { clearRepeat(); return; }
      const newPos = Math.min(maxScroll, pageScrollPosition + containerSize);
      pageScrollPosition = newPos;
      onScroll(newPos);
    }
    show();
  };

  // Continuous RAF loop — runs after initial delay while mouse is held
  const tickContinuousScroll = (timestamp: number): void => {
    // First frame: record baseline time and reschedule without scrolling
    if (repeatLastTime === null) {
      repeatLastTime = timestamp;
      repeatRafId = requestAnimationFrame(tickContinuousScroll);
      return;
    }

    const maxScroll = totalSize - containerSize;
    const dt = timestamp - repeatLastTime;
    repeatLastTime = timestamp;

    const dir = pageScrollDirection(maxScroll);
    if (dir === 0) { clearRepeat(); return; }

    // Speed in px/ms, capped so one frame never overshoots more than containerSize
    const speed = (PAGE_SCROLL_SPEED_PPS * containerSize) / 1000;
    const delta = Math.min(speed * dt, containerSize);

    if (dir === -1) {
      if (pageScrollPosition <= 0) { clearRepeat(); return; }
      const newPos = Math.max(0, pageScrollPosition - delta);
      pageScrollPosition = newPos;
      onScroll(newPos);
    } else {
      if (pageScrollPosition >= maxScroll) { clearRepeat(); return; }
      const newPos = Math.min(maxScroll, pageScrollPosition + delta);
      pageScrollPosition = newPos;
      onScroll(newPos);
    }
    // Keep scrollbar visible without creating a new hide timer every frame
    clearHideTimeout();
    repeatRafId = requestAnimationFrame(tickContinuousScroll);
  };

  const handleRepeatMouseUp = (): void => {
    clearRepeat();
    // Begin auto-hide now that the hold has ended
    scheduleHide();
    document.removeEventListener('mouseup', handleRepeatMouseUp);
  };

  // 'page' — immediate first scroll then smooth continuous scroll while held
  const handleTrackMouseDown = (e: MouseEvent): void => {
    if (e.target === thumb || clickBehavior !== 'page') return;
    e.preventDefault();

    const trackRect = track.getBoundingClientRect();
    pageClickPos = mousePos(e) - trackRect[rectStart];
    pageScrollPosition = currentScrollPosition;

    firePageScroll();

    // After initial delay, begin smooth RAF-driven continuous scroll
    repeatTimeout = setTimeout(() => {
      repeatRafId = requestAnimationFrame(tickContinuousScroll);
    }, PAGE_SCROLL_INITIAL_DELAY);

    document.addEventListener('mouseup', handleRepeatMouseUp);
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
    clearRepeat();

    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    // Remove event listeners
    track.removeEventListener("click", handleTrackClick);
    track.removeEventListener("mousedown", handleTrackMouseDown);
    track.removeEventListener("mouseenter", handleScrollbarAreaEnter);
    document.removeEventListener("mouseup", handleRepeatMouseUp);
    track.removeEventListener("mouseleave", handleScrollbarAreaLeave);
    thumb.removeEventListener("mousedown", handleThumbMouseDown);
    viewport.removeEventListener("mouseenter", handleViewportEnter);
    viewport.removeEventListener("mouseleave", handleViewportLeave);
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);

    hoverZone.removeEventListener("click", handleTrackClick);
    hoverZone.removeEventListener("mousedown", handleTrackMouseDown);
    if (showOnHover) {
      hoverZone.removeEventListener("mouseenter", handleScrollbarAreaEnter);
      hoverZone.removeEventListener("mouseleave", handleScrollbarAreaLeave);
    }
    if (hoverZone.parentNode) {
      hoverZone.parentNode.removeChild(hoverZone);
    }

    // Remove inline CSS variable overrides from viewport
    viewport.style.removeProperty("--vlist-custom-scrollbar-padding-top");
    viewport.style.removeProperty("--vlist-custom-scrollbar-padding-right");
    viewport.style.removeProperty("--vlist-custom-scrollbar-padding-bottom");
    viewport.style.removeProperty("--vlist-custom-scrollbar-padding-left");

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
  track.addEventListener("mousedown", handleTrackMouseDown);
  track.addEventListener("mouseenter", handleScrollbarAreaEnter);
  track.addEventListener("mouseleave", handleScrollbarAreaLeave);
  thumb.addEventListener("mousedown", handleThumbMouseDown);
  viewport.addEventListener("mouseenter", handleViewportEnter);
  viewport.addEventListener("mouseleave", handleViewportLeave);

  // Always: clicks in the padding margin behave the same as track clicks
  hoverZone.addEventListener("click", handleTrackClick);
  hoverZone.addEventListener("mousedown", handleTrackMouseDown);
  // Conditional: hover-to-reveal behavior
  if (showOnHover) {
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
