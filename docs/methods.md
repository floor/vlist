# Methods Module

> Public API methods for data, scroll, and selection operations in vlist.

## Overview

The methods module provides factory functions that create the public API methods for vlist instances. Each factory receives the context and returns an object with related methods:

- **Data Methods**: Item manipulation (setItems, updateItem, removeItem, etc.)
- **Scroll Methods**: Navigation (scrollToIndex, scrollToItem, getScrollPosition)
- **Selection Methods**: Selection management (select, deselect, selectAll, etc.)

## Module Structure

```
src/
└── methods.ts  # All method factories
```

## Key Concepts

### Method Factories

Methods are created using factory functions that receive the context:

```typescript
// Factory pattern
const dataMethods = createDataMethods(ctx);
const scrollMethods = createScrollMethods(ctx);
const selectionMethods = createSelectionMethods(ctx);

// Methods are spread into public API
return {
  ...dataMethods,
  ...scrollMethods,
  select: selectionMethods.select,
  deselect: selectionMethods.deselect,
  // ...
};
```

### Separation from Handlers

| Handlers | Methods |
|----------|---------|
| React to DOM events | Called programmatically |
| Internal implementation | Public API |
| Receive raw events | Receive clean parameters |

## API Reference

### Data Methods

#### `createDataMethods`

Creates data manipulation methods.

```typescript
function createDataMethods<T extends VListItem>(
  ctx: VListContext<T>
): DataMethods<T>;

interface DataMethods<T extends VListItem> {
  /** Set items (replaces all) */
  setItems: (items: T[]) => void;
  
  /** Append items to the end */
  appendItems: (items: T[]) => void;
  
  /** Prepend items to the start */
  prependItems: (items: T[]) => void;
  
  /** Update a single item by ID */
  updateItem: (id: string | number, updates: Partial<T>) => void;
  
  /** Remove item by ID */
  removeItem: (id: string | number) => void;
  
  /** Reload data (if using adapter) */
  reload: () => Promise<void>;
}
```

#### Method Details

**`setItems(items)`**
Replaces all items with new array.

```typescript
list.setItems(newItems);
// Clears existing data and sets new items
// Updates total count
// Triggers re-render
```

**`appendItems(items)`**
Adds items to the end of the list.

```typescript
list.appendItems(moreItems);
// Adds items after existing items
// Increases total count
// Useful for infinite scroll
```

**`prependItems(items)`**
Adds items to the beginning of the list.

```typescript
list.prependItems(newItems);
// Shifts existing items
// Adds new items at start
// Note: Indices change for all existing items
```

**`updateItem(id, updates)`**
Updates a specific item by ID.

```typescript
list.updateItem('user-1', { name: 'New Name', status: 'active' });
// Merges updates with existing item
// Re-renders item if visible
// Does not affect other items
```

**`removeItem(id)`**
Removes a specific item by ID.

```typescript
list.removeItem('user-1');
// Removes item from data
// Decreases total count
// Triggers re-render
```

**`reload()`**
Reloads all data (adapter mode only).

```typescript
await list.reload();
// Clears all data
// Re-fetches from adapter
// Resets to initial state
```

### Scroll Methods

#### `createScrollMethods`

Creates scroll/navigation methods.

```typescript
function createScrollMethods<T extends VListItem>(
  ctx: VListContext<T>
): ScrollMethods;

interface ScrollMethods {
  /** Scroll to specific index */
  scrollToIndex: (index: number, align?: 'start' | 'center' | 'end') => void;
  
  /** Scroll to specific item by ID */
  scrollToItem: (id: string | number, align?: 'start' | 'center' | 'end') => void;
  
  /** Get current scroll position */
  getScrollPosition: () => number;
}
```

#### Method Details

**`scrollToIndex(index, align?)`**
Scrolls to bring an item index into view.

```typescript
// Scroll to item at top
list.scrollToIndex(100);
list.scrollToIndex(100, 'start');

// Scroll to item at center
list.scrollToIndex(100, 'center');

// Scroll to item at bottom
list.scrollToIndex(100, 'end');
```

**`scrollToItem(id, align?)`**
Scrolls to a specific item by ID.

```typescript
list.scrollToItem('user-123', 'center');
// Finds item index by ID
// Scrolls to that index
// No-op if ID not found
```

**`getScrollPosition()`**
Returns current scroll position in pixels.

```typescript
const position = list.getScrollPosition();
// Returns virtual scroll position
// Works in both native and compressed modes
```

### Selection Methods

#### `createSelectionMethods`

Creates selection management methods.

```typescript
function createSelectionMethods<T extends VListItem>(
  ctx: VListContext<T>
): SelectionMethods<T>;

interface SelectionMethods<T extends VListItem> {
  /** Select item(s) by ID */
  select: (...ids: Array<string | number>) => void;
  
  /** Deselect item(s) by ID */
  deselect: (...ids: Array<string | number>) => void;
  
  /** Toggle selection */
  toggleSelect: (id: string | number) => void;
  
  /** Select all items */
  selectAll: () => void;
  
  /** Clear selection */
  clearSelection: () => void;
  
  /** Get selected item IDs */
  getSelected: () => Array<string | number>;
  
  /** Get selected items */
  getSelectedItems: () => T[];
}
```

#### Method Details

**`select(...ids)`**
Selects one or more items by ID.

```typescript
// Single selection
list.select('user-1');

// Multiple selection (multiple mode only)
list.select('user-1', 'user-2', 'user-3');
```

**`deselect(...ids)`**
Deselects one or more items by ID.

```typescript
list.deselect('user-1', 'user-2');
```

**`toggleSelect(id)`**
Toggles selection state of an item.

```typescript
list.toggleSelect('user-1');
// If selected → deselects
// If not selected → selects
```

**`selectAll()`**
Selects all items (multiple mode only).

```typescript
list.selectAll();
// Only works in 'multiple' selection mode
// No-op in 'single' or 'none' modes
```

**`clearSelection()`**
Clears all selection.

```typescript
list.clearSelection();
// Deselects all items
// Emits selection:change event
```

**`getSelected()`**
Returns array of selected item IDs.

```typescript
const ids = list.getSelected();
// ['user-1', 'user-3', 'user-5']
```

**`getSelectedItems()`**
Returns array of selected items.

```typescript
const items = list.getSelectedItems();
// [{ id: 'user-1', name: 'John' }, ...]
```

## Usage Examples

### Data Manipulation

```typescript
import { createVList } from 'vlist';

const list = createVList({
  container: '#app',
  itemHeight: 48,
  items: initialItems,
  template: (item) => `<div>${item.name}</div>`
});

// Replace all items
list.setItems(newItems);

// Add more items at end
list.appendItems(additionalItems);

// Update specific item
list.updateItem('user-1', { 
  status: 'online',
  lastSeen: new Date()
});

// Remove item
list.removeItem('user-deleted');

// Get current items
console.log(list.items);  // readonly array
console.log(list.total);  // total count
```

### Scroll Navigation

```typescript
// Scroll to specific index
list.scrollToIndex(0);      // Go to top
list.scrollToIndex(list.total - 1, 'end');  // Go to bottom

// Scroll to specific item
const targetId = getTargetItemId();
list.scrollToItem(targetId, 'center');

// Save and restore scroll position
const position = list.getScrollPosition();
// ... later ...
list.scrollToIndex(Math.floor(position / 48));  // Approximate restore
```

### Selection Management

```typescript
const list = createVList({
  container: '#app',
  itemHeight: 48,
  items: users,
  selection: { mode: 'multiple' },
  template: (item, index, { selected }) => `
    <div class="${selected ? 'selected' : ''}">
      ${item.name}
    </div>
  `
});

// Programmatic selection
list.select('user-1', 'user-2');

// Toggle with button
deleteButton.onclick = () => {
  const selected = list.getSelectedItems();
  if (confirm(`Delete ${selected.length} items?`)) {
    selected.forEach(item => list.removeItem(item.id));
    list.clearSelection();
  }
};

// Export selected
exportButton.onclick = () => {
  const items = list.getSelectedItems();
  downloadCSV(items);
};

// Select all / deselect all
selectAllCheckbox.onchange = (e) => {
  if (e.target.checked) {
    list.selectAll();
  } else {
    list.clearSelection();
  }
};
```

### With Adapter (Async Data)

```typescript
const list = createVList({
  container: '#app',
  itemHeight: 48,
  adapter: {
    read: async ({ offset, limit }) => {
      const response = await api.getItems(offset, limit);
      return {
        items: response.data,
        total: response.total,
        hasMore: response.hasMore
      };
    }
  },
  template: (item) => `<div>${item.name}</div>`
});

// Reload data (e.g., after filter change)
filterInput.oninput = async () => {
  await list.reload();
};

// Items are loaded automatically on scroll
// Manual reload clears and re-fetches
```

## Implementation Details

### Render and Emit Pattern

Selection methods follow a common pattern:

```typescript
const select = (...ids: Array<string | number>): void => {
  if (ctx.config.selectionMode === 'none') return;
  
  // 1. Update state
  ctx.state.selectionState = selectItems(
    ctx.state.selectionState,
    ids,
    ctx.config.selectionMode
  );
  
  // 2. Re-render
  renderAndEmitSelection(ctx);
};

// Shared helper
const renderAndEmitSelection = <T extends VListItem>(
  ctx: VListContext<T>
): void => {
  // Get items for current range
  const items = ctx.getItemsForRange(ctx.state.viewportState.renderRange);
  
  // Get compression context if needed
  const compressionCtx = ctx.state.viewportState.isCompressed
    ? ctx.getCompressionContext()
    : undefined;
  
  // Render
  ctx.renderer.render(
    items,
    ctx.state.viewportState.renderRange,
    ctx.state.selectionState.selected,
    ctx.state.selectionState.focusedIndex,
    compressionCtx
  );
  
  // Emit event
  ctx.emitter.emit('selection:change', {
    selected: getSelectedIds(ctx.state.selectionState),
    items: getSelectedItems(ctx.state.selectionState, ctx.getAllLoadedItems())
  });
};
```

### Item Update Optimization

`updateItem` only re-renders the specific item if visible:

```typescript
updateItem: (id: string | number, updates: Partial<T>): void => {
  const updated = ctx.dataManager.updateItem(id, updates);
  
  if (updated) {
    const index = ctx.dataManager.getIndexById(id);
    const item = ctx.dataManager.getItem(index);
    
    // Only re-render if item is in visible range
    if (item && 
        index >= ctx.state.viewportState.renderRange.start &&
        index <= ctx.state.viewportState.renderRange.end) {
      ctx.renderer.updateItem(
        index,
        item,
        isSelected(ctx.state.selectionState, id),
        ctx.state.selectionState.focusedIndex === index
      );
    }
  }
}
```

### Scroll Position Calculation

`scrollToIndex` uses compression-aware calculations:

```typescript
scrollToIndex: (index: number, align: 'start' | 'center' | 'end' = 'start'): void => {
  const dataState = ctx.dataManager.getState();
  
  // calculateScrollToIndex handles compression automatically
  const position = calculateScrollToIndex(
    index,
    ctx.config.itemHeight,
    ctx.state.viewportState.containerHeight,
    dataState.total,
    align
  );
  
  ctx.scrollController.scrollTo(position);
}
```

## Mode Guards

Methods respect selection mode:

```typescript
// select/toggleSelect: only in 'single' or 'multiple' mode
if (ctx.config.selectionMode === 'none') return;

// selectAll: only in 'multiple' mode
if (ctx.config.selectionMode !== 'multiple') return;

// reload: only when adapter exists
if (ctx.config.hasAdapter) {
  await ctx.dataManager.reload();
}
```

## Related Modules

- [context.md](./context.md) - Context passed to method factories
- [handlers.md](./handlers.md) - Event handlers (internal counterpart)
- [selection.md](./selection.md) - Selection state management functions
- [data.md](./data.md) - Data manager operations
- [scroll.md](./scroll.md) - Scroll controller
- [render.md](./render.md) - Scroll position calculations

---

*The methods module exposes the public API for programmatic control of vlist instances.*