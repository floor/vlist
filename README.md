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
- 🎨 **Tailwind CSS** - Beautiful, customizable styles
- ♿ **Accessible** - Full keyboard navigation and ARIA support

## Examples

Run the examples locally:

```bash
# Install dependencies
bun install

# Build the library
bun run build

# Serve examples
bun run examples
```

Then open http://localhost:3000/examples in your browser.

| Example | Description |
|---------|-------------|
| [Basic](examples/basic.html) | Simple list with 10,000 static items |
| [Selection](examples/selection.html) | Single/multiple selection with keyboard navigation |
| [Infinite Scroll](examples/infinite-scroll.html) | Async data loading with simulated API |
| [Million Items](examples/million-items.html) | Stress test with 1,000,000 items |

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
  itemHeight: 48,
  template: (item) => `
    <div class="flex items-center gap-3">
      <img src="${item.avatar}" class="w-8 h-8 rounded-full" />
      <span>${item.name}</span>
    </div>
  `,
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
  itemHeight: number;               // Fixed item height in pixels
  template: ItemTemplate<T>;        // Render function for each item

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
  itemHeight: 56,
  template: (item, index, { selected }) => `
    <div class="flex items-center gap-3 ${selected ? 'font-bold' : ''}">
      <span>${item.name}</span>
      ${selected ? '✓' : ''}
    </div>
  `,
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
  itemHeight: 72,
  template: (item, index, { selected, focused }) => {
    // Return an HTMLElement for more control
    const el = document.createElement('div');
    el.className = 'flex items-center gap-4 p-2';
    el.innerHTML = `
      <img src="${item.avatar}" class="w-12 h-12 rounded-full" />
      <div class="flex-1">
        <div class="font-medium">${item.name}</div>
        <div class="text-sm text-gray-500">${item.email}</div>
      </div>
      <div class="text-xs text-gray-400">${item.role}</div>
    `;
    return el;
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

### Using Tailwind CSS

Import the default styles:

```typescript
import 'vlist/styles';
```

Or customize with your own Tailwind classes in the template:

```typescript
template: (item, index, { selected }) => `
  <div class="${selected ? 'bg-blue-100' : 'bg-white'} p-4 hover:bg-gray-50">
    ${item.name}
  </div>
`
```

### CSS Custom Properties

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
  itemHeight: 48,
  template: (user) => `<div>${user.name} - ${user.email}</div>`,
  items: users,
});

// Fully typed
list.on('item:click', ({ item }) => {
  console.log(item.email); // TypeScript knows this is a User
});
```

## Performance

vlist is designed for maximum performance:

- **Virtual rendering** - Only visible items + overscan buffer are in the DOM
- **Element pooling** - DOM elements are recycled, reducing GC pressure
- **RAF throttling** - Scroll handlers are optimized with requestAnimationFrame
- **Minimal re-renders** - Only updates what changed

Benchmarks (10,000 items):
- Initial render: ~5ms
- Scroll update: ~1ms
- Memory: ~2MB (vs ~50MB without virtualization)

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
