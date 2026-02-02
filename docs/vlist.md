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
- **Infinite Scroll** - Built-in async adapter support for lazy loading
- **Selection** - Single and multiple selection modes with keyboard navigation
- **Sparse Storage** - Chunk-based memory management for huge datasets
- **Accessible** - Full keyboard navigation and ARIA support
- **TypeScript First** - Complete type definitions included

### Browser Limitations

> ⚠️ **Important:** Browsers have a maximum element height limit that affects virtual lists.

| Browser | Max Height |
|---------|------------|
| Chrome | ~16,777,216px (~16.7M px) |
| Firefox | ~17,895,697px (~17.9M px) |
| Safari | ~16,777,216px (~16.7M px) |
| Edge | ~16,777,216px (~16.7M px) |

**What this means:**

With a typical `itemHeight` of 48px, the maximum number of items is approximately:
- **~350,000 items** before hitting browser limits

If you need to display more items, consider:
1. **Pagination** - Split data into pages instead of infinite scroll
2. **Smaller item heights** - Use compact list items (e.g., 32px = ~500K items)
3. **Server-side filtering** - Reduce the dataset before displaying

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
  itemHeight: 48,
  items: [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
    { id: 3, name: 'Charlie' },
    // ... thousands more items
  ],
  template: (item) => `
    <div class="item">
      <span>${item.name}</span>
    </div>
  `,
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
  itemHeight: number;               // Fixed height of each item in pixels
  template: ItemTemplate<T>;        // Function to render each item

  // Optional
  items?: T[];                      // Static items array
  adapter?: VListAdapter<T>;        // Async data adapter for infinite scroll
  overscan?: number;                // Extra items to render (default: 3)
  selection?: SelectionConfig;      // Selection configuration
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
template: (item, index, { selected, focused }) => `
  <div class="item ${selected ? 'selected' : ''} ${focused ? 'focused' : ''}">
    <input type="checkbox" ${selected ? 'checked' : ''} />
    <span>${item.name}</span>
  </div>
`
```

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
// Scroll to a specific index
list.scrollToIndex(index: number, align?: 'start' | 'center' | 'end'): void

// Scroll to a specific item by ID
list.scrollToItem(id: string | number, align?: 'start' | 'center' | 'end'): void

// Get current scroll position
list.getScrollPosition(): number
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
  itemHeight: 64,
  template: (item) => `<div>${item.title}</div>`,
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
}
```

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

### Optimization Tips

1. **Use simple templates** - Complex DOM structures slow down rendering
2. **Avoid inline styles** - Use CSS classes instead
3. **Keep itemHeight fixed** - Variable heights require more calculations
4. **Use appropriate overscan** - Default of 3 is usually sufficient
5. **Debounce rapid updates** - Batch multiple data changes

### Memory Management

vlist uses sparse storage with automatic eviction:

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
  itemHeight: 64,
  items: users,
  template: (user) => `
    <div class="user">
      <img src="${user.avatar}" alt="${user.name}" />
      <div>
        <strong>${user.name}</strong>
        <span>${user.email}</span>
      </div>
    </div>
  `,
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
  itemHeight: 56,
  items: users,
  template: (user) => `
    <div style="display: flex; align-items: center; padding: 8px 16px;">
      <div style="width: 40px; height: 40px; border-radius: 50%; background: #ddd;"></div>
      <div style="margin-left: 12px;">
        <div style="font-weight: 500;">${user.name}</div>
        <div style="font-size: 14px; color: #666;">${user.email}</div>
      </div>
    </div>
  `,
});
```

### Selectable List

```typescript
const list = createVList({
  container: '#selectable-list',
  itemHeight: 48,
  items: items,
  selection: {
    mode: 'multiple',
  },
  template: (item, index, { selected }) => `
    <div style="display: flex; align-items: center; padding: 12px;">
      <input type="checkbox" ${selected ? 'checked' : ''} />
      <span style="margin-left: 8px;">${item.name}</span>
    </div>
  `,
});

list.on('selection:change', ({ selected, items }) => {
  document.getElementById('count').textContent = `${selected.length} selected`;
});
```

### Infinite Scroll with API

```typescript
const list = createVList({
  container: '#api-list',
  itemHeight: 72,
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

1. **Check container height** - Container must have a defined height
2. **Check itemHeight** - Must be a positive number
3. **Check items array** - Items must have unique `id` properties

### Scroll position jumping

1. **Ensure fixed itemHeight** - Variable heights cause jumps
2. **Check for layout shifts** - Images or async content can cause shifts

### Cannot scroll to end of large lists

This is caused by browser height limits (~16.7M pixels). Solutions:

1. **Reduce item count** - Use pagination or filtering
2. **Use smaller itemHeight** - Allows more items within the limit
3. **Calculate your limit:**
   ```javascript
   const maxItems = Math.floor(16777216 / itemHeight);
   console.log(`Max items with ${itemHeight}px height: ${maxItems}`);
   ```

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
- [Changelog](../CHANGELOG.md)