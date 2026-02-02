# Render Module

> DOM rendering, virtualization, and compression for vlist.

## Overview

The render module is responsible for all DOM-related operations in vlist. It handles:

- **DOM Structure**: Creating and managing the vlist DOM hierarchy
- **Element Rendering**: Efficiently rendering items using an element pool
- **Virtual Scrolling**: Calculating visible ranges and viewport state
- **Compression**: Handling large lists (1M+ items) that exceed browser limits

## Module Structure

```
src/render/
├── index.ts        # Module exports
├── renderer.ts     # DOM rendering with element pooling
├── virtual.ts      # Virtual scrolling calculations
└── compression.ts  # Large list compression logic
```

## Key Concepts

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

### Viewport State Mutation

For performance on the scroll hot path, viewport state is **mutated in place** rather than creating new objects:

```typescript
// updateViewportState mutates state directly
state.scrollTop = scrollTop;
state.visibleRange = visibleRange;
state.renderRange = renderRange;
```

### CSS Optimization

- Static styles (position, height) applied once per element
- Only `transform` is updated on scroll (GPU-accelerated)
- Class toggles use `classList.toggle()` for efficiency

## Related Modules

- [compression.md](./compression.md) - Detailed compression documentation
- [scroll.md](./scroll.md) - Scroll controller
- [context.md](./context.md) - Context that holds renderer reference
- [handlers.md](./handlers.md) - Scroll handler triggers rendering

---

*This module is the core of vlist's virtual scrolling implementation.*