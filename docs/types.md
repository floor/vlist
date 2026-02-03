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
  items: users,
  template: (item) => {
    // item is typed as User
    return `<div>${item.name}</div>`;
  }
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

#### `VListConfig`

Main configuration for createVList.

```typescript
interface VListConfig<T extends VListItem = VListItem> {
  /** Container element or selector */
  container: HTMLElement | string;
  
  /** Fixed item height in pixels (required for virtual scrolling) */
  itemHeight: number;
  
  /** Template function to render each item */
  template: ItemTemplate<T>;
  
  /** Static items array (optional if using adapter) */
  items?: T[];
  
  /** Async data adapter for infinite scroll */
  adapter?: VListAdapter<T>;
  
  /** Number of extra items to render outside viewport (default: 3) */
  overscan?: number;
  
  /** Selection configuration */
  selection?: SelectionConfig;
  
  /** Custom scrollbar configuration (for compressed mode) */
  scrollbar?: ScrollbarConfig;
  
  /** Loading behavior configuration */
  loading?: LoadingConfig;
  
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
template: (item, index, { selected, focused }) => `
  <div class="item ${selected ? 'selected' : ''}">
    <span>${index + 1}.</span>
    <span>${item.name}</span>
  </div>
`

// HTMLElement template
template: (item, index, state) => {
  const div = document.createElement('div');
  div.className = 'item';
  div.textContent = item.name;
  return div;
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
  itemHeight: 50,
  template: myTemplate,
  adapter: myAdapter,
  loading: {
    cancelThreshold: 30,    // Skip loading above 30 px/ms
    preloadThreshold: 5,    // Start preloading above 5 px/ms
    preloadAhead: 100,      // Preload 100 items ahead
  },
});
```

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
  scrollToIndex: (index: number, align?: 'start' | 'center' | 'end') => void;
  scrollToItem: (id: string | number, align?: 'start' | 'center' | 'end') => void;
  getScrollPosition: () => number;
  
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
  itemHeight: 60,
  items: products,
  template: (product, index, { selected }) => `
    <div class="product ${selected ? 'selected' : ''}">
      <strong>${product.name}</strong>
      <span class="price">$${product.price.toFixed(2)}</span>
      <span class="stock">${product.inStock ? 'In Stock' : 'Out of Stock'}</span>
    </div>
  `
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
template: (item, index, state) => {
  if (isPlaceholder(item)) {
    return `<div class="loading">${item.name}</div>`;
  }
  return `<div class="item">${item.name}</div>`;
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