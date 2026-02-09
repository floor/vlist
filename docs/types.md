# Types Module

> Core TypeScript type definitions for vlist.

## Overview

The types module provides all the TypeScript interfaces and types used throughout vlist. It serves as the **contract** between all modules, defining:

- **Item Types**: Base item interface and constraints
- **Configuration Types**: VListConfig and related options
- **State Types**: ViewportState, SelectionState, etc.
- **Event Types**: Event payloads and handlers
- **Adapter Types**: Async data loading interface
- **Public API Types**: VList interface

## Module Structure

```
src/
└── types.ts  # All type definitions
```

## Key Concepts

### Generic Item Type

vlist uses generics to support custom item types:

```typescript
// Base constraint
interface VListItem {
  id: string | number;
  [key: string]: unknown;
}

// User-defined type
interface User extends VListItem {
  id: string;
  name: string;
  email: string;
}

// vlist infers types throughout
const list = createVList<User>({
  container: '#app',
  item: {
    height: 48,
    template: (item) => {
      // item is typed as User
      return `<div>${item.name}</div>`;
    },
  },
  items: users,
});
```

### Type Flow

```
VListConfig<T>  →  createVList<T>  →  VList<T>
                        ↓
              VListContext<T>  →  Handlers<T>, Methods<T>
                        ↓
              VListEvents<T>  →  Event callbacks
```

## Type Reference

### Item Types

#### `VListItem`

Base interface all items must implement.

```typescript
interface VListItem {
  /** Unique identifier for the item */
  id: string | number;
  
  /** Allow additional properties */
  [key: string]: unknown;
}
```

**Requirements**:
- Must have an `id` property
- `id` must be unique within the list
- Can have any additional properties

### Configuration Types

#### `ItemConfig`

Item-specific configuration for height and rendering.

```typescript
interface ItemConfig<T extends VListItem = VListItem> {
  /**
   * Item height in pixels.
   *
   * - `number` — Fixed height for all items (fast path, zero overhead)
   * - `(index: number) => number` — Variable height per item (prefix-sum based lookups)
   */
  height: number | ((index: number) => number);

  /** Template function to render each item */
  template: ItemTemplate<T>;
}
```

**Fixed height** (number): All items have the same height. This is the fastest path — internally uses simple multiplication for O(1) offset calculations with zero overhead.

**Variable height** (function): Each item can have a different height. The function receives the item index and returns the height in pixels. Internally, vlist builds a prefix-sum array for O(1) offset lookups and O(log n) binary search for scroll-position-to-index mapping.

```typescript
// Fixed height — all items 48px
item: { height: 48, template: myTemplate }

// Variable height — headers are taller
item: {
  height: (index: number) => items[index].type === 'header' ? 64 : 48,
  template: myTemplate,
}

// Variable height — based on content
item: {
  height: (index: number) => items[index].expanded ? 120 : 48,
  template: myTemplate,
}
```

> **Note:** The height function must be deterministic — given the same index, it must always return the same value. If heights change (e.g., an item expands), call `setItems()` to trigger a rebuild of the internal height cache.

#### `VListConfig`

Main configuration for createVList.

```typescript
interface VListConfig<T extends VListItem = VListItem> {
  /** Container element or selector */
  container: HTMLElement | string;
  
  /** Item configuration (height and template) */
  item: ItemConfig<T>;
  
  /** Static items array (optional if using adapter) */
  items?: T[];
  
  /** Async data adapter for infinite scroll */
  adapter?: VListAdapter<T>;
  
  /** Number of extra items to render outside viewport (default: 3) */
  overscan?: number;
  
  /** Selection configuration */
  selection?: SelectionConfig;
  
  /**
   * External scroll element for document/window scrolling.
   * When set, the list scrolls with this element instead of its own container.
   * Pass `window` for document scrolling (most common use case).
   *
   * In window mode:
   * - The list participates in the normal page flow (no inner scrollbar)
   * - The browser's native scrollbar controls scrolling
   * - Compression still works (content height is capped, scroll math is remapped)
   * - Custom scrollbar is disabled (the browser scrollbar is used)
   */
  scrollElement?: Window;
  
  /** Custom scrollbar configuration (for compressed mode) */
  scrollbar?: ScrollbarConfig;
  
  /** Loading behavior configuration */
  loading?: LoadingConfig;
  
  /** Idle timeout in milliseconds (default: 150) */
  idleTimeout?: number;
  
  /** Custom CSS class prefix (default: 'vlist') */
  classPrefix?: string;
}
```

#### `ItemTemplate`

Function to render an item.

```typescript
type ItemTemplate<T = VListItem> = (
  item: T,
  index: number,
  state: ItemState
) => string | HTMLElement;

interface ItemState {
  selected: boolean;
  focused: boolean;
}
```

**Usage**:
```typescript
// String template
item: {
  height: 48,
  template: (item, index, { selected, focused }) => `
    <div class="item ${selected ? 'selected' : ''}">
      <span>${index + 1}.</span>
      <span>${item.name}</span>
    </div>
  `,
}

// HTMLElement template
item: {
  height: 48,
  template: (item, index, state) => {
    const div = document.createElement('div');
    div.className = 'item';
    div.textContent = item.name;
    return div;
  },
}
```

**⚠️ Important**: The `state` object is **reused** for performance. Templates should read from it immediately and not store the reference. See [optimization.md](./optimization.md) for details.

#### `SelectionConfig`

Selection behavior configuration.

```typescript
interface SelectionConfig {
  /** Selection mode (default: 'none') */
  mode?: SelectionMode;
  
  /** Initially selected item IDs */
  initial?: Array<string | number>;
}

type SelectionMode = 'none' | 'single' | 'multiple';
```

#### `ScrollToOptions`

Options for `scrollToIndex` and `scrollToItem` smooth scrolling.

```typescript
interface ScrollToOptions {
  /** Alignment within the viewport (default: 'start') */
  align?: 'start' | 'center' | 'end';
  
  /** Scroll behavior (default: 'auto' = instant) */
  behavior?: 'auto' | 'smooth';
  
  /** Animation duration in ms (default: 300, only used with behavior: 'smooth') */
  duration?: number;
}
```

**Usage**:
```typescript
// Instant scroll (default)
list.scrollToIndex(100, 'center');

// Smooth scroll with options object
list.scrollToIndex(100, { align: 'center', behavior: 'smooth' });

// Custom duration
list.scrollToIndex(100, { behavior: 'smooth', duration: 500 });

// Cancel in-progress animation
list.cancelScroll();
```

#### `ScrollSnapshot`

Scroll position snapshot for save/restore. Returned by `getScrollSnapshot()` and accepted by `restoreScroll()`.

```typescript
interface ScrollSnapshot {
  /** First visible item index */
  index: number;
  
  /** Pixel offset within the first visible item (how far it's scrolled off) */
  offsetInItem: number;
  
  /** Selected item IDs (optional, only included when items are selected) */
  selectedIds?: Array<string | number>;
}
```

**Usage**:
```typescript
// Save scroll position
const snapshot = list.getScrollSnapshot();
// { index: 523, offsetInItem: 12, selectedIds: [3, 7, 42] }
sessionStorage.setItem('list-scroll', JSON.stringify(snapshot));

// Restore scroll position
const saved = JSON.parse(sessionStorage.getItem('list-scroll'));
list.restoreScroll(saved);
```

**Details**:
- Plain JSON object — serializable with `JSON.stringify()` for `sessionStorage`
- `index` is always the user-facing item index (not a layout or row index)
- `offsetInItem` is the number of pixels scrolled past the top of the first visible item
- `selectedIds` is only present when at least one item is selected
- Works with normal and compressed (1M+ items) modes
- Round-trips perfectly: `restoreScroll(getScrollSnapshot())` is a no-op

#### `ScrollbarConfig`

Custom scrollbar configuration.

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
```

#### `LoadingConfig`

Loading behavior configuration for velocity-based loading and preloading.

```typescript
interface LoadingConfig {
  /**
   * Velocity threshold above which data loading is skipped (px/ms)
   * When scrolling faster than this, loading is deferred until scroll stops.
   * Default: 25 px/ms
   */
  cancelThreshold?: number;

  /**
   * Velocity threshold for preloading (px/ms)
   * When scrolling faster than this but slower than cancelThreshold,
   * extra items are preloaded in the scroll direction.
   * Default: 2 px/ms
   */
  preloadThreshold?: number;

  /**
   * Number of extra items to preload ahead of scroll direction
   * Only applies when velocity is between preloadThreshold and cancelThreshold.
   * Default: 50 items
   */
  preloadAhead?: number;
}
```

**Usage Example**:
```typescript
const list = createVList({
  container: '#list',
  item: {
    height: 50,
    template: myTemplate,
  },
  adapter: myAdapter,
  loading: {
    cancelThreshold: 30,    // Skip loading above 30 px/ms
    preloadThreshold: 5,    // Start preloading above 5 px/ms
    preloadAhead: 100,      // Preload 100 items ahead
  },
});
```

#### `idleTimeout`

Time in milliseconds after the last scroll event before the list is considered "idle". When idle is detected, vlist loads any pending data ranges skipped during fast scrolling, re-enables CSS transitions (removes `.vlist--scrolling` class), and resets the velocity tracker.

```typescript
/**
 * Idle timeout in milliseconds.
 * Default: 150
 */
idleTimeout?: number;
```

**Usage Example**:
```typescript
const list = createVList({
  container: '#list',
  item: { height: 50, template: myTemplate },
  adapter: myAdapter,
  idleTimeout: 200, // ms (default: 150)
});
```

**Tuning tips:**
- **Mobile/touch devices:** Increase to 200–300ms (scroll events have larger gaps)
- **Desktop with smooth scroll:** Default 150ms works well
- **Aggressive loading:** Decrease to 100ms (loads data sooner after scroll stops)

### State Types

#### `ViewportState`

Current viewport state for virtual scrolling.

```typescript
interface ViewportState {
  /** Current scroll position */
  scrollTop: number;
  
  /** Container height */
  containerHeight: number;
  
  /** Total content height (may be capped for compression) */
  totalHeight: number;
  
  /** Actual total height without compression (totalItems × itemHeight) */
  actualHeight: number;
  
  /** Whether compression is active */
  isCompressed: boolean;
  
  /** Compression ratio (1 = no compression, <1 = compressed) */
  compressionRatio: number;
  
  /** Visible item range */
  visibleRange: Range;
  
  /** Render range (includes overscan) */
  renderRange: Range;
}
```

#### `SelectionState`

Current selection state.

```typescript
interface SelectionState {
  /** Currently selected item IDs */
  selected: Set<string | number>;
  
  /** Currently focused item index (-1 if none) */
  focusedIndex: number;
}
```

#### `Range`

Index range for items.

```typescript
interface Range {
  start: number;
  end: number;
}
```

### Adapter Types

#### `VListAdapter`

Interface for async data loading.

```typescript
interface VListAdapter<T extends VListItem = VListItem> {
  /** Fetch items for a range */
  read: (params: AdapterParams) => Promise<AdapterResponse<T>>;
}
```

#### `AdapterParams`

Parameters passed to adapter.read.

```typescript
interface AdapterParams {
  /** Starting offset */
  offset: number;
  
  /** Number of items to fetch */
  limit: number;
  
  /** Optional cursor for cursor-based pagination */
  cursor: string | undefined;
}
```

#### `AdapterResponse`

Response from adapter.read.

```typescript
interface AdapterResponse<T extends VListItem = VListItem> {
  /** Fetched items */
  items: T[];
  
  /** Total count (if known) */
  total?: number;
  
  /** Next cursor (for cursor-based pagination) */
  cursor?: string;
  
  /** Whether more items exist */
  hasMore?: boolean;
}
```

**Implementation Example**:
```typescript
const adapter: VListAdapter<User> = {
  read: async ({ offset, limit, cursor }) => {
    const url = cursor
      ? `/api/users?cursor=${cursor}&limit=${limit}`
      : `/api/users?offset=${offset}&limit=${limit}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    return {
      items: data.users,
      total: data.totalCount,
      cursor: data.nextCursor,
      hasMore: data.hasMore
    };
  }
};
```

### Event Types

#### `VListEvents`

Event types and their payloads.

```typescript
interface VListEvents<T extends VListItem = VListItem> extends EventMap {
  /** Item clicked */
  'item:click': { item: T; index: number; event: MouseEvent };
  
  /** Selection changed */
  'selection:change': { selected: Array<string | number>; items: T[] };
  
  /** Scroll position changed */
  'scroll': { scrollTop: number; direction: 'up' | 'down' };
  
  /** Visible range changed */
  'range:change': { range: Range };
  
  /** Data loading started */
  'load:start': { offset: number; limit: number };
  
  /** Data loading completed */
  'load:end': { items: T[]; total?: number };
  
  /** Error occurred */
  'error': { error: Error; context: string };
  
  /** Container resized */
  'resize': { height: number; width: number };
}

type EventMap = Record<string, unknown>;
```

#### `EventHandler`

Event handler function type.

```typescript
type EventHandler<T> = (payload: T) => void;
```

#### `Unsubscribe`

Unsubscribe function returned by event subscription.

```typescript
type Unsubscribe = () => void;
```

### Public API Types

#### `VList`

Public API returned by createVList.

```typescript
interface VList<T extends VListItem = VListItem> {
  /** The root DOM element */
  readonly element: HTMLElement;
  
  /** Current items */
  readonly items: readonly T[];
  
  /** Total item count */
  readonly total: number;
  
  // Data methods
  setItems: (items: T[]) => void;
  appendItems: (items: T[]) => void;
  prependItems: (items: T[]) => void;
  updateItem: (id: string | number, updates: Partial<T>) => void;
  removeItem: (id: string | number) => void;
  reload: () => Promise<void>;
  
  // Scroll methods
  scrollToIndex: (
    index: number,
    alignOrOptions?: 'start' | 'center' | 'end' | ScrollToOptions,
  ) => void;
  scrollToItem: (
    id: string | number,
    alignOrOptions?: 'start' | 'center' | 'end' | ScrollToOptions,
  ) => void;
  cancelScroll: () => void;
  getScrollPosition: () => number;
  
  // Snapshot methods (scroll save/restore)
  getScrollSnapshot: () => ScrollSnapshot;
  restoreScroll: (snapshot: ScrollSnapshot) => void;
  
  // Selection methods
  select: (...ids: Array<string | number>) => void;
  deselect: (...ids: Array<string | number>) => void;
  toggleSelect: (id: string | number) => void;
  selectAll: () => void;
  clearSelection: () => void;
  getSelected: () => Array<string | number>;
  getSelectedItems: () => T[];
  
  // Events
  on: <K extends keyof VListEvents<T>>(
    event: K,
    handler: EventHandler<VListEvents<T>[K]>
  ) => Unsubscribe;
  
  off: <K extends keyof VListEvents<T>>(
    event: K,
    handler: EventHandler<VListEvents<T>[K]>
  ) => void;
  
  // Lifecycle
  destroy: () => void;
}
```

### Internal Types

#### `InternalState`

Internal state (not exposed publicly).

```typescript
interface InternalState<T extends VListItem = VListItem> {
  items: T[];
  total: number;
  viewport: ViewportState;
  selection: SelectionState;
  isLoading: boolean;
  cursor?: string;
  hasMore: boolean;
}
```

#### `RenderedItem`

Tracks rendered DOM elements.

```typescript
interface RenderedItem {
  index: number;
  element: HTMLElement;
}
```

## Usage Examples

### Custom Item Type

```typescript
import { createVList, VListItem, VList } from 'vlist';

// Define custom item type
interface Product extends VListItem {
  id: number;
  name: string;
  price: number;
  inStock: boolean;
}

// Create typed list
const productList: VList<Product> = createVList<Product>({
  container: '#products',
  item: {
    height: 60,
    template: (product, index, { selected }) => `
      <div class="product ${selected ? 'selected' : ''}">
        <strong>${product.name}</strong>
        <span class="price">$${product.price.toFixed(2)}</span>
        <span class="stock">${product.inStock ? 'In Stock' : 'Out of Stock'}</span>
      </div>
    `,
  },
  items: products,
});

// Methods are typed
const selectedProducts: Product[] = productList.getSelectedItems();
productList.updateItem(1, { price: 29.99 });  // Type-checked
```

### Typed Event Handlers

```typescript
import { VListEvents, EventHandler } from 'vlist';

interface User extends VListItem {
  id: string;
  name: string;
  email: string;
}

// Typed event handler
const handleClick: EventHandler<VListEvents<User>['item:click']> = ({ item, index, event }) => {
  console.log(`Clicked ${item.name} at index ${index}`);
  // item is typed as User
  // event is typed as MouseEvent
};

list.on('item:click', handleClick);
```

### Adapter Type Safety

```typescript
import { VListAdapter, AdapterParams, AdapterResponse } from 'vlist';

interface Article extends VListItem {
  id: number;
  title: string;
  author: string;
  publishedAt: Date;
}

// Fully typed adapter
const articleAdapter: VListAdapter<Article> = {
  read: async (params: AdapterParams): Promise<AdapterResponse<Article>> => {
    const response = await fetch(`/api/articles?offset=${params.offset}&limit=${params.limit}`);
    const data = await response.json();
    
    return {
      items: data.articles.map((a: any) => ({
        ...a,
        publishedAt: new Date(a.publishedAt)
      })),
      total: data.total,
      hasMore: data.hasMore
    };
  }
};
```

## Type Guards

### Checking Item Types

```typescript
// Check if item is a placeholder
function isPlaceholder(item: VListItem): boolean {
  return '_isPlaceholder' in item && item._isPlaceholder === true;
}

// In template
item: {
  height: 48,
  template: (item, index, state) => {
    if (isPlaceholder(item)) {
      return `<div class="loading">${item.name}</div>`;
    }
    return `<div class="item">${item.name}</div>`;
  },
}
```

### Type Narrowing

```typescript
// Narrow based on selection mode
function handleSelection<T extends VListItem>(
  list: VList<T>,
  config: SelectionConfig
): void {
  if (config.mode === 'multiple') {
    list.selectAll();  // Safe - only called in multiple mode
  }
}
```

## Best Practices

### Do

```typescript
// ✅ Define specific item types
interface User extends VListItem {
  id: string;
  name: string;
  email: string;
}

// ✅ Use generics with createVList
const list = createVList<User>({ ... });

// ✅ Type event handlers
list.on('item:click', ({ item }) => {
  // item is User, not VListItem
});
```

### Don't

```typescript
// ❌ Use 'any' for item type
const list = createVList<any>({ ... });

// ❌ Ignore type errors
// @ts-ignore
list.updateItem('id', { unknownProperty: 'value' });

// ❌ Cast unnecessarily
const item = list.items[0] as any;
```

## Related Modules

- [vlist.md](./vlist.md) - Main documentation with configuration examples
- [context.md](./context.md) - Internal context types
- [render.md](./render.md) - CompressionState, DOMStructure types
- [data.md](./data.md) - DataState, SparseStorage types
- [selection.md](./selection.md) - Selection state management
- [events.md](./events.md) - Event system types

---

*The types module provides full TypeScript support for type-safe vlist usage.*