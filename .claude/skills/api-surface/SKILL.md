---
name: api-surface
description: Show all public exports from the vlist package to catch accidental API changes
allowed-tools: Read Grep Glob
---

# API Surface Check

List all public exports from the vlist package.

## Context

- Main entry: !`cat src/index.ts`
- Internals entry: !`cat src/internals.ts 2>/dev/null || echo "no internals.ts"`

## Instructions

1. Parse `src/index.ts` and `src/internals.ts` to list every public export.

2. Categorize exports:
   - **Functions** — factory functions like `vlist`, `withGrid`, etc.
   - **Types** — TypeScript type/interface exports
   - **Constants** — exported constant values
   - **Classes** — any exported classes

3. Output format:
   ```
   ## Public API (src/index.ts)

   ### Functions
   - `vlist(config)` — Builder factory
   - `withGrid(config)` — Grid layout feature
   ...

   ### Types
   - `VList<T>` — Main instance interface
   - `BuilderConfig` — Configuration options
   ...

   ### Constants
   - `OVERSCAN` — Default overscan count (3)
   ...

   ## Internals (src/internals.ts)
   ...
   ```

4. For each feature factory function (`with*`), note its config type if one exists.

5. Flag anything that looks like it might be accidentally exported (internal helpers, underscore-prefixed, etc.).
