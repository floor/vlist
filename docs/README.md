# vlist Documentation

> Comprehensive documentation for the vlist virtual list library.

## Quick Links

- **[Main Documentation](./vlist.md)** - Getting started, configuration, and usage
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
- Viewport-relative positioning
- Compression for 1M+ items
- Efficient DOM updates

### Data Module
- Sparse storage (chunk-based)
- Memory-efficient (configurable limits)
- Smart placeholder generation
- Request deduplication

### Scroll Module
- Native and manual scrolling modes
- Custom scrollbar for compressed mode
- Velocity tracking
- Idle detection

### Selection Module
- Single/multiple selection modes
- Keyboard navigation
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
  itemHeight: 48,              // Fixed height in pixels
  template: (item) => `...`,   // Render function
  
  // Data source (one of)
  items: [],                   // Static array
  adapter: { read: async () => ... },  // Async loader
  
  // Optional
  overscan: 3,                 // Extra items to render
  classPrefix: 'vlist',        // CSS class prefix
  selection: {
    mode: 'multiple',          // 'none' | 'single' | 'multiple'
    initial: ['id-1']          // Pre-selected IDs
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