# Test Fixes After Builder Pattern & Plugin Architecture Refactor

**Branch:** `fix/tests-after-refactor`
**Base:** `staging`
**Created:** 2026-02-16

## Summary

After the `refactor/builder-pattern` and `feat/plugin-architecture` merges, many tests are failing or irrelevant due to API changes.

**Current Status:**
- ✅ 706 tests passing (was 646)
- ❌ 50 tests failing (was 110)
- ⚠️ 11 errors
- **Total:** 756 tests across 22 files

**Progress:** 60 tests fixed! (85.5% → 93.4% passing)

## Test Failure Breakdown

### High Priority (Core API Changes)

#### 1. Reverse Mode Tests (32 failures) ✅ FIXED
**File:** `test/reverse.test.ts`

**Issues:**
- Error message format changed: `"[vlist] ..."` → `"[vlist/builder] ..."`
- `appendItems()` not working - total count not updating
- `prependItems()` not working - total count not updating
- Auto-scroll behavior broken

**Root Cause:**
The spread operator (`{ ...instance }`) in `vlist.ts` was destroying getters! When spreading an object with getters, JavaScript calls the getter ONCE and copies the VALUE, not the getter function itself.

**Fix Applied:**
- ✅ Fixed spread operator bug in `vlist.ts` - now adds `update()` method directly to instance
- ✅ Updated error message expectations to match new builder format
- ✅ Fixed array expansion bug in `setItems()` for appending beyond current length

**Result:** All 36 reverse mode tests now passing!

---

#### 2. Horizontal Direction Tests (26 failures)
**File:** `test/core.test.ts` (createVList horizontal direction)

**Issues:**
- Validation error messages changed
- DOM structure expectations may differ with builder pattern
- Data methods (`setItems`, `appendItems`) not working

**Fix Strategy:**
- [ ] Update error message expectations
- [ ] Verify horizontal mode builder configuration
- [ ] Fix DOM structure assertions
- [ ] Test data mutation methods

---

#### 3. Grid Mode Tests (16 failures)
**File:** `test/core.test.ts` (createVList grid mode)

**Issues:**
- Validation errors format changed
- Grid initialization failing
- Data methods not working in grid mode
- Grid + compression integration broken (4 additional failures in `test/integration.test.ts`)

**Fix Strategy:**
- [ ] Update validation error expectations
- [ ] Fix grid mode initialization with builder
- [ ] Fix grid data methods (`setItems`, `appendItems`, `removeItem`)
- [ ] Fix grid + compression integration

---

#### 4. Groups Mode Tests (12 failures)
**File:** `test/core.test.ts` (createVList groups mode)

**Issues:**
- Groups initialization failing
- Data methods (`setItems`, `appendItems`, `prependItems`, `removeItem`) broken
- Group layout rebuild not working
- Items getter not returning original items without headers

**Additional Failures:**
- `test/vlist-coverage.test.ts`: 4 failures in groups data mutation methods
- `test/vlist-coverage.test.ts`: 2 failures in groups scrollToIndex

**Fix Strategy:**
- [ ] Fix groups initialization with builder
- [ ] Fix groups data mutation methods
- [ ] Fix group layout rebuild logic
- [ ] Fix items getter to exclude headers
- [ ] Fix scrollToIndex with groups

---

### Medium Priority (Feature-Specific)

#### 5. Compression Mode Transitions (10 failures)
**File:** `test/vlist-coverage.test.ts`

**Issues:**
- Compression transition logic broken
- Scrollbar creation with compression failing (4 failures)
- Window mode compression sync issues (4 failures)

**Fix Strategy:**
- [ ] Review compression transition logic after builder refactor
- [ ] Fix scrollbar integration with compression
- [ ] Fix window mode compression synchronization

---

#### 6. Accessibility - Live Region (8 failures)
**File:** `test/accessibility.test.ts`

**Issues:**
- Live region ARIA integration broken
- Keyboard navigation ARIA integration (2 failures)

**Fix Strategy:**
- [ ] Verify live region still exists in builder pattern
- [ ] Fix ARIA attributes and announcements
- [ ] Fix keyboard navigation ARIA integration

---

#### 7. Grid Gap with Function Height (6 failures)
**File:** `test/vlist-coverage.test.ts`

**Issues:**
- Grid gap calculation broken when using function-based heights

**Fix Strategy:**
- [ ] Fix grid gap calculation with dynamic heights
- [ ] Verify grid layout math

---

#### 8. Adapter Tests (6 failures)
**File:** `test/vlist-coverage.test.ts`

**Issues:**
- Adapter initial load failing (6 failures)
- Adapter reload failing (2 failures in `test/core.test.ts`)
- Reverse mode with adapter (2 failures)

**Fix Strategy:**
- [ ] Fix adapter initialization with builder
- [ ] Fix adapter reload mechanism
- [ ] Fix adapter + reverse mode combination

---

#### 9. Svelte Action Tests (6 failures)
**File:** `test/adapters/svelte.test.ts`

**Issues:**
- Update method not working properly
- Sequential updates failing

**Fix Strategy:**
- [ ] Fix Svelte action `update()` method
- [ ] Test with actual Svelte integration if needed

---

#### 10. Sticky Header Wrapping (6 failures)
**File:** `test/vlist-coverage.test.ts`

**Issues:**
- Sticky header wrapping behavior broken

**Fix Strategy:**
- [ ] Review sticky header implementation after refactor
- [ ] Fix wrapping logic

---

#### 11. Additional Edge Cases (6 failures)
**File:** `test/vlist-coverage.test.ts`

**Issues:**
- Various edge case scenarios broken

**Fix Strategy:**
- [ ] Review each edge case individually
- [ ] Update to match new builder API

---

### Low Priority (Validation & Minor)

#### 12. Validation Tests (4 failures)
**File:** `test/vlist-coverage.test.ts`

**Issues:**
- Error messages changed for missing container/config

**Fix Strategy:**
- [ ] Update validation error message expectations

---

#### 13. Window Resize Handler (2 failures)
**File:** `test/vlist-coverage.test.ts`

**Fix Strategy:**
- [ ] Verify window resize handling still works

---

#### 14. Edge Cases (2 failures)
**File:** `test/core.test.ts`

**Fix Strategy:**
- [ ] Review and fix edge case tests

---

## Common Patterns Observed

### 1. Error Message Format Changes ✅ FIXED
**Old:** `"[vlist] error message"`
**New:** `"[vlist/builder] error message"` or `"[vlist/plugin] error message"`

**Solution:** Update all error message expectations globally.

### 2. Data Methods Not Working ✅ FIXED (Root Cause)
`appendItems()`, `prependItems()`, `setItems()`, `removeItem()` appeared broken in several modes.

**Root Cause Found:**
The spread operator in `vlist.ts` was destroying getters:
```typescript
// ❌ WRONG - destroys getters
return { ...instance, update: ... }

// ✅ CORRECT - preserves getters
(instance as any).update = ...
return instance
```

**Solution Applied:** Fixed in `vlist.ts` by adding methods directly to instance instead of spreading.

### 3. Total Count Not Updating ✅ FIXED
Many tests expected `list.total` to update after data mutations, but it wasn't happening.

**Solution:** Same root cause as #2 - spread operator was copying getter values instead of preserving getter functions.

### 4. Mode Combinations
Tests for combinations (reverse + groups, horizontal + groups, grid + groups) are failing.

**Solution:** Verify validation logic and error messages for incompatible modes.

## Bugs Fixed

### Critical Bug: Spread Operator Destroying Getters
**File:** `src/vlist.ts`
**Issue:** Using `{ ...instance }` to add the `update()` method was destroying all getters (`items`, `total`, etc.)
**Fix:** Add `update()` method directly to the instance object instead of spreading

### Array Expansion Bug
**File:** `src/builder/core.ts`
**Issue:** When appending items at offset beyond array length, sparse array was created
**Fix:** Explicitly set `items.length` before assigning to indices

## Fix Strategy

### Phase 1: Core API ✅ IN PROGRESS
1. ✅ Fix error message format globally
2. ✅ Fix data mutation methods (appendItems, prependItems, setItems, removeItem)
3. ✅ Fix `total` getter
4. ✅ Fix reverse mode (all 36 tests passing!)
5. ⏳ Fix groups mode (still failing)

### Phase 2: Layout Modes (Week 2)
1. Fix horizontal mode
2. Fix grid mode
3. Fix grid + compression integration

### Phase 3: Advanced Features (Week 3)
1. Fix compression transitions
2. Fix adapter integration
3. Fix Svelte action
4. Fix sticky headers
5. Fix accessibility (live region, ARIA)

### Phase 4: Edge Cases & Cleanup
1. Fix validation tests
2. Fix window resize
3. Fix remaining edge cases
4. Remove obsolete tests

## Notes

- Some tests may be testing old API that no longer exists
- Consider if tests need to be rewritten for new builder pattern
- May need to add new tests for builder-specific features
- Check if any functionality was intentionally removed during refactor

## Progress Tracking

- [x] Phase 1: Core API (4/5) - **80% complete**
  - ✅ Error message format
  - ✅ Data mutation methods
  - ✅ Total getter
  - ✅ Reverse mode
  - ⏳ Groups mode
- [ ] Phase 2: Layout Modes (0/3)
- [ ] Phase 3: Advanced Features (0/5)
- [ ] Phase 4: Edge Cases & Cleanup (0/3)

**Target:** All tests passing (756/756)
**Current:** 706/756 passing (93.4%)
**Remaining:** 50 failures to fix

**Major Wins:** 
- Fixed the spread operator bug that was breaking getters - this fixed 45+ tests!
- Fixed all validation error message format issues - 15+ more tests fixed!

---

## Session Notes

### 2026-02-16 - Phase 1 Progress (Session 1)
**Fixed:** Spread operator bug in `vlist.ts` destroying getters
- Root cause: `{ ...instance }` copies getter VALUES, not getter functions
- Impact: Fixed 45+ tests across reverse mode and other areas
- All reverse mode tests now passing (36/36)
- Progress: 85.5% → 91.4% passing (646 → 691 tests)

### 2026-02-16 - Phase 1 Progress (Session 2)
**Fixed:** Validation error messages and grid/groups/horizontal validations
- Updated all validation error messages to match builder format `[vlist/builder]`
- Added grid config validation in `vlist.ts` (required when layout='grid')
- Added groups/horizontal incompatibility validation
- Added `--horizontal` class modifier to root element
- Impact: Fixed 15 more tests
- Progress: 91.4% → 93.4% passing (691 → 706 tests)

**Remaining Issues (50 failures):**
- Horizontal mode DOM structure (overflow, width) - needs full implementation
- Groups mode data mutations and total getter
- Grid mode data methods and total getter
- Live region / accessibility tests (8 failures)
- Grid + compression integration (4 failures)
- Window resize handler (2 failures)

**Next Steps:**
- Focus on groups mode (data mutations, total getter) - 12 failures
- Investigate grid mode failures - 10 failures
- Horizontal mode may require larger refactor (DOM structure changes)

---

*Last Updated: 2026-02-16 (Phase 1 in progress)*