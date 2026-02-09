# Known Issues & Roadmap

> Honest assessment of current limitations and prioritized plan to make vlist the best vanilla virtual list.

## Current State

vlist is a well-optimized, batteries-included virtual list with zero dependencies. It supports both fixed and variable item heights, built-in selection, keyboard navigation, infinite scroll, and 1M+ item compression.

**Where vlist wins today:**
- ✅ Zero dependencies
- ✅ Automatic compression for 1M+ items (no competitor does this)
- ✅ Built-in selection (single/multi/keyboard) — competitors say "BYO"
- ✅ Built-in infinite scroll with adapter, placeholders, velocity-based loading
- ✅ Variable item heights via `height: (index) => number` (Mode A)
- ✅ Smooth `scrollToIndex` animation with easing
- ✅ Extensive scroll hot-path optimizations (zero-allocation, RAF-throttled, circular buffer velocity)
- ✅ 543 tests, comprehensive documentation

**Where vlist falls short:**

| Gap | Impact | Competitors |
|-----|--------|-------------|
| No auto-height measurement (Mode B) | ⚠️ Mode A covers known heights; Mode B needed for dynamic content | @tanstack/virtual ✅ |
| No horizontal / grid layout | ❌ Major | @tanstack/virtual ✅ |
| No window (document) scrolling | ❌ Major | @tanstack/virtual ✅ |
| No sticky headers / grouped lists | ❌ Common pattern | react-virtuoso ✅ |
| No reverse mode (chat UI) | ❌ Common pattern | react-virtuoso ✅ |
| No framework adapters | ❌ Adoption barrier | @tanstack/virtual ✅ |
| Bundle ~12.2 KB gzip | ⚠️ 2× larger than tanstack (~5.5 KB) | @tanstack/virtual ✅ |
| Basic accessibility | ⚠️ Missing aria-setsize/posinset | — |

---

## Phase 1 — Remove Dealbreakers

### 1. ✅ Variable Item Heights — Mode A (Function-Based Known Heights)

**Status:** ✅ **Shipped** — Mode A (function-based known heights) is implemented.

**What shipped:**

`ItemConfig.height` now accepts `number | ((index: number) => number)`:

```typescript
// Fixed height (existing, zero-overhead fast path)
item: {
  height: 48,
  template: myTemplate,
}

// Variable height via function (NEW)
item: {
  height: (index: number) => items[index].type === 'header' ? 64 : 48,
  template: myTemplate,
}
```

**Architecture:**

A new `HeightCache` abstraction (`src/render/heights.ts`) encapsulates height lookups:
- **Fixed implementation:** O(1) via multiplication — zero overhead, matches previous behavior
- **Variable implementation:** O(1) offset lookup via prefix-sum array, O(log n) binary search for index-at-offset

All rendering, compression, and scroll functions (`virtual.ts`, `compression.ts`, `renderer.ts`, `handlers.ts`, `methods.ts`) accept `HeightCache` instead of `itemHeight: number`. The fixed-height `HeightCache` uses pure multiplication internally, so there is **zero performance regression** for fixed-height lists.

Compression works with variable heights: the compression ratio uses actual total height from the cache, and near-bottom interpolation counts items fitting from bottom using actual heights.

**What remains (Mode B — follow-up):**

```typescript
// Mode B: Estimated + measured (most flexible, what tanstack does)
item: {
  estimatedHeight: 48,  // Initial guess for scroll math
  template: myTemplate, // vlist measures after render, caches actual height
}
```

Mode B (auto-measurement with `estimatedHeight`) is a separate follow-up. It requires DOM measurement after render and dynamic cache updates, which is a different complexity level.

---

### 2. ✅ Smooth `scrollToIndex` Animation

**Status:** Done

**Implementation:** Custom `easeInOutQuad` animation loop that works in both native and compressed scroll modes. Fully backward-compatible API — the second argument accepts either a string alignment or a `ScrollToOptions` object.

```typescript
// Old API still works
list.scrollToIndex(500, 'center');

// New smooth scrolling
list.scrollToIndex(500, { align: 'center', behavior: 'smooth' });
list.scrollToIndex(500, { behavior: 'smooth', duration: 500 });

// Cancel in-progress animation
list.cancelScroll();

// Also works on scrollToItem
list.scrollToItem('user-123', { align: 'center', behavior: 'smooth' });
```

**New type:**
```typescript
interface ScrollToOptions {
  align?: 'start' | 'center' | 'end';
  behavior?: 'auto' | 'smooth';
  duration?: number; // default: 300ms
}
```

**Changes:** `src/types.ts`, `src/methods.ts`, `src/index.ts`, `test/methods.test.ts` (+12 tests)

---

### 3. ✅ Shrink Bundle Size

**Status:** Done (sub-module split + lazy-init placeholder)

**a) Split entry points for tree-shaking — Done:**

Consumers can now import individual sub-modules instead of the full bundle:

```typescript
import { createVList } from 'vlist'                    // full bundle
import { createSparseStorage } from 'vlist/data'       // 9.2 KB / 3.8 KB gzip
import { getCompressionInfo } from 'vlist/compression'  // 2.0 KB / 0.9 KB gzip
import { createSelectionState } from 'vlist/selection'  // 1.9 KB / 0.7 KB gzip
import { createScrollController } from 'vlist/scroll'   // 5.2 KB / 2.1 KB gzip
```

Bundle sizes after split:

| Import | Minified | Gzipped |
|--------|----------|---------|
| `vlist` (full) | 34.4 KB | 11.6 KB |
| `vlist/data` | 9.2 KB | 3.8 KB |
| `vlist/scroll` | 5.2 KB | 2.1 KB |
| `vlist/compression` | 2.0 KB | 0.9 KB |
| `vlist/selection` | 1.9 KB | 0.7 KB |

**b) Lazy-init placeholder manager — Done (Z3):**

The placeholder manager (~400 lines) is now only instantiated when first needed (i.e., when an unloaded item is requested). Static `items: [...]` lists never create it.

**c) Remaining:** The full bundle size hasn't shrunk because `createVList` internally depends on all modules. Further reduction would require making features like selection, scrollbar, and placeholders conditionally loaded inside `createVList` itself — a larger architectural change deferred for later.

**Changes:** `build.ts`, `package.json`, `src/compression.ts` (new), `src/data/manager.ts`

---

## Phase 2 — Expand Layout Modes

### 4. Horizontal Scrolling

**Priority:** Medium.

**Problem:** Some UIs need horizontal lists (carousels, timelines, horizontal menus). Currently vlist is vertical-only.

**Approach:** Generalize the scroll controller and renderer to accept a direction:

```typescript
const list = createVList({
  container: '#carousel',
  direction: 'horizontal', // new option (default: 'vertical')
  item: {
    width: 200,  // or height for vertical
    template: (item) => `<div class="card">${item.title}</div>`,
  },
  items: cards,
});
```

**Architecture impact:**
- Swap `scrollTop` ↔ `scrollLeft`, `height` ↔ `width`, `translateY` ↔ `translateX`
- CSS containment and positioning need axis-awareness
- Compression works the same (just on the opposite axis)

**Estimated effort:** Medium — mostly mechanical axis swaps if abstracted well.

---

### 5. Grid / Masonry Layout

**Priority:** Medium.

**Problem:** Image galleries, card grids, and dashboard tiles need 2D virtualization. This is a top use case that no vanilla library handles well.

**Approach:**

```typescript
const grid = createVList({
  container: '#gallery',
  layout: 'grid',       // new option
  columns: 4,           // or 'auto' for responsive
  item: {
    height: 200,
    template: (item) => `<img src="${item.thumbnail}" />`,
  },
  items: photos,
});
```

**Architecture impact:**
- `(row, col)` calculation from flat index: `row = floor(index / columns)`, `col = index % columns`
- Virtual range is rows, not items: visible rows × columns = visible items
- Item width = `containerWidth / columns`
- Compression applies to row count, not item count

**Estimated effort:** Medium-Large — new layout mode but builds on existing virtual scrolling math.

---

### 6. Window (Document) Scrolling

**Priority:** Medium.

**Problem:** Currently vlist only works inside a contained `overflow: auto` div. Many pages need the list to scroll with the page itself (search results, feeds, landing pages).

**Approach:**

```typescript
const list = createVList({
  container: '#results',
  scrollElement: window,  // new option (default: own viewport)
  item: { height: 48, template: myTemplate },
  items: searchResults,
});
```

**Architecture impact:**
- Listen on `window.scroll` instead of viewport scroll
- Calculate list offset from page top: `getBoundingClientRect().top`
- Visible range = items within `(windowScrollY - listTop)` to `(windowScrollY - listTop + windowHeight)`
- No custom scrollbar needed (browser handles it)
- Compressed mode may not apply (window scroll has different height limits)

**Estimated effort:** Medium.

---

## Phase 3 — Advanced Patterns

### 7. Sticky Headers / Grouped Lists

**Priority:** Medium.

**Problem:** Grouped lists with sticky section headers (like iOS Contacts: A, B, C...) are a ubiquitous UI pattern. No vanilla library does this cleanly.

**Approach:**

```typescript
const list = createVList({
  container: '#contacts',
  item: { height: 48, template: contactTemplate },
  groups: {
    getGroupForIndex: (index) => contacts[index].lastName[0],
    headerHeight: 32,
    headerTemplate: (group) => `<div class="section-header">${group}</div>`,
    sticky: true,
  },
  items: contacts,
});
```

**Architecture impact:**
- Group headers are virtual items with special positioning
- Sticky headers need `position: sticky` or manual positioning outside the virtual container
- Scroll calculations must account for header heights interspersed with items
- Builds naturally on variable height support (Phase 1)

**Estimated effort:** Medium — depends on variable heights being done first.

---

### 8. Reverse Mode (Chat UI)

**Priority:** Medium.

**Problem:** Chat and messaging UIs start scrolled to the bottom and prepend messages on top. This is a very common pattern that's surprisingly hard to get right with virtual scrolling.

**Approach:**

```typescript
const chat = createVList({
  container: '#messages',
  reverse: true,  // new option
  item: {
    estimatedHeight: 60,
    template: messageTemplate,
  },
  adapter: {
    read: async ({ offset, limit }) => {
      // Loads older messages
      return fetchMessages({ before: oldestId, limit });
    },
  },
});

// Append new message at bottom
chat.appendItems([newMessage]);
// Auto-scrolls to bottom if user was at bottom
```

**Architecture impact:**
- Render order is reversed (newest at bottom, oldest at top)
- Prepending items must maintain scroll position (not jump)
- "Load more" triggers at the TOP, not bottom
- `scrollToIndex(0)` means "go to newest", not oldest
- Requires variable height support for realistic chat bubbles

**Estimated effort:** Medium-Large — depends on variable heights.

---

### 9. Framework Adapters

**Priority:** Medium — for adoption, not for the core library.

**Problem:** React/Vue/Svelte/Solid developers won't use a vanilla library directly if ergonomic framework wrappers exist elsewhere (tanstack).

**Approach:** Keep vlist as the pure vanilla core. Ship optional thin wrappers (<1 KB each):

```typescript
// vlist/react — thin wrapper
import { useVList } from 'vlist/react';

function UserList({ users }) {
  const { ref, virtualItems } = useVList({
    count: users.length,
    estimateSize: () => 48,
  });

  return (
    <div ref={ref} style={{ height: 400, overflow: 'auto' }}>
      {virtualItems.map(({ index, style }) => (
        <div key={users[index].id} style={style}>
          {users[index].name}
        </div>
      ))}
    </div>
  );
}
```

```typescript
// vlist/vue — thin wrapper
import { VList } from 'vlist/vue';

// <VList :items="users" :item-height="48" v-slot="{ item }">
//   <div>{{ item.name }}</div>
// </VList>
```

**Estimated effort:** Small per adapter — they're thin wrappers around `createVList`. The real work is designing the ergonomic API for each framework.

---

## Phase 4 — Prove It's The Best

### 10. Public Benchmark Page

**Priority:** High (for marketing).

**Problem:** "Fastest" and "lightweight" are claims without proof. A benchmark page makes it credible.

**Approach:** Host at `vlist.dev/benchmarks` with automated comparisons:

| Benchmark | What It Measures |
|-----------|-----------------|
| Scroll FPS | 10K/100K/1M items, sustained scroll for 10s |
| Initial render | Time to first visible item |
| Memory baseline | After initial render |
| Memory stability | After 60s of scrolling (should be flat) |
| GC pauses | Max pause duration during scroll |
| Bundle size | Minified, gzipped, core-only vs full |
| Time to interactive | Script parse + first render |

**Compare against:** @tanstack/virtual, react-window, react-virtuoso, clusterize.js

**Estimated effort:** Medium — build the harness once, runs automatically.

---

### 11. Auto-Height Measurement

**Priority:** Low (Phase 4 polish — requires variable heights first).

**Problem:** Even with Mode A (function-based heights), consumers must know heights upfront. Auto-measurement lets consumers provide just an estimate and vlist figures out the rest.

**Approach:**

```typescript
item: {
  estimatedHeight: 48,
  template: myTemplate,
  // vlist renders item, measures with getBoundingClientRect(),
  // caches actual height, adjusts scroll position
}
```

**Challenge:** Measuring causes layout, which is expensive. Must be batched and amortized — only measure items as they enter the viewport for the first time, then cache forever (or until data changes).

---

### 12. Enhanced Accessibility

**Priority:** Medium.

**Current gaps:**

| Missing | Standard | Impact |
|---------|----------|--------|
| `aria-setsize` | WAI-ARIA Listbox | Screen readers can't announce "item 5 of 10,000" |
| `aria-posinset` | WAI-ARIA Listbox | Same — positional context is lost |
| `aria-busy` | WAI-ARIA | No loading state announced |
| Live regions | WAI-ARIA | Selection changes not announced |
| Roving tabindex | WAI-ARIA Practices | Tab behavior could be improved |

**Fix:**

```typescript
// On each rendered item
element.setAttribute('aria-setsize', String(totalItems));
element.setAttribute('aria-posinset', String(index + 1));

// On container during loading
root.setAttribute('aria-busy', 'true');

// Live region for selection announcements
const liveRegion = document.createElement('div');
liveRegion.setAttribute('aria-live', 'polite');
liveRegion.setAttribute('aria-atomic', 'true');
// "3 items selected" on selection change
```

**Estimated effort:** Small-Medium.

---

### 13. Scroll Position Save/Restore

**Priority:** Low.

**Problem:** When navigating away and returning (SPA route change, browser back), scroll position is lost.

**Approach:**

```typescript
// Save
const snapshot = list.getScrollSnapshot();
// { index: 523, offsetInItem: 12, selectedIds: [...] }
sessionStorage.setItem('list-scroll', JSON.stringify(snapshot));

// Restore
const saved = JSON.parse(sessionStorage.getItem('list-scroll'));
list.restoreScroll(saved);
```

**Estimated effort:** Small.

---

## Priority Matrix

| # | Feature | Impact | Effort | Phase | Status |
|---|---------|--------|--------|-------|--------|
| 1 | Variable item heights (Mode A) | 🔴 Critical | Large | 1 | ✅ Done |
| 2 | Smooth scrollToIndex | 🟠 High | Small | 1 | ✅ Done |
| 3 | Shrink bundle size | 🟠 High | Medium | 1 | ✅ Done |
| 4 | Horizontal scrolling | 🟡 Medium | Medium | 2 | 🟡 Pending |
| 5 | Grid layout | 🟡 Medium | Medium-Large | 2 | 🟡 Pending |
| 6 | Window scrolling | 🟡 Medium | Medium | 2 | 🟡 Pending |
| 7 | Sticky headers | 🟡 Medium | Medium | 3 | 🟡 Pending |
| 8 | Reverse mode (chat) | 🟡 Medium | Medium-Large | 3 | 🟡 Pending |
| 9 | Framework adapters | 🟡 Medium | Small each | 3 | 🟡 Pending |
| 10 | Public benchmarks | 🟠 High | Medium | 4 | 🟡 Pending |
| 11 | Auto-height measurement | 🟢 Low | Medium | 4 | 🟡 Pending |
| 12 | Enhanced accessibility | 🟡 Medium | Small-Medium | 4 | 🟡 Pending |
| 13 | Scroll save/restore | 🟢 Low | Small | 4 | 🟡 Pending |

---

## Remaining Optimization (from optimization.md)

| # | Item | Status |
|---|------|--------|
| Z1 | Deduplicate dark mode CSS | ⏸️ Deferred (gzip handles it) |
| Z3 | Lazy-init placeholder manager | ✅ Done (part of Issue #3) |

---

## Related Documentation

- [Optimization Guide](./optimization.md) — Implemented performance optimizations
- [Main Documentation](./vlist.md) — Configuration and usage
- [Compression Guide](./compression.md) — How 1M+ item compression works
- [Styles Guide](./styles.md) — CSS architecture

---

*Last updated: February 2025*
*Status: Phase 1 complete — variable heights (Mode A), smooth scrollToIndex, and bundle split all shipped. Phase 2+ pending.*