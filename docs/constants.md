# Constants Module

> Default values and magic numbers for vlist configuration.

## Overview

The constants module centralizes all default values, thresholds, and configuration constants used throughout vlist. This ensures:

- **Consistency**: Same defaults across all components
- **Maintainability**: Single place to adjust values
- **Documentation**: Clear explanation of each constant's purpose

## Module Structure

```
src/
└── constants.ts  # All constants in one file
```

## Constants Reference

### Virtual Scrolling

#### `DEFAULT_OVERSCAN`

Number of extra items to render outside the viewport.

```typescript
const DEFAULT_OVERSCAN = 3;
```

**Purpose**: Reduces visual flickering during fast scrolling by pre-rendering items just outside the visible area.

**Trade-off**:
- Higher value → Smoother scrolling, more DOM elements
- Lower value → Fewer DOM elements, potential flickering

#### `DEFAULT_CLASS_PREFIX`

Default CSS class prefix for all vlist elements.

```typescript
const DEFAULT_CLASS_PREFIX = 'vlist';
```

**Usage**: All generated CSS classes use this prefix:
- `vlist` → root element
- `vlist-viewport` → scrollable container
- `vlist-item` → individual items
- `vlist-item--selected` → selected state

### Data Loading

#### `LOAD_MORE_THRESHOLD`

Distance from bottom (in pixels) to trigger infinite scroll loading.

```typescript
const LOAD_MORE_THRESHOLD = 200;
```

**Purpose**: Starts loading more data before user reaches the end, creating seamless infinite scroll experience.

#### `INITIAL_LOAD_SIZE`

Default number of items to load per request.

```typescript
const INITIAL_LOAD_SIZE = 50;
```

**Purpose**: Balances between:
- Loading enough items to fill viewport
- Not overloading initial request

#### `DEFAULT_PAGE_SIZE`

Default page size for data manager operations.

```typescript
const DEFAULT_PAGE_SIZE = 50;
```

**Purpose**: Standard batch size for data fetching operations.

### Compression (Large Lists)

#### `MAX_VIRTUAL_HEIGHT`

Maximum virtual height in pixels.

```typescript
const MAX_VIRTUAL_HEIGHT = 16_000_000;  // 16M pixels
```

**Purpose**: Browsers have a maximum element height limit (~16.7M pixels). This constant provides a safe margin below that limit.

**When exceeded**: vlist switches to compressed mode with manual wheel-based scrolling.

**Calculation**:
```typescript
// Max items without compression
const maxItems = Math.floor(MAX_VIRTUAL_HEIGHT / itemHeight);

// Examples:
// 48px items → 333,333 items
// 40px items → 400,000 items
// 32px items → 500,000 items
```

### Scrollbar

#### `DEFAULT_SCROLLBAR_AUTO_HIDE`

Whether scrollbar auto-hides after idle.

```typescript
const DEFAULT_SCROLLBAR_AUTO_HIDE = true;
```

#### `DEFAULT_SCROLLBAR_AUTO_HIDE_DELAY`

Delay in milliseconds before scrollbar hides.

```typescript
const DEFAULT_SCROLLBAR_AUTO_HIDE_DELAY = 1000;
```

#### `DEFAULT_SCROLLBAR_MIN_THUMB_SIZE`

Minimum scrollbar thumb size in pixels.

```typescript
const DEFAULT_SCROLLBAR_MIN_THUMB_SIZE = 30;
```

**Purpose**: Ensures thumb is always large enough to click/drag, even for very large lists.

### Placeholder

#### `DEFAULT_MASK_CHARACTER`

Character used for masking text in placeholders.

```typescript
const DEFAULT_MASK_CHARACTER = '█';
```

**Usage**: Placeholder text like `████████████` to indicate loading state.

#### `DEFAULT_MAX_SAMPLE_SIZE`

Maximum items to sample for placeholder structure analysis.

```typescript
const DEFAULT_MAX_SAMPLE_SIZE = 20;
```

**Purpose**: Limits analysis time while getting representative data structure.

#### `PLACEHOLDER_FLAG`

Internal flag to identify placeholder items.

```typescript
const PLACEHOLDER_FLAG = '_isPlaceholder';
```

**Usage**:
```typescript
if (item._isPlaceholder) {
  // Show loading state
}
```

#### `PLACEHOLDER_ID_PREFIX`

Prefix for placeholder item IDs.

```typescript
const PLACEHOLDER_ID_PREFIX = '__placeholder_';
```

**Purpose**: Ensures placeholder IDs don't collide with real item IDs.

### Sparse Storage

#### `DEFAULT_CHUNK_SIZE`

Default number of items per storage chunk.

```typescript
const DEFAULT_CHUNK_SIZE = 100;
```

**Purpose**: Balances between:
- Memory granularity (smaller chunks = finer control)
- Overhead (fewer chunks = less management overhead)

#### `DEFAULT_MAX_CACHED_ITEMS`

Default maximum items to keep in memory.

```typescript
const DEFAULT_MAX_CACHED_ITEMS = 10_000;
```

**Purpose**: Prevents memory exhaustion for very large lists.

#### `DEFAULT_EVICTION_BUFFER`

Extra items to keep around visible range during eviction.

```typescript
const DEFAULT_EVICTION_BUFFER = 500;
```

**Purpose**: Keeps recently viewed items in memory for quick scroll-back.

### Scroll

#### `SCROLL_IDLE_TIMEOUT`

Timeout for scroll idle detection in milliseconds.

```typescript
const SCROLL_IDLE_TIMEOUT = 150;
```

**Purpose**: Determines when scrolling has "stopped" for:
- Scrollbar auto-hide
- Idle callbacks
- Post-scroll cleanup

#### `DEFAULT_WHEEL_SENSITIVITY`

Default wheel sensitivity multiplier.

```typescript
const DEFAULT_WHEEL_SENSITIVITY = 1;
```

**Purpose**: Allows adjusting scroll speed in compressed mode.

## Usage Examples

### Importing Constants

```typescript
import {
  DEFAULT_OVERSCAN,
  LOAD_MORE_THRESHOLD,
  MAX_VIRTUAL_HEIGHT
} from './constants';

// Use in component
const visibleRange = calculateVisibleRange(
  scrollTop,
  containerHeight,
  itemHeight,
  totalItems
);

const renderRange = {
  start: Math.max(0, visibleRange.start - DEFAULT_OVERSCAN),
  end: Math.min(totalItems - 1, visibleRange.end + DEFAULT_OVERSCAN)
};
```

### Overriding Defaults

Most constants have corresponding config options:

```typescript
const list = createVList({
  container: '#app',
  item: {
    height: 48,
    template: (item) => `<div>${item.name}</div>`,
  },
  items: myItems,
  
  // Override defaults
  overscan: 5,                    // DEFAULT_OVERSCAN
  classPrefix: 'my-list',        // DEFAULT_CLASS_PREFIX
  scrollbar: {
    autoHide: false,             // DEFAULT_SCROLLBAR_AUTO_HIDE
    autoHideDelay: 2000,         // DEFAULT_SCROLLBAR_AUTO_HIDE_DELAY
    minThumbSize: 50             // DEFAULT_SCROLLBAR_MIN_THUMB_SIZE
  }
});
```

### Data Manager Configuration

```typescript
const dataManager = createDataManager({
  adapter: myAdapter,
  pageSize: 100,  // Override DEFAULT_PAGE_SIZE
  storage: {
    chunkSize: 50,           // Override DEFAULT_CHUNK_SIZE
    maxCachedItems: 5000,    // Override DEFAULT_MAX_CACHED_ITEMS
    evictionBuffer: 200      // Override DEFAULT_EVICTION_BUFFER
  },
  placeholder: {
    maskCharacter: '▒',      // Override DEFAULT_MASK_CHARACTER
    maxSampleSize: 10        // Override DEFAULT_MAX_SAMPLE_SIZE
  }
});
```

## Constant Categories Summary

| Category | Constants | Purpose |
|----------|-----------|---------|
| **Virtual Scrolling** | `DEFAULT_OVERSCAN`, `DEFAULT_CLASS_PREFIX` | Core rendering behavior |
| **Data Loading** | `LOAD_MORE_THRESHOLD`, `INITIAL_LOAD_SIZE`, `DEFAULT_PAGE_SIZE` | Async data fetching |
| **Compression** | `MAX_VIRTUAL_HEIGHT` | Large list handling |
| **Scrollbar** | `DEFAULT_SCROLLBAR_*` | Custom scrollbar behavior |
| **Placeholder** | `DEFAULT_MASK_CHARACTER`, `PLACEHOLDER_*` | Loading state display |
| **Sparse Storage** | `DEFAULT_CHUNK_SIZE`, `DEFAULT_MAX_CACHED_ITEMS`, `DEFAULT_EVICTION_BUFFER` | Memory management |
| **Scroll** | `SCROLL_IDLE_TIMEOUT`, `DEFAULT_WHEEL_SENSITIVITY` | Scroll behavior |

## Performance Tuning

### For Smooth Scrolling

```typescript
// Increase overscan for smoother scrolling
const TUNED_OVERSCAN = 5;  // vs default 3

// Decrease idle timeout for faster response
const TUNED_IDLE_TIMEOUT = 100;  // vs default 150
```

### For Memory Efficiency

```typescript
// Reduce max cached items
const TUNED_MAX_CACHED = 5000;  // vs default 10,000

// Smaller eviction buffer
const TUNED_EVICTION_BUFFER = 200;  // vs default 500
```

### For Large Datasets

```typescript
// Larger chunks for less overhead
const TUNED_CHUNK_SIZE = 200;  // vs default 100

// Larger page size for fewer requests
const TUNED_PAGE_SIZE = 100;  // vs default 50
```

## Related Modules

- [render.md](./render.md) - Uses `DEFAULT_OVERSCAN`, `MAX_VIRTUAL_HEIGHT`
- [scroll.md](./scroll.md) - Uses `SCROLL_IDLE_TIMEOUT`, scrollbar constants
- [data.md](./data.md) - Uses storage and placeholder constants
- [handlers.md](./handlers.md) - Uses `LOAD_MORE_THRESHOLD`, `INITIAL_LOAD_SIZE`

---

*The constants module provides a central reference for all configurable values in vlist.*