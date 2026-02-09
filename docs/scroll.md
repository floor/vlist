# Scroll Module

> Scroll controller and custom scrollbar for vlist.

## Overview

The scroll module handles all scrolling functionality in vlist, including:

- **Native Scrolling**: Standard browser scrolling for smaller lists
- **Compressed Scrolling**: Manual wheel-based scrolling for large lists (1M+ items)
- **Window Scrolling**: Document-level scrolling where the list participates in the page flow
- **Custom Scrollbar**: Visual scrollbar for compressed mode
- **Velocity Tracking**: Smooth scroll momentum detection

## Module Structure

```
src/scroll/
├── index.ts       # Module exports
├── controller.ts  # Scroll controller (native + compressed modes)
└── scrollbar.ts   # Custom scrollbar component
```

## Key Concepts

### Scroll Transition Suppression

During active scrolling, vlist toggles a `.vlist--scrolling` class on the root element. This disables CSS transitions on items to prevent visual jank from transition animations fighting with rapid position updates. When scrolling becomes idle, the class is removed and transitions are re-enabled.

```
Scroll starts → add .vlist--scrolling (transitions disabled)
    ↓
Scrolling active...
    ↓
Scroll stops (idle detected) → remove .vlist--scrolling (transitions re-enabled)
```

### Scroll Modes

The scroll controller operates in three modes:

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Native** | Small lists (< ~333K items @ 48px) | `overflow: auto`, browser handles scrolling |
| **Compressed** | Large lists (> browser limit) | `overflow: hidden`, manual wheel handling |
| **Window** | `scrollElement: window` config option | `overflow: visible`, browser scrolls the page |

### Mode Switching

```
List Created
    ↓
scrollElement: window?
    ↓
Yes → Window Mode (window scroll events)
No  → Check: totalItems × itemHeight > 16M?
        ↓
      Yes → Compressed Mode (wheel events)
      No  → Native Mode (scroll events)
```

### Window Scrolling

When `scrollElement: window` is set, the list participates in the normal page flow instead of scrolling inside its own container. This is ideal for search results, feeds, landing pages, and any UI where the list should scroll with the document.

**How it works:**

1. The viewport is set to `overflow: visible` and `height: auto` — no inner scrollbar
2. The scroll controller listens to `window.scroll` (RAF-throttled, passive)
3. The list-relative scroll position is computed from `viewport.getBoundingClientRect().top`
4. Container height is derived from `window.innerHeight` and updated on window resize
5. The browser's native scrollbar is used (custom scrollbar is disabled)

**Compression in window mode:** Compression still works — the content div height is set to the virtual height, and the browser scrolls natively. The compression math (ratio-based position mapping) is purely mathematical; no overflow changes or wheel interception are needed.

```
Page Layout (Window Mode)
┌──────────────────────────┐
│  Page header / nav       │
├──────────────────────────┤
│  VList viewport          │  ← overflow: visible, height: auto
│  ┌────────────────────┐  │
│  │ content div         │  │  ← height = totalHeight (or virtualHeight)
│  │  ┌──────────────┐  │  │
│  │  │ visible items │  │  │  ← positioned within content
│  │  └──────────────┘  │  │
│  └────────────────────┘  │
├──────────────────────────┤
│  Page footer             │
└──────────────────────────┘
     ↕ browser scrollbar scrolls the whole page
```

### Configurable Idle Timeout

The idle timeout controls how long after the last scroll event before the list is considered "idle". This is configurable via the `idleTimeout` option on both `VListConfig` and `ScrollControllerConfig`:

```typescript
const list = createVList({
  container: '#list',
  item: { height: 50, template: myTemplate },
  adapter: myAdapter,
  idleTimeout: 200, // ms (default: 150)
});
```

When idle is detected, vlist:
- Loads any pending data ranges skipped during fast scrolling
- Re-enables CSS transitions (removes `.vlist--scrolling` class)
- Resets the velocity tracker

**Tuning tips:**
- **Mobile/touch devices:** Increase to 200-300ms (scroll events have larger gaps)
- **Desktop with smooth scroll:** Default 150ms works well
- **Aggressive loading:** Decrease to 100ms (loads data sooner after scroll stops)

### Velocity Tracking

The controller tracks scroll velocity using a **circular buffer** for optimal performance (zero allocations during scrolling):

```typescript
interface VelocityTracker {
  velocity: number;      // Current velocity (px/ms)
  lastPosition: number;  // Previous scroll position
  lastTime: number;      // Timestamp of last update
  samples: VelocitySample[];  // Pre-allocated circular buffer (8 samples)
  sampleIndex: number;   // Current write index
  sampleCount: number;   // Number of valid samples (0-8)
}

interface VelocitySample {
  position: number;
  time: number;
}
```

The circular buffer pre-allocates 8 sample slots and overwrites the oldest sample on each update, avoiding array allocation/spread operations during scrolling.

**Key constants:**

| Constant | Value | Purpose |
|----------|-------|---------|
| `VELOCITY_SAMPLE_COUNT` | 8 | Buffer size (~133ms window at 60fps) for smooth averaging |
| `MIN_RELIABLE_SAMPLES` | 3 | Minimum samples before `isTracking()` returns true |
| `STALE_GAP_MS` | 100 | Max gap (ms) before buffer is considered stale |

**Stale gap detection:** When more than 100ms passes between samples (e.g., after idle resets the tracker), the buffer is cleared and the current position becomes the new baseline. This prevents computing bogus low velocity from `small_delta / huge_time_gap` — a problem that caused spurious API requests at the start of scrollbar drags.

**Reliability tracking:** `isTracking()` returns `false` until at least 3 samples have accumulated. The scroll handler uses this to defer loading during the ramp-up phase of a new scroll gesture, rather than trusting near-zero velocity readings.

## API Reference

### Scroll Controller

#### `createScrollController`

Creates a scroll controller for a viewport element.

```typescript
function createScrollController(
  viewport: HTMLElement,
  config?: ScrollControllerConfig
): ScrollController;

interface ScrollControllerConfig {
  /** Enable compressed scroll mode (manual wheel handling) */
  compressed?: boolean;
  
  /** Compression state for calculating bounds */
  compression?: CompressionState;
  
  /**
   * External scroll element for window/document scrolling.
   * When set, the controller listens to this element's scroll events
   * and computes list-relative positions from the viewport's bounding rect.
   */
  scrollElement?: Window;
  
  /** Wheel sensitivity multiplier (default: 1) */
  sensitivity?: number;
  
  /** Enable smooth scrolling interpolation */
  smoothing?: boolean;
  
  /** Idle timeout in milliseconds (default: 150) */
  idleTimeout?: number;
  
  /** Callback when scroll position changes */
  onScroll?: (data: ScrollEventData) => void;
  
  /** Callback when scrolling becomes idle */
  onIdle?: () => void;
}
```

#### ScrollController Interface

```typescript
interface ScrollController {
  /** Get current scroll position */
  getScrollTop: () => number;
  
  /** Set scroll position */
  scrollTo: (position: number, smooth?: boolean) => void;
  
  /** Scroll by delta */
  scrollBy: (delta: number) => void;
  
  /** Check if at top */
  isAtTop: () => boolean;
  
  /** Check if at bottom */
  isAtBottom: (threshold?: number) => boolean;
  
  /** Get scroll percentage (0-1) */
  getScrollPercentage: () => number;
  
  /** Get current scroll velocity (px/ms, absolute value) */
  getVelocity: () => number;
  
  /**
   * Check if the velocity tracker is actively tracking with enough samples.
   * Returns false during ramp-up (first few frames of a new scroll gesture)
   * when the tracker doesn't have enough samples yet.
   */
  isTracking: () => boolean;
  
  /** Check if currently scrolling */
  isScrolling: () => boolean;
  
  /** Update configuration */
  updateConfig: (config: Partial<ScrollControllerConfig>) => void;
  
  /** Enable compressed mode */
  enableCompression: (compression: CompressionState) => void;
  
  /** Disable compressed mode (revert to native scroll) */
  disableCompression: () => void;
  
  /** Check if compressed mode is active */
  isCompressed: () => boolean;
  
  /** Check if in window scroll mode */
  isWindowMode: () => boolean;
  
  /**
   * Update the container height used for scroll calculations.
   * In window mode, call this when the window resizes.
   */
  updateContainerHeight: (height: number) => void;
  
  /** Destroy and cleanup */
  destroy: () => void;
}
```

#### ScrollEventData

```typescript
interface ScrollEventData {
  scrollTop: number;
  direction: 'up' | 'down';
  velocity: number;
}
```

### Custom Scrollbar

#### `createScrollbar`

Creates a custom scrollbar for compressed mode.

```typescript
function createScrollbar(
  viewport: HTMLElement,
  onScroll: ScrollCallback,
  config?: ScrollbarConfig,
  classPrefix?: string
): Scrollbar;

type ScrollCallback = (position: number) => void;

interface ScrollbarConfig {
  /** Enable scrollbar (default: true when compressed) */
  enabled?: boolean;
  
  /** Auto-hide scrollbar after idle (default: true) */
  autoHide?: boolean;
  
  /** Auto-hide delay in milliseconds (default: 1000) */
  autoHideDelay?: number;
  
  /** Minimum thumb size in pixels (default: 30) */
  minThumbSize?: number;
}
```

#### Scrollbar Interface

```typescript
interface Scrollbar {
  /** Show the scrollbar */
  show: () => void;
  
  /** Hide the scrollbar */
  hide: () => void;
  
  /** Update scrollbar dimensions */
  updateBounds: (totalHeight: number, containerHeight: number) => void;
  
  /** Update thumb position */
  updatePosition: (scrollTop: number) => void;
  
  /** Check if scrollbar is visible */
  isVisible: () => boolean;
  
  /** Destroy and cleanup */
  destroy: () => void;
}
```

### Utility Functions

#### `rafThrottle`

Throttle a function using requestAnimationFrame.

```typescript
function rafThrottle<T extends (...args: any[]) => void>(
  fn: T
): ((...args: Parameters<T>) => void) & { cancel: () => void };

// Usage
const throttledScroll = rafThrottle(handleScroll);
element.addEventListener('scroll', throttledScroll);

// Cleanup
throttledScroll.cancel();
```

#### Scroll Position Utilities

```typescript
// Check if at bottom of scrollable area
function isAtBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold?: number
): boolean;

// Check if at top
function isAtTop(scrollTop: number, threshold?: number): boolean;

// Get scroll percentage (0-1)
function getScrollPercentage(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number
): number;

// Check if a range is visible in scroll viewport
function isRangeVisible(
  rangeStart: number,
  rangeEnd: number,
  visibleStart: number,
  visibleEnd: number
): boolean;
```

## Usage Examples

### Basic Scroll Controller

```typescript
import { createScrollController } from './scroll';

const controller = createScrollController(viewport, {
  onScroll: ({ scrollTop, direction, velocity }) => {
    console.log(`Scrolled ${direction} to ${scrollTop}px`);
    console.log(`Velocity: ${velocity}px/ms`);
  },
  onIdle: () => {
    console.log('Scrolling stopped');
  }
});

// Programmatic scrolling
controller.scrollTo(500);
controller.scrollTo(1000, true);  // smooth scroll
controller.scrollBy(100);         // relative scroll

// Query scroll state
const position = controller.getScrollTop();
const percentage = controller.getScrollPercentage();
const atBottom = controller.isAtBottom();
const atTop = controller.isAtTop();

// Cleanup
controller.destroy();
```

### Enabling Compression

```typescript
import { createScrollController } from './scroll';
import { getCompressionState } from './render';

const controller = createScrollController(viewport);

// When list grows large
const compression = getCompressionState(1_000_000, 48);

if (compression.isCompressed) {
  controller.enableCompression(compression);
  // Now uses manual wheel handling
}

// When list shrinks
controller.disableCompression();
// Back to native scrolling
```

### Custom Scrollbar

```typescript
import { createScrollbar } from './scroll';

const scrollbar = createScrollbar(
  viewport,
  (position) => {
    // Called when user interacts with scrollbar
    scrollController.scrollTo(position);
  },
  {
    autoHide: true,
    autoHideDelay: 1500,
    minThumbSize: 40
  },
  'vlist'
);

// Update scrollbar when content changes
scrollbar.updateBounds(totalHeight, containerHeight);

// Update position on scroll
scrollbar.updatePosition(scrollTop);

// Manual show/hide
scrollbar.show();
scrollbar.hide();

// Cleanup
scrollbar.destroy();
```

### Window Scrolling

```typescript
import { createScrollController } from './scroll';

// The list scrolls with the page instead of inside its own container
const controller = createScrollController(viewport, {
  scrollElement: window,
  onScroll: ({ scrollTop, direction, velocity }) => {
    console.log(`Page scrolled ${direction}, list at ${scrollTop}px`);
  },
  onIdle: () => {
    console.log('Page scrolling stopped');
  }
});

// scrollTo delegates to window.scrollTo with the correct document offset
controller.scrollTo(5000);

// isAtBottom / getScrollPercentage work using tracked maxScroll
const atBottom = controller.isAtBottom();
const pct = controller.getScrollPercentage();

// Update container height when window resizes
window.addEventListener('resize', () => {
  controller.updateContainerHeight(window.innerHeight);
});

// Cleanup removes the window scroll listener
controller.destroy();
```

### Complete Integration

```typescript
import { createScrollController, createScrollbar } from './scroll';
import { getCompressionState } from './render';

function createScrollSystem(
  viewport: HTMLElement,
  totalItems: number,
  itemHeight: number
) {
  const compression = getCompressionState(totalItems, itemHeight);
  
  // Create scroll controller
  const controller = createScrollController(viewport, {
    compressed: compression.isCompressed,
    compression: compression.isCompressed ? compression : undefined,
    onScroll: handleScroll,
    onIdle: handleIdle
  });
  
  // Create scrollbar if compressed
  let scrollbar: Scrollbar | null = null;
  
  if (compression.isCompressed) {
    scrollbar = createScrollbar(
      viewport,
      (position) => controller.scrollTo(position),
      { autoHide: true }
    );
    
    scrollbar.updateBounds(compression.virtualHeight, viewport.clientHeight);
  }
  
  function handleScroll({ scrollTop }) {
    // Update scrollbar position
    scrollbar?.updatePosition(scrollTop);
    scrollbar?.show();
    
    // Trigger render
    updateViewport(scrollTop);
  }
  
  function handleIdle() {
    // Scrollbar will auto-hide
  }
  
  return {
    controller,
    scrollbar,
    destroy: () => {
      controller.destroy();
      scrollbar?.destroy();
    }
  };
}
```

## Scrollbar Styling

### CSS Classes

```css
.vlist-scrollbar {
  position: absolute;
  top: 0;
  right: 0;
  width: var(--vlist-scrollbar-width, 8px);
  height: 100%;
  background: var(--vlist-scrollbar-track-bg, transparent);
  opacity: 0;
  transition: opacity 0.2s;
}

.vlist-scrollbar--visible {
  opacity: 1;
}

.vlist-scrollbar--dragging {
  opacity: 1;
}

.vlist-scrollbar-thumb {
  position: absolute;
  width: 100%;
  background: var(--vlist-scrollbar-custom-thumb-bg, rgba(0, 0, 0, 0.3));
  border-radius: var(--vlist-scrollbar-custom-thumb-radius, 4px);
  cursor: pointer;
}

.vlist-scrollbar-thumb:hover {
  background: var(--vlist-scrollbar-custom-thumb-hover-bg, rgba(0, 0, 0, 0.5));
}
```

### CSS Variables

```css
:root {
  --vlist-scrollbar-width: 8px;
  --vlist-scrollbar-track-bg: transparent;
  --vlist-scrollbar-custom-thumb-bg: rgba(0, 0, 0, 0.3);
  --vlist-scrollbar-custom-thumb-hover-bg: rgba(0, 0, 0, 0.5);
  --vlist-scrollbar-custom-thumb-radius: 4px;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  :root {
    --vlist-scrollbar-custom-thumb-bg: rgba(255, 255, 255, 0.3);
    --vlist-scrollbar-custom-thumb-hover-bg: rgba(255, 255, 255, 0.5);
  }
}
```

## Implementation Details

### Native Mode

In native mode, the controller listens to the standard scroll event:

```typescript
// Native mode setup
viewport.style.overflow = 'auto';
viewport.addEventListener('scroll', handleNativeScroll, { passive: true });

function handleNativeScroll() {
  const scrollTop = viewport.scrollTop;
  // Update state, trigger callbacks
}
```

### Window Mode

In window mode, the controller listens to `window.scroll` and computes the list-relative position from the viewport's bounding rect:

```typescript
// Window mode setup — no overflow changes, no wheel interception
window.addEventListener('scroll', handleWindowScroll, { passive: true });

function handleWindowScroll() {
  // The viewport's bounding rect tells us how far the list has scrolled
  // relative to the window. When rect.top = 0, scrollTop = 0.
  // When rect.top = -500, the list has scrolled 500px past the window top.
  const rect = viewport.getBoundingClientRect();
  const scrollTop = Math.max(0, -rect.top);
  // Update state, trigger callbacks
}
```

**Key differences from native/compressed modes:**

| Aspect | Native/Compressed | Window |
|--------|-------------------|--------|
| Scroll listener | `viewport.scroll` / `viewport.wheel` | `window.scroll` |
| `getScrollTop()` | `viewport.scrollTop` / tracked position | tracked `scrollPosition` (viewport has no scrollTop) |
| `scrollTo(pos)` | `viewport.scrollTop = pos` / tracked | `window.scrollTo(listDocumentTop + pos)` |
| Compression | Changes overflow, intercepts wheel | Purely mathematical (no overflow/wheel changes) |
| Custom scrollbar | Enabled when compressed | Disabled (browser scrollbar used) |

### Compressed Mode

In compressed mode, the controller intercepts wheel events:

```typescript
// Compressed mode setup
viewport.style.overflow = 'hidden';  // Hide native scrollbar
viewport.addEventListener('wheel', handleWheel, { passive: false });

function handleWheel(event: WheelEvent) {
  event.preventDefault();  // Prevent page scroll
  
  const delta = event.deltaY * sensitivity;
  scrollPosition = clamp(scrollPosition + delta, 0, maxScroll);
  
  // Trigger callbacks with virtual scroll position
}
```

### Scroll Position Conversion

When switching modes, scroll position is converted:

```typescript
// Native → Compressed
const ratio = viewport.scrollTop / (actualHeight - viewport.clientHeight);
scrollPosition = ratio * maxScroll;

// Compressed → Native
const ratio = scrollPosition / maxScroll;
viewport.scrollTop = ratio * (actualHeight - viewport.clientHeight);
```

> **Note:** In window mode, `enableCompression` and `disableCompression` skip overflow and wheel changes entirely — compression is purely mathematical. The content div height is set to the virtual height by `vlist.ts`, and the browser scrolls natively.

### Idle Detection

The controller detects when scrolling stops using a configurable timeout (default: 150ms):

```typescript
let idleTimer: number | null = null;

function scheduleIdleCheck() {
  if (idleTimer) clearTimeout(idleTimer);
  
  idleTimer = setTimeout(() => {
    isScrolling = false;
    onIdle?.();  // Triggers pending loads, removes .vlist--scrolling, resets velocity
  }, config.idleTimeout ?? 150);  // Configurable via idleTimeout option
}
```

The idle timeout can be tuned per device/use case via `VListConfig.idleTimeout` or `ScrollControllerConfig.idleTimeout`.

## Performance Considerations

### Passive Event Listeners

Native scroll uses passive listeners for better performance:

```typescript
viewport.addEventListener('scroll', handler, { passive: true });
```

### RAF Throttling

Use `rafThrottle` to limit callback frequency:

```typescript
const throttledCallback = rafThrottle((scrollTop) => {
  // Heavy operations
  updateViewport(scrollTop);
});
```

### RAF-Throttled Native Scroll

In native mode, `handleNativeScroll` is wrapped with `rafThrottle` to guarantee at most one scroll processing per animation frame, preventing redundant work:

```typescript
const throttledScroll = rafThrottle(handleNativeScroll);
viewport.addEventListener('scroll', throttledScroll, { passive: true });
```

### Velocity Sampling (Circular Buffer)

Velocity is calculated using a pre-allocated circular buffer of 8 samples:

```typescript
const SAMPLE_COUNT = 8;
const STALE_GAP_MS = 100;
const MIN_RELIABLE_SAMPLES = 3;

function updateVelocityTracker(tracker, newPosition) {
  const now = performance.now();
  const timeDelta = now - tracker.lastTime;

  // Stale gap detection: reset buffer after a pause (>100ms)
  // Prevents bogus low velocity from small_delta / huge_time_gap
  if (timeDelta > STALE_GAP_MS) {
    tracker.sampleCount = 0;
    tracker.sampleIndex = 0;
    tracker.velocity = 0;
    // Record baseline — real velocity computed on next update
    tracker.samples[0] = { position: newPosition, time: now };
    tracker.sampleIndex = 1;
    tracker.sampleCount = 1;
    return tracker;
  }

  // Write to current slot (no allocation)
  const currentSample = tracker.samples[tracker.sampleIndex]!;
  currentSample.position = newPosition;
  currentSample.time = now;

  // Advance index (wrap around)
  tracker.sampleIndex = (tracker.sampleIndex + 1) % SAMPLE_COUNT;
  tracker.sampleCount = Math.min(tracker.sampleCount + 1, SAMPLE_COUNT);

  // Calculate average velocity (only with enough data)
  if (tracker.sampleCount >= 2) {
    const oldestIndex = (tracker.sampleIndex - tracker.sampleCount + SAMPLE_COUNT) % SAMPLE_COUNT;
    const oldest = tracker.samples[oldestIndex]!;
    tracker.velocity = (newPosition - oldest.position) / (now - oldest.time);
  }

  return tracker;
}

// Reliability check — used by scroll handler to defer loading during ramp-up
function isTrackerReliable(tracker) {
  return tracker.sampleCount >= MIN_RELIABLE_SAMPLES;
}
```

This approach:
- Eliminates array allocation and garbage collection during scrolling
- Detects stale gaps after idle to prevent misleading velocity readings
- Provides explicit reliability signaling via `isTracking()`

## Scrollbar Interactions

### Track Click

Click on track jumps to position:

```typescript
function handleTrackClick(event: MouseEvent) {
  const trackRect = track.getBoundingClientRect();
  const clickY = event.clientY - trackRect.top;
  
  // Center thumb at click position
  const thumbTop = clickY - thumbHeight / 2;
  const scrollRatio = thumbTop / maxThumbTravel;
  const scrollPosition = scrollRatio * maxScroll;
  
  onScroll(scrollPosition);
}
```

### Thumb Drag

Drag thumb to scroll proportionally:

```typescript
function handleMouseMove(event: MouseEvent) {
  const deltaY = event.clientY - dragStartY;
  const scrollDelta = (deltaY / maxThumbTravel) * maxScroll;
  const newPosition = dragStartScrollPosition + scrollDelta;
  
  onScroll(clamp(newPosition, 0, maxScroll));
}
```

## Related Modules

- [compression.md](./compression.md) - Compression state for large lists
- [render.md](./render.md) - Viewport state management
- [handlers.md](./handlers.md) - Scroll event handler
- [context.md](./context.md) - Context holds scroll controller
- [optimization.md](./optimization.md) - Full list of scroll-related optimizations
- [styles.md](./styles.md) - `.vlist--scrolling` class and CSS containment
- [vlist.md](./vlist.md) - Main vlist documentation (window scrolling usage)

---

*The scroll module provides seamless scrolling for lists of any size — inside a container or with the page.*