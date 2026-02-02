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
- [x] Comprehensive tests (261 passing)

### 🚧 TODO: Custom Scrollbar

The compressed mode uses `overflow: hidden`, which hides the native scrollbar. A custom scrollbar is needed for:
- Visual feedback of scroll position
- Click-to-scroll functionality
- Drag-to-scroll functionality

## Next Steps: Custom Scrollbar Implementation

### Reference: mtrl-addons Scrollbar

See `mtrl-addons/src/core/viewport/features/scrollbar.ts` for reference implementation.

### Requirements

1. **Visual scrollbar track and thumb**
   - Track: Full height of viewport
   - Thumb: Size proportional to visible content ratio
   - Position: Maps to current scroll position

2. **Interactions**
   - Click on track → Jump to position
   - Drag thumb → Scroll proportionally
   - Mouse wheel on track → Scroll

3. **Styling**
   - Match vlist visual style
   - Auto-hide after idle (optional)
   - Custom colors via CSS variables

### Proposed API

```typescript
interface ScrollbarConfig {
  enabled?: boolean;
  autoHide?: boolean;
  autoHideDelay?: number;
  width?: number;
  minThumbSize?: number;
}

// Usage
const list = createVList({
  container: '#app',
  itemHeight: 48,
  items: largeDataset,
  scrollbar: {
    enabled: true,
    autoHide: true,
    autoHideDelay: 1000,
  }
});
```

### Implementation Plan

1. **Create `src/core/scrollbar.ts`**
   - DOM structure (track, thumb)
   - Position calculations
   - Event handlers (click, drag)

2. **Integrate with ScrollController**
   - Update thumb position on scroll
   - Emit scroll events on interaction

3. **Add CSS styles**
   - `src/styles/scrollbar.scss`
   - CSS variables for customization

4. **Update vlist.ts**
   - Optional scrollbar config
   - Auto-enable for compressed lists

### CSS Variables (Proposed)

```css
:root {
  --vlist-scrollbar-width: 8px;
  --vlist-scrollbar-track-bg: rgba(0, 0, 0, 0.1);
  --vlist-scrollbar-thumb-bg: rgba(0, 0, 0, 0.3);
  --vlist-scrollbar-thumb-hover-bg: rgba(0, 0, 0, 0.5);
  --vlist-scrollbar-thumb-radius: 4px;
}
```

## Files Reference

| File | Description |
|------|-------------|
| `src/core/compression.ts` | Compression calculations |
| `src/core/scroll.ts` | Scroll controller (native + compressed) |
| `src/core/render.ts` | Item rendering with compression support |
| `src/core/virtual.ts` | Viewport state management |
| `src/vlist.ts` | Main entry point |
| `test/compression.test.ts` | Compression tests |

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
  itemHeight: 48,
  items,
  template: (item) => `<div class="item">${item.name}</div>`,
});

// Scroll to middle
list.scrollToIndex(500_000, 'center');

// Scroll to end
list.scrollToIndex(999_999, 'end');
```

---

*Last updated: January 2025*
*Status: Compression working, scrollbar pending*