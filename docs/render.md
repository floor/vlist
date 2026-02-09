# Render Module

> DOM rendering, virtualization, and compression for vlist.

## Overview

The render module is responsible for all DOM-related operations in vlist. It handles:

- **Height Cache**: Efficient height management for fixed and variable item heights
- **DOM Structure**: Creating and managing the vlist DOM hierarchy
- **Element Rendering**: Efficiently rendering items using an element pool
- **Virtual Scrolling**: Calculating visible ranges and viewport state
- **Compression**: Handling large lists (1M+ items) that exceed browser limits

## Module Structure

```
src/render/
├── index.ts        # Module exports
├── heights.ts      # Height cache for fixed and variable item heights
├── renderer.ts     # DOM rendering with element pooling
├── virtual.ts      # Virtual scrolling calculations
└── compression.ts  # Large list compression logic
```

## Key Concepts

### Height Cache (`heights.ts`)

The `HeightCache` abstraction enables both fixed and variable item heights throughout the rendering pipeline. All virtual scrolling and compression functions accept a `HeightCache` instead of a raw `itemHeight: number`.

**Two implementations:**

| Implementation | When | Offset Lookup | Index Search | Overhead |
|----------------|------|---------------|--------------|----------|
| **Fixed** | `height: number` | O(1) multiplication | O(1) division | Zero — identical to pre-variable-height code |
| **Variable** | `height: (index) => number` | O(1) prefix-sum lookup | O(log n) binary search | Prefix-sum array rebuilt on data changes |

```typescript
import { createHeightCache, type HeightCache } from 'vlist';

// Fixed — zero overhead fast path
const fixed = createHeightCache(48, totalItems);
fixed.getOffset(10);      // 480  (10 × 48)
fixed.indexAtOffset(480);  // 10   (480 / 48)
fixed.getTotalHeight();    // totalItems × 48

// Variable — prefix-sum based
const variable = createHeightCache(
  (index) => index % 2 === 0 ? 40 : 80,
  totalItems
);
variable.getOffset(2);      // 120  (40 + 80)
variable.indexAtOffset(100); // 1   (binary search)
variable.getTotalHeight();   // sum of all heights
```

**HeightCache interface:**

```typescript
interface HeightCache {
  getOffset(index: number): number;      // Y position of item
  getHeight(index: number): number;      // Height of specific item
  indexAtOffset(offset: number): number;  // Item at scroll position
  getTotalHeight(): number;              // Total content height
  getTotal(): number;                    // Current item count
  rebuild(totalItems: number): void;     // Rebuild after data changes
  isVariable(): boolean;                 // Fixed vs variable
}
```

**Helper functions** (used internally by compression):

- `countVisibleItems(cache, startIndex, containerHeight, totalItems)` — How many items fit in a viewport
- `countItemsFittingFromBottom(cache, containerHeight, totalItems)` — How many items fit from list end
- `getOffsetForVirtualIndex(cache, virtualIndex, totalItems)` — Pixel offset for fractional index (compressed mode)


### DOM Structure

vlist creates a specific DOM hierarchy for virtual scrolling:

```html
<div class="vlist" role="listbox" tabindex="0">
  <div class="vlist-viewport" style="overflow: auto; height: 100%;">
    <div class="vlist-content" style="position: relative; height: {totalHeight}px;">
      <div class="vlist-items" style="position: relative;">
        <!-- Rendered items appear here -->
        <div class="vlist-item" data-index="0" style="transform: translateY(0px);">...</div>
        <div class="vlist-item" data-index="1" style="transform: translateY(48px);">...</div>
      </div>
    </div>
  </div>
</div>
```

### Element Pooling

The renderer uses an element pool to recycle DOM elements, reducing garbage collection and improving performance:

```typescript
interface ElementPool {
  acquire: () => HTMLElement;   // Get element from pool (or create new)
  release: (element: HTMLElement) => void;  // Return element to pool
  clear: () => void;            // Clear the pool
  stats: () => { poolSize: number; created: number; reused: number };
}
```

When acquiring elements, the pool also sets the static `role="option"` attribute once per element lifetime, avoiding repeated `setAttribute` calls during rendering.

### DocumentFragment Batching

When rendering new items, the renderer collects them in a `DocumentFragment` and appends them in a single DOM operation. This reduces layout thrashing during fast scrolling:

```typescript
// Collect new elements
const fragment = document.createDocumentFragment();
const newElements: Array<{ index: number; element: HTMLElement }> = [];

for (let i = range.start; i <= range.end; i++) {
  // ... render logic ...
  if (!existing) {
    fragment.appendChild(element);
    newElements.push({ index: i, element });
  }
}

// Single DOM operation
if (newElements.length > 0) {
  itemsContainer.appendChild(fragment);
}
```

### Optimized Attribute Setting

The renderer uses `dataset` and direct property assignment instead of `setAttribute` for better performance:

```typescript
// Fast: direct property assignment
element.dataset.index = String(index);
element.dataset.id = String(item.id);
element.ariaSelected = String(isSelected);

// Slower: setAttribute (avoided)
// element.setAttribute("data-index", String(index));
```

### CSS Containment

The renderer applies CSS containment for optimized compositing:

- **Items container**: `contain: layout style` — tells the browser that layout and style changes inside the container don't affect elements outside it
- **Individual items**: `contain: content` + `will-change: transform` — enables the browser to treat each item as an independent compositing layer, improving scroll performance

These are applied via the `.vlist-items` and `.vlist-item` CSS classes respectively.

### CSS-Only Static Positioning

Item static styles (`position: absolute; top: 0; left: 0; right: 0`) are defined purely in the `.vlist-item` CSS class rather than set via JavaScript `style.cssText`. Only the dynamic `height` property is set via JS. This eliminates per-element CSS string parsing during rendering.

### Re-exported Range Functions

`calculateVisibleRange` and `calculateRenderRange` in `virtual.ts` are direct re-exports from `compression.ts` (`calculateCompressedVisibleRange as calculateVisibleRange`), eliminating ~40 lines of pass-through wrapper code and JSDoc duplication.

### Reusable ItemState

The `ItemState` object passed to templates is reused to reduce GC pressure:

```typescript
const reusableItemState: ItemState = { selected: false, focused: false };

const getItemState = (isSelected: boolean, isFocused: boolean): ItemState => {
  reusableItemState.selected = isSelected;
  reusableItemState.focused = isFocused;
  return reusableItemState;
};
```

**⚠️ Important**: Templates should read from the state object immediately and not store the reference, as it will be mutated on the next render call.

### Virtual Scrolling

Only items within the visible range (plus overscan buffer) are rendered:

```
Total: 10,000 items
Visible: items 150-165 (16 items)
Overscan: 3
Rendered: items 147-168 (22 items)
```

### Compression

When a list exceeds browser height limits (~16.7M pixels), compression automatically activates. See [compression.md](./compression.md) for details.

## API Reference

### DOM Structure

#### `createDOMStructure`

Creates the vlist DOM hierarchy.

```typescript
function createDOMStructure(
  container: HTMLElement,
  classPrefix: string
): DOMStructure;

interface DOMStructure {
  root: HTMLElement;      // Root vlist element
  viewport: HTMLElement;  // Scrollable container
  content: HTMLElement;   // Height-setting element
  items: HTMLElement;     // Items container
}
```

#### `resolveContainer`

Resolves a container from selector or element.

```typescript
function resolveContainer(container: HTMLElement | string): HTMLElement;

// Usage
const element = resolveContainer('#my-list');
const element = resolveContainer(document.getElementById('my-list'));
```

#### `getContainerDimensions`

Gets viewport dimensions.

```typescript
function getContainerDimensions(viewport: HTMLElement): {
  width: number;
  height: number;
};
```

#### `updateContentHeight`

Updates the content height for virtual scrolling.

```typescript
function updateContentHeight(content: HTMLElement, totalHeight: number): void;
```

### Renderer

#### `createRenderer`

Creates a renderer instance for managing DOM elements.

```typescript
function createRenderer<T extends VListItem>(
  itemsContainer: HTMLElement,
  template: ItemTemplate<T>,
  itemHeight: number,
  classPrefix: string,
  totalItemsGetter?: () => number
): Renderer<T>;

interface Renderer<T extends VListItem> {
  render: (
    items: T[],
    range: Range,
    selectedIds: Set<string | number>,
    focusedIndex: number,
    compressionCtx?: CompressionContext
  ) => void;
  
  updatePositions: (compressionCtx: CompressionContext) => void;
  updateItem: (index: number, item: T, isSelected: boolean, isFocused: boolean) => void;
  getElement: (index: number) => HTMLElement | undefined;
  clear: () => void;
  destroy: () => void;
}
```

#### `CompressionContext`

Context for positioning items in compressed mode.

```typescript
interface CompressionContext {
  scrollTop: number;
  totalItems: number;
  containerHeight: number;
  rangeStart: number;
}
```

### Virtual Scrolling

#### `createViewportState`

Creates initial viewport state.

```typescript
function createViewportState(
  containerHeight: number,
  itemHeight: number,
  totalItems: number,
  overscan: number
): ViewportState;

interface ViewportState {
  scrollTop: number;
  containerHeight: number;
  totalHeight: number;        // Virtual height (may be capped)
  actualHeight: number;       // True height without compression
  isCompressed: boolean;
  compressionRatio: number;
  visibleRange: Range;
  renderRange: Range;
}
```

#### `updateViewportState`

Updates viewport state after scroll.

```typescript
function updateViewportState(
  state: ViewportState,
  scrollTop: number,
  itemHeight: number,
  totalItems: number,
  overscan: number
): ViewportState;
```

#### `updateViewportSize`

Updates viewport state when container resizes.

```typescript
function updateViewportSize(
  state: ViewportState,
  containerHeight: number,
  itemHeight: number,
  totalItems: number,
  overscan: number
): ViewportState;
```

#### `updateViewportItems`

Updates viewport state when total items changes.

```typescript
function updateViewportItems(
  state: ViewportState,
  itemHeight: number,
  totalItems: number,
  overscan: number
): ViewportState;
```

### Range Calculations

#### `calculateVisibleRange`

Calculates the visible item range based on scroll position.

```typescript
function calculateVisibleRange(
  scrollTop: number,
  containerHeight: number,
  itemHeight: number,
  totalItems: number
): Range;
```

#### `calculateRenderRange`

Calculates the render range (visible + overscan).

```typescript
function calculateRenderRange(
  visibleRange: Range,
  overscan: number,
  totalItems: number
): Range;
```

#### `calculateScrollToIndex`

Calculates scroll position to bring an index into view.

```typescript
function calculateScrollToIndex(
  index: number,
  itemHeight: number,
  containerHeight: number,
  totalItems: number,
  align?: 'start' | 'center' | 'end'
): number;
```

### Range Utilities

```typescript
// Check if two ranges are equal
function rangesEqual(a: Range, b: Range): boolean;

// Check if index is within range
function isInRange(index: number, range: Range): boolean;

// Get count of items in range
function getRangeCount(range: Range): number;

// Calculate which indices need to be added/removed
function diffRanges(oldRange: Range, newRange: Range): {
  add: number[];
  remove: number[];
};

// Clamp scroll position to valid range
function clampScrollPosition(
  scrollTop: number,
  totalHeight: number,
  containerHeight: number
): number;

// Determine scroll direction
function getScrollDirection(
  currentScrollTop: number,
  previousScrollTop: number
): 'up' | 'down';
```

### Compression

#### `getCompressionState`

Calculate compression state for a list.

```typescript
function getCompressionState(
  totalItems: number,
  itemHeight: number
): CompressionState;

interface CompressionState {
  isCompressed: boolean;
  actualHeight: number;   // totalItems × itemHeight
  virtualHeight: number;  // Capped at MAX_VIRTUAL_HEIGHT
  ratio: number;          // virtualHeight / actualHeight
}
```

#### Compression Utilities

```typescript
// Maximum virtual height (16M pixels)
const MAX_VIRTUAL_HEIGHT = 16_000_000;

// Check if compression is needed
function needsCompression(totalItems: number, itemHeight: number): boolean;

// Get max items without compression
function getMaxItemsWithoutCompression(itemHeight: number): number;

// Human-readable compression info
function getCompressionInfo(totalItems: number, itemHeight: number): string;
```

#### Compressed Range Calculations

```typescript
// Calculate visible range with compression
function calculateCompressedVisibleRange(
  scrollTop: number,
  containerHeight: number,
  itemHeight: number,
  totalItems: number,
  compression: CompressionState
): Range;

// Calculate render range with compression
function calculateCompressedRenderRange(
  visibleRange: Range,
  overscan: number,
  totalItems: number
): Range;

// Calculate item position with compression
function calculateCompressedItemPosition(
  index: number,
  scrollTop: number,
  itemHeight: number,
  totalItems: number,
  containerHeight: number,
  compression: CompressionState
): number;

// Calculate scroll position for an index with compression
function calculateCompressedScrollToIndex(
  index: number,
  itemHeight: number,
  containerHeight: number,
  totalItems: number,
  compression: CompressionState,
  align?: 'start' | 'center' | 'end'
): number;

// Get approximate item index at scroll position
function calculateIndexFromScrollPosition(
  scrollTop: number,
  itemHeight: number,
  totalItems: number,
  compression: CompressionState
): number;
```

## Usage Examples

### Basic Rendering

```typescript
import { createRenderer, createDOMStructure } from './render';

// Create DOM structure
const dom = createDOMStructure(container, 'vlist');

// Create renderer
const renderer = createRenderer(
  dom.items,
  (item, index, state) => `<div>${item.name}</div>`,
  48,
  'vlist'
);

// Render items
renderer.render(
  items,
  { start: 0, end: 20 },
  new Set(),  // selected IDs
  -1          // focused index
);
```

### Viewport State Management

```typescript
import { createViewportState, updateViewportState } from './render';

// Create initial state
let viewport = createViewportState(
  containerHeight,  // 600
  itemHeight,       // 48
  totalItems,       // 1000
  overscan          // 3
);

// Update on scroll
viewport = updateViewportState(
  viewport,
  scrollTop,    // 240
  itemHeight,   // 48
  totalItems,   // 1000
  overscan      // 3
);

console.log(viewport.visibleRange); // { start: 5, end: 17 }
console.log(viewport.renderRange);  // { start: 2, end: 20 }
```

### Compression Detection

```typescript
import { getCompressionState, getCompressionInfo } from './render';

const compression = getCompressionState(1_000_000, 48);

console.log(compression.isCompressed);  // true
console.log(compression.ratio);         // 0.333...
console.log(getCompressionInfo(1_000_000, 48));
// "Compressed to 33.3% (1000000 items × 48px = 48.0M px → 16.0M px virtual)"
```

## Performance Considerations

### Element Pooling

- Elements are reused instead of created/destroyed
- Reduces DOM operations and garbage collection
- Pool size is capped to prevent memory issues
- `role="option"` is set once per element lifetime in the pool, not per render
- Pool release uses `textContent = ""` instead of `innerHTML = ""` (avoids HTML parser invocation)

### Viewport State Mutation

For performance on the scroll hot path, viewport state is **mutated in place** rather than creating new objects:

```typescript
// updateViewportState mutates state directly
state.scrollTop = scrollTop;
state.visibleRange = visibleRange;
state.renderRange = renderRange;
```

### In-Place Range Mutation

`calculateCompressedVisibleRange` and `calculateCompressedRenderRange` accept an optional `out` parameter to mutate existing range objects, avoiding allocation of new `Range` objects on every scroll frame:

```typescript
// Zero-allocation: mutate existing range
calculateCompressedVisibleRange(scrollTop, containerHeight, itemHeight, totalItems, compression, existingRange);
```

### CSS Optimization

- **CSS containment**: `contain: layout style` on items container, `contain: content` + `will-change: transform` on items for optimized compositing
- Static positioning (`position: absolute; top: 0; left: 0; right: 0`) defined in `.vlist-item` CSS class — only dynamic `height` set via JS
- Only `transform` is updated on scroll (GPU-accelerated)
- Class toggles use `classList.toggle()` for efficiency
- **Scroll transition suppression**: `.vlist--scrolling` class is toggled during active scroll to disable CSS transitions, re-enabled on idle

## Related Modules

- [compression.md](./compression.md) - Detailed compression documentation
- [scroll.md](./scroll.md) - Scroll controller
- [context.md](./context.md) - Context that holds renderer reference
- [handlers.md](./handlers.md) - Scroll handler triggers rendering

---

*This module is the core of vlist's virtual scrolling implementation.*