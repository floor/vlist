# Handlers Module

> Event handlers for scroll, click, and keyboard interactions in vlist.

## Overview

The handlers module provides factory functions that create event handlers for vlist. Each handler receives the context and returns a function that processes events:

- **Scroll Handler**: Processes scroll events, updates viewport, triggers data loading
- **Click Handler**: Handles item clicks, manages selection
- **Keyboard Handler**: Handles keyboard navigation and selection

## Module Structure

```
src/
└── handlers.ts  # All event handler factories
```

## Key Concepts

### Handler Factories

Handlers are created using factory functions that receive the context:

```typescript
// Factory pattern
const handleScroll = createScrollHandler(ctx, renderIfNeeded);
const handleClick = createClickHandler(ctx, forceRender);
const handleKeydown = createKeyboardHandler(ctx, scrollToIndex);

// Attach to DOM
dom.viewport.addEventListener('scroll', handleScroll);
dom.items.addEventListener('click', handleClick);
dom.root.addEventListener('keydown', handleKeydown);
```

### Separation of Concerns

Handlers focus on:
1. Processing the raw event
2. Updating state via context
3. Triggering side effects (render, emit events)

They do NOT:
- Manage DOM structure
- Hold their own state
- Know about the public API

## API Reference

### Scroll Handler

#### `createScrollHandler`

Creates the scroll event handler.

```typescript
function createScrollHandler<T extends VListItem>(
  ctx: VListContext<T>,
  renderIfNeeded: RenderFunction
): (scrollTop: number, direction: 'up' | 'down') => void;

type RenderFunction = () => void;
```

**Responsibilities:**
- Update viewport state with new scroll position
- Update custom scrollbar position (if present)
- Trigger render when range changes
- Emit scroll events
- Trigger infinite scroll data loading
- Ensure visible range data is loaded
- **Velocity-based load cancellation**: Skip loading when scrolling fast
- **Preloading**: Load items ahead based on scroll direction at medium velocity

**Usage:**
```typescript
const handleScroll = createScrollHandler(ctx, renderIfNeeded);

// Called by scroll controller
handleScroll(scrollTop, 'down');
```

**Velocity-Based Loading:**

The scroll handler implements intelligent loading based on scroll velocity:

| Velocity | Behavior |
|----------|----------|
| Slow (< `preloadThreshold`) | Load visible range only |
| Medium (`preloadThreshold` to `cancelThreshold`) | Preload items ahead in scroll direction |
| Fast (> `cancelThreshold`) | Skip loading, defer to idle |

The thresholds are configurable via `LoadingConfig`:

```typescript
// In VListConfig
loading: {
  cancelThreshold: 25,    // px/ms - skip loading above this
  preloadThreshold: 2,    // px/ms - start preloading above this
  preloadAhead: 50,       // items to preload ahead
}
```

When velocity drops below `cancelThreshold`, any pending range is loaded immediately for smooth transitions.

### Click Handler

#### `createClickHandler`

Creates the item click handler.

```typescript
function createClickHandler<T extends VListItem>(
  ctx: VListContext<T>,
  forceRender: RenderFunction
): (event: MouseEvent) => void;

type RenderFunction = () => void;
```

**Responsibilities:**
- Find clicked item from event target
- Emit item click events
- Update selection state (if selection enabled)
- Update focused index
- Re-render affected items
- Emit selection change events

**Usage:**
```typescript
const handleClick = createClickHandler(ctx, forceRender);

// Attach to items container
dom.items.addEventListener('click', handleClick);
```

### Keyboard Handler

#### `createKeyboardHandler`

Creates the keyboard navigation handler.

```typescript
function createKeyboardHandler<T extends VListItem>(
  ctx: VListContext<T>,
  scrollToIndex: ScrollToIndexFunction
): (event: KeyboardEvent) => void;

type ScrollToIndexFunction = (
  index: number,
  align?: 'start' | 'center' | 'end'
) => void;
```

**Responsibilities:**
- Handle arrow keys for focus navigation
- Handle Home/End for first/last navigation
- Handle Space/Enter for selection toggle
- Scroll focused item into view
- Re-render with updated focus
- Emit selection change events

**Supported Keys:**
| Key | Action |
|-----|--------|
| `↑` Arrow Up | Move focus up |
| `↓` Arrow Down | Move focus down |
| `Home` | Move focus to first item |
| `End` | Move focus to last item |
| `Space` | Toggle selection on focused item |
| `Enter` | Toggle selection on focused item |

**Usage:**
```typescript
const handleKeydown = createKeyboardHandler(ctx, scrollMethods.scrollToIndex);

// Attach to root for keyboard focus
dom.root.addEventListener('keydown', handleKeydown);
```

## Usage Examples

### Scroll Handler in Detail

```typescript
const handleScroll = createScrollHandler(ctx, renderIfNeeded);

// What happens when scroll occurs:
function handleScrollInternal(scrollTop: number, direction: 'up' | 'down') {
  // 1. Check if destroyed
  if (ctx.state.isDestroyed) return;
  
  // 2. Update viewport state
  ctx.state.viewportState = updateViewportState(
    ctx.state.viewportState,
    scrollTop,
    ctx.config.itemHeight,
    ctx.dataManager.getTotal(),
    ctx.config.overscan
  );
  
  // 3. Update scrollbar
  if (ctx.scrollbar) {
    ctx.scrollbar.updatePosition(scrollTop);
    ctx.scrollbar.show();
  }
  
  // 4. Render if needed
  renderIfNeeded();
  
  // 5. Emit scroll event
  ctx.emitter.emit('scroll', { scrollTop, direction });
  
  // 6. Check for infinite scroll
  if (shouldLoadMore()) {
    ctx.emitter.emit('load:start', { offset, limit });
    ctx.dataManager.loadMore();
  }
  
  // 7. Ensure visible data is loaded
  ctx.dataManager.ensureRange(renderRange.start, renderRange.end);
}
```

### Click Handler in Detail

```typescript
const handleClick = createClickHandler(ctx, forceRender);

// What happens when item is clicked:
function handleClickInternal(event: MouseEvent) {
  // 1. Check if destroyed
  if (ctx.state.isDestroyed) return;
  
  // 2. Find clicked item
  const target = event.target as HTMLElement;
  const itemElement = target.closest('[data-index]');
  if (!itemElement) return;
  
  const index = parseInt(itemElement.dataset.index, 10);
  const item = ctx.dataManager.getItem(index);
  if (!item) return;
  
  // 3. Emit click event
  ctx.emitter.emit('item:click', { item, index, event });
  
  // 4. Handle selection (if enabled)
  if (ctx.config.selectionMode !== 'none') {
    // Update focus
    ctx.state.selectionState = setFocusedIndex(
      ctx.state.selectionState,
      index
    );
    
    // Toggle selection
    ctx.state.selectionState = toggleSelection(
      ctx.state.selectionState,
      item.id,
      ctx.config.selectionMode
    );
    
    // Re-render
    const items = ctx.getItemsForRange(ctx.state.viewportState.renderRange);
    ctx.renderer.render(items, range, selected, focusedIndex, compressionCtx);
    
    // Emit selection change
    ctx.emitter.emit('selection:change', {
      selected: getSelectedIds(ctx.state.selectionState),
      items: getSelectedItems(ctx.state.selectionState, ctx.getAllLoadedItems())
    });
  }
}
```

### Keyboard Handler in Detail

```typescript
const handleKeydown = createKeyboardHandler(ctx, scrollToIndex);

// What happens on keypress:
function handleKeydownInternal(event: KeyboardEvent) {
  // 1. Check if destroyed or selection disabled
  if (ctx.state.isDestroyed || ctx.config.selectionMode === 'none') return;
  
  const totalItems = ctx.dataManager.getTotal();
  let newState = ctx.state.selectionState;
  let handled = false;
  
  // 2. Process key
  switch (event.key) {
    case 'ArrowUp':
      newState = moveFocusUp(newState, totalItems);
      handled = true;
      break;
      
    case 'ArrowDown':
      newState = moveFocusDown(newState, totalItems);
      handled = true;
      break;
      
    case 'Home':
      newState = moveFocusToFirst(newState, totalItems);
      handled = true;
      break;
      
    case 'End':
      newState = moveFocusToLast(newState, totalItems);
      handled = true;
      break;
      
    case ' ':
    case 'Enter':
      if (newState.focusedIndex >= 0) {
        const item = ctx.dataManager.getItem(newState.focusedIndex);
        if (item) {
          newState = toggleSelection(newState, item.id, ctx.config.selectionMode);
        }
        handled = true;
      }
      break;
  }
  
  // 3. If handled, update state and render
  if (handled) {
    event.preventDefault();
    ctx.state.selectionState = newState;
    
    // Scroll focused item into view
    if (newState.focusedIndex >= 0) {
      scrollToIndex(newState.focusedIndex, 'center');
    }
    
    // Re-render
    const items = ctx.getItemsForRange(ctx.state.viewportState.renderRange);
    ctx.renderer.render(items, range, selected, focusedIndex, compressionCtx);
    
    // Emit selection change (for Space/Enter)
    if (event.key === ' ' || event.key === 'Enter') {
      ctx.emitter.emit('selection:change', { selected, items });
    }
  }
}
```

## Implementation Details

### Hot Path Optimization

The scroll handler is on the hot path (called ~60fps during scroll). Optimizations include:

```typescript
// Use direct getters to avoid object allocation
const total = ctx.dataManager.getTotal();  // ✅ No allocation
// Instead of:
const { total } = ctx.dataManager.getState();  // ❌ Creates object

// Track last ensured range to avoid redundant calls
let lastEnsuredRange: Range | null = null;

if (!lastEnsuredRange || 
    renderRange.start !== lastEnsuredRange.start ||
    renderRange.end !== lastEnsuredRange.end) {
  lastEnsuredRange = { ...renderRange };
  ctx.dataManager.ensureRange(renderRange.start, renderRange.end);
}
```

### Event Delegation

Click handling uses event delegation on the items container:

```typescript
// Single listener on container
dom.items.addEventListener('click', handleClick);

// Find actual item via closest()
const itemElement = target.closest('[data-index]');
```

This is more efficient than attaching listeners to each item.

### Guard Conditions

All handlers check for destroyed state first:

```typescript
if (ctx.state.isDestroyed) return;
```

Selection handlers also check mode:

```typescript
if (ctx.config.selectionMode === 'none') return;
```

### Infinite Scroll Trigger

The scroll handler triggers data loading when near the bottom:

```typescript
const LOAD_MORE_THRESHOLD = 200;  // pixels from bottom

const distanceFromBottom = 
  totalHeight - scrollTop - containerHeight;

if (distanceFromBottom < LOAD_MORE_THRESHOLD) {
  if (!ctx.dataManager.getIsLoading() && ctx.dataManager.getHasMore()) {
    ctx.emitter.emit('load:start', { offset, limit });
    ctx.dataManager.loadMore();
  }
}
```

## Handler Registration

In `vlist.ts`, handlers are registered to DOM elements:

```typescript
// Create handlers
const handleScroll = createScrollHandler(ctx, renderIfNeeded);
const handleClick = createClickHandler(ctx, forceRender);
const handleKeydown = createKeyboardHandler(ctx, scrollMethods.scrollToIndex);

// Attach to DOM
dom.items.addEventListener('click', handleClick);
dom.root.addEventListener('keydown', handleKeydown);

// Scroll handler is called by scroll controller, not directly
// scrollController calls handleScroll(scrollTop, direction)
```

### Cleanup

Handlers are removed on destroy:

```typescript
const destroy = (): void => {
  ctx.state.isDestroyed = true;
  
  // Remove event listeners
  dom.items.removeEventListener('click', handleClick);
  dom.root.removeEventListener('keydown', handleKeydown);
  
  // Cleanup components
  scrollController.destroy();
  scrollbar?.destroy();
  renderer.destroy();
  emitter.clear();
  
  // Remove DOM
  dom.root.remove();
};
```

## Error Handling

Handlers should catch and report errors:

```typescript
// In scroll handler
ctx.dataManager.loadMore().catch((error) => {
  ctx.emitter.emit('error', { error, context: 'loadMore' });
});

ctx.dataManager.ensureRange(start, end).catch((error) => {
  ctx.emitter.emit('error', { error, context: 'ensureRange' });
});
```

## Related Modules

- [context.md](./context.md) - Context passed to handlers
- [methods.md](./methods.md) - Public methods (scrollToIndex used by keyboard handler)
- [selection.md](./selection.md) - Selection state management functions
- [render.md](./render.md) - Viewport state updates
- [events.md](./events.md) - Event emission

---

*The handlers module processes user interactions and coordinates updates across the system.*