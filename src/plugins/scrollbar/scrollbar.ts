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

import type { SizeCache } from "../../rendering/sizes";
import type { ScrollbarPadding } from "../../types";
export type { ScrollbarPadding } from "../../types";

/** Scrollbar configuration */
export interface ScrollbarConfig {
  /** Override the platform appearance selected once at setup. */
  platform?: 'macos' | 'windows' | 'android';
  /** Override standard scrollbar-width; auto uses the platform width. */
  width?: 'auto' | 'thin' | 'none';
  /** Explicit colors override author scrollbar-color. */
  thumbColor?: string;
  trackColor?: string;
  /** Reserve a gutter while the scrollbar is enabled. */
  gutter?: boolean;

  /** Enable scrollbar (default: true; width:none also disables it). */
  enabled?: boolean;

  /** Auto-hide after idle (default: true for overlays, false for Windows). */
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
   * Behavior when clicking on the scrollbar track (not the thumb) (default: 'scroll').
   * - `'scroll'` — scrolls toward the clicked position, matching macOS native scrollbar
   *                behavior. Hold to scroll continuously.
   * - `'jump'`   — jumps directly to the clicked position (centers the thumb there).
   */
  clickBehavior?: 'jump' | 'scroll' | 'page';
}

/** Scrollbar instance */
export interface Scrollbar {
  /** Re-read the container’s standard scrollbar CSS properties. */
  refresh: () => void;

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

let nextViewportId = 0;
const AUTO_HIDE_DELAY = 1000;
const MIN_THUMB_SIZE = 15;
const SHOW_ON_HOVER = true;
const HOVER_ZONE_REACH = 16; // px of reach beyond the visible track (added to padding for the default)
const SHOW_ON_VIEWPORT_ENTER = true;
const PADDING = 2;
const TRACK_CLICK_BEHAVIOR = 'scroll' as const;
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
 * @param viewport - The viewport element (used for events and CSS variables)
 * @param onScroll - Callback when scrollbar interaction causes scroll
 * @param config - Scrollbar configuration
 * @param classPrefix - CSS class prefix (default: 'vlist')
 * @param isX - Whether the primary axis is X (horizontal, default: false)
 * @param parent - Element to append scrollbar DOM to (default: viewport)
 */
export const createScrollbar = (
  viewport: HTMLElement,
  onScroll: ScrollCallback,
  config: ScrollbarConfig = {},
  classPrefix = "vlist",
  isX = false,
  parent?: HTMLElement,
  getSizeCache?: () => SizeCache,
  styleSource?: HTMLElement,
): Scrollbar => {
  const os = (navigator as Navigator & {userAgentData?: {platform: string}}).userAgentData?.platform || navigator.platform + navigator.userAgent;
  const classic = config.platform ? config.platform === 'windows' : !/Mac|Android/i.test(os);
  const {
    autoHide = !classic,
    autoHideDelay = AUTO_HIDE_DELAY,
    minThumbSize = MIN_THUMB_SIZE,
    showOnHover = SHOW_ON_HOVER,
    showOnViewportEnter = SHOW_ON_VIEWPORT_ENTER,
    clickBehavior: rawClickBehavior = TRACK_CLICK_BEHAVIOR,
  } = config;

  const clickBehavior = rawClickBehavior === 'page' ? 'scroll' : rawClickBehavior;
  const attachTo = parent ?? viewport;

  const pad = resolvePadding(config.padding);

  // Axis-aware padding: start/end along the scroll axis, wall-side for hover zone default
  const scrollAxisStartPad = isX ? pad.left : pad.top;
  const scrollAxisEndPad   = isX ? pad.right : pad.bottom;
  const wallPad            = isX ? pad.bottom : pad.right;

  // Hover zone covers wall-gap + fixed reach beyond the track edge
  const hoverZoneWidth = config.hoverZoneWidth ?? (wallPad + HOVER_ZONE_REACH);

  // State
  let enabled = true;
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
  let pointerId: number | null = null;
  let captureTarget: HTMLElement | null = null;
  let lastMax = -1, lastNow = -1, lastRow = -1, lastTotal = -1;
  let lastThumbPosition = -1;
  const ownedViewportId = viewport.id ? '' : (() => {
    let id: string;
    do { id = `${classPrefix}-scrollport-${++nextViewportId}`; } while (document.getElementById(id));
    viewport.id = id;
    return id;
  })();
  let pageClickPos = 0;
  let pageScrollPosition = 0; // internal tracker — updated synchronously each tick
  let repeatTimeout: ReturnType<typeof setTimeout> | null = null;
  let repeatRafId: number | null = null;
  let repeatLastTime: number | null = null;

  // Axis helpers — select CSS property / mouse coordinate once
  const thumbSizeProp = isX ? "width" : "height";
  const translateFn = isX ? "translateX" : "translateY";
  const mousePos = isX
    ? (e: MouseEvent) => e.clientX
    : (e: MouseEvent) => e.clientY;
  const rectStart = isX ? "left" : "top";

  // DOM elements
  const track = document.createElement("div");
  const thumb = document.createElement("div");
  // Always created: extends click target into the padding margin + handles hover when showOnHover
  const hoverZone = document.createElement("div");

  // When the scrollbar lives on root, offset its top to align with the viewport.
  // Uses the CSS variable for padding so runtime updates via CSS take effect
  // without rebuilding the scrollbar.
  const startPadVar = isX
    ? "--vlist-custom-scrollbar-padding-left"
    : "--vlist-custom-scrollbar-padding-top";
  const syncTrackOffset = (): void => {
    if (attachTo === viewport) return;
    const offset = viewport.offsetTop;
    track.style[isX ? "left" : "top"] = offset
      ? `calc(var(${startPadVar}) + ${offset}px)`
      : `var(${startPadVar})`;
    hoverZone.style[isX ? "left" : "top"] = `${offset}px`;
  };

  // =============================================================================
  // DOM Setup
  // =============================================================================

  const setupDOM = (): void => {
    track.className = `${classPrefix}-scrollbar`;
    track.setAttribute('role', 'scrollbar');
    track.setAttribute('aria-controls', viewport.id);
    track.setAttribute('aria-orientation', isX ? 'horizontal' : 'vertical');
    track.setAttribute('aria-label', viewport.getAttribute('aria-label') || 'Scroll');
    track.setAttribute('aria-valuemin', '0');
    track.tabIndex = 0;
    thumb.className = `${classPrefix}-scrollbar__thumb`;

    if (isX) {
      track.classList.add(`${classPrefix}-scrollbar--horizontal`);
    }

    if (config.padding !== undefined) {
      attachTo.style.setProperty("--vlist-custom-scrollbar-padding-top",    `${pad.top}px`);
      attachTo.style.setProperty("--vlist-custom-scrollbar-padding-right",  `${pad.right}px`);
      attachTo.style.setProperty("--vlist-custom-scrollbar-padding-bottom", `${pad.bottom}px`);
      attachTo.style.setProperty("--vlist-custom-scrollbar-padding-left",   `${pad.left}px`);
    }

    if (config.minThumbSize !== undefined) {
      track.style.setProperty("--vlist-custom-scrollbar-min-thumb-size", `${minThumbSize}px`);
    }

    track.appendChild(thumb);
    attachTo.appendChild(track);

    // Edge zone — covers the padding margin + track area along the scrollbar edge.
    // Always present so clicks in the padding margin are captured regardless of showOnHover.
    // pointer-events:auto so events fire even when the track is hidden (opacity:0).
    hoverZone.className = `${classPrefix}-scrollbar__hover`;
    if (isX) {
      hoverZone.classList.add(`${classPrefix}-scrollbar__hover--horizontal`);
      hoverZone.style.height = `${hoverZoneWidth}px`;
    } else {
      hoverZone.style.width = `${hoverZoneWidth}px`;
    }
    attachTo.appendChild(hoverZone);

    // When attached to root instead of viewport, offset track/hover to match
    // the viewport's position (e.g. below a sticky header).
    if (attachTo !== viewport) {
      syncTrackOffset();
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
    if (!enabled || totalSize <= containerSize) return;

    clearHideTimeout();

    if (!visible) {
      track.classList.add(`${classPrefix}-scrollbar--visible`);
      visible = true;
    }

    // Schedule auto-hide only if not hovering and not dragging
    if (autoHide && !isDragging && !isHovering && document.activeElement !== track) {
      scheduleHide();
    }
  };

  const hide = (): void => {
    if (isDragging || isHovering || document.activeElement === track) return;

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
    syncTrackOffset();

    updatePosition(currentScrollPosition);

    // Check if scrollbar is needed
    if (!enabled || totalSize <= containerSize) {
      track.style.display = "none";
      track.classList.remove(`${classPrefix}-scrollbar--visible`);
      visible = false;
      return;
    }
    track.style.display = "";

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

    if (!autoHide) {
      show();
    }
  };

  const updatePosition = (scrollTop: number): void => {
    const maxScroll = Math.max(0, totalSize - containerSize);
    currentScrollPosition = Math.max(0, Math.min(scrollTop, maxScroll));
    if (lastMax !== maxScroll) {
      lastMax = maxScroll;
      track.setAttribute('aria-valuemax', String(maxScroll));
    }
    if (lastNow !== currentScrollPosition) {
      lastNow = currentScrollPosition;
      track.setAttribute('aria-valuenow', String(currentScrollPosition));
    }
    const cache = getSizeCache?.();
    const total = cache?.getTotal() ?? 0;
    const row = total ? cache!.indexAtOffset(currentScrollPosition) + 1 : 0;
    if (row !== lastRow || total !== lastTotal) {
      lastRow = row; lastTotal = total;
      track.setAttribute('aria-valuetext', `Row ${row} of ${total}`);
    }
    if (maxScroll <= 0 || maxThumbTravel <= 0) return;
    const position = currentScrollPosition / maxScroll * maxThumbTravel;
    if (position !== lastThumbPosition) {
      lastThumbPosition = position;
      thumb.style.transform = `${translateFn}(${position}px)`;
    }
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!enabled || event.target !== track || document.activeElement !== track) return;
    // A focused scrollbar must not forward Space/Enter to list selection.
    event.stopPropagation();
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const cache = getSizeCache?.();
    const step = cache?.getSize(cache.indexAtOffset(currentScrollPosition)) ?? 40;
    let position = currentScrollPosition;
    switch (event.key) {
      case isX ? 'ArrowLeft' : 'ArrowUp': position -= step; break;
      case isX ? 'ArrowRight' : 'ArrowDown': position += step; break;
      case 'PageUp': position -= containerSize; break;
      case 'PageDown': position += containerSize; break;
      case 'Home': position = 0; break;
      case 'End': position = totalSize; break;
      default: return;
    }
    event.preventDefault();
    onScroll(Math.max(0, Math.min(position, Math.max(0, totalSize - containerSize))));
    show();
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

  // 'scroll' — immediate first scroll by one containerSize toward click
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

  const handlePointerEnd = (event?: PointerEvent): void => {
    if (event && event.pointerId !== pointerId) return;
    const id = pointerId, target = captureTarget;
    pointerId = null; captureTarget = null;
    isDragging = false;
    track.classList.remove(`${classPrefix}-scrollbar--dragging`);
    clearRepeat();
    if (id !== null && target?.hasPointerCapture(id)) target.releasePointerCapture(id);
    scheduleHide();
  };

  const handlePointerDown = (event: PointerEvent): void => {
    if (!enabled || event.button !== 0 || pointerId !== null || maxThumbTravel <= 0) return;
    event.preventDefault(); event.stopPropagation();
    pointerId = event.pointerId;
    isDragging = event.target === thumb;
    captureTarget = isDragging ? thumb : event.currentTarget as HTMLElement;
    captureTarget.setPointerCapture(pointerId);
    clearHideTimeout();
    if (isDragging) {
      dragStartPos = mousePos(event);
      dragStartScrollPosition = currentScrollPosition;
      track.classList.add(`${classPrefix}-scrollbar--dragging`);
    } else if (clickBehavior === 'jump') {
      handleTrackClick(event);
    } else {
      pageClickPos = mousePos(event) - track.getBoundingClientRect()[rectStart];
      pageScrollPosition = currentScrollPosition;
      firePageScroll();
      repeatTimeout = setTimeout(() => {
        repeatRafId = requestAnimationFrame(tickContinuousScroll);
      }, PAGE_SCROLL_INITIAL_DELAY);
    }
    show();
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (!isDragging || event.pointerId !== pointerId) return;
    event.stopPropagation();
    const delta = mousePos(event) - dragStartPos;
    const maxScroll = Math.max(0, totalSize - containerSize);
    const position = Math.max(0, Math.min(dragStartScrollPosition + delta / maxThumbTravel * maxScroll, maxScroll));
    // Immediate visual response even if the consumer's scroll event is deferred.
    updatePosition(position);
    onScroll(position);
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

  const styleNames = ['width', 'radius', 'thumb-color', 'track-color'];
  const setStyle = (name: string, value: string): void => attachTo.style.setProperty(`--vlist-custom-scrollbar-${name}`, value);
  const originalStyles = styleNames.map(name => attachTo.style.getPropertyValue(`--vlist-custom-scrollbar-${name}`));
  const refresh = (): void => {
    const css = getComputedStyle(styleSource ?? attachTo);
    const width = config.width ?? css.getPropertyValue('scrollbar-width');
    const colors = css.getPropertyValue('scrollbar-color').match(/[\w-]+\([^)]*\)|\S+/g);
    enabled = config.enabled !== false && width !== 'none';
    const values = [width === 'thin' || !classic ? '6px' : '14px', classic ? '0px' : '4px',
      config.thumbColor ?? (colors?.length === 2 ? colors[0]! : originalStyles[2]!),
      config.trackColor ?? (colors?.length === 2 ? colors[1]! : originalStyles[3]!)];
    for (let i = 0; i < styleNames.length; i++) setStyle(styleNames[i]!, values[i]!);
    hoverZone.style.display = enabled ? '' : 'none';
    viewport.classList.toggle(`${classPrefix}-viewport--gutter`, enabled && !!config.gutter);
    if (!enabled) handlePointerEnd();
    updateBounds(totalSize, containerSize);
  };

  // =============================================================================
  // Cleanup
  // =============================================================================

  const destroy = (): void => {
    // Clear timers
    clearHideTimeout();
    clearRepeat();

    handlePointerEnd();
    clearHideTimeout();
    for (const remove of removeListeners) remove();
    for (let i = 0; i < styleNames.length; i++) setStyle(styleNames[i]!, originalStyles[i]!);
    viewport.classList.remove(`${classPrefix}-viewport--gutter`);
    hoverZone.remove();

    // Remove inline CSS variable overrides
    attachTo.style.removeProperty("--vlist-custom-scrollbar-padding-top");
    attachTo.style.removeProperty("--vlist-custom-scrollbar-padding-right");
    attachTo.style.removeProperty("--vlist-custom-scrollbar-padding-bottom");
    attachTo.style.removeProperty("--vlist-custom-scrollbar-padding-left");

    // Remove DOM elements
    track.remove();
    if (ownedViewportId && viewport.id === ownedViewportId) viewport.removeAttribute('id');
  };

  // =============================================================================
  // Initialize
  // =============================================================================

  setupDOM();

  // Registration allocates only at setup; pointer capture keeps drag listeners local.
  const removeListeners: (() => void)[] = [];
  const listen = (element: HTMLElement, type: string, handler: EventListener): void => {
    element.addEventListener(type, handler);
    removeListeners.push(() => element.removeEventListener(type, handler));
  };
  for (const element of [track, thumb, hoverZone]) {
    listen(element, 'pointerdown', handlePointerDown as EventListener);
    listen(element, 'pointermove', handlePointerMove as EventListener);
    listen(element, 'pointerup', handlePointerEnd as EventListener);
    listen(element, 'pointercancel', handlePointerEnd as EventListener);
    listen(element, 'lostpointercapture', handlePointerEnd as EventListener);
  }
  listen(track, 'keydown', handleKeyDown as EventListener);
  listen(track, 'focus', show);
  listen(track, 'blur', scheduleHide);
  listen(viewport, 'mouseenter', handleViewportEnter);
  listen(viewport, 'mouseleave', handleViewportLeave);
  listen(track, 'mouseenter', handleScrollbarAreaEnter);
  listen(track, 'mouseleave', handleScrollbarAreaLeave);
  if (showOnHover) {
    listen(hoverZone, 'mouseenter', handleScrollbarAreaEnter);
    listen(hoverZone, 'mouseleave', handleScrollbarAreaLeave);
  }
  refresh();

  // =============================================================================
  // Public API
  // =============================================================================

  return {
    refresh,
    show,
    hide,
    updateBounds,
    updatePosition,
    isVisible: () => visible,
    destroy,
  };
};
