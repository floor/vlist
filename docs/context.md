# Context Module

> Internal state container that wires all vlist domains together.

## Overview

The context module provides a central coordination point for all vlist internal components. It acts as a **facade** that:

- Holds references to all domain managers (data, scroll, renderer, etc.)
- Manages mutable state (viewport, selection, render range)
- Provides helper methods for common operations
- Enables dependency injection for handlers and methods

## Module Structure

```
src/
└── context.ts  # Context creation and management
```

## Key Concepts

### Composition Root

The context is created in `vlist.ts` after all components are instantiated, serving as the single point where everything comes together:

```
createVList()
    ↓
Create individual components:
  - DataManager
  - ScrollController
  - Renderer
  - Emitter
  - Scrollbar (optional)
    ↓
Create Context (wires everything together)
    ↓
Create Handlers (receive context)
    ↓
Create Methods (receive context)
    ↓
Return Public API
```

### Immutable Config vs Mutable State

The context separates immutable configuration from mutable runtime state:

```typescript
// Immutable - set once at creation
readonly config: VListContextConfig;

// Mutable - changes during runtime
state: VListContextState;
```

### Helper Methods

Context provides commonly-needed operations to avoid duplicating logic:

```typescript
getItemsForRange(range)      // Get items from data manager
getAllLoadedItems()          // Get all loaded items
getCompressionContext()      // Get compression positioning context
getCachedCompression()       // Get cached compression state
```

## API Reference

### `createContext`

Creates a VListContext from individual components.

```typescript
function createContext<T extends VListItem>(
  config: VListContextConfig,
  dom: DOMStructure,
  dataManager: DataManager<T>,
  scrollController: ScrollController,
  renderer: Renderer<T>,
  emitter: Emitter<VListEvents<T>>,
  scrollbar: Scrollbar | null,
  initialState: VListContextState
): VListContext<T>;
```

### VListContextConfig

Immutable configuration extracted from VListConfig.

```typescript
interface VListContextConfig {
  readonly itemHeight: number;
  readonly overscan: number;
  readonly classPrefix: string;
  readonly selectionMode: SelectionMode;
  readonly hasAdapter: boolean;
}
```

### VListContextState

Mutable state managed by the context.

```typescript
interface VListContextState {
  /** Current viewport state (scroll position, ranges) */
  viewportState: ViewportState;
  
  /** Current selection state */
  selectionState: SelectionState;
  
  /** Last rendered range (for change detection) */
  lastRenderRange: Range;
  
  /** Whether vlist has been initialized */
  isInitialized: boolean;
  
  /** Whether vlist has been destroyed */
  isDestroyed: boolean;
  
  /** Cached compression state (invalidated when totalItems changes) */
  cachedCompression: CachedCompression | null;
}

interface CachedCompression {
  state: CompressionState;
  totalItems: number;
}
```

### VListContext Interface

```typescript
interface VListContext<T extends VListItem> {
  // Immutable configuration
  readonly config: VListContextConfig;
  
  // DOM structure
  readonly dom: DOMStructure;
  
  // Stateful managers
  readonly dataManager: DataManager<T>;
  readonly scrollController: ScrollController;
  readonly renderer: Renderer<T>;
  readonly emitter: Emitter<VListEvents<T>>;
  readonly scrollbar: Scrollbar | null;
  
  // Mutable state
  state: VListContextState;
  
  // Helper methods
  getItemsForRange: (range: Range) => T[];
  getAllLoadedItems: () => T[];
  getCompressionContext: () => CompressionContext;
  getCachedCompression: () => CompressionState;
}
```

## Usage Examples

### Accessing Context in Handlers

```typescript
// In handlers.ts
export const createScrollHandler = <T extends VListItem>(
  ctx: VListContext<T>,
  renderIfNeeded: RenderFunction
) => {
  return (scrollTop: number, direction: 'up' | 'down'): void => {
    if (ctx.state.isDestroyed) return;
    
    // Access data manager
    const total = ctx.dataManager.getTotal();
    
    // Update viewport state
    ctx.state.viewportState = updateViewportState(
      ctx.state.viewportState,
      scrollTop,
      ctx.config.itemHeight,
      total,
      ctx.config.overscan
    );
    
    // Update scrollbar
    if (ctx.scrollbar) {
      ctx.scrollbar.updatePosition(scrollTop);
      ctx.scrollbar.show();
    }
    
    // Trigger render
    renderIfNeeded();
    
    // Emit event
    ctx.emitter.emit('scroll', { scrollTop, direction });
  };
};
```

### Accessing Context in Methods

```typescript
// In methods.ts
export const createScrollMethods = <T extends VListItem>(
  ctx: VListContext<T>
): ScrollMethods => {
  let animationFrameId: number | null = null;

  const cancelScroll = (): void => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };

  const animateScroll = (from: number, to: number, duration: number): void => {
    cancelScroll();
    if (Math.abs(to - from) < 1) { ctx.scrollController.scrollTo(to); return; }
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min((now - start) / duration, 1);
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      ctx.scrollController.scrollTo(from + (to - from) * eased);
      if (t < 1) animationFrameId = requestAnimationFrame(tick);
      else animationFrameId = null;
    };
    animationFrameId = requestAnimationFrame(tick);
  };

  const scrollToIndex = (index, alignOrOptions?) => {
    const { align, behavior, duration } = resolveScrollArgs(alignOrOptions);
    const dataState = ctx.dataManager.getState();
    const position = calculateScrollToIndex(
      index,
      ctx.config.itemHeight,
      ctx.state.viewportState.containerHeight,
      dataState.total,
      align,
      ctx.getCachedCompression()
    );
    
    if (behavior === 'smooth') {
      animateScroll(ctx.scrollController.getScrollTop(), position, duration);
    } else {
      cancelScroll();
      ctx.scrollController.scrollTo(position);
    }
  };

  return {
    scrollToIndex,
    
    scrollToItem: (id, alignOrOptions?) => {
      const index = ctx.dataManager.getIndexById(id);
      if (index >= 0) {
        scrollToIndex(index, alignOrOptions);
      }
    },

    cancelScroll,
    
    getScrollPosition: () => {
      return ctx.scrollController.getScrollTop();
    }
  };
};
```

### Using Helper Methods

```typescript
// Get items for rendering
const items = ctx.getItemsForRange(ctx.state.viewportState.renderRange);

// Get all items for selection operations
const allItems = ctx.getAllLoadedItems();

// Get compression context for positioning
const compressionCtx = ctx.state.viewportState.isCompressed
  ? ctx.getCompressionContext()
  : undefined;

// Get cached compression state (avoids recalculation)
const compression = ctx.getCachedCompression();
```

### Rendering with Context

```typescript
function render(ctx: VListContext<T>): void {
  if (ctx.state.isDestroyed) return;
  
  const { renderRange, isCompressed } = ctx.state.viewportState;
  
  // Get items using helper
  const items = ctx.getItemsForRange(renderRange);
  
  // Get compression context if needed
  const compressionCtx = isCompressed
    ? ctx.getCompressionContext()
    : undefined;
  
  // Render via renderer
  ctx.renderer.render(
    items,
    renderRange,
    ctx.state.selectionState.selected,
    ctx.state.selectionState.focusedIndex,
    compressionCtx
  );
  
  // Update last render range
  ctx.state.lastRenderRange = { ...renderRange };
  
  // Emit event
  ctx.emitter.emit('range:change', { range: renderRange });
}
```

## Implementation Details

### Reusable Compression Context

To avoid object allocation on every scroll frame, the compression context is reused:

```typescript
// Single object reused across calls
const reusableCompressionCtx: CompressionContext = {
  scrollTop: 0,
  totalItems: 0,
  containerHeight: 0,
  rangeStart: 0
};

const getCompressionContext = (): CompressionContext => {
  // Update values in place
  reusableCompressionCtx.scrollTop = state.viewportState.scrollTop;
  reusableCompressionCtx.totalItems = dataManager.getTotal();
  reusableCompressionCtx.containerHeight = state.viewportState.containerHeight;
  reusableCompressionCtx.rangeStart = state.viewportState.renderRange.start;
  return reusableCompressionCtx;
};
```

### Compression Caching

Compression state is cached and only recalculated when `totalItems` changes:

```typescript
const getCachedCompression = (): CompressionState => {
  const totalItems = dataManager.getTotal();
  
  // Return cached if still valid
  if (state.cachedCompression?.totalItems === totalItems) {
    return state.cachedCompression.state;
  }
  
  // Recalculate and cache
  const compression = getCompressionState(totalItems, config.itemHeight);
  state.cachedCompression = { state: compression, totalItems };
  return compression;
};
```

### Destroyed State Check

All operations should check `isDestroyed` before proceeding:

```typescript
if (ctx.state.isDestroyed) return;
```

This prevents operations after `destroy()` is called.

## Context Flow

### Creation Flow

```
1. vlist.ts creates all components
2. createContext() wires them together
3. Context passed to handler factories
4. Context passed to method factories
5. Handlers and methods have access to everything
```

### Runtime Flow

```
Event occurs (scroll, click, etc.)
    ↓
Handler receives event
    ↓
Handler accesses ctx.dataManager, ctx.state, etc.
    ↓
Handler updates ctx.state
    ↓
Handler triggers render or emits events via ctx
    ↓
Renderer uses ctx to get items and state
```

### Destruction Flow

```
destroy() called on VList instance
    ↓
ctx.state.isDestroyed = true
    ↓
All handlers check isDestroyed and return early
    ↓
Components destroyed (scrollController, renderer, etc.)
    ↓
Emitter cleared
    ↓
DOM removed
```

## Best Practices

### Do

```typescript
// ✅ Check destroyed state
if (ctx.state.isDestroyed) return;

// ✅ Use helper methods
const items = ctx.getItemsForRange(range);

// ✅ Use direct getters on hot paths
const total = ctx.dataManager.getTotal();  // No object allocation

// ✅ Update state immutably when appropriate
ctx.state.selectionState = selectItems(ctx.state.selectionState, ids, mode);
```

### Don't

```typescript
// ❌ Access internal state without checking destroyed
ctx.state.viewportState.scrollTop = 0;  // Check isDestroyed first!

// ❌ Create objects on hot paths
const state = ctx.dataManager.getState();  // Allocates object
// Use ctx.dataManager.getTotal() instead

// ❌ Hold references to mutable state
const savedState = ctx.state;  // State will change!
```

## Related Modules

- [vlist.md](./vlist.md) - Main documentation, shows context creation
- [handlers.md](./handlers.md) - Handlers that use context
- [methods.md](./methods.md) - Methods that use context
- [render.md](./render.md) - DOMStructure, Renderer interfaces
- [data.md](./data.md) - DataManager interface
- [scroll.md](./scroll.md) - ScrollController interface
- [events.md](./events.md) - Emitter interface

---

*The context module is the glue that holds all vlist components together.*