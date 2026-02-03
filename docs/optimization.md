# vlist - Performance Optimization Guide

This document outlines performance optimization opportunities for the vlist virtual scrolling component. The implementation is already well-optimized with element recycling, compression for large lists, and efficient DOM management. These recommendations can squeeze out additional performance gains.

## Current Optimizations ✓

Before diving into improvements, here's what's already optimized:

- **Element Pooling** - DOM elements are recycled via `createElementPool()`
- **Compression** - Large lists (1M+ items) use virtual scroll space compression
- **Event Delegation** - Single click listener on items container
- **Velocity-based Load Cancellation** - Skips data loading during fast scrolls
- **Reusable Compression Context** - Avoids object allocation per frame
- **Cached Compression State** - Only recalculates when `totalItems` changes
- **Sparse Storage with LRU Eviction** - Efficient memory management for large datasets
- **Idle Detection** - Defers non-critical operations until scroll stops

---

## Optimization Opportunities

### Priority Legend
- 🔴 **High** - Significant impact, implement first
- 🟡 **Medium** - Noticeable improvement
- 🟢 **Low** - Marginal gains or situational

---

### 1. DOM Batching with DocumentFragment 🔴

**Current**: Elements are appended individually in `render()`:

```typescript
// renderer.ts - current implementation
for (let i = range.start; i <= range.end; i++) {
  // ...
  if (!existing) {
    const element = renderItem(i, item, isSelected, isFocused, compressionCtx);
    itemsContainer.appendChild(element);  // Individual append
    rendered.set(i, { index: i, element });
  }
}
```

**Optimized**: Batch new elements with `DocumentFragment`:

```typescript
// Collect new elements for single DOM operation
const fragment = document.createDocumentFragment();
const newElements: Array<{ index: number; element: HTMLElement }> = [];

for (let i = range.start; i <= range.end; i++) {
  const item = items[i - range.start];
  if (!item) continue;

  const existing = rendered.get(i);
  
  if (existing) {
    // Update existing element...
  } else {
    const element = renderItem(i, item, isSelected, isFocused, compressionCtx);
    fragment.appendChild(element);
    newElements.push({ index: i, element });
  }
}

// Single DOM operation for all new elements
if (newElements.length > 0) {
  itemsContainer.appendChild(fragment);
  for (const { index, element } of newElements) {
    rendered.set(index, { index, element });
  }
}
```

**Impact**: Reduces layout thrashing when scrolling fast and adding many items at once.

---

### 2. Replace `setAttribute` with Direct Properties 🔴

**Current**: Multiple `setAttribute` calls per item render:

```typescript
// renderer.ts - current implementation
element.setAttribute("data-index", String(index));
element.setAttribute("data-id", String(item.id));
element.setAttribute("role", "option");
element.setAttribute("aria-selected", String(isSelected));
```

**Optimized**: Use `dataset` and direct property assignment:

```typescript
// Faster than setAttribute
element.dataset.index = String(index);
element.dataset.id = String(item.id);
element.ariaSelected = String(isSelected);

// Set static attributes once in pool.acquire() or applyBaseClass()
// role="option" never changes, so set it once per element lifetime
```

**Additional optimization** - Set `role` in `createElementPool`:

```typescript
const acquire = (): HTMLElement => {
  const element = pool.pop();
  if (element) {
    reused++;
    return element;
  }
  
  const newElement = document.createElement(tagName);
  newElement.setAttribute("role", "option");  // Set once, never changes
  created++;
  return newElement;
};
```

**Impact**: `dataset` and direct properties are faster than `setAttribute`.

---

### 3. Reusable ItemState Object 🟡

**Current**: Creates new object every call:

```typescript
// renderer.ts - current implementation
const createItemState = (isSelected: boolean, isFocused: boolean): ItemState => ({
  selected: isSelected,
  focused: isFocused,
});
```

**Optimized**: Reuse a single state object:

```typescript
// Reusable state object (avoids allocation per item)
const reusableItemState: ItemState = { selected: false, focused: false };

const getItemState = (isSelected: boolean, isFocused: boolean): ItemState => {
  reusableItemState.selected = isSelected;
  reusableItemState.focused = isFocused;
  return reusableItemState;
};
```

**⚠️ Caveat**: Only safe if the template function doesn't store or mutate the state object reference. Document this constraint for template authors.

**Impact**: Reduces garbage collection pressure during fast scrolling.

---

### 4. ResizeObserver for Container 🟡

**Current**: No automatic handling of container resize.

**Optimized**: Add `ResizeObserver` to recalculate viewport on resize:

```typescript
// In vlist.ts initialization
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const { height } = entry.contentRect;
    if (Math.abs(height - ctx.state.viewportState.containerHeight) > 1) {
      ctx.state.viewportState = updateViewportSize(
        ctx.state.viewportState,
        height,
        itemHeight,
        dataManager.getTotal(),
        overscan
      );
      updateContentHeight(dom.content, ctx.state.viewportState.totalHeight);
      renderIfNeeded();
    }
  }
});

resizeObserver.observe(dom.viewport);

// Cleanup in destroy()
resizeObserver.disconnect();
```

**Impact**: Correctly handles dynamic layouts, split panes, responsive designs.

---

### 5. Velocity Tracker Circular Buffer 🟡

**Current**: Creates new arrays on every update:

```typescript
// controller.ts - current implementation
const samples = [
  ...tracker.samples.filter((s) => now - s.time < 100),
  { position: newPosition, time: now },
];
```

**Optimized**: Use a circular buffer:

```typescript
const SAMPLE_COUNT = 5;

interface VelocityTracker {
  samples: Array<{ position: number; time: number }>;
  sampleIndex: number;
  sampleCount: number;
  velocity: number;
  lastPosition: number;
  lastTime: number;
}

const createVelocityTracker = (initialPosition = 0): VelocityTracker => ({
  samples: new Array(SAMPLE_COUNT).fill(null).map(() => ({ position: 0, time: 0 })),
  sampleIndex: 0,
  sampleCount: 0,
  velocity: 0,
  lastPosition: initialPosition,
  lastTime: performance.now(),
});

const updateVelocityTracker = (
  tracker: VelocityTracker,
  newPosition: number,
): VelocityTracker => {
  const now = performance.now();
  const timeDelta = now - tracker.lastTime;
  
  if (timeDelta === 0) return tracker;

  // Overwrite oldest sample (circular)
  tracker.samples[tracker.sampleIndex].position = newPosition;
  tracker.samples[tracker.sampleIndex].time = now;
  tracker.sampleIndex = (tracker.sampleIndex + 1) % SAMPLE_COUNT;
  tracker.sampleCount = Math.min(tracker.sampleCount + 1, SAMPLE_COUNT);

  // Calculate velocity from samples
  if (tracker.sampleCount > 1) {
    const oldest = tracker.samples[(tracker.sampleIndex - tracker.sampleCount + SAMPLE_COUNT) % SAMPLE_COUNT];
    const totalDistance = newPosition - oldest.position;
    const totalTime = now - oldest.time;
    tracker.velocity = totalTime > 0 ? totalDistance / totalTime : 0;
  } else {
    tracker.velocity = (newPosition - tracker.lastPosition) / timeDelta;
  }

  tracker.lastPosition = newPosition;
  tracker.lastTime = now;

  return tracker;
};
```

**Impact**: Eliminates array allocation/spread on every scroll tick.

---

### 6. Chunk Preloading Based on Scroll Direction 🟢

**Current**: Only loads visible range + overscan.

**Optimized**: Preload chunks ahead based on scroll velocity:

```typescript
// In scroll handler
const PRELOAD_VELOCITY_THRESHOLD = 0.5; // px/ms
const PRELOAD_ITEMS_AHEAD = 50;

if (ctx.config.hasAdapter && canLoad) {
  const velocity = ctx.scrollController.getVelocity();
  const { renderRange } = ctx.state.viewportState;
  
  if (Math.abs(velocity) > PRELOAD_VELOCITY_THRESHOLD) {
    const direction = velocity > 0 ? 'down' : 'up';
    
    if (direction === 'down') {
      const preloadEnd = Math.min(renderRange.end + PRELOAD_ITEMS_AHEAD, total - 1);
      ctx.dataManager.ensureRange(renderRange.start, preloadEnd);
    } else {
      const preloadStart = Math.max(renderRange.start - PRELOAD_ITEMS_AHEAD, 0);
      ctx.dataManager.ensureRange(preloadStart, renderRange.end);
    }
  } else {
    ctx.dataManager.ensureRange(renderRange.start, renderRange.end);
  }
}
```

**Impact**: Reduces placeholder flashing during medium-speed scrolling.

---

### 7. Template Result Caching 🟢

For templates with expensive computations or complex DOM structures:

```typescript
// Template cache (WeakMap to allow GC when item is evicted)
const templateCache = new WeakMap<T, { result: HTMLElement; version: number }>();
let cacheVersion = 0;

const getCachedTemplate = (item: T, index: number, state: ItemState): HTMLElement => {
  const cached = templateCache.get(item);
  
  // Cache hit - clone and update state
  if (cached && cached.version === cacheVersion) {
    const clone = cached.result.cloneNode(true) as HTMLElement;
    // Update only state-dependent parts...
    return clone;
  }
  
  // Cache miss - render and cache
  const result = template(item, index, state);
  if (result instanceof HTMLElement) {
    templateCache.set(item, { result: result.cloneNode(true) as HTMLElement, version: cacheVersion });
  }
  
  return result instanceof HTMLElement ? result : createElementFromString(result);
};

// Invalidate cache when data changes significantly
const invalidateTemplateCache = () => {
  cacheVersion++;
};
```

**⚠️ Complexity**: This adds significant complexity and is only beneficial for very heavy templates. Most use cases don't need this.

**Impact**: High for complex templates, negligible for simple ones.

---

### 8. Web Worker for Data Processing 🟢

For adapters that do heavy data transformation:

```typescript
// worker.ts
self.onmessage = (e) => {
  const { type, payload } = e.data;
  
  if (type === 'transform') {
    const { items, transformFn } = payload;
    // Heavy processing off main thread
    const transformed = items.map(transformFn);
    self.postMessage({ type: 'transformed', payload: transformed });
  }
};

// In adapter
const worker = new Worker('./data-worker.ts');

const adapter: VListAdapter<T> = {
  read: async (params) => {
    const rawItems = await fetchItems(params);
    
    return new Promise((resolve) => {
      worker.postMessage({ type: 'transform', payload: { items: rawItems } });
      worker.onmessage = (e) => {
        if (e.data.type === 'transformed') {
          resolve({ items: e.data.payload, total: rawItems.total });
        }
      };
    });
  }
};
```

**Impact**: Keeps main thread free for smooth 60fps scrolling during heavy data operations.

---

## Summary: Priority Matrix

| Priority | Optimization | Impact | Effort | When to Use |
|----------|-------------|--------|--------|-------------|
| 🔴 High | DocumentFragment batching | High | Low | Always |
| 🔴 High | Direct properties vs setAttribute | Medium | Low | Always |
| 🟡 Medium | Reusable ItemState object | Medium | Low | High-frequency updates |
| 🟡 Medium | ResizeObserver | Medium | Low | Dynamic layouts |
| 🟡 Medium | Velocity tracker circular buffer | Low-Medium | Medium | Very fast scrolling |
| 🟢 Low | Chunk preloading | Medium | Medium | Slow network/API |
| 🟢 Low | Template result caching | High | High | Complex templates only |
| 🟢 Low | Web Worker for data | High | High | Heavy data transformation |

---

## Benchmarking

When implementing optimizations, measure with:

```typescript
// Simple timing
const start = performance.now();
// ... operation ...
console.log(`Operation took ${performance.now() - start}ms`);

// Frame timing
let lastFrame = performance.now();
const measureFrame = () => {
  const now = performance.now();
  const delta = now - lastFrame;
  if (delta > 16.67) {
    console.warn(`Frame drop: ${delta.toFixed(2)}ms`);
  }
  lastFrame = now;
  requestAnimationFrame(measureFrame);
};
requestAnimationFrame(measureFrame);

// Memory profiling
console.log('Heap used:', (performance as any).memory?.usedJSHeapSize / 1024 / 1024, 'MB');
```

Use Chrome DevTools Performance tab to profile:
1. Record during fast scrolling
2. Look for long tasks (>50ms)
3. Check for excessive GC pauses
4. Monitor memory growth over time

---

## Related Documentation

- [Compression](./compression.md) - How large list compression works
- [Data Management](./data.md) - Sparse storage and chunking
- [Scroll Controller](./scroll.md) - Velocity tracking and scroll handling
- [Rendering](./render.md) - Element pooling and DOM management