# vlist - Performance Optimization Guide

This document outlines performance optimizations for the vlist virtual scrolling component. Many optimizations are already implemented, with concrete remaining opportunities organized by category.

---

## Implemented Optimizations ✅

The following optimizations are already implemented in vlist:

### Core Optimizations (Always Active)

- **Element Pooling** - DOM elements are recycled via `createElementPool()`
- **Compression** - Large lists (1M+ items) use virtual scroll space compression
- **Event Delegation** - Single click listener on items container
- **Reusable Compression Context** - Avoids object allocation per frame (`reusableCompressionCtx` in context)
- **Cached Compression State** - Only recalculates when `totalItems` changes (`getCachedCompression`)
- **Zero-Allocation Scroll Hot Path** - Cached compression passed to `updateViewportState` and range functions; no `CompressionState` or `Range` objects allocated per frame
- **In-Place Range Mutation** - `calculateCompressedVisibleRange` and `calculateCompressedRenderRange` accept optional `out` parameter to mutate existing range objects
- **RAF-Throttled Native Scroll** - `handleNativeScroll` wrapped with `rafThrottle` to guarantee at most one processing per animation frame
- **CSS Containment** - `contain: layout style` on items container, `contain: content` + `will-change: transform` on items for optimized compositing
- **Scroll Transition Suppression** - `.vlist--scrolling` class toggled during active scroll to disable CSS transitions, re-enabled on idle
- **Sparse Storage with LRU Eviction** - Efficient memory management for large datasets
- **Idle Detection** - Defers non-critical operations until scroll stops
- **DocumentFragment Batching** - New elements are batched and appended in a single DOM operation
- **Direct Property Assignment** - Uses `dataset` and `ariaSelected` instead of `setAttribute`
- **Static Role Attribute** - `role="option"` set once in element pool, not per render
- **Reusable ItemState Object** - Single object reused to reduce GC pressure
- **ResizeObserver** - Automatic viewport recalculation on container resize
- **Circular Buffer Velocity Tracker** - Pre-allocated buffer, zero allocations during scroll
- **Configurable Chunk Preloading** - Preloads items ahead based on scroll direction and velocity
- **Cheap Pool Release** - `textContent=""` instead of `innerHTML=""` in element pool release (no HTML parser invocation)
- **Batched LRU Timestamps** - Single `Date.now()` call per render via `touchChunksForRange()` instead of per-item in `storage.get()`
- **In-Place Focus Mutation** - `moveFocusUp/Down/ToFirst/ToLast/ByPage` mutate `focusedIndex` directly, zero object allocations
- **Targeted Keyboard Focus Render** - Arrow keys update only 2 affected items via `updateItemClasses()` instead of full-rendering all ~20-50 visible items

---

## Configuration Options

### Loading Behavior

Control velocity-based loading and preloading via the `loading` config:

```typescript
const list = createVList({
  container: '#list',
  item: {
    height: 50,
    template: myTemplate,
  },
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

Concrete improvements organized by category and priority.

### 🚀 Speed (Hot Path Allocations)

#### ~~S1. Remove `innerHTML = ""` from element pool release~~ ✅ Implemented

Replaced with `textContent = ""` (no HTML parser invocation). Content is overwritten on next `acquire()` → `applyTemplate()`.

#### ~~S2. Batch `Date.now()` in sparse storage access~~ ✅ Implemented

Added `touchChunksForRange(start, end)` that calls `Date.now()` once per render cycle. Removed per-item `Date.now()` from `storage.get()`.

#### ~~S3. Avoid `SelectionState` allocation on every arrow key~~ ✅ Implemented

Focus movement functions (`moveFocusUp/Down/ToFirst/ToLast/ByPage`) now mutate `state.focusedIndex` in-place instead of spreading new objects.

#### S4. Lazy-build `getState()` in data manager 🟡 Low Impact

**Problem:** `getState()` creates a new object and spreads `[...pendingRanges]` on every call. Called frequently from `notifyStateChange()`.

**File:** `src/data/manager.ts` — `getState`, `notifyStateChange`

**Fix:** Pass a dirty flag to `notifyStateChange` and only build the full state object when the consumer explicitly calls `getState()`. Internal hot paths should use the direct getters (`getTotal()`, `getCached()`, etc.) which already exist.

---

### 🎬 Smoothness (Rendering & Scroll Feel)

#### ~~M1. Targeted re-render on keyboard focus change~~ ✅ Implemented

Arrow key navigation now uses `renderer.updateItemClasses()` on just the 2 affected items (old focus → remove class, new focus → add class) instead of full-rendering all ~20-50 visible items. Space/Enter (selection changes) still trigger full render.

#### M2. Make idle timeout configurable 🟡 Low Impact

**Problem:** `SCROLL_IDLE_TIMEOUT` is hardcoded at 150ms. This works on desktop but may be too aggressive on mobile/slower devices where scroll event gaps are naturally longer.

**File:** `src/constants.ts`, `src/types.ts`, `src/scroll/controller.ts`

**Fix:** Expose via `VListConfig` or `ScrollControllerConfig`:

```typescript
interface VListConfig {
  // ...
  /** Scroll idle detection timeout in ms (default: 150) */
  idleTimeout?: number;
}
```

---

### 📦 Size (Bundle & CSS Weight)

#### Z1. Deduplicate dark mode CSS 🟠 Medium Impact

**Problem:** Dark mode custom properties are defined identically in both `@media (prefers-color-scheme: dark)` and `.dark {}` — that's ~700 bytes of exact duplication (12 properties × 2).

**File:** `src/styles/vlist.css`

**Fix:** Consolidate using a single definition block:

```css
@media (prefers-color-scheme: dark) {
    :root {
        --vlist-bg: #111827;
        /* ... */
    }
}

/* Class override reuses same values — define once */
.dark {
    --vlist-bg: #111827;
    /* ... */
}
```

**Option A:** Keep both but accept the duplication (current, ~700 bytes gzipped is negligible).

**Option B:** Remove the `.dark` class block and document that consumers should use `@media` or define their own `.dark` override. This halves the dark mode CSS.

**Option C:** Use a CSS custom property layer approach so both selectors share one declaration block. Browser support may be a concern.

#### Z2. Split unused CSS into a separate file 🟠 Medium Impact

**Problem:** The following CSS classes are defined but never created by the vlist component itself:

- `.vlist-loading`, `.vlist-loading-spinner` — loading overlay
- `.vlist-empty`, `.vlist-empty-icon`, `.vlist-empty-text`, `.vlist-empty-subtext` — empty state
- `.vlist--compact`, `.vlist--comfortable` — density variants
- `.vlist--borderless`, `.vlist--striped` — visual variants
- `.vlist-item--enter`, `.vlist--animate` — animations
- `@keyframes vlist-spin`, `@keyframes vlist-fade-in` — animation keyframes

These are "convenience" classes for consumers but bloat the core CSS (~2.5-3 KB).

**File:** `src/styles/vlist.css`

**Fix:** Split into two files:

```
dist/vlist.css         ← Core styles only (~6-7 KB, ~1.5 KB gzipped)
dist/vlist-extras.css  ← Presets, variants, loading/empty states
```

Update `package.json` exports:

```json
"exports": {
  ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
  "./styles": "./dist/vlist.css",
  "./styles/extras": "./dist/vlist-extras.css"
}
```

#### Z3. Lazy-initialize placeholder manager 🟡 Low Impact

**Problem:** `createPlaceholderManager()` is always instantiated in the data manager, even for static lists with `items: [...]` that never need placeholders. The placeholder module includes structure analysis, field detection, and masked text generation (~300 lines).

**File:** `src/data/manager.ts` — `createDataManager`

**Fix:** Create the placeholder manager lazily, only when the first unloaded item is requested:

```typescript
// Before
const placeholders = createPlaceholderManager<T>(placeholderConfig);

// After
let placeholders: PlaceholderManager<T> | null = null;
const getPlaceholders = () => {
  if (!placeholders) {
    placeholders = createPlaceholderManager<T>(placeholderConfig);
  }
  return placeholders;
};
```

This keeps the code tree-shakeable for bundlers and avoids initialization cost for static lists.

#### Z4. Use CSS class instead of inline `style.cssText` for static styles 🟡 Low Impact

**Problem:** Every pooled element gets `style.cssText = "position:absolute;top:0;left:0;right:0;height:${itemHeight}px"` applied. The first four properties are already defined in `.vlist-item` CSS. This duplicates styles and requires string parsing per element.

**File:** `src/render/renderer.ts` — `applyStaticStyles`

**Fix:** Rely on the existing `.vlist-item` class for static positioning. Only set the dynamic height:

```typescript
// Before
const staticStyles = `position:absolute;top:0;left:0;right:0;height:${itemHeight}px`;
const applyStaticStyles = (element) => {
  element.style.cssText = staticStyles;
};

// After — only set what CSS doesn't know
const applyStaticStyles = (element) => {
  element.style.height = `${itemHeight}px`;
};
```

This reduces per-element work and avoids overriding the CSS class with equivalent inline styles.

#### Z5. Eliminate thin pass-through wrappers in virtual.ts 🟡 Low Impact

**Problem:** Several functions in `virtual.ts` are 1-2 line wrappers that call `getCompressionState` + delegate to `compression.ts`. These add ~20-30 lines of code + JSDoc duplication.

**File:** `src/render/virtual.ts` — `calculateVisibleRange`, `calculateRenderRange`, `calculateTotalHeight`

**Fix:** If S1 is implemented (compression passed as parameter), these wrappers become pure pass-throughs and can be replaced by direct re-exports from `compression.ts`.

---

### 🟢 Situational Optimizations (Consumer-Side)

These optimizations are **not implemented in vlist** and only beneficial in specific scenarios:

#### Template Result Caching

For templates with very expensive computations (>1ms per item):

```typescript
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

#### Web Worker for Data Processing

For adapters that transform large amounts of data:

```typescript
// worker.ts
self.onmessage = (e) => {
  const { items } = e.data;
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

### Implemented

| Optimization | Impact |
|--------------|--------|
| Element pooling | High |
| DocumentFragment batching | High |
| Compression for large lists | High |
| Sparse storage + LRU | High |
| Zero-allocation scroll hot path (S1→S2 done) | High |
| RAF-throttled native scroll (M1 done) | High |
| Reusable Compression Context | Medium |
| Cached Compression State | Medium |
| CSS containment + `will-change` (M2 done) | Medium |
| Scroll transition suppression (M3 done) | Medium |
| Direct property assignment | Medium |
| Reusable ItemState | Medium |
| ResizeObserver | Medium |
| Circular buffer velocity | Medium |
| Configurable preloading | Medium |
| Idle detection | Medium |
| Event delegation | Medium |
| Static role attribute | Low |

### Pending — Priority Matrix

| # | Optimization | Impact | Effort | Category |
|---|-------------|--------|--------|----------|
| Z1 | Deduplicate dark mode CSS | 🟠 Medium | Low | Size |
| Z2 | Split unused CSS to extras file | 🟠 Medium | Low | Size |
| S4 | Lazy state object in data manager | 🟡 Low | Low | Speed |
| Z3 | Lazy-init placeholder manager | 🟡 Low | Medium | Size |
| Z4 | CSS class instead of inline styles | 🟡 Low | Low | Size/Speed |
| Z5 | Eliminate thin virtual.ts wrappers | 🟡 Low | Low | Size |
| M2 | Configurable idle timeout | 🟡 Low | Low | Smoothness |

**Completed:** S1 ✅, S2 ✅, S3 ✅, M1 ✅
**Next quick wins:** Z1 (CSS dedup), Z2 (CSS split), S4 (lazy state)

---

## Related Documentation

- [Compression](./compression.md) - How large list compression works
- [Data Management](./data.md) - Sparse storage and chunking
- [Scroll Controller](./scroll.md) - Velocity tracking and scroll handling
- [Rendering](./render.md) - Element pooling and DOM management
- [Types](./types.md) - Configuration interfaces including `LoadingConfig`
