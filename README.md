# vlist

Lightweight, high-performance virtual list with zero dependencies.

[![npm version](https://img.shields.io/npm/v/%40floor%2Fvlist.svg)](https://www.npmjs.com/package/@floor/vlist)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@floor/vlist)](https://bundlephobia.com/package/@floor/vlist)
[![tests](https://img.shields.io/badge/tests-1730%20passing-brightgreen)](https://github.com/floor/vlist)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

## Features

- 🪶 **Zero dependencies** - No external libraries required
- ⚡ **Blazing fast** - Only renders visible items with element pooling
- 🎯 **Simple API** - Easy to use with TypeScript support
- 📐 **Grid layout** - 2D virtualized grid with configurable columns and gap
- 📏 **Variable heights** - Fixed or per-item height via `(index) => number`
- 📜 **Infinite scroll** - Built-in async adapter support
- ✅ **Selection** - Single and multiple selection modes
- 📌 **Sticky headers** - Grouped lists with sticky section headers
- 🪟 **Window scrolling** - Document-level scrolling with `scrollElement: window`
- 🎨 **Customizable** - Beautiful, customizable styles
- ♿ **Accessible** - WAI-ARIA listbox pattern, `aria-setsize`/`aria-posinset`, `aria-activedescendant`, live region, keyboard navigation
- 🌊 **Smooth scrolling** - Animated `scrollToIndex` / `scrollToItem`
- 💾 **Scroll save/restore** - `getScrollSnapshot()` / `restoreScroll()` for SPA navigation
- 💬 **Reverse mode** - Chat UI support with auto-scroll, scroll-preserving prepend
- 🔌 **Framework adapters** - Thin wrappers for React, Vue, and Svelte (<1 KB each)
- 🌲 **Tree-shakeable** - Sub-module imports for smaller bundles

## Sandbox & Documentation

Interactive examples and documentation are available at **[vlist.dev](https://vlist.dev)**.

| Example | Description |
|---------|-------------|
| [Basic](https://vlist.dev/sandbox/basic/) | Pure vanilla JS — no frameworks, no dependencies |
| [Core](https://vlist.dev/sandbox/core/) | Lightweight `vlist/core` — 7.3 KB, 83% smaller |
| [Grid](https://vlist.dev/sandbox/grid/) | 2D photo gallery with real photos from Lorem Picsum |
| [Variable Heights](https://vlist.dev/sandbox/variable-heights/) | Chat-style messages with 4 different item heights |
| [Reverse Chat](https://vlist.dev/sandbox/reverse-chat/) | Chat UI with reverse mode, prepend history, auto-scroll |
| [Selection](https://vlist.dev/sandbox/selection/) | Single/multiple selection with keyboard navigation |
| [Infinite Scroll](https://vlist.dev/sandbox/infinite-scroll/) | Async data loading with simulated API |
| [Million Items](https://vlist.dev/sandbox/million-items/) | Stress test with 1–5 million items |
| [Velocity Loading](https://vlist.dev/sandbox/velocity-loading/) | Velocity-based load skipping demo |
| [Sticky Headers](https://vlist.dev/sandbox/sticky-headers/) | Grouped contact list with sticky section headers |
| [Window Scroll](https://vlist.dev/sandbox/window-scroll/) | Document-level scrolling with `scrollElement: window` |
| [Scroll Restore](https://vlist.dev/sandbox/scroll-restore/) | Save/restore scroll position across SPA navigation |

## Installation

```bash
npm install @floor/vlist
```

> **Note:** Currently published as `@floor/vlist` (scoped package). When the npm dispute for `vlist` is resolved, the package will migrate to the simpler `vlist` name.

### Sub-module Imports

For smaller bundles, import only what you need:

```typescript
import { createVList } from '@floor/vlist'                    // full library (48.2 KB / 16.0 KB gzip)
import { createVList } from '@floor/vlist/core'               // lightweight core (7.8 KB / 3.2 KB gzip)
import { createGridLayout } from '@floor/vlist/grid'          // grid layout utilities only
import { createSparseStorage } from '@floor/vlist/data'       // data utilities only
import { getCompressionInfo } from '@floor/vlist/compression'  // compression utilities only
import { createSelectionState } from '@floor/vlist/selection'  // selection utilities only
import { createScrollController } from '@floor/vlist/scroll'   // scroll utilities only
import { createGroupLayout } from '@floor/vlist/groups'        // group/sticky header utilities only
```

| Import | Minified | Gzipped | Description |
|--------|----------|---------|-------------|
| `@floor/vlist` | 48.2 KB | 16.0 KB | All features |
| **`@floor/vlist/core`** | **7.8 KB** | **3.2 KB** | **Lightweight — 83% smaller** |
| `@floor/vlist/data` | 9.2 KB | 3.8 KB | Sparse storage, placeholders, data manager |
| `@floor/vlist/scroll` | 6.0 KB | 2.3 KB | Scroll controller + custom scrollbar |
| `@floor/vlist/grid` | 4.1 KB | 1.9 KB | Grid layout + 2D renderer |
| `@floor/vlist/groups` | 3.6 KB | 1.4 KB | Group layout + sticky headers |
| `@floor/vlist/compression` | 2.6 KB | 1.1 KB | Large-list compression utilities |
| `@floor/vlist/selection` | 1.9 KB | 0.7 KB | Selection state management |

### Framework Adapters

Thin wrappers for React, Vue, and Svelte — each under 1 KB:

```typescript
import { useVList } from '@floor/vlist/react'       // React hook (0.7 KB / 0.4 KB gzip)
import { useVList } from '@floor/vlist/vue'         // Vue 3 composable (0.5 KB / 0.4 KB gzip)
import { vlist } from '@floor/vlist/svelte'         // Svelte action (0.3 KB / 0.2 KB gzip)
```

| Import | Minified | Gzipped | Description |
|--------|----------|---------|-------------|
| `@floor/vlist/react` | 0.7 KB | 0.4 KB | `useVList` hook + `useVListEvent` |
| `@floor/vlist/vue` | 0.5 KB | 0.4 KB | `useVList` composable + `useVListEvent` |
| `@floor/vlist/svelte` | 0.3 KB | 0.2 KB | `vlist` action + `onVListEvent` |

Adapters manage the vlist lifecycle (create on mount, destroy on unmount) and sync items reactively. See [Framework Adapters](#framework-adapters) for full examples.

## Quick Start

```typescript
import { createVList } from '@floor/vlist';
import '@floor/vlist/styles';

const list = createVList({
  container: '#my-list',
  ariaLabel: 'Contact list',
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

### Lightweight Core (7.3 KB)

If you don't need selection, groups, grid, compression, custom scrollbar, or async data adapters, use the lightweight core for an **83% smaller bundle**:

```typescript
import { createVList } from '@floor/vlist/core';
import '@floor/vlist/styles';

const list = createVList({
  container: '#my-list',
  item: {
    height: 48,
    template: (item) => `<div>${item.name}</div>`,
  },
  items: myItems,
});

// Same core API: setItems, appendItems, scrollToIndex, events, etc.
list.on('item:click', ({ item }) => console.log(item));
list.scrollToIndex(50, { behavior: 'smooth' });
```

The core entry supports fixed/variable heights, smooth `scrollToIndex`, all data methods (`setItems`, `appendItems`, `prependItems`, `updateItem`, `removeItem`), events, window scrolling, and ResizeObserver — everything you need for most use cases.

## Configuration

```typescript
interface VListConfig<T> {
  // Required
  container: HTMLElement | string;  // Container element or selector
  item: {
    height: number | ((index: number) => number);  // Fixed or variable height
    template: ItemTemplate<T>;      // Render function for each item
  };

  // Layout
  layout?: 'list' | 'grid';        // Layout mode (default: 'list')
  grid?: {                          // Grid config (required when layout: 'grid')
    columns: number;                //   Number of columns
    gap?: number;                   //   Gap between items in px (default: 0)
  };

  // Data
  items?: T[];                      // Static items array
  adapter?: VListAdapter<T>;        // Async data adapter

  // Scrolling
  overscan?: number;                // Extra items to render (default: 3)
  scroll?: {
    wheel?: boolean;                //   Enable mouse wheel (default: true)
    wrap?: boolean;                 //   Wrap around at boundaries (default: false)
    scrollbar?: 'native' | 'none'  //   Scrollbar mode (default: custom)
      | ScrollbarOptions;           //   or { autoHide, autoHideDelay, minThumbSize }
    element?: Window;               //   Window scrolling mode
    idleTimeout?: number;           //   Scroll idle detection in ms (default: 150)
  };

  // Features
  selection?: SelectionConfig;      // Selection configuration
  groups?: GroupsConfig;            // Sticky headers / grouped lists
  loading?: LoadingConfig;          // Velocity-based loading thresholds

  // Chat UI
  reverse?: boolean;                // Reverse mode (start at bottom, auto-scroll)

  // Appearance
  classPrefix?: string;             // CSS class prefix (default: 'vlist')
  ariaLabel?: string;               // Accessible label for the listbox
}
```

## Examples

### Grid Layout

```typescript
const grid = createVList({
  container: '#gallery',
  layout: 'grid',
  grid: {
    columns: 4,
    gap: 8,           // 8px gap between columns AND rows
  },
  item: {
    height: 200,
    template: (item) => `
      <div class="card">
        <img src="${item.thumbnail}" />
        <span>${item.title}</span>
      </div>
    `,
  },
  items: photos,
});
```

Grid mode virtualizes by **rows** — only visible rows are in the DOM. Each item is positioned with `translate(x, y)` for GPU-accelerated rendering. Compression applies to row count, not item count.

### Variable Heights

```typescript
const list = createVList({
  container: '#messages',
  item: {
    height: (index) => messages[index].type === 'header' ? 32 : 64,
    template: (item) => `<div class="message">${item.text}</div>`,
  },
  items: messages,
});
```

Variable heights use a prefix-sum array for O(1) offset lookups and O(log n) binary search for index-at-offset.

### Sticky Headers

```typescript
const list = createVList({
  container: '#contacts',
  item: {
    height: 56,
    template: (item) => `<div>${item.name}</div>`,
  },
  items: contacts,   // Must be pre-sorted by group
  groups: {
    getGroupForIndex: (index) => contacts[index].lastName[0],
    headerHeight: 36,
    headerTemplate: (group) => `<div class="section-header">${group}</div>`,
    sticky: true,     // Headers stick to the top (default: true)
  },
});
```

### Window Scrolling

```typescript
const list = createVList({
  container: '#my-list',
  scroll: { element: window },   // Use the browser's native scrollbar
  item: {
    height: 48,
    template: (item) => `<div>${item.name}</div>`,
  },
  items: myItems,
});
```

### Wizard / Carousel (Wrap Navigation)

```typescript
const wizard = createVList({
  container: '#wizard',
  scroll: { wheel: false, scrollbar: 'none', wrap: true },
  item: {
    height: 400,
    template: (step) => `<div class="step">${step.content}</div>`,
  },
  items: steps,
});

let current = 0;

// No boundary checks needed — wrap handles it
btnNext.addEventListener('click', () => {
  current++;
  wizard.scrollToIndex(current, { align: 'start', behavior: 'smooth' });
});

btnPrev.addEventListener('click', () => {
  current--;
  wizard.scrollToIndex(current, { align: 'start', behavior: 'smooth' });
});
```

### Reverse Mode (Chat UI)

```typescript
const chat = createVList({
  container: '#messages',
  reverse: true,
  item: {
    height: (index) => messages[index].type === 'image' ? 200 : 60,
    template: (msg) => `
      <div class="bubble bubble--${msg.sender}">
        <span class="sender">${msg.sender}</span>
        <p>${msg.text}</p>
      </div>
    `,
  },
  items: messages,   // Chronological order (oldest first)
});

// New message arrives — auto-scrolls to bottom if user was at bottom
chat.appendItems([newMessage]);

// Load older messages — scroll position preserved (no jump)
chat.prependItems(olderMessages);
```

Reverse mode starts scrolled to the bottom. `appendItems` auto-scrolls to show new messages when the user is at the bottom. `prependItems` adjusts the scroll position so older messages appear above without disrupting the current view. Works with both fixed and variable heights. Cannot be combined with `groups` or `grid`.

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

### Scroll Save/Restore

```typescript
const list = createVList({
  container: '#my-list',
  item: {
    height: 64,
    template: (item) => `<div>${item.name}</div>`,
  },
  items: myItems,
  selection: { mode: 'multiple' },
});

// Save — e.g. before navigating away
const snapshot = list.getScrollSnapshot();
// { index: 523, offsetInItem: 12, selectedIds: [3, 7, 42] }
sessionStorage.setItem('list-scroll', JSON.stringify(snapshot));

// Restore — e.g. after navigating back and recreating the list
const saved = JSON.parse(sessionStorage.getItem('list-scroll'));
list.restoreScroll(saved);
// Scroll position AND selection are perfectly restored
```

### Framework Adapters

vlist ships thin framework wrappers that handle lifecycle and reactive item syncing. The adapters are **mount-based** — vlist manages the DOM while the framework provides the container element.

#### React

```tsx
import { useVList, useVListEvent } from 'vlist/react';

function UserList({ users }) {
  const { containerRef, instanceRef } = useVList({
    item: {
      height: 48,
      template: (user) => `<div class="user">${user.name}</div>`,
    },
    items: users,
    selection: { mode: 'single' },
  });

  // Optional: subscribe to events with automatic cleanup
  useVListEvent(instanceRef, 'selection:change', ({ selected }) => {
    console.log('Selected:', selected);
  });

  return (
    <div
      ref={containerRef}
      style={{ height: 400 }}
      onClick={() => instanceRef.current?.scrollToIndex(0)}
    />
  );
}
```

`useVList` returns:
- `containerRef` — attach to your container `<div>`
- `instanceRef` — ref to the `VList` instance (populated after mount)
- `getInstance()` — stable helper to access the instance

Items auto-sync when `config.items` changes by reference.

#### Vue

```vue
<template>
  <div ref="containerRef" style="height: 400px" />
</template>

<script setup lang="ts">
import { useVList, useVListEvent } from 'vlist/vue';
import { ref } from 'vue';

const users = ref([
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
]);

const { containerRef, instance } = useVList({
  item: {
    height: 48,
    template: (user) => `<div class="user">${user.name}</div>`,
  },
  items: users.value,
});

// Optional: subscribe to events with automatic cleanup
useVListEvent(instance, 'selection:change', ({ selected }) => {
  console.log('Selected:', selected);
});

function jumpToTop() {
  instance.value?.scrollToIndex(0);
}
</script>
```

`useVList` accepts a plain config or a reactive `Ref<Config>`. When using a ref, items are watched and synced automatically.

#### Svelte

```svelte
<script>
  import { vlist, onVListEvent } from 'vlist/svelte';

  let instance;
  let unsubs = [];

  const options = {
    config: {
      item: {
        height: 48,
        template: (user) => `<div class="user">${user.name}</div>`,
      },
      items: users,
      selection: { mode: 'single' },
    },
    onInstance: (inst) => {
      instance = inst;
      unsubs.push(
        onVListEvent(inst, 'selection:change', ({ selected }) => {
          console.log('Selected:', selected);
        })
      );
    },
  };

  import { onDestroy } from 'svelte';
  onDestroy(() => unsubs.forEach(fn => fn()));
</script>

<div use:vlist={options} style="height: 400px" />
<button on:click={() => instance?.scrollToIndex(0)}>Jump to top</button>
```

The `vlist` action follows the standard Svelte `use:` directive contract. It works with both Svelte 4 and 5 with zero Svelte imports. Pass reactive options via `$:` to trigger updates automatically.

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
list.scrollToIndex(index, options?) // Scroll with options (smooth scrolling)
list.scrollToItem(id, align?)       // Scroll to item by ID
list.scrollToItem(id, options?)     // Scroll to item with options
list.cancelScroll()                 // Cancel in-progress smooth scroll
list.getScrollPosition()            // Get current scroll position
list.getScrollSnapshot()            // Get snapshot for save/restore
list.restoreScroll(snapshot)        // Restore position (and selection) from snapshot

// ScrollToOptions: { align?, behavior?: 'auto' | 'smooth', duration? }
// Example: list.scrollToIndex(500, { align: 'center', behavior: 'smooth' })
// ScrollSnapshot: { index, offsetInItem, selectedIds? } — JSON-serializable
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
| `resize` | `{ height, width }` | Container was resized |
| `load:start` | `{ offset, limit }` | Data loading started |
| `load:end` | `{ items, total }` | Data loading completed |
| `error` | `{ error, context }` | Error occurred |

## Keyboard Navigation & Accessibility

vlist implements the [WAI-ARIA Listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/) for full screen reader and keyboard support.

### Keyboard Shortcuts

When selection is enabled, the list supports full keyboard navigation:

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move focus up/down |
| `Home` | Move focus to first item |
| `End` | Move focus to last item |
| `Space` / `Enter` | Toggle selection on focused item |
| `Tab` | Move focus into / out of the list |

### ARIA Attributes

| Attribute | Element | Purpose |
|-----------|---------|---------|
| `role="listbox"` | Root | Identifies the widget as a list of selectable items |
| `role="option"` | Each item | Identifies each item as a selectable option |
| `aria-setsize` | Each item | Total item count — screen readers announce "item 5 of 10,000" |
| `aria-posinset` | Each item | 1-based position within the list |
| `aria-activedescendant` | Root | Points to the focused item's ID for screen reader tracking |
| `aria-selected` | Each item | Reflects selection state |
| `aria-busy` | Root | Present during async data loading |
| `aria-label` | Root | Set via `ariaLabel` config option |

A visually-hidden **live region** (`aria-live="polite"`) announces selection changes (e.g., "3 items selected").

Each item receives a unique `id` (`vlist-{instance}-item-{index}`) safe for multiple lists per page.

> 📖 Full documentation: [docs/accessibility.md](docs/accessibility.md)

## Styling

### Default Styles

Import the default styles:

```typescript
import 'vlist/styles';
```

Optional extras (variants, loading states, animations):

```typescript
import 'vlist/styles/extras';
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
- `.vlist--grid` - Grid layout modifier
- `.vlist-grid-item` - Grid item (positioned with `translate(x, y)`)
- `.vlist--grouped` - Grouped list modifier
- `.vlist-sticky-header` - Sticky header overlay
- `.vlist-live-region` - Visually-hidden live region for screen reader announcements
- `.vlist--scrolling` - Applied during active scroll (disables transitions)

### Variants

Import `vlist/styles/extras` for these variant classes:

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

### CSS Custom Properties

All visual aspects can be customized via CSS custom properties:

```css
:root {
  --vlist-bg: #ffffff;
  --vlist-bg-hover: #f9fafb;
  --vlist-bg-selected: #eff6ff;
  --vlist-border: #e5e7eb;
  --vlist-text: #111827;
  --vlist-focus-ring: #3b82f6;
  --vlist-item-padding-x: 1rem;
  --vlist-item-padding-y: 0.75rem;
  --vlist-border-radius: 0.5rem;
  --vlist-transition-duration: 150ms;
}
```

Dark mode is supported automatically via `prefers-color-scheme: dark` or the `.dark` class.

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
- **Split CSS** - Core styles (5.6 KB) separated from optional extras (1.8 KB)
- **Configurable velocity-based loading** - Skip, preload, or defer loading based on scroll speed
- **Compression for 1M+ items** - Automatic scroll space compression when content exceeds browser height limits

### Benchmark Results

Measured in Chrome (10-core Mac, 60Hz display) via the [live benchmark page](https://vlist.dev/benchmarks/):

| Metric | 10K items | 1M items |
|--------|-----------|----------|
| Initial render | ~32ms | ~135ms |
| Scroll FPS | 60fps | 61fps |
| Frame budget (avg) | 2.1ms | 1.9ms |
| Frame budget (p95) | 4.2ms | 8.7ms |
| Dropped frames | 0% | 0% |
| scrollToIndex | ~166ms | ~82ms |
| Memory (scroll delta) | 0 MB | 0 MB |

Zero dropped frames and zero memory growth during sustained scrolling — even at 1M items.

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

# Type check
bun run typecheck

# Build for production
bun run build
```

## License

MIT © [Floor](https://github.com/floor)

## Credits

Inspired by the [mtrl-addons](https://github.com/floor/mtrl-addons) vlist component.