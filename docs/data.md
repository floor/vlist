# Data Module

> Data management, sparse storage, and placeholder generation for vlist.

## Overview

The data module handles all data-related operations in vlist, designed for efficient handling of large datasets (1M+ items):

- **Data Manager**: Central coordinator for data operations
- **Sparse Storage**: Memory-efficient storage using chunked approach
- **Placeholder System**: Smart loading state indicators

## Module Structure

```
src/data/
├── index.ts       # Module exports
├── manager.ts     # Data manager (main coordinator)
├── sparse.ts      # Sparse storage implementation
└── placeholder.ts # Placeholder generation
```

## Key Concepts

### Sparse Storage

Instead of loading all items into memory, vlist uses **sparse storage**:

```
Total: 1,000,000 items
Loaded: Only items 0-99, 5000-5099 (200 items in memory)
Memory saved: 99.98%
```

Items are stored in **chunks** (default: 100 items per chunk):

```
Chunk 0:  items 0-99
Chunk 1:  items 100-199
Chunk 50: items 5000-5099
...
```

### Placeholder Generation

When items aren't loaded, placeholders are shown:

```typescript
// Real item
{ id: 'user-1', name: 'John Doe', email: 'john@example.com' }

// Placeholder (analyzed structure)
{ id: '__placeholder_0', _isPlaceholder: true, name: '████████', email: '███████████████' }
```

### Data Flow

```
User scrolls to new range
    ↓
DataManager.ensureRange(start, end)
    ↓
Check SparseStorage for missing items
    ↓
Missing? → Call Adapter.read()
    ↓
Store items in SparseStorage
    ↓
Emit 'load:end' event
    ↓
Renderer re-renders with real data
```

## API Reference

### Data Manager

#### `createDataManager`

Creates a data manager instance.

```typescript
function createDataManager<T extends VListItem>(
  config: DataManagerConfig<T>
): DataManager<T>;

interface DataManagerConfig<T extends VListItem> {
  /** Async data adapter */
  adapter?: VListAdapter<T>;
  
  /** Initial items (optional) */
  initialItems?: T[];
  
  /** Initial total count (if known) */
  initialTotal?: number;
  
  /** Sparse storage configuration */
  storage?: SparseStorageConfig;
  
  /** Placeholder configuration */
  placeholder?: PlaceholderConfig;
  
  /** Items per load request (default: 50) */
  pageSize?: number;
  
  /** Callback when state changes */
  onStateChange?: (state: DataState<T>) => void;
  
  /** Callback when items are loaded */
  onItemsLoaded?: (items: T[], offset: number, total: number) => void;
  
  /** Callback when items are evicted */
  onItemsEvicted?: (count: number) => void;
}
```

#### DataManager Interface

```typescript
interface DataManager<T extends VListItem> {
  // State
  getState: () => DataState<T>;
  
  // Direct getters (hot-path optimized, no object allocation)
  getTotal: () => number;
  getCached: () => number;
  getIsLoading: () => boolean;
  getHasMore: () => boolean;
  
  // Storage access
  getStorage: () => SparseStorage<T>;
  getPlaceholders: () => PlaceholderManager<T>;
  
  // Item access
  getItem: (index: number) => T | undefined;
  getItemById: (id: string | number) => T | undefined;
  getIndexById: (id: string | number) => number;
  isItemLoaded: (index: number) => boolean;
  getItemsInRange: (start: number, end: number) => T[];
  
  // Data operations
  setTotal: (total: number) => void;
  setItems: (items: T[], offset?: number, total?: number) => void;
  updateItem: (id: string | number, updates: Partial<T>) => boolean;
  removeItem: (id: string | number) => boolean;
  
  // Loading
  loadRange: (start: number, end: number) => Promise<void>;
  ensureRange: (start: number, end: number) => Promise<void>;
  loadInitial: () => Promise<void>;
  loadMore: () => Promise<boolean>;
  reload: () => Promise<void>;
  
  // Memory management
  evictDistant: (visibleStart: number, visibleEnd: number) => void;
  
  // Lifecycle
  clear: () => void;
  reset: () => void;
}
```

#### DataState Interface

```typescript
interface DataState<T extends VListItem> {
  /** Total items (declared, may be larger than loaded) */
  total: number;
  
  /** Number of items in memory */
  cached: number;
  
  /** Whether data is loading */
  isLoading: boolean;
  
  /** Pending load ranges */
  pendingRanges: Range[];
  
  /** Error from last operation */
  error: Error | undefined;
  
  /** Whether more items exist */
  hasMore: boolean;
  
  /** Current cursor (for cursor pagination) */
  cursor: string | undefined;
}
```

### Sparse Storage

#### `createSparseStorage`

Creates sparse storage for efficient large list handling.

```typescript
function createSparseStorage<T extends VListItem>(
  config?: SparseStorageConfig
): SparseStorage<T>;

interface SparseStorageConfig {
  /** Number of items per chunk (default: 100) */
  chunkSize?: number;
  
  /** Maximum items to keep in memory (default: 5000) */
  maxCachedItems?: number;
  
  /** Extra items to keep around visible range (default: 200) */
  evictionBuffer?: number;
  
  /** Callback when items are evicted */
  onEvict?: (evictedCount: number, evictedRanges: number[]) => void;
}
```

#### SparseStorage Interface

```typescript
interface SparseStorage<T extends VListItem> {
  // Configuration
  readonly chunkSize: number;
  readonly maxCachedItems: number;
  
  // Total management
  getTotal: () => number;
  setTotal: (total: number) => void;
  
  // Item access
  get: (index: number) => T | undefined;
  has: (index: number) => boolean;
  set: (index: number, item: T) => void;
  setRange: (offset: number, items: T[]) => void;
  delete: (index: number) => boolean;
  
  // Range operations
  getRange: (start: number, end: number) => (T | undefined)[];
  isRangeLoaded: (start: number, end: number) => boolean;
  getLoadedRanges: () => Range[];
  findUnloadedRanges: (start: number, end: number) => Range[];
  
  // Chunk operations
  getChunkIndex: (itemIndex: number) => number;
  isChunkLoaded: (chunkIndex: number) => boolean;
  touchChunk: (chunkIndex: number) => void;
  
  // Eviction
  evictDistant: (visibleStart: number, visibleEnd: number) => number;
  evictToLimit: () => number;
  
  // Statistics
  getStats: () => SparseStorageStats;
  getCachedCount: () => number;
  
  // Lifecycle
  clear: () => void;
  reset: () => void;
}

interface SparseStorageStats {
  totalItems: number;
  cachedItems: number;
  cachedChunks: number;
  chunkSize: number;
  maxCachedItems: number;
  memoryEfficiency: number;  // 1 - (cachedItems / totalItems)
}
```

### Placeholder Manager

#### `createPlaceholderManager`

Creates a placeholder manager for loading states.

```typescript
function createPlaceholderManager<T extends VListItem>(
  config?: PlaceholderConfig
): PlaceholderManager<T>;

interface PlaceholderConfig {
  /** Enable placeholder generation (default: true) */
  enabled?: boolean;
  
  /** Character used for masking text (default: '█') */
  maskCharacter?: string;
  
  /** Add random variance to text lengths (default: true) */
  randomVariance?: boolean;
  
  /** Maximum items to sample for structure analysis (default: 20) */
  maxSampleSize?: number;
  
  /** Custom placeholder generator */
  customGenerator?: (index: number) => VListItem;
}
```

#### PlaceholderManager Interface

```typescript
interface PlaceholderManager<T extends VListItem> {
  /** Analyze data structure from sample items */
  analyzeStructure: (items: T[]) => void;
  
  /** Check if structure has been analyzed */
  hasAnalyzedStructure: () => boolean;
  
  /** Generate a single placeholder item */
  generate: (index: number) => T;
  
  /** Generate multiple placeholder items */
  generateRange: (start: number, end: number) => T[];
  
  /** Check if an item is a placeholder */
  isPlaceholder: (item: unknown) => boolean;
  
  /** Get the placeholder flag key */
  getPlaceholderKey: () => string;
  
  /** Clear analyzed structure */
  clear: () => void;
}
```

### Utility Functions

```typescript
// Check if item is a placeholder
function isPlaceholderItem(item: unknown): boolean;

// Filter out placeholders from array
function filterPlaceholders<T extends VListItem>(items: T[]): T[];

// Count non-placeholder items
function countRealItems<T extends VListItem>(items: (T | undefined)[]): number;

// Replace placeholders with real items
function replacePlaceholders<T extends VListItem>(
  target: (T | undefined)[],
  items: T[],
  offset: number
): number;

// Merge adjacent/overlapping ranges
function mergeRanges(ranges: Range[]): Range[];

// Calculate ranges that need to be loaded
function calculateMissingRanges(
  needed: Range,
  loaded: Range[],
  chunkSize: number
): Range[];
```

## Usage Examples

### Basic Data Manager

```typescript
import { createDataManager } from './data';

const dataManager = createDataManager({
  initialItems: myItems,
  onStateChange: (state) => {
    console.log(`Cached: ${state.cached} / ${state.total}`);
  }
});

// Access items
const item = dataManager.getItem(0);
const items = dataManager.getItemsInRange(0, 20);

// Modify items
dataManager.setItems(newItems);
dataManager.updateItem('user-1', { name: 'New Name' });
dataManager.removeItem('user-1');
```

### With Async Adapter

```typescript
import { createDataManager } from './data';

const dataManager = createDataManager({
  adapter: {
    read: async ({ offset, limit }) => {
      const response = await fetch(`/api/items?offset=${offset}&limit=${limit}`);
      const data = await response.json();
      return {
        items: data.items,
        total: data.total,
        hasMore: offset + limit < data.total
      };
    }
  },
  pageSize: 50,
  onItemsLoaded: (items, offset, total) => {
    console.log(`Loaded ${items.length} items at offset ${offset}`);
  }
});

// Load initial data
await dataManager.loadInitial();

// Ensure a range is loaded (for scrolling)
await dataManager.ensureRange(100, 150);

// Load more (infinite scroll)
await dataManager.loadMore();

// Reload all data
await dataManager.reload();
```

### Sparse Storage

```typescript
import { createSparseStorage } from './data';

const storage = createSparseStorage({
  chunkSize: 100,
  maxCachedItems: 5000,
  evictionBuffer: 200,
  onEvict: (count, chunks) => {
    console.log(`Evicted ${count} items from chunks: ${chunks.join(', ')}`);
  }
});

// Set total (for virtual scrolling height calculation)
storage.setTotal(1_000_000);

// Store items
storage.set(0, { id: 'item-0', name: 'First' });
storage.setRange(100, items);

// Retrieve items
const item = storage.get(0);
const range = storage.getRange(100, 150);
const isLoaded = storage.has(0);

// Check what's loaded
const loadedRanges = storage.getLoadedRanges();
const unloaded = storage.findUnloadedRanges(0, 1000);

// Memory management
const evicted = storage.evictDistant(500, 600);  // Keep around visible area

// Statistics
const stats = storage.getStats();
console.log(`Memory efficiency: ${(stats.memoryEfficiency * 100).toFixed(1)}%`);
```

### Placeholder System

```typescript
import { createPlaceholderManager, isPlaceholderItem } from './data';

const placeholders = createPlaceholderManager({
  maskCharacter: '█',
  randomVariance: true
});

// Analyze structure from real data
placeholders.analyzeStructure(realItems);

// Generate placeholders
const placeholder = placeholders.generate(0);
const placeholderRange = placeholders.generateRange(0, 20);

// Check if item is placeholder
if (isPlaceholderItem(item)) {
  element.classList.add('loading');
}

// In template
template: (item, index, state) => {
  if (isPlaceholderItem(item)) {
    return `<div class="item loading">${item.name}</div>`;
  }
  return `<div class="item">${item.name}</div>`;
}
```

### Complete Integration

```typescript
import { createVList } from 'vlist';

const list = createVList({
  container: '#app',
  itemHeight: 48,
  adapter: {
    read: async ({ offset, limit, cursor }) => {
      const url = cursor 
        ? `/api/items?cursor=${cursor}&limit=${limit}`
        : `/api/items?offset=${offset}&limit=${limit}`;
        
      const response = await fetch(url);
      const data = await response.json();
      
      return {
        items: data.items,
        total: data.total,
        cursor: data.nextCursor,
        hasMore: data.hasMore
      };
    }
  },
  template: (item, index, state) => {
    const isLoading = item._isPlaceholder;
    return `
      <div class="item ${isLoading ? 'loading' : ''}">
        <span class="name">${item.name}</span>
        <span class="email">${item.email}</span>
      </div>
    `;
  }
});

// Events
list.on('load:start', ({ offset, limit }) => {
  showLoadingIndicator();
});

list.on('load:end', ({ items, total }) => {
  hideLoadingIndicator();
  updateTotalCount(total);
});

list.on('error', ({ error, context }) => {
  if (context === 'loadMore') {
    showRetryButton();
  }
});
```

## Memory Management

### Eviction Strategy

When memory limits are reached, chunks far from the visible area are evicted:

```
Visible: items 5000-5050
Buffer: 200 items
Keep zone: 4800-5250

Evict chunks outside keep zone using LRU
```

### Configuration Guidelines

| List Size | Chunk Size | Max Cached | Buffer |
|-----------|------------|------------|--------|
| < 10K | 100 | 5,000 | 200 |
| 10K - 100K | 100 | 10,000 | 500 |
| 100K - 1M | 100 | 10,000 | 500 |
| > 1M | 100 | 10,000 | 500 |

### Stats Monitoring

```typescript
const stats = dataManager.getStorage().getStats();

console.log({
  totalItems: stats.totalItems,          // 1,000,000
  cachedItems: stats.cachedItems,        // 5,000
  cachedChunks: stats.cachedChunks,      // 50
  memoryEfficiency: stats.memoryEfficiency  // 0.995 (99.5%)
});
```

## Chunk-Based Loading

Items are loaded in chunk-aligned boundaries for efficiency:

```typescript
// Request: load items 50-150
// Chunk size: 100

// Aligned to chunks:
// Chunk 0: items 0-99 (includes 50-99)
// Chunk 1: items 100-199 (includes 100-150)

// Actually loaded: items 0-199
```

This reduces redundant loads when scrolling back and forth.

## Deduplication

The data manager prevents duplicate loading:

```typescript
// Scroll handler calls ensureRange rapidly
await dataManager.ensureRange(100, 200);  // Starts loading
await dataManager.ensureRange(100, 200);  // Returns existing promise
await dataManager.ensureRange(100, 200);  // Returns existing promise

// Only ONE API call is made
```

## Related Modules

- [types.md](./types.md) - VListAdapter, VListItem interfaces
- [handlers.md](./handlers.md) - Scroll handler triggers data loading
- [render.md](./render.md) - Renderer displays items/placeholders
- [context.md](./context.md) - Context holds data manager reference

---

*The data module enables vlist to efficiently handle datasets of any size.*