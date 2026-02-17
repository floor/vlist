# vlist

Lightweight, high-performance virtual list with zero dependencies and optimal tree-shaking.

[![npm version](https://img.shields.io/npm/v/%40floor%2Fvlist.svg)](https://www.npmjs.com/package/@floor/vlist)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@floor/vlist)](https://bundlephobia.com/package/@floor/vlist)
[![tests](https://img.shields.io/badge/tests-1739%20passing-brightgreen)](https://github.com/floor/vlist)
[![license](https://img.shields.io/npm/l/vlist.svg)](https://github.com/floor/vlist/blob/main/LICENSE)

## Features

- 🪶 **Zero dependencies** - No external libraries required
- ⚡ **Tiny bundle** - 8-12 KB gzipped (vs 20+ KB for traditional virtual lists)
- 🌲 **Perfect tree-shaking** - Pay only for features you use
- 🎯 **Builder API** - Explicit, composable plugin system
- 📐 **Grid layout** - 2D virtualized grid with configurable columns
- 📏 **Variable heights** - Fixed or per-item height calculation
- ↔️ **Horizontal scrolling** - Horizontal lists and carousels
- 📜 **Async loading** - Built-in lazy loading with adapters
- ✅ **Selection** - Single and multiple selection modes
- 📌 **Sticky headers** - Grouped lists with sticky section headers
- 🪟 **Page scrolling** - Document-level scrolling mode
- 🔄 **Wrap navigation** - Circular scrolling for wizards
- 💬 **Reverse mode** - Chat UI with auto-scroll and history loading
- ⚖️ **Scale to millions** - Handle 1M+ items with automatic compression
- 🎨 **Customizable** - Beautiful, customizable styles
- ♿ **Accessible** - Full WAI-ARIA support and keyboard navigation
- 🔌 **Framework adapters** - React, Vue, and Svelte support
- 📱 **Mobile optimized** - Touch-friendly with momentum scrolling

## Sandbox & Documentation

Interactive examples and documentation at **[vlist.dev](https://vlist.dev)**

**30+ examples** with multi-framework implementations (JavaScript, React, Vue, Svelte)

## Installation

```bash
npm install @floor/vlist
```

> **Note:** Currently published as `@floor/vlist` (scoped package). When the npm dispute for `vlist` is resolved, the package will migrate to `vlist`.

## Quick Start

```typescript
import { vlist } from 'vlist';
import 'vlist/styles';

const list = vlist({
  container: '#my-list',
  items: [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
    { id: 3, name: 'Charlie' },
  ],
  item: {
    height: 48,
    template: (item) => `<div>${item.name}</div>`,
  },
}).build();

// API methods
list.scrollToIndex(10);
list.setItems(newItems);
list.on('item:click', ({ item }) => console.log(item));
```

**Bundle:** ~8 KB gzipped

## Builder Pattern

VList uses a composable builder pattern. Start with the base, add only the features you need:

```typescript
import { vlist, withGrid, withSections, withSelection } from 'vlist';

const list = vlist({
  container: '#app',
  items: photos,
  item: {
    height: 200,
    template: renderPhoto,
  },
})
  .use(withGrid({ columns: 4, gap: 16 }))
  .use(withSections({ 
    getGroupForIndex: (i) => photos[i].category,
    headerHeight: 40,
    headerTemplate: (cat) => `<h2>${cat}</h2>`,
  }))
  .use(withSelection({ mode: 'multiple' }))
  .build();
```

**Bundle:** ~12 KB gzipped (only includes used plugins)

### Available Plugins

| Plugin | Cost | Description |
|--------|------|-------------|
| **Base** | 7.7 KB gzip | Core virtualization, no plugins |
| `withGrid()` | +4.0 KB | 2D grid layout |
| `withSections()` | +4.6 KB | Grouped lists with sticky/inline headers |
| `withAsync()` | +5.3 KB | Async data loading with adapters |
| `withSelection()` | +2.3 KB | Single/multiple item selection |
| `withScale()` | +2.2 KB | Handle 1M+ items with compression |
| `withScrollbar()` | +1.0 KB | Custom scrollbar UI |
| `withPage()` | +0.9 KB | Document-level scrolling |
| `withSnapshots()` | Included | Scroll save/restore |

**Compare to monolithic:** Traditional virtual lists bundle everything = 20-23 KB gzipped minimum, regardless of usage.

## Examples

### Simple List (No Plugins)

```typescript
import { vlist } from 'vlist';

const list = vlist({
  container: '#list',
  items: users,
  item: {
    height: 64,
    template: (user) => `
      <div class="user">
        <img src="${user.avatar}" />
        <span>${user.name}</span>
      </div>
    `,
  },
}).build();
```

**Bundle:** 8.2 KB gzipped

### Grid Layout

```typescript
import { vlist, withGrid, withScrollbar } from 'vlist';

const gallery = vlist({
  container: '#gallery',
  items: photos,
  item: {
    height: 200,
    template: (photo) => `
      <div class="card">
        <img src="${photo.url}" />
        <span>${photo.title}</span>
      </div>
    `,
  },
})
  .use(withGrid({ columns: 4, gap: 16 }))
  .use(withScrollbar({ autoHide: true }))
  .build();
```

**Bundle:** 11.7 KB gzipped

Grid mode virtualizes by **rows** - only visible rows are in the DOM. Each item is positioned with `translate(x, y)` for GPU-accelerated rendering.

### Sticky Headers (Contact List)

```typescript
import { vlist, withSections } from 'vlist';

const contacts = vlist({
  container: '#contacts',
  items: sortedContacts,  // Must be pre-sorted by group
  item: {
    height: 56,
    template: (contact) => `<div>${contact.name}</div>`,
  },
})
  .use(withSections({
    getGroupForIndex: (i) => contacts[i].lastName[0].toUpperCase(),
    headerHeight: 36,
    headerTemplate: (letter) => `<div class="header">${letter}</div>`,
    sticky: true,  // Headers stick to top (Telegram style)
  }))
  .build();
```

**Bundle:** 12.3 KB gzipped

Set `sticky: false` for inline headers (iMessage/WhatsApp style).

### Chat UI (Reverse + Sections)

```typescript
import { vlist, withSections } from 'vlist';

const chat = vlist({
  container: '#messages',
  reverse: true,  // Start at bottom, newest messages visible
  items: messages,  // Chronological order (oldest first)
  item: {
    height: (i) => messages[i].height || 60,
    template: (msg) => `<div class="message">${msg.text}</div>`,
  },
})
  .use(withSections({
    getGroupForIndex: (i) => {
      const date = new Date(messages[i].timestamp);
      return date.toLocaleDateString();  // "Jan 15", "Jan 16", etc.
    },
    headerHeight: 32,
    headerTemplate: (date) => `<div class="date-header">${date}</div>`,
    sticky: false,  // Inline date headers (iMessage style)
  }))
  .build();

// New messages - auto-scrolls to bottom
chat.appendItems([newMessage]);

// Load history - preserves scroll position
chat.prependItems(olderMessages);
```

**Bundle:** 11.9 KB gzipped

Perfect for iMessage, WhatsApp, Telegram-style chat interfaces.

### Large Datasets (1M+ Items)

```typescript
import { vlist, withScale, withScrollbar } from 'vlist';

const bigList = vlist({
  container: '#big-list',
  items: generateItems(5_000_000),
  item: {
    height: 48,
    template: (item) => `<div>#${item.id}: ${item.name}</div>`,
  },
})
  .use(withScale())  // Auto-activates when height > 16.7M pixels
  .use(withScrollbar({ autoHide: true }))
  .build();
```

**Bundle:** 9.9 KB gzipped

The scale plugin automatically compresses scroll space when total height exceeds browser limits (~16.7M pixels), enabling smooth scrolling through millions of items.

### Async Loading with Pagination

```typescript
import { vlist, withAsync } from 'vlist';

const list = vlist({
  container: '#list',
  item: {
    height: 64,
    template: (item) => {
      if (!item) return `<div class="loading">Loading...</div>`;
      return `<div>${item.name}</div>`;
    },
  },
})
  .use(withAsync({
    adapter: {
      read: async ({ offset, limit }) => {
        const response = await fetch(`/api/users?offset=${offset}&limit=${limit}`);
        const data = await response.json();
        return {
          items: data.items,
          total: data.total,
          hasMore: data.hasMore,
        };
      },
    },
    loading: {
      cancelThreshold: 15,  // Cancel loads when scrolling fast (pixels/ms)
    },
  }))
  .build();
```

**Bundle:** 13.5 KB gzipped

The async plugin shows placeholders for unloaded items and fetches data as you scroll. Velocity-aware loading cancels requests when scrolling fast.

### Page-Level Scrolling

```typescript
import { vlist, withPage } from 'vlist';

const list = vlist({
  container: '#list',
  items: articles,
  item: {
    height: 200,
    template: (article) => `<article>...</article>`,
  },
})
  .use(withPage())  // Uses document scroll instead of container
  .build();
```

**Bundle:** 8.6 KB gzipped

Perfect for blog posts, infinite scroll feeds, and full-page lists.

### Horizontal Carousel

```typescript
import { vlist } from 'vlist';

const carousel = vlist({
  container: '#carousel',
  direction: 'horizontal',
  items: cards,
  item: {
    width: 300,   // Required for horizontal
    height: 400,  // Optional (can use CSS)
    template: (card) => `<div class="card">...</div>`,
  },
  scroll: {
    wrap: true,  // Circular scrolling
  },
}).build();
```

**Bundle:** 8.6 KB gzipped

### Selection & Navigation

```typescript
import { vlist, withSelection } from 'vlist';

const list = vlist({
  container: '#list',
  items: users,
  item: {
    height: 48,
    template: (user, index, { selected }) => {
      const cls = selected ? 'item--selected' : '';
      return `<div class="${cls}">${user.name}</div>`;
    },
  },
})
  .use(withSelection({ 
    mode: 'multiple',
    initial: [1, 5, 10],  // Pre-select items
  }))
  .build();

// Selection API
list.selectItem(5);
list.deselectItem(5);
list.toggleSelection(5);
list.getSelectedIds();      // [1, 5, 10]
list.clearSelection();
```

**Bundle:** 10.0 KB gzipped

Supports `mode: 'single'` or `'multiple'` with keyboard navigation (Arrow keys, Home, End, Space, Enter).

### Variable Heights (Chat Messages)

```typescript
import { vlist } from 'vlist';

const list = vlist({
  container: '#messages',
  items: messages,
  item: {
    height: (index) => {
      // Heights computed from actual DOM measurements
      return messages[index].measuredHeight || 60;
    },
    template: (msg) => `
      <div class="message">
        <div class="author">${msg.user}</div>
        <div class="text">${msg.text}</div>
      </div>
    `,
  },
}).build();
```

**Bundle:** 10.9 KB gzipped

Variable heights use a prefix-sum array for O(1) offset lookups and O(log n) binary search.

## API Reference

### Core Methods

```typescript
const list = vlist(config).use(...plugins).build();

// Data manipulation
list.setItems(items: T[]): void
list.appendItems(items: T[]): void
list.prependItems(items: T[]): void
list.updateItem(id: string | number, item: Partial<T>): boolean
list.removeItem(id: string | number): boolean

// Navigation
list.scrollToIndex(index: number, align?: 'start' | 'center' | 'end'): void
list.scrollToIndex(index: number, options?: {
  align?: 'start' | 'center' | 'end',
  behavior?: 'auto' | 'smooth',
  duration?: number
}): void
list.scrollToItem(id: string | number, align?: string): void

// State
list.getScrollPosition(): number
list.getVisibleRange(): { start: number, end: number }
list.getScrollSnapshot(): ScrollSnapshot
list.restoreScroll(snapshot: ScrollSnapshot): void

// Events
list.on(event: string, handler: Function): Unsubscribe
list.off(event: string, handler: Function): void

// Lifecycle
list.destroy(): void

// Properties
list.element: HTMLElement
list.items: readonly T[]
list.total: number
```

### Selection Methods (with `withSelection()`)

```typescript
list.selectItem(id: string | number): void
list.deselectItem(id: string | number): void
list.toggleSelection(id: string | number): void
list.selectAll(): void
list.clearSelection(): void
list.getSelectedIds(): Array<string | number>
list.getSelectedItems(): T[]
list.setSelectionMode(mode: 'none' | 'single' | 'multiple'): void
```

### Grid Methods (with `withGrid()`)

```typescript
list.updateGrid(config: { columns?: number, gap?: number }): void
```

### Events

```typescript
list.on('scroll', ({ scrollTop, direction }) => { })
list.on('range:change', ({ range }) => { })
list.on('item:click', ({ item, index, event }) => { })
list.on('item:dblclick', ({ item, index, event }) => { })
list.on('selection:change', ({ selectedIds, selectedItems }) => { })
list.on('load:start', ({ offset, limit }) => { })
list.on('load:end', ({ items, offset, total }) => { })
list.on('load:error', ({ error, offset, limit }) => { })
list.on('velocity:change', ({ velocity, reliable }) => { })
```

## Configuration

### Base Configuration

```typescript
interface VListConfig<T> {
  // Required
  container: HTMLElement | string;
  item: {
    height?: number | ((index: number) => number);  // Required for vertical
    width?: number | ((index: number) => number);   // Required for horizontal
    template: (item: T, index: number, state: ItemState) => string | HTMLElement;
  };

  // Optional
  items?: T[];                    // Initial items
  overscan?: number;              // Extra items to render (default: 3)
  direction?: 'vertical' | 'horizontal';  // Default: 'vertical'
  reverse?: boolean;              // Reverse mode for chat (default: false)
  classPrefix?: string;           // CSS class prefix (default: 'vlist')
  ariaLabel?: string;             // Accessible label

  scroll?: {
    wheel?: boolean;              // Enable mouse wheel (default: true)
    wrap?: boolean;               // Circular scrolling (default: false)
    scrollbar?: 'none';           // Hide scrollbar
    idleTimeout?: number;         // Scroll idle detection (default: 150ms)
  };
}
```

### Plugin: `withGrid(config)`

2D grid layout with virtualized rows.

```typescript
interface GridConfig {
  columns: number;     // Number of columns (required)
  gap?: number;        // Gap between items in pixels (default: 0)
}
```

**Example:**
```typescript
.use(withGrid({ columns: 4, gap: 16 }))
```

### Plugin: `withSections(config)`

Grouped lists with sticky or inline headers.

```typescript
interface SectionsConfig {
  getGroupForIndex: (index: number) => string;
  headerHeight: number | ((group: string, groupIndex: number) => number);
  headerTemplate: (group: string, groupIndex: number) => string | HTMLElement;
  sticky?: boolean;  // Default: true (Telegram style), false = inline (iMessage style)
}
```

**Example:**
```typescript
.use(withSections({
  getGroupForIndex: (i) => items[i].category,
  headerHeight: 40,
  headerTemplate: (cat) => `<h2>${cat}</h2>`,
  sticky: true,
}))
```

**Important:** Items must be pre-sorted by group!

### Plugin: `withSelection(config)`

Single or multiple item selection with keyboard navigation.

```typescript
interface SelectionConfig {
  mode: 'single' | 'multiple';
  initial?: Array<string | number>;  // Pre-selected item IDs
}
```

**Example:**
```typescript
.use(withSelection({ 
  mode: 'multiple',
  initial: [1, 5, 10],
}))
```

### Plugin: `withAsync(config)`

Asynchronous data loading with lazy loading and placeholders.

```typescript
interface AsyncConfig {
  adapter: {
    read: (params: { offset: number, limit: number }) => Promise<{
      items: T[];
      total?: number;
      hasMore?: boolean;
    }>;
  };
  loading?: {
    cancelThreshold?: number;  // Cancel loads when scrolling fast (px/ms)
  };
}
```

**Example:**
```typescript
.use(withAsync({
  adapter: {
    read: async ({ offset, limit }) => {
      const response = await fetch(`/api?offset=${offset}&limit=${limit}`);
      return response.json();
    },
  },
  loading: {
    cancelThreshold: 15,  // Skip loads when scrolling > 15px/ms
  },
}))
```

### Plugin: `withScale()`

Automatically handles lists with 1M+ items by compressing scroll space when total height exceeds browser limits (~16.7M pixels).

```typescript
.use(withScale())  // No config needed - auto-activates
```

**Example:**
```typescript
const bigList = vlist({
  container: '#list',
  items: generateItems(5_000_000),
  item: { height: 48, template: renderItem },
})
  .use(withScale())
  .build();
```

### Plugin: `withScrollbar(config)`

Custom scrollbar with auto-hide and smooth dragging.

```typescript
interface ScrollbarConfig {
  autoHide?: boolean;        // Hide when not scrolling (default: false)
  autoHideDelay?: number;    // Hide delay in ms (default: 1000)
  minThumbSize?: number;     // Minimum thumb size in px (default: 20)
}
```

**Example:**
```typescript
.use(withScrollbar({ 
  autoHide: true,
  autoHideDelay: 1500,
}))
```

### Plugin: `withPage()`

Use document-level scrolling instead of container scrolling.

```typescript
.use(withPage())  // No config needed
```

**Example:**
```typescript
const list = vlist({
  container: '#list',
  items: articles,
  item: { height: 300, template: renderArticle },
})
  .use(withPage())
  .build();
```

Perfect for blog posts, infinite scroll feeds, and full-page lists.

### Plugin: `withSnapshots()`

Scroll position save/restore for SPA navigation.

```typescript
// Included in base - no need to import
const snapshot = list.getScrollSnapshot();
list.restoreScroll(snapshot);
```

**Example:**
```typescript
// Save on navigation away
const snapshot = list.getScrollSnapshot();
sessionStorage.setItem('scroll', JSON.stringify(snapshot));

// Restore on return
const snapshot = JSON.parse(sessionStorage.getItem('scroll'));
list.restoreScroll(snapshot);
```

## Advanced Usage

### Variable Heights with DOM Measurement

```typescript
import { vlist } from 'vlist';

// Measure items before creating list
const measuringDiv = document.createElement('div');
measuringDiv.style.cssText = 'position:absolute;visibility:hidden;width:400px';
document.body.appendChild(measuringDiv);

items.forEach(item => {
  measuringDiv.innerHTML = renderItem(item);
  item.measuredHeight = measuringDiv.offsetHeight;
});

document.body.removeChild(measuringDiv);

// Use measured heights
const list = vlist({
  container: '#list',
  items,
  item: {
    height: (i) => items[i].measuredHeight,
    template: renderItem,
  },
}).build();
```

### Dynamic Grid Columns

```typescript
import { vlist, withGrid } from 'vlist';

let currentColumns = 4;

const list = vlist({
  container: '#gallery',
  items: photos,
  item: {
    height: 200,
    template: renderPhoto,
  },
})
  .use(withGrid({ columns: currentColumns, gap: 16 }))
  .build();

// Update grid on resize
window.addEventListener('resize', () => {
  const width = container.clientWidth;
  const newColumns = width > 1200 ? 6 : width > 800 ? 4 : 2;
  if (newColumns !== currentColumns) {
    currentColumns = newColumns;
    list.updateGrid({ columns: newColumns });
  }
});
```

### Combining Multiple Plugins

```typescript
import { 
  vlist, 
  withGrid, 
  withSections, 
  withSelection, 
  withAsync,
  withScrollbar 
} from 'vlist';

const list = vlist({
  container: '#gallery',
  item: {
    height: 200,
    template: renderPhoto,
  },
})
  .use(withAsync({ adapter: photoAdapter }))
  .use(withGrid({ columns: 4, gap: 16 }))
  .use(withSections({
    getGroupForIndex: (i) => items[i]?.category || 'Loading...',
    headerHeight: 48,
    headerTemplate: (cat) => `<h2>${cat}</h2>`,
  }))
  .use(withSelection({ mode: 'multiple' }))
  .use(withScrollbar({ autoHide: true }))
  .build();
```

**Bundle:** ~15 KB gzipped (includes only used plugins)

## Framework Adapters

### React

```typescript
import { vlist, withSelection } from 'vlist';
import { useEffect, useRef } from 'react';

function MyList({ items }) {
  const containerRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    listRef.current = vlist({
      container: containerRef.current,
      items,
      item: { height: 48, template: renderItem },
    })
      .use(withSelection({ mode: 'single' }))
      .build();

    return () => listRef.current?.destroy();
  }, []);

  useEffect(() => {
    listRef.current?.setItems(items);
  }, [items]);

  return <div ref={containerRef} />;
}
```

### Vue 3

```typescript
import { vlist, withSelection } from 'vlist';
import { ref, onMounted, onUnmounted, watch } from 'vue';

export default {
  setup() {
    const container = ref(null);
    const list = ref(null);

    onMounted(() => {
      list.value = vlist({
        container: container.value,
        items: items.value,
        item: { height: 48, template: renderItem },
      })
        .use(withSelection({ mode: 'single' }))
        .build();
    });

    watch(items, (newItems) => {
      list.value?.setItems(newItems);
    });

    onUnmounted(() => {
      list.value?.destroy();
    });

    return { container };
  },
};
```

### Svelte

```typescript
<script>
  import { vlist, withSelection } from 'vlist';
  import { onMount, onDestroy } from 'svelte';

  export let items = [];
  
  let container;
  let list;

  onMount(() => {
    list = vlist({
      container,
      items,
      item: { height: 48, template: renderItem },
    })
      .use(withSelection({ mode: 'single' }))
      .build();
  });

  $: list?.setItems(items);

  onDestroy(() => {
    list?.destroy();
  });
</script>

<div bind:this={container}></div>
```

## Styling

Import the base styles:

```typescript
import 'vlist/styles';
```

Or customize with your own CSS:

```css
.vlist {
  /* Container styles */
}

.vlist-viewport {
  /* Scroll viewport */
}

.vlist-item {
  /* Item wrapper - positioned absolutely */
}

.vlist-item--selected {
  /* Selected state */
}

.vlist-item--focused {
  /* Focused state (keyboard navigation) */
}

.vlist-scrollbar {
  /* Custom scrollbar track */
}

.vlist-scrollbar__thumb {
  /* Scrollbar thumb/handle */
}
```

## Performance

### Bundle Sizes (Gzipped)

| Configuration | Size | What's Included |
|---------------|------|-----------------|
| Base only | 7.7 KB | Core virtualization |
| + Grid | 11.7 KB | + 2D layout |
| + Sections | 12.3 KB | + Grouped lists |
| + Selection | 10.0 KB | + Item selection |
| + Async | 13.5 KB | + Data loading |
| + Scale | 9.9 KB | + 1M+ items |
| + All plugins | ~16 KB | Everything |

**Traditional virtual lists:** 20-23 KB minimum (all features bundled regardless of usage)

### Memory Efficiency

With 100,000 items at 48px each:
- **Total height:** 4,800,000 pixels
- **Visible items:** ~20 (depending on viewport height)
- **DOM nodes:** ~26 (visible + overscan)
- **Memory saved:** ~99.97% (26 DOM nodes vs 100,000)

### Benchmarks

See [benchmarks](https://vlist.dev/benchmarks/) for detailed performance comparisons.

## Browser Support

- Chrome/Edge: Latest 2 versions
- Firefox: Latest 2 versions
- Safari: Latest 2 versions
- iOS Safari: 12.4+
- Chrome Android: Latest

Relies on:
- `IntersectionObserver` (widely supported)
- `ResizeObserver` (polyfill available if needed)
- CSS `transform` (universal support)

## TypeScript

Fully typed with comprehensive TypeScript definitions:

```typescript
import { vlist, withGrid, type VList, type VListConfig } from 'vlist';

interface Photo {
  id: number;
  url: string;
  title: string;
}

const config: VListConfig<Photo> = {
  container: '#gallery',
  items: photos,
  item: {
    height: 200,
    template: (photo: Photo) => `<img src="${photo.url}" />`,
  },
};

const list: VList<Photo> = vlist(config)
  .use(withGrid({ columns: 4 }))
  .build();
```

## Migration from Monolithic API

If you're using the old monolithic API:

### Before (Monolithic - Deprecated)

```typescript
import { createVList } from 'vlist';

const list = createVList({
  container: '#app',
  items: data,
  grid: { columns: 4 },
  groups: { ... },
  selection: { mode: 'single' },
});
```

### After (Builder - Recommended)

```typescript
import { vlist, withGrid, withSections, withSelection } from 'vlist';

const list = vlist({
  container: '#app',
  items: data,
})
  .use(withGrid({ columns: 4 }))
  .use(withSections({ ... }))
  .use(withSelection({ mode: 'single' }))
  .build();
```

**Benefits:**
- 2-3x smaller bundles (20 KB → 8-12 KB gzipped)
- Explicit about what's included
- Better tree-shaking
- Easier to understand and debug

## Plugin Naming Changes

If you're upgrading from an earlier version:

| Old Name | New Name | Import |
|----------|----------|--------|
| `withCompression()` | `withScale()` | `import { withScale } from 'vlist'` |
| `withData()` | `withAsync()` | `import { withAsync } from 'vlist'` |
| `withWindow()` | `withPage()` | `import { withPage } from 'vlist'` |
| `withGroups()` | `withSections()` | `import { withSections } from 'vlist'` |
| `withScroll()` | `withScrollbar()` | `import { withScrollbar } from 'vlist'` |

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add/update tests
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details

## Links

- **Documentation & Examples:** [vlist.dev](https://vlist.dev)
- **GitHub:** [github.com/floor/vlist](https://github.com/floor/vlist)
- **NPM:** [@floor/vlist](https://www.npmjs.com/package/@floor/vlist)
- **Issues:** [GitHub Issues](https://github.com/floor/vlist/issues)

---

**Built by [Floor IO](https://floor.io)** with ❤️ for the web community