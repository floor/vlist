# Variable Item Heights — Implementation Prompt

## Goal

Implement variable item height support for vlist (Issue #1 from `docs/known-issues.md`). This is the single most important missing feature — it blocks ~80% of real-world use cases (chat messages, cards with descriptions, expandable rows, mixed content lists).

## Scope: Mode A Only (Function-Based Known Heights)

Ship **Mode A** first: the consumer provides a height function. Mode B (auto-measurement with `estimatedHeight`) is a follow-up.

### Target API

```typescript
// Current (fixed height) — keep as fast path
item: {
  height: 48,
  template: myTemplate,
}

// New (variable height via function)
item: {
  height: (index: number) => items[index].type === 'header' ? 64 : 48,
  template: myTemplate,
}
```

The `ItemConfig.height` field changes from `number` to `number | ((index: number) => number)`. When it's a number, all existing code paths should remain as-is (zero-cost fast path). When it's a function, use a prefix-sum based lookup system.

## Architecture

### Core Data Structure: Prefix-Sum Array

For variable heights, we need efficient:
- **Index → offset**: "What is the Y position of item 500?" → O(1) prefix sum lookup
- **Offset → index**: "Which item is at scroll position 12,340px?" → O(log n) binary search on prefix sums

```
heights:    [48, 64, 48, 48, 96, 48, ...]
prefixSums: [0, 48, 112, 160, 208, 304, 352, ...]

totalHeight = prefixSums[n]  (last entry)
offsetOf(i) = prefixSums[i]
indexAt(scrollTop) = binarySearch(prefixSums, scrollTop)
```

Create a new module `src/render/heights.ts` that encapsulates this:

```typescript
interface HeightCache {
  /** Get offset (Y position) for an item index — O(1) */
  getOffset(index: number): number;

  /** Get height of a specific item */
  getHeight(index: number): number;

  /** Find item index at a scroll offset — O(log n) binary search */
  indexAtOffset(offset: number): number;

  /** Total content height */
  getTotalHeight(): number;

  /** Rebuild prefix sums (call when items change) */
  rebuild(totalItems: number): void;

  /** Whether heights are variable (false = fixed fast path) */
  isVariable(): boolean;
}

/** Create height cache — returns fixed or variable implementation */
function createHeightCache(
  height: number | ((index: number) => number),
  initialTotal: number
): HeightCache;
```

When `height` is a `number`, return a trivial implementation that uses multiplication (current behavior, zero overhead). When it's a function, build the prefix-sum array.

### Files That Need Changes

Every location that currently uses `index * itemHeight` or `scrollTop / itemHeight` must be updated. Here is the complete list:

**`src/types.ts`** — Change `ItemConfig.height` from `number` to `number | ((index: number) => number)`

**`src/context.ts`** — Change `VListContextConfig.itemHeight` from `number` to `number | ((index: number) => number)`. Add `heightCache: HeightCache` to the context.

**`src/vlist.ts`** — Create `HeightCache` during init. Pass it into context. Update all calls that pass `itemHeight` to use the cache instead.

**`src/render/virtual.ts`** — These pure functions all take `itemHeight: number`:
- `calculateActualHeight(totalItems, itemHeight)` → use `heightCache.getTotalHeight()`
- `calculateItemOffset(index, itemHeight)` → use `heightCache.getOffset(index)`
- `createViewportState(...)` → needs height cache
- `updateViewportState(...)` → needs height cache
- `updateViewportSize(...)` → needs height cache
- `updateViewportItems(...)` → needs height cache

**`src/render/compression.ts`** — These take `itemHeight: number`:
- `getCompressionState(totalItems, itemHeight)` → needs total height from cache
- `calculateCompressedVisibleRange(scrollTop, containerHeight, itemHeight, totalItems, ...)` → needs cache for `indexAtOffset` and `getOffset`
- `calculateCompressedItemPosition(index, itemHeight, ...)` → needs cache for `getOffset`
- `calculateCompressedScrollToIndex(index, itemHeight, ...)` → needs cache for `getOffset`
- `calculateIndexFromScrollPosition(scrollTop, itemHeight, ...)` → needs cache for `indexAtOffset`
- `needsCompression(totalItems, itemHeight)` → needs total height
- `getMaxItemsWithoutCompression(itemHeight)` → only meaningful for fixed heights

**`src/render/renderer.ts`** — `calculateOffset` inside `createRenderer` uses `index * itemHeight`:
- Needs height cache for positioning items via `getOffset(index)`

**`src/methods.ts`** — `scrollToIndex` passes `ctx.config.itemHeight` to `calculateScrollToIndex`:
- Pass height cache instead

**`src/handlers.ts`** — `createScrollHandler` passes `ctx.config.itemHeight` to `updateViewportState`:
- Pass height cache instead

### Strategy: HeightCache Abstraction

The cleanest approach is to **not change the signatures of compression/virtual functions piecemeal**. Instead:

1. Create `HeightCache` in `src/render/heights.ts`
2. Add `heightCache` to `VListContext`
3. Update the functions in `virtual.ts` and `compression.ts` to accept `HeightCache` instead of `itemHeight: number`
4. The fixed-height `HeightCache` implementation uses pure multiplication internally, so there is zero performance regression for fixed-height lists

This way the change is clean: swap `itemHeight: number` → `HeightCache` in function signatures, and each function uses `cache.getOffset(i)` / `cache.indexAtOffset(scrollTop)` / `cache.getTotalHeight()` instead of arithmetic.

### Compression Interaction

For compressed mode with variable heights:
- `getCompressionState` needs total height → use `heightCache.getTotalHeight()`
- The compression ratio is `virtualHeight / actualHeight` — this still works because `actualHeight` comes from the cache
- `calculateCompressedVisibleRange` currently uses `scrollTop / itemHeight` for the non-compressed path → replace with `heightCache.indexAtOffset(scrollTop)`
- `calculateCompressedItemPosition` uses `index * itemHeight` for non-compressed → replace with `heightCache.getOffset(index)`
- For the compressed path, the scroll-ratio-based interpolation still works conceptually (ratio × totalItems gives approximate index), but bottom-snapping logic that uses `containerHeight / itemHeight` needs to use the cache to count how many items fit

### Prefix-Sum Rebuild

The prefix-sum array must be rebuilt when:
- `setItems` is called (total changes)
- `appendItems` / `prependItems` is called (can extend or rebuild)
- `removeItem` is called (rebuild from removal point)
- Total changes via adapter loading

For Mode A (known heights), the height function is deterministic, so rebuilding is just re-running the function for each index. This is O(n) but only happens on data changes, not on scroll.

### Tests

Create `test/render/heights.test.ts` with:
- Fixed height cache: getOffset, indexAtOffset, getTotalHeight, rebuild
- Variable height cache: same operations with a function
- Binary search edge cases: first item, last item, between items, exact boundaries
- Empty list, single item
- Rebuild after total changes

Update existing tests in:
- `test/render/virtual.test.ts` — pass HeightCache instead of itemHeight
- `test/render/compression.test.ts` — same
- `test/methods.test.ts` — mock HeightCache in context
- `test/handlers.test.ts` — mock HeightCache in context
- `test/integration.test.ts` — add integration test with variable heights

### Backward Compatibility

- `height: number` must keep working exactly as before
- The fixed-height `HeightCache` must have zero overhead (inline multiplication)
- All existing 443 tests must continue to pass
- The public `VList` interface doesn't change (height is part of config, not runtime API)

## Key Files to Read First

Before coding, read these files to understand the current architecture:

```
src/render/heights.ts    ← CREATE THIS (new module)
src/types.ts             ← ItemConfig.height type change
src/context.ts           ← VListContextConfig, HeightCache integration
src/vlist.ts             ← Orchestration, how itemHeight flows through
src/render/virtual.ts    ← All viewport calculation functions
src/render/compression.ts ← Compression math (most complex changes)
src/render/renderer.ts   ← Item positioning in DOM
src/methods.ts           ← scrollToIndex uses itemHeight
src/handlers.ts          ← scroll handler uses itemHeight
```

## Implementation Order

1. **Create `src/render/heights.ts`** — HeightCache interface + fixed/variable implementations + tests
2. **Update `src/types.ts`** — Change `ItemConfig.height` type
3. **Update `src/context.ts`** — Add HeightCache to context config
4. **Update `src/render/virtual.ts`** — Replace `itemHeight` params with HeightCache
5. **Update `src/render/compression.ts`** — Replace `itemHeight` params with HeightCache
6. **Update `src/render/renderer.ts`** — Use HeightCache for positioning
7. **Update `src/render/index.ts`** — Export new module
8. **Update `src/vlist.ts`** — Create HeightCache, wire into context
9. **Update `src/methods.ts`** and `src/handlers.ts`** — Use HeightCache from context
10. **Update all tests** — Pass HeightCache mocks, add variable height integration tests
11. **Update `src/index.ts`** — Export HeightCache type
12. **Run full test suite** — All 443+ tests must pass
13. **Build and typecheck** — `bun run build && bun run typecheck`
14. **Update docs** — `docs/known-issues.md` (mark as done), `docs/types.md`, `docs/vlist.md`, `docs/render.md`

## What NOT To Do

- Do NOT implement Mode B (auto-measurement / `estimatedHeight`) — that's a follow-up
- Do NOT change the public VList API beyond the config type
- Do NOT break compression support — it must work with variable heights
- Do NOT regress performance for fixed-height lists — the fixed HeightCache must be zero-overhead
- Do NOT skip tests — this is a core architecture change
- Do NOT commit without explicit permission