# vlist - Performance Optimization Guide

This document outlines performance optimizations for the vlist virtual scrolling component. Many optimizations are already implemented, with a few remaining opportunities for specific use cases.

---

## Implemented Optimizations ✅

The following optimizations are already implemented in vlist:

### Core Optimizations (Always Active)

- **Element Pooling** - DOM elements are recycled via `createElementPool()`
- **Compression** - Large lists (1M+ items) use virtual scroll space compression
- **Event Delegation** - Single click listener on items container
- **Reusable Compression Context** - Avoids object allocation per frame
- **Cached Compression State** - Only recalculates when `totalItems` changes
- **Sparse Storage with LRU Eviction** - Efficient memory management for large datasets
- **Idle Detection** - Defers non-critical operations until scroll stops

### Recently Implemented (v1.1+)

- **DocumentFragment Batching** - New elements are batched and appended in a single DOM operation
- **Direct Property Assignment** - Uses `dataset` and `ariaSelected` instead of `setAttribute`
- **Static Role Attribute** - `role="option"` set once in element pool, not per render
- **Reusable ItemState Object** - Single object reused to reduce GC pressure
- **ResizeObserver** - Automatic viewport recalculation on container resize
- **Circular Buffer Velocity Tracker** - Pre-allocated buffer, zero allocations during scroll
- **Configurable Chunk Preloading** - Preloads items ahead based on scroll direction and velocity

---

## Configuration Options

### Loading Behavior

Control velocity-based loading and preloading via the `loading` config:

```typescript
const list = createVList({
  container: '#list',
  itemHeight: 50,
  template: myTemplate,
  adapter: myAdapter,
  loading: {
    // Velocity above which loading is skipped entirely (px/ms)
    // Default: 25
    cancelThreshold: 25,
    
    // Velocity above which preloading kicks in (px/ms)
    // Default: 2
    preloadThreshold: 2,
    
    // Number of items to preload ahead of scroll direction
    // Default: 50
    preloadAhead: 50,
  },
});
```

**Velocity-based loading strategy:**

| Scroll Speed | Velocity | Behavior |
|--------------|----------|----------|
| Slow | < `preloadThreshold` | Load visible range only |
| Medium | `preloadThreshold` to `cancelThreshold` | Preload items ahead |
| Fast | > `cancelThreshold` | Skip loading, defer to idle |

**Tuning tips:**
- **Slow API?** Increase `preloadAhead` (e.g., 100-200)
- **Heavy templates?** Decrease `preloadAhead` (e.g., 20-30)
- **Disable preloading:** Set `preloadThreshold: Infinity`

### Resize Handling

The `resize` event is emitted when the container dimensions change:

```typescript
list.on('resize', ({ height, width }) => {
  console.log(`Container resized to ${width}x${height}`);
});
```

---

## Template Authoring Guidelines

### ItemState Object Reuse

The `state` parameter passed to templates is **reused** to reduce GC pressure. Templates should:

```typescript
// ✅ Good - read state immediately
const template = (item, index, state) => {
  const className = state.selected ? 'item selected' : 'item';
  return `<div class="${className}">${item.name}</div>`;
};

// ❌ Bad - storing state reference
const template = (item, index, state) => {
  item._state = state;  // Don't do this! State object is reused
  return `<div>${item.name}</div>`;
};
```

### Efficient Templates

For best performance:

```typescript
// ✅ Simple string templates (fastest)
const template = (item, index, state) => 
  `<div class="item ${state.selected ? 'selected' : ''}">${item.name}</div>`;

// ✅ HTMLElement templates (good for complex layouts)
const template = (item, index, state) => {
  const el = document.createElement('div');
  el.className = state.selected ? 'item selected' : 'item';
  el.textContent = item.name;
  return el;
};

// ✅ Layout system (mtrl integration)
const template = (item, index, state) => {
  return createLayout([
    { class: 'item-content' },
    [{ class: 'item-name', text: item.name }],
  ]).element;
};
```

---

## Remaining Optimization Opportunities

These optimizations are **not implemented** and only beneficial in specific scenarios:

### 1. Template Result Caching 🟢

For templates with very expensive computations:

```typescript
// Only implement if templates are measurably slow (>1ms per item)
const templateCache = new WeakMap<T, HTMLElement>();

const cachedTemplate = (item, index, state) => {
  let cached = templateCache.get(item);
  if (!cached) {
    cached = expensiveTemplate(item, index, state);
    templateCache.set(item, cached);
  }
  // Clone and update state-dependent parts
  const clone = cached.cloneNode(true) as HTMLElement;
  clone.classList.toggle('selected', state.selected);
  return clone;
};
```

**When to use:** Only if your template involves heavy computation (parsing, complex calculations). Most templates don't need this.

### 2. Web Worker for Data Processing 🟢

For adapters that transform large amounts of data:

```typescript
// worker.ts
self.onmessage = (e) => {
  const { items } = e.data;
  // Heavy transformation off main thread
  const transformed = items.map(item => ({
    ...item,
    computedField: expensiveComputation(item),
  }));
  self.postMessage(transformed);
};

// adapter
const worker = new Worker('./transform-worker.ts');

const adapter = {
  read: async (params) => {
    const raw = await fetchItems(params);
    
    return new Promise(resolve => {
      worker.postMessage({ items: raw.items });
      worker.onmessage = (e) => {
        resolve({ items: e.data, total: raw.total });
      };
    });
  },
};
```

**When to use:** Only if data transformation causes visible frame drops during scrolling.

---

## Benchmarking

### Measuring Performance

```typescript
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

// Operation timing
const start = performance.now();
list.scrollToIndex(500000, 'center');
console.log(`Scroll took ${performance.now() - start}ms`);
```

### Chrome DevTools Profiling

1. Open Performance tab
2. Start recording
3. Scroll the list rapidly for 5-10 seconds
4. Stop recording
5. Look for:
   - Long tasks (>50ms) - indicates blocking operations
   - Excessive GC pauses - indicates too many allocations
   - Layout thrashing - indicates DOM inefficiency

### Expected Performance

With all optimizations enabled:
- **Scroll FPS:** 60fps sustained
- **Initial render:** <50ms for 50 items
- **Memory:** Stable (no growth during scrolling)
- **GC pauses:** Minimal (<5ms)

---

## Summary

| Optimization | Status | Impact |
|--------------|--------|--------|
| Element pooling | ✅ Implemented | High |
| DocumentFragment batching | ✅ Implemented | High |
| Direct property assignment | ✅ Implemented | Medium |
| Reusable ItemState | ✅ Implemented | Medium |
| ResizeObserver | ✅ Implemented | Medium |
| Circular buffer velocity | ✅ Implemented | Medium |
| Configurable preloading | ✅ Implemented | Medium |
| Compression for large lists | ✅ Implemented | High |
| Sparse storage + LRU | ✅ Implemented | High |
| Template caching | ❌ Not implemented | Situational |
| Web Worker for data | ❌ Not implemented | Situational |

---

## Related Documentation

- [Compression](./compression.md) - How large list compression works
- [Data Management](./data.md) - Sparse storage and chunking
- [Scroll Controller](./scroll.md) - Velocity tracking and scroll handling
- [Rendering](./render.md) - Element pooling and DOM management
- [Types](./types.md) - Configuration interfaces including `LoadingConfig`
