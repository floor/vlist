# Scroll Module

> Scroll controller and custom scrollbar for vlist.

## Overview

The scroll module handles all scrolling functionality in vlist, including:

- **Native Scrolling**: Standard browser scrolling for smaller lists
- **Compressed Scrolling**: Manual wheel-based scrolling for large lists (1M+ items)
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

### Dual Mode Scrolling

The scroll controller operates in two modes:

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Native** | Small lists (< ~333K items @ 48px) | `overflow: auto`, browser handles scrolling |
| **Compressed** | Large lists (> browser limit) | `overflow: hidden`, manual wheel handling |

### Mode Switching

```
List Created
    ↓
Check: totalItems × itemHeight > 16M?
    ↓
Yes → Compressed Mode (wheel events)
No  → Native Mode (scroll events)
```

### Velocity Tracking

The controller tracks scroll velocity for smooth momentum:

```typescript
interface VelocityTracker {
  velocity: number;      // Current velocity (px/ms)
  lastPosition: number;  // Previous scroll position
  lastTime: number;      // Timestamp of last update
  samples: Array<{ position: number; time: number }>;
}
```

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
  
  /** Wheel sensitivity multiplier (default: 1) */
  sensitivity?: number;
  
  /** Enable smooth scrolling interpolation */
  smoothing?: boolean;
  
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
  
  /** Update configuration */
  updateConfig: (config: Partial<ScrollControllerConfig>) => void;
  
  /** Enable compressed mode */
  enableCompression: (compression: CompressionState) => void;
  
  /** Disable compressed mode (revert to native scroll) */
  disableCompression: () => void;
  
  /** Check if compressed mode is active */
  isCompressed: () => boolean;
  
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

### Idle Detection

The controller detects when scrolling stops:

```typescript
let idleTimeout: number | null = null;

function scheduleIdleCheck() {
  if (idleTimeout) clearTimeout(idleTimeout);
  
  idleTimeout = setTimeout(() => {
    isScrolling = false;
    onIdle?.();
  }, 150);  // 150ms idle threshold
}
```

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

### Velocity Sampling

Velocity is calculated from recent samples (last 100ms):

```typescript
// Keeps only recent samples
const samples = tracker.samples.filter(s => now - s.time < 100);

// Average velocity from samples
const totalDistance = newPosition - samples[0].position;
const totalTime = now - samples[0].time;
const avgVelocity = totalDistance / totalTime;
```

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

---

*The scroll module provides seamless scrolling for lists of any size.*