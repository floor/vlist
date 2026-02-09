# vlist Documentation

> Comprehensive documentation for the vlist virtual list library.

## Quick Links

- **[Main Documentation](./vlist.md)** - Getting started, configuration, and usage
- **[Optimization Guide](./optimization.md)** - Performance optimizations and tuning
- **[Styles Guide](./styles.md)** - CSS tokens, variants, dark mode, split core/extras CSS, and customization
- **[Compression Guide](./compression.md)** - Handling large lists (1M+ items)

## Module Documentation

Each module has detailed documentation covering its API, usage examples, and implementation details.

### Core Modules

| Module | Description | File |
|--------|-------------|------|
| **[Types](./types.md)** | TypeScript interfaces and type definitions | `src/types.ts` |
| **[Constants](./constants.md)** | Default values and configuration constants | `src/constants.ts` |
| **[Context](./context.md)** | Internal state container and coordination | `src/context.ts` |

### Feature Modules

| Module | Description | Directory |
|--------|-------------|-----------|
| **[Render](./render.md)** | DOM rendering, virtualization, and compression | `src/render/` |
| **[Data](./data.md)** | Data management, sparse storage, and placeholders | `src/data/` |
| **[Scroll](./scroll.md)** | Scroll controller and custom scrollbar | `src/scroll/` |
| **[Selection](./selection.md)** | Selection state management | `src/selection/` |
| **[Events](./events.md)** | Type-safe event emitter system | `src/events/` |

### API Modules

| Module | Description | File |
|--------|-------------|------|
| **[Handlers](./handlers.md)** | Scroll, click, and keyboard event handlers | `src/handlers.ts` |
| **[Methods](./methods.md)** | Public API methods (data, scroll, selection) | `src/methods.ts` |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        createVList()                         │
│                         (vlist.ts)                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         Context                              │
│  Wires together all components and manages mutable state     │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  DataManager  │   │ ScrollController│   │   Renderer    │
│ (sparse data) │   │ (native/manual)│   │ (DOM pooling) │
└───────────────┘   └───────────────┘   └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│    Adapter    │   │   Scrollbar   │   │  Compression  │
│ (async fetch) │   │   (custom)    │   │ (large lists) │
└───────────────┘   └───────────────┘   └───────────────┘
```

## Data Flow

### Scroll Event Flow

```
User scrolls
    ↓
ScrollController detects scroll
    ↓
Scroll Handler updates ViewportState
    ↓
Calculate new visible/render range
    ↓
DataManager.ensureRange() loads missing data
    ↓
Renderer.render() updates DOM
    ↓
Emit 'scroll' and 'range:change' events
```

### Selection Event Flow

```
User clicks item (or presses Space/Enter)
    ↓
Click/Keyboard Handler processes event
    ↓
Update SelectionState (immutable)
    ↓
Renderer.render() updates DOM
    ↓
Emit 'item:click' and 'selection:change' events
```

### Data Loading Flow

```
Adapter mode: scroll near bottom
    ↓
Scroll Handler detects threshold
    ↓
Emit 'load:start' event
    ↓
DataManager.loadMore() calls Adapter.read()
    ↓
Store items in SparseStorage
    ↓
Renderer.render() replaces placeholders
    ↓
Emit 'load:end' event
```

## Key Features by Module

### Render Module
- Element pooling for performance
- DocumentFragment batching for bulk DOM operations
- Viewport-relative positioning
- Compression for 1M+ items
- CSS containment (`contain: layout style` on items container, `contain: content` + `will-change: transform` on items)
- CSS-only static positioning (only dynamic `height` set via JS)
- Reusable ItemState object to reduce GC pressure
- Targeted keyboard focus render (updates only 2 affected items on arrow keys)

### Data Module
- Sparse storage (chunk-based) with LRU eviction
- Memory-efficient (configurable limits)
- Smart placeholder generation
- Request deduplication
- Batched LRU timestamps (`touchChunksForRange()` — single `Date.now()` per render)
- Direct state getters (`getTotal()`, `getCached()`) for zero-allocation hot paths

### Scroll Module
- Native and manual scrolling modes
- Custom scrollbar for compressed mode
- Circular buffer velocity tracking (zero allocations during scroll)
- RAF-throttled native scroll (at most one processing per animation frame)
- Configurable idle detection (`idleTimeout` option, default: 150ms)
- Scroll transition suppression (`.vlist--scrolling` class during active scroll)
- Velocity-based configurable chunk preloading

### Selection Module
- Single/multiple selection modes
- Keyboard navigation with in-place focus mutation (zero allocations)
- Range selection (shift+click)
- Pure functional state management

### Events Module
- Type-safe event system
- Error isolation per handler
- Subscription management
- Memory-safe cleanup

## Configuration Quick Reference

```typescript
const list = createVList({
  // Required
  container: '#app',           // HTMLElement or selector
  item: {
    height: 48,                // Fixed height in pixels
    template: (item) => `...`, // Render function
  },
  
  // Data source (one of)
  items: [],                   // Static array
  adapter: { read: async () => ... },  // Async loader
  
  // Optional
  overscan: 3,                 // Extra items to render
  classPrefix: 'vlist',        // CSS class prefix
  idleTimeout: 150,            // Scroll idle detection (ms)
  selection: {
    mode: 'multiple',          // 'none' | 'single' | 'multiple'
    initial: ['id-1']          // Pre-selected IDs
  },
  loading: {
    cancelThreshold: 25,       // Skip loading above this velocity (px/ms)
    preloadThreshold: 2,       // Start preloading above this velocity (px/ms)
    preloadAhead: 50,          // Items to preload in scroll direction
  },
  scrollbar: {
    enabled: true,             // Auto-enabled in compressed mode
    autoHide: true,
    autoHideDelay: 1000,
    minThumbSize: 30
  }
});
```

## Browser Support

- Chrome/Edge 88+
- Firefox 78+
- Safari 14+

Requires:
- ES2020+
- CSS Custom Properties
- ResizeObserver
- requestAnimationFrame

## License

GPL-3.0-or-later

---

*For the main getting started guide, see [vlist.md](./vlist.md).*