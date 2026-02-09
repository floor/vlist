# vlist

Lightweight, high-performance virtual list with zero dependencies.

[![npm version](https://img.shields.io/npm/v/vlist.svg)](https://www.npmjs.com/package/vlist)
[![bundle size](https://img.shields.io/bundlephobia/minzip/vlist)](https://bundlephobia.com/package/vlist)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

## Features

- 🪶 **Zero dependencies** - No external libraries required
- ⚡ **Blazing fast** - Only renders visible items with element pooling
- 🎯 **Simple API** - Easy to use with TypeScript support
- 📜 **Infinite scroll** - Built-in async adapter support
- ✅ **Selection** - Single and multiple selection modes
- 🎨 **Customizable** - Beautiful, customizable styles
- ♿ **Accessible** - Full keyboard navigation and ARIA support

## Sandbox

Run the sandbox locally to explore examples:

```bash
# Install dependencies
bun install

# Build and serve sandbox
bun run sandbox
```

Then open http://localhost:3337/sandbox in your browser.

To stop the server, press `Ctrl+C` in the terminal.

**Development mode** (auto-rebuilds on changes):
```bash
bun run dev:sandbox
```

| Example | Description |
|---------|-------------|
| [Basic](sandbox/basic/) | Pure vanilla JS - no frameworks, no dependencies |
| [Selection](sandbox/selection/) | Single/multiple selection with keyboard navigation |
| [Infinite Scroll](sandbox/infinite-scroll/) | Async data loading with simulated API |
| [Million Items](sandbox/million-items/) | Stress test with 1,000,000 items |
| [Velocity Loading](sandbox/velocity-loading/) | Velocity-based load skipping demo |

## Installation

```bash
npm install vlist
```

## Quick Start

```typescript
import { createVList } from 'vlist';
import 'vlist/styles';

// Simple usage with static data
const list = createVList({
  container: '#my-list',
  item: {
    height: 48,
    template: (item) => `
      <div class="item-content">
        <img src="${item.avatar}" class="avatar" />
        <span>${item.name}</span>
      </div>
    `,
  },
  items: [
    { id: 1, name: 'Alice', avatar: '/avatars/alice.jpg' },
    { id: 2, name: 'Bob', avatar: '/avatars/bob.jpg' },
    // ... more items
  ],
});
```

## Configuration

```typescript
interface VListConfig<T> {
  // Required
  container: HTMLElement | string;  // Container element or selector
  item: {
    height: number;                 // Fixed item height in pixels
    template: ItemTemplate<T>;      // Render function for each item
  };

  // Optional
  items?: T[];                      // Static items array
  adapter?: VListAdapter<T>;        // Async data adapter
  overscan?: number;                // Extra items to render (default: 3)
  selection?: SelectionConfig;      // Selection configuration
  classPrefix?: string;             // CSS class prefix (default: 'vlist')
}
```

## Examples

### With Selection

```typescript
const list = createVList({
  container: '#my-list',
  item: {
    height: 56,
    template: (item, index, { selected }) => `
      <div class="item-content ${selected ? 'selected' : ''}">
        <span>${item.name}</span>
        ${selected ? '✓' : ''}
      </div>
    `,
  },
  items: users,
  selection: {
    mode: 'multiple',      // 'none' | 'single' | 'multiple'
    initial: [1, 2],       // Initially selected IDs
  },
});

// Listen for selection changes
list.on('selection:change', ({ selected, items }) => {
  console.log('Selected:', selected);
});

// Programmatic selection
list.select(5);
list.deselect(1);
list.selectAll();
list.clearSelection();
```

### With Infinite Scroll

```typescript
const list = createVList({
  container: '#my-list',
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

// Listen for loading events
list.on('load:start', ({ offset, limit }) => {
  console.log('Loading...', offset, limit);
});

list.on('load:end', ({ items, total }) => {
  console.log('Loaded', items.length, 'of', total);
});
```

### With Custom Template

```typescript
const list = createVList({
  container: '#my-list',
  item: {
    height: 72,
    template: (item, index, { selected, focused }) => {
      // Return an HTMLElement for more control
      const el = document.createElement('div');
      el.className = 'item-content';
      el.innerHTML = `
        <img src="${item.avatar}" class="avatar avatar--large" />
        <div class="item-details">
          <div class="item-name">${item.name}</div>
          <div class="item-email">${item.email}</div>
        </div>
        <div class="item-role">${item.role}</div>
      `;
      return el;
    },
  },
  items: users,
});
```

## API Reference

### Methods

#### Data Management

```typescript
list.setItems(items: T[])           // Replace all items
list.appendItems(items: T[])        // Add items to end
list.prependItems(items: T[])       // Add items to start
list.updateItem(id, updates)        // Update item by ID
list.removeItem(id)                 // Remove item by ID
list.reload()                       // Reload from adapter
```

#### Scrolling

```typescript
list.scrollToIndex(index, align?)   // Scroll to index ('start' | 'center' | 'end')
list.scrollToItem(id, align?)       // Scroll to item by ID
list.getScrollPosition()            // Get current scroll position
```

#### Selection

```typescript
list.select(...ids)                 // Select items
list.deselect(...ids)               // Deselect items
list.toggleSelect(id)               // Toggle selection
list.selectAll()                    // Select all
list.clearSelection()               // Clear selection
list.getSelected()                  // Get selected IDs
list.getSelectedItems()             // Get selected items
```

#### Events

```typescript
list.on(event, handler)             // Subscribe to event
list.off(event, handler)            // Unsubscribe from event
```

#### Lifecycle

```typescript
list.destroy()                      // Cleanup and remove
```

### Properties

```typescript
list.element                        // Root DOM element
list.items                          // Current items (readonly)
list.total                          // Total item count
```

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `item:click` | `{ item, index, event }` | Item was clicked |
| `selection:change` | `{ selected, items }` | Selection changed |
| `scroll` | `{ scrollTop, direction }` | Scroll position changed |
| `range:change` | `{ range }` | Visible range changed |
| `load:start` | `{ offset, limit }` | Data loading started |
| `load:end` | `{ items, total }` | Data loading completed |
| `error` | `{ error, context }` | Error occurred |

## Keyboard Navigation

When selection is enabled, the list supports full keyboard navigation:

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move focus up/down |
| `Home` | Move focus to first item |
| `End` | Move focus to last item |
| `Space` / `Enter` | Toggle selection on focused item |

## Styling

### Default Styles

Import the default styles:

```typescript
import 'vlist/styles';
```

### CSS Classes

The component uses these CSS class names:

- `.vlist` - Root container
- `.vlist-viewport` - Scrollable viewport
- `.vlist-content` - Content container (sets total height)
- `.vlist-items` - Items container
- `.vlist-item` - Individual item
- `.vlist-item--selected` - Selected item
- `.vlist-item--focused` - Focused item (keyboard nav)

### Variants

```html
<!-- Compact spacing -->
<div class="vlist vlist--compact">...</div>

<!-- Comfortable spacing -->
<div class="vlist vlist--comfortable">...</div>

<!-- No borders -->
<div class="vlist vlist--borderless">...</div>

<!-- Striped rows -->
<div class="vlist vlist--striped">...</div>
```

## TypeScript

Full TypeScript support with generics:

```typescript
interface User {
  id: number;
  name: string;
  email: string;
}

const list = createVList<User>({
  container: '#users',
  item: {
    height: 48,
    template: (user) => `<div>${user.name} - ${user.email}</div>`,
  },
  items: users,
});

// Fully typed
list.on('item:click', ({ item }) => {
  console.log(item.email); // TypeScript knows this is a User
});
```

## Performance

vlist is designed for maximum performance with extensive built-in optimizations:

- **Virtual rendering** - Only visible items + overscan buffer are in the DOM
- **Element pooling** - DOM elements are recycled via `createElementPool()`, reducing GC pressure
- **Zero-allocation scroll hot path** - No object allocations per scroll frame; in-place range mutation
- **RAF-throttled native scroll** - At most one scroll processing per animation frame
- **CSS containment** - `contain: layout style` on items container, `contain: content` + `will-change: transform` on items
- **Scroll transition suppression** - `.vlist--scrolling` class disables CSS transitions during active scroll
- **Circular buffer velocity tracker** - Pre-allocated buffer, zero allocations during scroll
- **Targeted keyboard focus render** - Arrow keys update only 2 affected items instead of all visible items
- **Batched LRU timestamps** - Single `Date.now()` per render cycle instead of per-item
- **DocumentFragment batching** - New elements appended in a single DOM operation
- **Split CSS** - Core styles (6.7 KB) separated from optional extras (3.4 KB)
- **Configurable velocity-based loading** - Skip, preload, or defer loading based on scroll speed

Benchmarks (10,000 items):
- Initial render: ~5ms
- Scroll update: ~1ms
- Memory: ~2MB (vs ~50MB without virtualization)

For the full optimization guide, see [docs/optimization.md](docs/optimization.md).

## Browser Support

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## Contributing

Contributions are welcome! Please read our [contributing guidelines](CONTRIBUTING.md) first.

```bash
# Install dependencies
bun install

# Run development build
bun run dev

# Run tests
bun test

# Build for production
bun run build
```

## License

MIT © [Floor](https://github.com/floor)

## Credits

Inspired by the [mtrl-addons](https://github.com/floor/mtrl-addons) vlist component.
