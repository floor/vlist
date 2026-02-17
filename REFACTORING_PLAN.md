# VList Refactoring Plan - Module Organization

**Branch:** `refactor/module-organization`  
**Goal:** Reorganize and rename modules for clarity and optimal tree-shaking  
**Breaking Changes:** Yes (but library is new, no backward compatibility needed)

## Overview

Transform VList from dual-entry (monolithic + builder) to **builder-only** with clearer module naming and organization.

## Current State

```
src/
├── core.ts              # 10KB lite version (variable heights)
├── core-light.ts        # 3KB minimal version (fixed heights only)
├── vlist.ts             # Monolithic auto-plugin applier (20KB+)
├── index.ts             # Main export (monolithic)
├── types.ts
├── constants.ts
├── builder/             # Builder pattern implementation
├── plugins/             # All plugins
│   ├── compression/     # Large dataset handling
│   ├── data/           # Async loading
│   ├── scroll/         # Scrollbar UI
│   ├── window/         # Page-level scrolling
│   ├── groups/         # Grouped lists with headers
│   ├── grid/
│   ├── selection/
│   └── snapshots/
├── render/              # Virtual scrolling calculations
│   ├── compression.ts
│   ├── virtual.ts
│   ├── heights.ts
│   └── renderer.ts
├── adapters/            # Framework adapters (react, vue, svelte)
├── events/
└── styles/
```

## Target State

```
src/
├── index.ts             # Main export - builder only
├── types.ts
├── constants.ts
├── core/                # Keep but don't expose
│   ├── full.ts         # Builder-based (was: vlist.ts)
│   ├── lite.ts         # 10KB version (was: core.ts)
│   └── minimal.ts      # 3KB version (was: core-light.ts)
├── builder/             # Unchanged
├── features/            # Renamed from plugins/
│   ├── scale/          # Renamed from compression/
│   ├── async/          # Renamed from data/
│   ├── scrollbar/      # Renamed from scroll/
│   ├── page/           # Renamed from window/
│   ├── sections/       # Renamed from groups/
│   ├── grid/
│   ├── selection/
│   └── snapshots/
├── rendering/           # Renamed from render/
│   ├── viewport.ts     # Renamed from virtual.ts
│   ├── scale.ts        # Renamed from compression.ts
│   ├── heights.ts
│   └── renderer.ts
├── adapters/            # Unchanged
├── events/              # Unchanged
└── styles/              # Unchanged
```

## Phase 1: Rename Directories

### 1.1 Rename `plugins/` → `features/`

```bash
git mv src/plugins src/features
```

**Rationale:** "Features" better describes what they are from user perspective. More neutral term.

### 1.2 Rename `render/` → `rendering/`

```bash
git mv src/render src/rendering
```

**Rationale:** Clearer as a noun (the process of rendering).

## Phase 2: Rename Feature Modules

### 2.1 Rename `features/compression/` → `features/scale/`

```bash
git mv src/features/compression src/features/scale
```

**Files to update internally:**
- `src/features/scale/plugin.ts` - rename `withCompression` → `withScale`
- `src/features/scale/index.ts` - update exports

**Rationale:** "Scale" better conveys handling large datasets, not data compression.

### 2.2 Rename `features/data/` → `features/async/`

```bash
git mv src/features/data src/features/async
```

**Files to update internally:**
- `src/features/async/plugin.ts` - rename `withData` → `withAsync`
- `src/features/async/index.ts` - update exports

**Rationale:** Explicitly about asynchronous data loading, not just "data" (too vague).

### 2.3 Rename `features/scroll/` → `features/scrollbar/`

```bash
git mv src/features/scroll src/features/scrollbar
```

**Files to update internally:**
- Already exports `withScrollbar()` - keep as-is
- `src/features/scrollbar/index.ts` - update exports

**Rationale:** Scrolling is core functionality; this is specifically about custom scrollbar UI.

### 2.4 Rename `features/window/` → `features/page/`

```bash
git mv src/features/window src/features/page
```

**Files to update internally:**
- `src/features/page/plugin.ts` - rename `withWindow` → `withPage`
- `src/features/page/index.ts` - update exports

**Rationale:** "Page" better conveys document-level scrolling than generic "window".

### 2.5 Rename `features/groups/` → `features/sections/`

```bash
git mv src/features/groups src/features/sections
```

**Files to update internally:**
- `src/features/sections/plugin.ts` - rename `withGroups` → `withSections`
- `src/features/sections/index.ts` - update exports
- `src/features/sections/types.ts` - rename types (GroupsConfig → SectionsConfig, etc.)

**Rationale:** "Sections" is clearer for grouped lists with headers.

### 2.6 Keep Unchanged

- `features/grid/` - clear and accurate
- `features/selection/` - clear and accurate
- `features/snapshots/` - clear and accurate

## Phase 3: Rename Rendering Files

### 3.1 Rename `rendering/virtual.ts` → `rendering/viewport.ts`

```bash
git mv src/rendering/virtual.ts src/rendering/viewport.ts
```

**Rationale:** "Viewport" is more precise than "virtual" for viewport calculations.

### 3.2 Rename `rendering/compression.ts` → `rendering/scale.ts`

```bash
git mv src/rendering/compression.ts src/rendering/scale.ts
```

**Rationale:** Align with feature name change (compression → scale).

## Phase 4: Reorganize Core Files

### 4.1 Create `core/` directory

```bash
mkdir src/core
```

### 4.2 Move core files

```bash
git mv src/vlist.ts src/core/full.ts
git mv src/core.ts src/core/lite.ts
git mv src/core-light.ts src/core/minimal.ts
```

### 4.3 Update core files

**`src/core/full.ts`** (was: vlist.ts):
- Keep smart plugin auto-application logic
- This will NOT be exposed in public API (internal only)

**`src/core/lite.ts`** (was: core.ts):
- No changes needed
- Keep for future potential export

**`src/core/minimal.ts`** (was: core-light.ts):
- No changes needed
- Keep for future potential export

## Phase 5: Update Main Entry Point

### 5.1 Update `src/index.ts`

**Before:**
```typescript
export { createVList } from './vlist'
// ... lots of exports
```

**After:**
```typescript
// Main builder export
export { vlist } from './builder'

// Feature plugins - tree-shakeable
export { withScale } from './features/scale'
export { withAsync } from './features/async'
export { withScrollbar } from './features/scrollbar'
export { withPage } from './features/page'
export { withSections } from './features/sections'
export { withGrid } from './features/grid'
export { withSelection } from './features/selection'
export { withSnapshots } from './features/snapshots'

// Utilities (tree-shakeable)
export {
  createHeightCache,
  type HeightCache,
} from './rendering/heights'

export {
  createScrollController,
  type ScrollController,
} from './features/scrollbar'

// Types
export type {
  VList,
  VListConfig,
  VListItem,
  VListEvents,
  ItemTemplate,
  ItemState,
  // ... all other types
} from './types'

// Builder types
export type {
  VListBuilder,
  BuiltVList,
  BuilderConfig,
  VListPlugin,
} from './builder'

// Feature types
export type {
  ScaleConfig,
  ScaleState,
} from './features/scale'

export type {
  AsyncConfig,
  DataManager,
} from './features/async'

export type {
  ScrollbarConfig,
} from './features/scrollbar'

export type {
  SectionsConfig,
  SectionLayout,
  StickyHeader,
} from './features/sections'

export type {
  GridConfig,
  GridLayout,
} from './features/grid'

export type {
  SelectionConfig,
  SelectionState,
} from './features/selection'
```

## Phase 6: Update All Internal Imports

### 6.1 Search and replace across all files

**Plugin/Feature imports:**
```typescript
// Old → New
'./plugins/compression' → './features/scale'
'./plugins/data' → './features/async'
'./plugins/scroll' → './features/scrollbar'
'./plugins/window' → './features/page'
'./plugins/groups' → './features/sections'
'./plugins/grid' → './features/grid'
'./plugins/selection' → './features/selection'
'./plugins/snapshots' → './features/snapshots'
```

**Rendering imports:**
```typescript
// Old → New
'./render/compression' → './rendering/scale'
'./render/virtual' → './rendering/viewport'
'./render/heights' → './rendering/heights'
'./render/renderer' → './rendering/renderer'
'./render' → './rendering'
```

**Core imports:**
```typescript
// Old → New
'./vlist' → './core/full'
'./core' → './core/lite'
'./core-light' → './core/minimal'
```

### 6.2 Files that need import updates

**Builder:**
- `src/builder/core.ts`
- `src/builder/context.ts`
- `src/builder/data.ts`

**Features (all plugin.ts files):**
- `src/features/scale/plugin.ts`
- `src/features/async/plugin.ts`
- `src/features/scrollbar/plugin.ts`
- `src/features/page/plugin.ts`
- `src/features/sections/plugin.ts`
- `src/features/grid/plugin.ts`
- `src/features/selection/plugin.ts`
- `src/features/snapshots/plugin.ts`

**Rendering:**
- `src/rendering/index.ts`
- `src/rendering/renderer.ts`
- `src/rendering/viewport.ts`

**Core:**
- `src/core/full.ts` (was vlist.ts)
- `src/core/lite.ts` (was core.ts)

**Types:**
- `src/types.ts`

## Phase 7: Update Type Names

### 7.1 Rename types in `src/types.ts`

```typescript
// Old → New
GroupsConfig → SectionsConfig
GroupBoundary → SectionBoundary
GroupHeaderItem → SectionHeaderItem
GroupLayout → SectionLayout
```

### 7.2 Update all references

Search and replace across all files:
- `GroupsConfig` → `SectionsConfig`
- `GroupBoundary` → `SectionBoundary`
- `GroupHeaderItem` → `SectionHeaderItem`
- `GroupLayout` → `SectionLayout`

## Phase 8: Update Package.json Exports

### 8.1 Simplify exports

**Before:**
```json
{
  ".": "./dist/index.js",
  "./core": "./dist/core/index.js",
  "./core-light": "./dist/core-light.js",
  "./compression": "./dist/compression/index.js",
  "./data": "./dist/data/index.js",
  "./scroll": "./dist/scroll/index.js",
  "./groups": "./dist/groups/index.js",
  "./grid": "./dist/grid/index.js",
  "./selection": "./dist/selection/index.js",
  "./snapshots": "./dist/snapshots/index.js",
  "./builder": "./dist/builder/index.js"
}
```

**After:**
```json
{
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js",
    "default": "./dist/index.js"
  },
  "./styles": "./dist/vlist.css",
  "./styles/extras": "./dist/vlist-extras.css",
  "./package.json": "./package.json"
}
```

**Rationale:** Single entry point. Everything tree-shakeable from main export.

## Phase 9: Update Build Configuration

### 9.1 Update build script if needed

Check `build.ts` for any references to old paths:
- Remove separate entry points for plugins
- Ensure single entry point builds correctly
- Verify tree-shaking works

### 9.2 Update TypeScript config

Check `tsconfig.json` for any path mappings that need updating.

## Phase 10: Update Tests

### 10.1 Update test imports

All test files need import updates:
```typescript
// Old
import { withCompression } from '../src/plugins/compression'
import { withData } from '../src/plugins/data'

// New
import { withScale } from '../src/features/scale'
import { withAsync } from '../src/features/async'
```

### 10.2 Run tests

```bash
bun test
```

Fix any broken tests.

## Phase 11: Update Documentation Comments

### 11.1 Update JSDoc comments

Search for old terminology and update:
- "compression" → "scale" (in context of large datasets)
- "data plugin" → "async plugin"
- "groups" → "sections"
- "window scroll" → "page scroll"

### 11.2 Update code examples in comments

Ensure all code examples in JSDoc use new API.

## Verification Checklist

- [ ] All directories renamed
- [ ] All files moved to correct locations
- [ ] All internal imports updated
- [ ] All type names updated
- [ ] `src/index.ts` exports correct API
- [ ] `package.json` exports updated
- [ ] Build succeeds: `bun run build`
- [ ] Type check passes: `bun run typecheck`
- [ ] All tests pass: `bun test`
- [ ] No circular dependencies: `bun run analyze:deps`
- [ ] Tree-shaking verified (check bundle sizes)

## Expected Bundle Size Impact

**Before (monolithic):** ~63-70 KB minified (20-23 KB gzip)  
**After (builder):** ~22-35 KB minified (8-12 KB gzip) based on features used

**Improvement:** 2-3x smaller bundles! ✅

## Migration Guide for Users

### Before (Monolithic)
```typescript
import { createVList } from 'vlist'

const list = createVList({
  container: '#app',
  items: data,
  grid: { columns: 4 },
  groups: { ... }
})
```

### After (Builder)
```typescript
import { vlist, withGrid, withSections } from 'vlist'

const list = vlist({
  container: '#app',
  items: data
})
  .use(withGrid({ columns: 4 }))
  .use(withSections({ ... }))
  .build()
```

## Timeline Estimate

- **Phase 1-2** (Rename directories): 5 minutes
- **Phase 3-4** (Rename files): 10 minutes
- **Phase 5-6** (Update imports): 30 minutes
- **Phase 7** (Rename types): 15 minutes
- **Phase 8-9** (Package.json, build): 15 minutes
- **Phase 10** (Fix tests): 20 minutes
- **Phase 11** (Documentation): 15 minutes
- **Verification**: 20 minutes

**Total:** ~2.5 hours

## Notes

- Core files (`lite.ts`, `minimal.ts`) kept for future potential exposure
- Framework adapters (react, vue, svelte) unchanged
- Styles unchanged
- Events unchanged
- Builder pattern unchanged (just re-exported from main)

## Success Criteria

✅ Single main entry point: `import { vlist, withX } from 'vlist'`  
✅ Optimal tree-shaking (8-12 KB gzip based on usage)  
✅ Clear, intuitive naming (scale, async, sections, page)  
✅ All tests passing  
✅ Build successful  
✅ Ready for vlist.dev examples update