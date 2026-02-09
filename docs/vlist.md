# vlist Documentation

> Lightweight, high-performance virtual list with zero dependencies

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Events](#events)
- [Selection](#selection)
- [Infinite Scroll](#infinite-scroll)
- [Compression (1M+ Items)](#compression-1m-items)
- [Styling](#styling)
- [Performance](#performance)
- [TypeScript](#typescript)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

---

## Overview

vlist is a high-performance virtual list library designed to handle massive datasets (1M+ items) efficiently. It only renders visible items plus a small buffer, dramatically reducing DOM nodes and memory usage.

### Key Features

- **Zero Dependencies** - Pure TypeScript, no external libraries
- **Blazing Fast** - Only renders visible items with element pooling
- **Variable Heights** - Fixed or per-item height via function, with prefix-sum based lookups
- **Infinite Scroll** - Built-in async adapter support for lazy loading
- **Selection** - Single and multiple selection modes with keyboard navigation
- **Sparse Storage** - Chunk-based memory management for huge datasets
- **Accessible** - Full keyboard navigation and ARIA support
- **TypeScript First** - Complete type definitions included

### Browser Limitations & Compression

> ℹ️ **Good news:** vlist now supports **compression** for lists exceeding browser limits!

Browsers have a maximum element height limit of approximately **16 million pixels**. Without compression, this limits lists to ~350,000 items at 48px height.

**vlist automatically enables compression** when your list exceeds this limit, allowing you to display **1 million+ items** smoothly.

| Scenario | Items | Compression |
|----------|-------|-------------|
| Small list | < 350K | Native scrolling |
| Large list | 350K - 1M+ | Automatic compression |

**How compression works:**
- Automatically detects when list exceeds browser limits
- Switches from native scroll to manual wheel-based scrolling
- Items positioned relative to viewport for smooth scrolling
- No configuration needed - it just works!

See [Compression (1M+ Items)](#compression-1m-items) for details.

### How It Works

```
┌─────────────────────────────────────┐
│  Virtual List Container             │
│  ┌───────────────────────────────┐  │
│  │ Viewport (visible area)       │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │ Item 50                 │  │  │  ← Only these items
│  │  │ Item 51                 │  │  │    exist in the DOM
│  │  │ Item 52                 │  │  │
│  │  │ Item 53                 │  │  │
│  │  │ Item 54                 │  │  │
│  │  └─────────────────────────┘  │  │
│  │         ▼ scroll ▼            │  │
│  └───────────────────────────────┘  │
│                                     │
│  Items 0-49: Not rendered           │
│  Items 55-9999: Not rendered        │
└─────────────────────────────────────┘
```

---

## Installation

```bash
# npm
npm install vlist

# yarn
yarn add vlist

# pnpm
pnpm add vlist

# bun
bun add vlist
```

---

## Quick Start

### Basic Usage

```typescript
import { createVList } from 'vlist';
import 'vlist/styles';

const list = createVList({
  container: '#my-list',
  item: {
    height: 48,
    template: (item) => `
      <div class="item">
        ${item.name}
      </div>
    `,
  },
  items: [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
    { id: 3, name: 'Charlie' },
    // ... thousands more items
  ],
});
```

### HTML Structure

```html
<div id="my-list" style="height: 400px;"></div>
```

The container must have a defined height for virtual scrolling to work.

---

## Configuration

### VListConfig

```typescript
interface VListConfig<T extends VListItem> {
  // Required
  container: HTMLElement | string;  // Container element or CSS selector
  item: {
    height: number;                 // Fixed height of each item in pixels
    template: ItemTemplate<T>;      // Function to render each item
  };

  // Optional
  items?: T[];                      // Static items array
  adapter?: VListAdapter<T>;        // Async data adapter for infinite scroll
  overscan?: number;                // Extra items to render (default: 3)
  selection?: SelectionConfig;      // Selection configuration
  scrollElement?: Window;           // External scroll element for document scrolling
  scrollbar?: ScrollbarConfig;      // Custom scrollbar configuration
  loading?: LoadingConfig;          // Loading behavior configuration
  idleTimeout?: number;             // Scroll idle detection in ms (default: 150)
  classPrefix?: string;             // CSS class prefix (default: 'vlist')
}
```

### Item Interface

All items must have a unique `id`:

```typescript
interface VListItem {
  id: string | number;
  [key: string]: unknown;
}
```

### Template Function

The template function receives the item, its index, and state:

```typescript
type ItemTemplate<T> = (
  item: T,
  index: number,
  state: ItemState
) => string | HTMLElement;

interface ItemState {
  selected: boolean;
  focused: boolean;
}
```

**Example with state:**

```typescript
item: {
  height: 48,
  template: (item, index, { selected, focused }) => `
    <div class="item ${selected ? 'selected' : ''} ${focused ? 'focused' : ''}">
      <input type="checkbox" ${selected ? 'checked' : ''} />
      <span>${item.name}</span>
    </div>
  `,
}
```

**⚠️ Important**: The `state` object is **reused** for performance. Templates should read from it immediately and not store the reference.

### LoadingConfig

Configure velocity-based loading and preloading behavior:

```typescript
interface LoadingConfig {
  cancelThreshold?: number;   // Skip loading above this velocity (default: 25 px/ms)
  preloadThreshold?: number;  // Start preloading above this velocity (default: 2 px/ms)
  preloadAhead?: number;      // Items to preload ahead (default: 50)
}
```

**Example:**

```typescript
const list = createVList({
  // ... other config
  loading: {
    cancelThreshold: 30,    // Skip loading when scrolling very fast
    preloadThreshold: 5,    // Start preloading at medium scroll speed
    preloadAhead: 100,      // Preload 100 items in scroll direction
  },
});
```

**Velocity-based loading strategy:**

| Scroll Speed | Behavior |
|--------------|----------|
| Slow (< `preloadThreshold`) | Load visible range only |
| Medium (`preloadThreshold` to `cancelThreshold`) | Preload items ahead |
| Fast (> `cancelThreshold`) | Skip loading, defer to idle |

---

## API Reference

### Methods

#### Data Management

```typescript
// Replace all items
list.setItems(items: T[]): void

// Add items to the end
list.appendItems(items: T[]): void

// Add items to the beginning
list.prependItems(items: T[]): void

// Update a single item by ID
list.updateItem(id: string | number, updates: Partial<T>): void

// Remove an item by ID
list.removeItem(id: string | number): void

// Reload data (clears and re-fetches if using adapter)
list.reload(): Promise<void>
```

#### Scrolling

```typescript
// Scroll to a specific index (instant)
list.scrollToIndex(index: number, align?: 'start' | 'center' | 'end'): void

// Scroll to a specific index (with options — supports smooth scrolling)
list.scrollToIndex(index: number, options?: ScrollToOptions): void

// Scroll to a specific item by ID (instant)
list.scrollToItem(id: string | number, align?: 'start' | 'center' | 'end'): void

// Scroll to a specific item by ID (with options)
list.scrollToItem(id: string | number, options?: ScrollToOptions): void

// Cancel any in-progress smooth scroll animation
list.cancelScroll(): void

// Get current scroll position
list.getScrollPosition(): number

interface ScrollToOptions {
  align?: 'start' | 'center' | 'end';   // default: 'start'
  behavior?: 'auto' | 'smooth';          // default: 'auto' (instant)
  duration?: number;                      // default: 300 (ms, smooth only)
}
```

**Smooth scrolling examples:**

```typescript
// Smooth scroll to center
list.scrollToIndex(500, { align: 'center', behavior: 'smooth' });

// Smooth scroll with custom duration
list.scrollToIndex(500, { behavior: 'smooth', duration: 500 });

// Smooth scroll to item by ID
list.scrollToItem('user-123', { align: 'center', behavior: 'smooth' });

// Cancel in-progress animation
list.cancelScroll();
```

#### Selection

```typescript
// Select items by ID
list.select(...ids: Array<string | number>): void

// Deselect items by ID
list.deselect(...ids: Array<string | number>): void

// Toggle selection
list.toggleSelect(id: string | number): void

// Select all items
list.selectAll(): void

// Clear all selections
list.clearSelection(): void

// Get selected IDs
list.getSelected(): Array<string | number>

// Get selected items
list.getSelectedItems(): T[]
```

#### Events

```typescript
// Subscribe to an event
list.on(event: string, handler: Function): Unsubscribe

// Unsubscribe from an event
list.off(event: string, handler: Function): void
```

#### Lifecycle

```typescript
// Destroy the instance and cleanup
list.destroy(): void
```

### Properties

```typescript
list.element    // Root DOM element (readonly)
list.items      // Current items array (readonly)
list.total      // Total item count (readonly)
```

---

## Events

### Available Events

| Event | Payload | Description |
|-------|---------|-------------|
| `item:click` | `{ item, index, event }` | Item was clicked |
| `selection:change` | `{ selected, items }` | Selection changed |
| `scroll` | `{ scrollTop, direction }` | Scroll position changed |
| `range:change` | `{ range }` | Visible range changed |
| `load:start` | `{ offset, limit }` | Data loading started |
| `load:end` | `{ items, total }` | Data loading completed |
| `error` | `{ error, context }` | Error occurred |
| `resize` | `{ height, width }` | Container was resized |

### Event Usage

```typescript
// Subscribe
const unsubscribe = list.on('item:click', ({ item, index, event }) => {
  console.log(`Clicked ${item.name} at index ${index}`);
});

// Unsubscribe
unsubscribe();

// Or use off()
const handler = ({ item }) => console.log(item);
list.on('item:click', handler);
list.off('item:click', handler);
```

---

## Selection

### Configuration

```typescript
const list = createVList({
  // ... other config
  selection: {
    mode: 'multiple',      // 'none' | 'single' | 'multiple'
    initial: [1, 2, 3],    // Initially selected IDs
  },
});
```

### Selection Modes

- **none** - Selection disabled
- **single** - Only one item can be selected at a time
- **multiple** - Multiple items can be selected

### Keyboard Navigation

When selection is enabled:

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move focus up/down |
| `Home` | Move focus to first item |
| `End` | Move focus to last item |
| `Space` / `Enter` | Toggle selection on focused item |

### Programmatic Selection

```typescript
// Select specific items
list.select(1, 2, 3);

// Deselect
list.deselect(2);

// Toggle
list.toggleSelect(1);

// Select all (multiple mode only)
list.selectAll();

// Clear all
list.clearSelection();

// Get selection
const selectedIds = list.getSelected();        // [1, 3]
const selectedItems = list.getSelectedItems(); // [{ id: 1, ... }, { id: 3, ... }]
```

---

## Infinite Scroll

### Adapter Interface

```typescript
interface VListAdapter<T extends VListItem> {
  read: (params: AdapterParams) => Promise<AdapterResponse<T>>;
}

interface AdapterParams {
  offset: number;      // Starting index
  limit: number;       // Number of items to fetch
  cursor?: string;     // Optional cursor for pagination
}

interface AdapterResponse<T> {
  items: T[];          // Fetched items
  total?: number;      // Total count (if known)
  cursor?: string;     // Next cursor (for cursor pagination)
  hasMore?: boolean;   // Whether more items exist
}
```

### Basic Example

```typescript
const list = createVList({
  container: '#list',
  item: {
    height: 64,
    template: (item) => `<div>${item.title}</div>`,
  },
  adapter: {
    read: async ({ offset, limit }) => {
      const response = await fetch(
        `/api/items?offset=${offset}&limit=${limit}`
      );
      const data = await response.json();
      
      return {
        items: data.items,
        total: data.total,
        hasMore: data.hasMore,
      };
    },
  },
});
```

### Cursor-Based Pagination

```typescript
adapter: {
  read: async ({ offset, limit, cursor }) => {
    const url = cursor 
      ? `/api/items?cursor=${cursor}&limit=${limit}`
      : `/api/items?limit=${limit}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    return {
      items: data.items,
      total: data.total,
      cursor: data.nextCursor,
      hasMore: !!data.nextCursor,
    };
  },
}
```

### Loading Events

```typescript
list.on('load:start', ({ offset, limit }) => {
  console.log(`Loading items ${offset} to ${offset + limit}`);
  showSpinner();
});

list.on('load:end', ({ items, total }) => {
  console.log(`Loaded ${items.length} items. Total: ${total}`);
  hideSpinner();
});

list.on('error', ({ error, context }) => {
  console.error(`Error in ${context}:`, error);
  showError(error.message);
});
```

### Placeholders

When items haven't loaded yet, vlist generates placeholder items with a `_isPlaceholder` flag:

```typescript
item: {
  height: 64,
  template: (item, index) => {
    if (item._isPlaceholder) {
      return `
        <div class="item placeholder">
          <div class="skeleton-text"></div>
        </div>
      `;
    }
    
    return `
      <div class="item">
        <span>${item.name}</span>
      </div>
    `;
  },
}
```

#### Automatic Placeholder Replacement

When data loads, placeholders are automatically replaced with real content. The renderer detects when an item's ID changes (from `__placeholder_X` to a real ID) and re-applies the template. This happens seamlessly during:

- Initial data load
- Fast scrolling (when you scroll past unloaded regions)
- Jumping to specific positions

No manual intervention is required - just ensure your template handles both placeholder and real items appropriately.

#### Chunk-Based Loading

Data is loaded in chunks (default: 100 items per chunk) aligned to chunk boundaries. When scrolling quickly:

- Multiple ranges may be requested simultaneously
- Duplicate requests for the same chunk are automatically deduplicated
- The renderer updates as soon as each chunk loads

---

## Window Scrolling

By default, vlist scrolls inside its own container (`overflow: auto`). Pass `scrollElement: window` to make the list participate in the normal page flow — the browser's native scrollbar controls scrolling instead.

### Basic Usage

```javascript
const list = createVList({
  container: '#results',
  scrollElement: window,  // list scrolls with the page
  item: {
    height: 48,
    template: (item) => `<div class="result">${item.title}</div>`,
  },
  items: searchResults,
});
```

### How It Works

- The viewport is set to `overflow: visible` and `height: auto` — no inner scrollbar
- A RAF-throttled `window.scroll` listener computes the list-relative position from `viewport.getBoundingClientRect()`
- Container height is derived from `window.innerHeight` and updated on window resize
- `scrollTo()` / `scrollToIndex()` delegate to `window.scrollTo()` with the list's document offset
- The custom scrollbar is automatically disabled (the browser scrollbar is used)
- Compression still works — the scroll math is purely mathematical, no wheel interception needed

### When to Use

| Use Case | Recommended Mode |
|----------|-----------------|
| Contained panel, sidebar, modal | Default (no `scrollElement`) |
| Full-page search results, feeds | `scrollElement: window` |
| Landing page with list section | `scrollElement: window` |
| Dashboard with multiple lists | Default (no `scrollElement`) |

### Page Layout Example

```html
<!-- The list sits in the normal page flow -->
<header>My App</header>
<main>
  <h1>Search Results</h1>
  <div id="results"></div>  <!-- vlist mounts here -->
</main>
<footer>Footer content</footer>
```

```javascript
const list = createVList({
  container: '#results',
  scrollElement: window,
  item: {
    height: 64,
    template: (item) => `
      <div class="search-result">
        <h3>${item.title}</h3>
        <p>${item.description}</p>
      </div>
    `,
  },
  adapter: searchAdapter,
});

// Navigate to a result — scrolls the whole page
list.scrollToIndex(50, { align: 'center', behavior: 'smooth' });
```

### Notes

- **Resize handling**: vlist listens for `window.resize` to update the container height and re-render. The `resize` event is emitted as usual.
- **Compression**: Works identically to container mode. For 1M+ items, the content div is capped at the virtual height and the browser scrolls natively.
- **Destroy**: Calling `list.destroy()` properly removes the window scroll and resize listeners.

---

## Styling

### Default CSS Classes

```css
.vlist                    /* Root container */
.vlist-viewport           /* Scrollable viewport */
.vlist-content            /* Content container (sets total height) */
.vlist-items              /* Items container */
.vlist-item               /* Individual item */
.vlist-item--selected     /* Selected item */
.vlist-item--focused      /* Focused item (keyboard nav) */
```

### Import Default Styles

```typescript
import 'vlist/styles';
```

### Custom Styling

```css
/* Custom item styling */
.vlist-item {
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
  transition: background-color 0.15s;
}

.vlist-item:hover {
  background-color: #f5f5f5;
}

.vlist-item--selected {
  background-color: #e3f2fd;
}

.vlist-item--focused {
  outline: 2px solid #2196f3;
  outline-offset: -2px;
}
```

### Custom Class Prefix

```typescript
const list = createVList({
  // ...
  classPrefix: 'my-list',
});

// Results in: .my-list, .my-list-item, etc.
```

---

## Performance

### Benchmarks

With 10,000 items:
- **Initial render:** ~5ms
- **Scroll update:** ~1ms
- **Memory:** ~2MB (vs ~50MB without virtualization)

With 100,000 items:
- **Initial render:** ~8ms
- **Scroll update:** ~1ms
- **Memory:** ~3MB

### Maximum Items Calculation

Due to browser height limitations (~16.7M pixels), the maximum number of items depends on your `itemHeight`:

```
maxItems = 16,777,216 / itemHeight
```

| Item Height | Max Items |
|-------------|-----------|
| 32px | ~524,000 |
| 48px | ~349,000 |
| 64px | ~262,000 |
| 72px | ~233,000 |

> **Note:** While vlist can technically handle millions of items in memory, the browser's DOM height limit is the practical constraint for scrollable content.

### Built-In Optimizations

vlist includes many performance optimizations out of the box. For the complete list, see the [Optimization Guide](./optimization.md).

**Key highlights:**

- **Zero-allocation scroll hot path** — No `CompressionState` or `Range` objects allocated per frame; in-place range mutation via `out` parameters
- **RAF-throttled native scroll** — At most one scroll processing per animation frame
- **Element pooling** — DOM elements are recycled via `createElementPool()`, reducing GC pressure
- **DocumentFragment batching** — New elements collected and appended in a single DOM operation
- **CSS containment** — `contain: layout style` on items container, `contain: content` + `will-change: transform` on items for optimized compositing
- **Scroll transition suppression** — `.vlist--scrolling` class disables CSS transitions during active scroll
- **Circular buffer velocity tracker** — Pre-allocated buffer, zero allocations during scroll
- **Batched LRU timestamps** — Single `Date.now()` call per render via `touchChunksForRange()` instead of per-item
- **Targeted keyboard focus render** — Arrow keys update only 2 affected items instead of full-rendering all visible items
- **In-place focus mutation** — Focus movement functions mutate `focusedIndex` directly, zero object allocations
- **Direct state getters** — Hot paths use `getTotal()`, `getCached()` etc. instead of allocating state objects
- **Split CSS** — Core styles (6.7 KB) separated from optional extras (3.4 KB)

### Optimization Tips

1. **Use simple templates** — Complex DOM structures slow down rendering
2. **Avoid inline styles** — Use CSS classes instead (vlist uses CSS-only static positioning)
3. **Keep itemHeight fixed** — Variable heights require more calculations
4. **Use appropriate overscan** — Default of 3 is usually sufficient
5. **Debounce rapid updates** — Batch multiple data changes
6. **Tune `idleTimeout`** — Increase to 200-300ms on mobile/touch devices, decrease to 100ms for aggressive loading
7. **Configure velocity-based loading** — Adjust `loading.cancelThreshold` and `loading.preloadAhead` for your API speed
8. **Don't store the `state` reference** — The `ItemState` object passed to templates is reused; read from it immediately

### Memory Management

vlist uses sparse storage with automatic LRU eviction:

```typescript
// Configure sparse storage (advanced)
const dataManager = createDataManager({
  storage: {
    chunkSize: 100,           // Items per chunk
    maxCachedItems: 5000,     // Max items in memory
    evictionBuffer: 200,      // Buffer around visible range
  },
});
```

---

## TypeScript

### Generic Types

```typescript
interface User {
  id: number;
  name: string;
  email: string;
  avatar: string;
}

const list = createVList<User>({
  container: '#users',
  item: {
    height: 64,
    template: (user) => `
      <div class="user">
        <img src="${user.avatar}" alt="${user.name}" />
        <div>
          <strong>${user.name}</strong>
          <span>${user.email}</span>
        </div>
      </div>
    `,
  },
  items: users,
});

// Fully typed
list.on('item:click', ({ item }) => {
  console.log(item.email); // TypeScript knows this is User
});

const selected: User[] = list.getSelectedItems();
```

### Event Types

```typescript
import type { VListEvents, VListItem } from 'vlist';

interface Product extends VListItem {
  id: number;
  name: string;
  price: number;
}

list.on<'item:click'>('item:click', ({ item, index, event }) => {
  // item: Product
  // index: number
  // event: MouseEvent
});
```

---

## Examples

### Basic List

```typescript
import { createVList } from 'vlist';
import 'vlist/styles';

const users = Array.from({ length: 10000 }, (_, i) => ({
  id: i + 1,
  name: `User ${i + 1}`,
  email: `user${i + 1}@example.com`,
}));

const list = createVList({
  container: '#user-list',
  item: {
    height: 56,
    template: (user) => `
      <div style="display: flex; align-items: center; padding: 8px 16px;">
        <div style="width: 40px; height: 40px; border-radius: 50%; background: #ddd;"></div>
        <div style="margin-left: 12px;">
          <div style="font-weight: 500;">${user.name}</div>
          <div style="font-size: 14px; color: #666;">${user.email}</div>
        </div>
      </div>
    `,
  },
  items: users,
});
```

### Selectable List

```typescript
const list = createVList({
  container: '#selectable-list',
  item: {
    height: 48,
    template: (item, index, { selected }) => `
      <div style="display: flex; align-items: center; padding: 12px;">
        <input type="checkbox" ${selected ? 'checked' : ''} />
        <span style="margin-left: 8px;">${item.name}</span>
      </div>
    `,
  },
  items: items,
  selection: {
    mode: 'multiple',
  },
});

list.on('selection:change', ({ selected, items }) => {
  document.getElementById('count').textContent = `${selected.length} selected`;
});
```

### Infinite Scroll with API

```typescript
const list = createVList({
  container: '#api-list',
  item: {
    height: 72,
    template: (item) => {
      if (item._isPlaceholder) {
        return `<div class="skeleton"></div>`;
      }
      return `
        <div class="post">
          <h3>${item.title}</h3>
          <p>${item.body}</p>
        </div>
      `;
    },
  },
  adapter: {
    read: async ({ offset, limit }) => {
      const res = await fetch(
        `https://jsonplaceholder.typicode.com/posts?_start=${offset}&_limit=${limit}`
      );
      const items = await res.json();
      return {
        items,
        total: 100,
        hasMore: offset + limit < 100,
      };
    },
  },
});
```

---

## Troubleshooting

### Items not rendering

1. **Check container height** - Container must have a defined height (not required in window mode)
2. **Check itemHeight** - Must be a positive number
3. **Check items array** - Items must have unique `id` properties

### Scroll position jumping

1. **Ensure fixed itemHeight** - Variable heights cause jumps
2. **Check for layout shifts** - Images or async content can cause shifts

### Cannot scroll to end of large lists

**This should now work automatically!** vlist has built-in compression support for lists exceeding browser height limits.

If you're still having issues:

1. **Ensure you're using the latest version** - Compression was added recently
2. **Check compression is active:**
   ```javascript
   import { getCompressionInfo } from 'vlist';
   console.log(getCompressionInfo(totalItems, itemHeight));
   ```
3. **Verify smooth scrolling** - In compressed mode, scrolling uses wheel events

### Selection not working

1. **Check selection mode** - Must be 'single' or 'multiple', not 'none'
2. **Check item IDs** - IDs must be unique and consistent

### Infinite scroll not loading

1. **Check adapter.read** - Must return a Promise with correct shape
2. **Check hasMore** - Must be true for more items to load
3. **Check error events** - Listen for 'error' events for debugging

### Memory issues with large datasets

1. **Use adapter** - Don't load all items upfront
2. **Configure sparse storage** - Reduce maxCachedItems
3. **Simplify templates** - Reduce DOM complexity

---

## Compression (1M+ Items)

vlist automatically handles lists that exceed browser height limits (~16M pixels) through **compression**.

### How It Works

When your list's total height (`totalItems × itemHeight`) exceeds 16 million pixels:

1. **Detection**: vlist calculates if compression is needed
2. **Mode switch**: Switches from `overflow: auto` to `overflow: hidden`
3. **Wheel handling**: Intercepts wheel events for manual scroll control
4. **Positioning**: Items positioned relative to viewport, not content

### Automatic Behavior

No configuration required - compression activates automatically:

```javascript
// This just works, even with 1 million items!
const list = createVList({
  container: '#app',
  item: {
    height: 48,
    template: (item) => `<div>${item.name}</div>`,
  },
  items: millionItems, // 1,000,000 items
});

// Navigate anywhere in the list
list.scrollToIndex(500_000, 'center');                          // Jump to middle (instant)
list.scrollToIndex(999_999, 'end');                             // Jump to end (instant)
list.scrollToIndex(500_000, { align: 'center', behavior: 'smooth' }); // Smooth scroll
```

### Compression Utilities

```javascript
import { 
  getCompressionState, 
  getCompressionInfo,
  needsCompression,
  getMaxItemsWithoutCompression 
} from 'vlist';

// Check if compression needed
needsCompression(1_000_000, 48); // true

// Get detailed info
console.log(getCompressionInfo(1_000_000, 48));
// "Compressed to 33.3% (1000000 items × 48px = 48.0M px → 16.0M px virtual)"

// Get compression state
const state = getCompressionState(1_000_000, 48);
// { isCompressed: true, actualHeight: 48000000, virtualHeight: 16000000, ratio: 0.333 }

// Calculate max items without compression
getMaxItemsWithoutCompression(48); // 333,333
getMaxItemsWithoutCompression(32); // 500,000
```

### Limitations

- **No native scrollbar**: Compressed mode uses `overflow: hidden`, hiding the native scrollbar
- **Custom scrollbar coming**: A custom scrollbar component is planned for visual feedback

### Performance

Compression adds minimal overhead:
- Wheel event handling: ~0.1ms per event
- Position calculations: Pure math, very fast
- Memory: No additional memory for compression

For detailed technical documentation, see [compression.md](./compression.md).

---

## Browser Support

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

---

## License

MIT © [Floor](https://github.com/floor)

---

## Related Links

- [GitHub Repository](https://github.com/floor/vlist)
- [npm Package](https://www.npmjs.com/package/vlist)
- [Examples](../examples/)
- [Compression Documentation](./compression.md)
- [Changelog](../CHANGELOG.md)