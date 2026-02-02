# Selection Module

> Pure functions for managing selection state in vlist.

## Overview

The selection module provides immutable state management for item selection. It handles:

- **Single/Multiple Selection**: Configurable selection modes
- **Keyboard Navigation**: Focus management with arrow keys
- **Range Selection**: Shift+click for selecting ranges
- **Pure Functions**: All operations return new state (immutable)

## Module Structure

```
src/selection/
├── index.ts   # Module exports
└── state.ts   # Selection state management
```

## Key Concepts

### Immutable State

All selection operations return a **new state object** rather than mutating:

```typescript
// State is never mutated
const newState = selectItems(state, ['id1', 'id2'], 'multiple');
// state !== newState (new object created)
```

### Selection Modes

| Mode | Description |
|------|-------------|
| `none` | Selection disabled |
| `single` | Only one item can be selected at a time |
| `multiple` | Multiple items can be selected |

### Focus vs Selection

- **Focus**: Visual indicator of keyboard navigation position (single index)
- **Selection**: Set of selected item IDs (can be multiple)

```typescript
interface SelectionState {
  selected: Set<string | number>;  // Selected item IDs
  focusedIndex: number;            // Keyboard focus position (-1 if none)
}
```

## API Reference

### State Creation

#### `createSelectionState`

Creates initial selection state.

```typescript
function createSelectionState(
  initial?: Array<string | number>
): SelectionState;

// Usage
const state = createSelectionState();                    // Empty
const state = createSelectionState(['id1', 'id2']);     // With initial selection
```

### Selection Operations

#### `selectItems`

Select items by ID.

```typescript
function selectItems(
  state: SelectionState,
  ids: Array<string | number>,
  mode: SelectionMode
): SelectionState;

// Single mode: replaces selection
const newState = selectItems(state, ['id2'], 'single');
// newState.selected = Set(['id2'])

// Multiple mode: adds to selection
const newState = selectItems(state, ['id2', 'id3'], 'multiple');
// newState.selected = Set(['id1', 'id2', 'id3'])
```

#### `deselectItems`

Deselect items by ID.

```typescript
function deselectItems(
  state: SelectionState,
  ids: Array<string | number>
): SelectionState;

// Usage
const newState = deselectItems(state, ['id1']);
```

#### `toggleSelection`

Toggle item selection.

```typescript
function toggleSelection(
  state: SelectionState,
  id: string | number,
  mode: SelectionMode
): SelectionState;

// If selected -> deselect
// If not selected -> select
const newState = toggleSelection(state, 'id1', 'multiple');
```

#### `selectAll`

Select all items (multiple mode only).

```typescript
function selectAll<T extends VListItem>(
  state: SelectionState,
  items: T[],
  mode: SelectionMode
): SelectionState;

// Only works in 'multiple' mode
const newState = selectAll(state, allItems, 'multiple');
```

#### `clearSelection`

Clear all selection.

```typescript
function clearSelection(state: SelectionState): SelectionState;

const newState = clearSelection(state);
// newState.selected = Set()
```

### Focus Management

#### `setFocusedIndex`

Set focused index directly.

```typescript
function setFocusedIndex(
  state: SelectionState,
  index: number
): SelectionState;

const newState = setFocusedIndex(state, 5);
```

#### `moveFocusUp`

Move focus up one item.

```typescript
function moveFocusUp(
  state: SelectionState,
  totalItems: number,
  wrap?: boolean  // default: true
): SelectionState;

// With wrap=true (default): 0 -> totalItems-1
// With wrap=false: 0 -> 0
```

#### `moveFocusDown`

Move focus down one item.

```typescript
function moveFocusDown(
  state: SelectionState,
  totalItems: number,
  wrap?: boolean  // default: true
): SelectionState;

// With wrap=true (default): totalItems-1 -> 0
// With wrap=false: totalItems-1 -> totalItems-1
```

#### `moveFocusToFirst`

Move focus to first item.

```typescript
function moveFocusToFirst(
  state: SelectionState,
  totalItems: number
): SelectionState;
```

#### `moveFocusToLast`

Move focus to last item.

```typescript
function moveFocusToLast(
  state: SelectionState,
  totalItems: number
): SelectionState;
```

#### `moveFocusByPage`

Move focus by page (for Page Up/Down).

```typescript
function moveFocusByPage(
  state: SelectionState,
  totalItems: number,
  pageSize: number,
  direction: 'up' | 'down'
): SelectionState;
```

### Queries

#### `isSelected`

Check if an item is selected.

```typescript
function isSelected(
  state: SelectionState,
  id: string | number
): boolean;

if (isSelected(state, 'item-5')) {
  // Item is selected
}
```

#### `getSelectedIds`

Get selected IDs as array.

```typescript
function getSelectedIds(state: SelectionState): Array<string | number>;

const ids = getSelectedIds(state);
// ['id1', 'id2', 'id3']
```

#### `getSelectedItems`

Get selected items from item array.

```typescript
function getSelectedItems<T extends VListItem>(
  state: SelectionState,
  items: T[]
): T[];

const selectedItems = getSelectedItems(state, allItems);
```

#### `getSelectionCount`

Get number of selected items.

```typescript
function getSelectionCount(state: SelectionState): number;
```

#### `isSelectionEmpty`

Check if selection is empty.

```typescript
function isSelectionEmpty(state: SelectionState): boolean;
```

### Keyboard Selection Helpers

#### `selectFocused`

Toggle selection on focused item (Space/Enter key).

```typescript
function selectFocused<T extends VListItem>(
  state: SelectionState,
  items: T[],
  mode: SelectionMode
): SelectionState;
```

#### `selectRange`

Handle shift+click range selection.

```typescript
function selectRange<T extends VListItem>(
  state: SelectionState,
  items: T[],
  fromIndex: number,
  toIndex: number,
  mode: SelectionMode
): SelectionState;

// Only works in 'multiple' mode
// Selects all items between fromIndex and toIndex (inclusive)
```

## Usage Examples

### Basic Selection

```typescript
import {
  createSelectionState,
  selectItems,
  deselectItems,
  toggleSelection
} from './selection';

// Create initial state
let state = createSelectionState();

// Select items
state = selectItems(state, ['user-1', 'user-2'], 'multiple');

// Toggle item
state = toggleSelection(state, 'user-3', 'multiple');

// Check selection
console.log(getSelectedIds(state)); // ['user-1', 'user-2', 'user-3']
```

### Single Selection Mode

```typescript
let state = createSelectionState();

// In single mode, new selection replaces previous
state = selectItems(state, ['item-1'], 'single');
// selected: ['item-1']

state = selectItems(state, ['item-2'], 'single');
// selected: ['item-2']  (item-1 was deselected)
```

### Keyboard Navigation

```typescript
import {
  createSelectionState,
  setFocusedIndex,
  moveFocusDown,
  moveFocusUp,
  selectFocused
} from './selection';

let state = createSelectionState();
const totalItems = 100;

// Set initial focus
state = setFocusedIndex(state, 0);

// Arrow down
state = moveFocusDown(state, totalItems);
// focusedIndex: 1

// Arrow up
state = moveFocusUp(state, totalItems);
// focusedIndex: 0

// Arrow up with wrap
state = moveFocusUp(state, totalItems, true);
// focusedIndex: 99 (wrapped to end)

// Select focused item (Space/Enter)
state = selectFocused(state, items, 'multiple');
```

### Range Selection

```typescript
import { createSelectionState, selectRange } from './selection';

let state = createSelectionState();

// Shift+click from item 5 to item 10
state = selectRange(state, items, 5, 10, 'multiple');
// Selects items at indices 5, 6, 7, 8, 9, 10
```

### With VList

```typescript
import { createVList } from 'vlist';

const list = createVList({
  container: '#app',
  itemHeight: 48,
  items: users,
  selection: {
    mode: 'multiple',
    initial: ['user-1']  // Pre-selected
  },
  template: (item, index, { selected, focused }) => `
    <div class="item ${selected ? 'selected' : ''} ${focused ? 'focused' : ''}">
      ${item.name}
    </div>
  `
});

// Listen for selection changes
list.on('selection:change', ({ selected, items }) => {
  console.log(`Selected: ${selected.join(', ')}`);
  updateUI(items);
});

// Programmatic selection
list.select('user-2', 'user-3');
list.deselect('user-1');
list.toggleSelect('user-4');
list.selectAll();
list.clearSelection();

// Get selection
const ids = list.getSelected();
const selectedUsers = list.getSelectedItems();
```

### Complete Keyboard Handler Example

```typescript
import {
  moveFocusUp,
  moveFocusDown,
  moveFocusToFirst,
  moveFocusToLast,
  toggleSelection
} from './selection';

function handleKeyboard(event: KeyboardEvent, state: SelectionState, items: VListItem[]) {
  const totalItems = items.length;
  
  switch (event.key) {
    case 'ArrowUp':
      return moveFocusUp(state, totalItems);
      
    case 'ArrowDown':
      return moveFocusDown(state, totalItems);
      
    case 'Home':
      return moveFocusToFirst(state, totalItems);
      
    case 'End':
      return moveFocusToLast(state, totalItems);
      
    case ' ':
    case 'Enter':
      if (state.focusedIndex >= 0) {
        const item = items[state.focusedIndex];
        return toggleSelection(state, item.id, 'multiple');
      }
      return state;
      
    default:
      return state;
  }
}
```

## Implementation Details

### Why Pure Functions?

Pure functions make state management predictable and testable:

```typescript
// Easy to test
const input = createSelectionState(['a']);
const output = selectItems(input, ['b'], 'multiple');

expect(output.selected.has('a')).toBe(true);
expect(output.selected.has('b')).toBe(true);
expect(input.selected.has('b')).toBe(false); // Original unchanged
```

### Set-Based Storage

Selection uses `Set` for O(1) lookup:

```typescript
interface SelectionState {
  selected: Set<string | number>;
  // ...
}

// O(1) operations
selected.has(id);     // Check
selected.add(id);     // Add
selected.delete(id);  // Remove
```

### Mode Handling

Selection functions respect the mode parameter:

```typescript
function selectItems(state, ids, mode) {
  if (mode === 'none') return state;  // No-op
  
  const newSelected = new Set(state.selected);
  
  if (mode === 'single') {
    newSelected.clear();        // Replace
    if (ids.length > 0) {
      newSelected.add(ids[0]);
    }
  } else {
    // Multiple: add all
    for (const id of ids) {
      newSelected.add(id);
    }
  }
  
  return { ...state, selected: newSelected };
}
```

## Keyboard Navigation Reference

| Key | Action |
|-----|--------|
| `↑` Arrow Up | Move focus up (wraps to bottom) |
| `↓` Arrow Down | Move focus down (wraps to top) |
| `Home` | Move focus to first item |
| `End` | Move focus to last item |
| `Space` / `Enter` | Toggle selection on focused item |
| `Page Up` | Move focus up by page size |
| `Page Down` | Move focus down by page size |

## Related Modules

- [types.md](./types.md) - SelectionMode, SelectionState types
- [handlers.md](./handlers.md) - Click and keyboard handlers
- [methods.md](./methods.md) - Public selection API methods
- [context.md](./context.md) - Context holds selection state

---

*The selection module provides a clean, functional approach to managing selection state.*