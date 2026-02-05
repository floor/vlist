# vlist Compression System

> Documentation for handling large lists (1M+ items) that exceed browser height limits.

## Overview

Browsers have a maximum element height limit of approximately **16.7 million pixels**. When a virtual list's total height (`totalItems × itemHeight`) exceeds this limit, we need **compression** to make scrolling work.

### The Problem

```
1,000,000 items × 48px = 48,000,000 pixels
Browser limit ≈ 16,700,000 pixels
Result: Scrollbar breaks, can't reach end of list
```

### The Solution

vlist automatically detects when compression is needed and switches from native scrolling to **manual wheel-based scrolling**:

1. **Native mode** (`overflow: auto`): Standard browser scrolling for smaller lists
2. **Compressed mode** (`overflow: hidden`): Manual wheel event handling for large lists

## How Compression Works

### Key Concepts

| Term | Description |
|------|-------------|
| `actualHeight` | True height if all items rendered: `totalItems × itemHeight` |
| `virtualHeight` | Capped height used for scroll bounds: `min(actualHeight, 16M)` |
| `compressionRatio` | `virtualHeight / actualHeight` (1 = no compression, <1 = compressed) |
| `virtualScrollIndex` | The item index at the current scroll position |

### Scroll Position Mapping

In compressed mode, scroll position maps to item index via ratio:

```javascript
// Scroll position → Item index
const scrollRatio = scrollTop / virtualHeight;
const itemIndex = Math.floor(scrollRatio * totalItems);

// Item index → Scroll position
const ratio = itemIndex / totalItems;
const scrollPosition = ratio * virtualHeight;
```

### Item Positioning

Items are positioned **relative to the viewport** (not content):

```javascript
const scrollRatio = scrollTop / virtualHeight;
const virtualScrollIndex = scrollRatio * totalItems;
const position = (itemIndex - virtualScrollIndex) * itemHeight;
```

This formula ensures:
- Items at the current scroll position appear at viewport top (position ≈ 0)
- Items use their full `itemHeight` (no visual compression)
- Consecutive items are exactly `itemHeight` pixels apart

### Near-Bottom Interpolation

Special handling ensures the last items are reachable:

```javascript
const maxScroll = virtualHeight - containerHeight;
const distanceFromBottom = maxScroll - scrollTop;

if (distanceFromBottom <= containerHeight) {
  // Interpolate between compressed position and actual bottom
  const interpolation = 1 - (distanceFromBottom / containerHeight);
  // Blend positions to smoothly reach the last items
}
```

## Architecture

### Scroll Controller

The scroll controller (`src/core/scroll.ts`) handles both modes:

```
┌─────────────────────────────────────────────────────┐
│                  ScrollController                    │
├─────────────────────────────────────────────────────┤
│  Native Mode (small lists)                          │
│  - overflow: auto                                   │
│  - Browser handles scrolling                        │
│  - Listen to 'scroll' event                         │
├─────────────────────────────────────────────────────┤
│  Compressed Mode (large lists)                      │
│  - overflow: hidden                                 │
│  - Intercept wheel events                           │
│  - Track virtual scrollPosition                     │
│  - Position items relative to viewport              │
└─────────────────────────────────────────────────────┘
```

### Mode Switching

```javascript
// Automatic detection in vlist.ts
const compression = getCompressionState(totalItems, itemHeight);

if (compression.isCompressed && !scrollController.isCompressed()) {
  scrollController.enableCompression(compression);
} else if (!compression.isCompressed && scrollController.isCompressed()) {
  scrollController.disableCompression();
}
```

### Rendering Flow

```
Wheel Event
    ↓
Update scrollPosition (virtual)
    ↓
Calculate visible range from scroll ratio
    ↓
Position items relative to viewport
    ↓
Items appear at correct positions
```

## API Reference

### Compression State

```typescript
interface CompressionState {
  isCompressed: boolean;
  actualHeight: number;
  virtualHeight: number;
  ratio: number;
}

// Get compression state
const state = getCompressionState(totalItems, itemHeight);
```

### Scroll Controller Methods

```typescript
interface ScrollController {
  getScrollTop(): number;
  scrollTo(position: number, smooth?: boolean): void;
  scrollBy(delta: number): void;
  isAtTop(): boolean;
  isAtBottom(threshold?: number): boolean;
  getScrollPercentage(): number;
  enableCompression(compression: CompressionState): void;
  disableCompression(): void;
  isCompressed(): boolean;
  destroy(): void;
}
```

### Utility Functions

```typescript
// Check if compression needed
needsCompression(totalItems: number, itemHeight: number): boolean

// Get max items without compression
getMaxItemsWithoutCompression(itemHeight: number): number

// Human-readable compression info
getCompressionInfo(totalItems: number, itemHeight: number): string
```

## Constants

```typescript
// Maximum virtual height (browser safe limit)
const MAX_VIRTUAL_HEIGHT = 16_000_000; // 16M pixels

// Max items by height
// 48px → 333,333 items
// 40px → 400,000 items
// 32px → 500,000 items
// 24px → 666,666 items
```

## Testing

Run compression tests:

```bash
bun test test/compression.test.ts
```

Key test scenarios:
- Small lists (no compression)
- Large lists (compression active)
- Near-bottom interpolation
- Scroll position ↔ item index mapping
- Consecutive item spacing

## Current Status

### ✅ Implemented

- [x] Compression detection
- [x] Manual wheel event handling
- [x] Viewport-relative item positioning
- [x] Near-bottom interpolation
- [x] Smooth scrolling for 1M+ items
- [x] Automatic mode switching
- [x] Custom scrollbar for compressed mode
- [x] Comprehensive tests (284 passing)

## Custom Scrollbar

The compressed mode uses `overflow: hidden`, which hides the native scrollbar. A custom scrollbar provides:
- Visual feedback of scroll position
- Click-to-scroll functionality
- Drag-to-scroll functionality
- Auto-hide after idle (configurable)

### API

```typescript
interface ScrollbarConfig {
  /** Enable scrollbar (default: auto - enabled when compressed) */
  enabled?: boolean;
  
  /** Auto-hide scrollbar after idle (default: true) */
  autoHide?: boolean;
  
  /** Auto-hide delay in milliseconds (default: 1000) */
  autoHideDelay?: number;
  
  /** Minimum thumb size in pixels (default: 30) */
  minThumbSize?: number;
}

// Usage
const list = createVList({
  container: '#app',
  item: {
    height: 48,
    template: (item) => `<div class="item">${item.name}</div>`,
  },
  items: largeDataset,
  scrollbar: {
    enabled: true,
    autoHide: true,
    autoHideDelay: 1000,
  }
});
```

### Features

1. **Visual scrollbar track and thumb**
   - Track: Full height of viewport
   - Thumb: Size proportional to visible content ratio
   - Position: Maps to current scroll position

2. **Interactions**
   - Click on track → Jump to position (centers thumb at click)
   - Drag thumb → Scroll proportionally
   - Hover on viewport → Show scrollbar

3. **Styling**
   - Matches vlist visual style
   - Auto-hide after idle (configurable)
   - Full dark mode support
   - Custom colors via CSS variables

### CSS Variables

```css
:root {
  /* Custom Scrollbar (for compressed mode) */
  --vlist-scrollbar-width: 8px;
  --vlist-scrollbar-track-bg: transparent;
  --vlist-scrollbar-custom-thumb-bg: rgba(0, 0, 0, 0.3);
  --vlist-scrollbar-custom-thumb-hover-bg: rgba(0, 0, 0, 0.5);
  --vlist-scrollbar-custom-thumb-radius: 4px;
}

/* Dark mode automatically adjusts */
@media (prefers-color-scheme: dark) {
  :root {
    --vlist-scrollbar-custom-thumb-bg: rgba(255, 255, 255, 0.3);
    --vlist-scrollbar-custom-thumb-hover-bg: rgba(255, 255, 255, 0.5);
  }
}
```

### Implementation Files

- `src/core/scrollbar.ts` - Scrollbar component
- `src/styles/vlist.css` - CSS styles (scrollbar section)
- `test/scrollbar.test.ts` - Unit tests (23 tests)

## Files Reference

| File | Description |
|------|-------------|
| `src/core/compression.ts` | Compression calculations |
| `src/core/scroll.ts` | Scroll controller (native + compressed) |
| `src/core/render.ts` | Item rendering with compression support |
| `src/core/virtual.ts` | Viewport state management |
| `src/core/scrollbar.ts` | Custom scrollbar component |
| `src/vlist.ts` | Main entry point |
| `test/compression.test.ts` | Compression tests |
| `test/scrollbar.test.ts` | Scrollbar tests |

## Example: Million Items

```javascript
import { createVList, getCompressionInfo } from 'vlist';

const items = Array.from({ length: 1_000_000 }, (_, i) => ({
  id: i,
  name: `Item ${i + 1}`,
}));

console.log(getCompressionInfo(items.length, 48));
// "Compressed to 33.3% (1000000 items × 48px = 48.0M px → 16.0M px virtual)"

const list = createVList({
  container: '#app',
  item: {
    height: 48,
    template: (item) => `<div class="item">${item.name}</div>`,
  },
  items,
});

// Scroll to middle
list.scrollToIndex(500_000, 'center');

// Scroll to end
list.scrollToIndex(999_999, 'end');
```

---

*Last updated: January  *
*Status: Compression and custom scrollbar fully implemented*
