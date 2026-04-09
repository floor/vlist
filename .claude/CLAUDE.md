# vlist — Project Instructions

High-performance virtual scrolling library. Zero dependencies, plugin architecture, TypeScript strict mode.

**Use `trash` instead of `rm` for all file deletions.** The `rm` command is denied in permissions.

- **Package:** `@floor/vlist` on npm
- **Repo:** `github.com/floor/vlist` (core) + separate repos for `vlist-react`, `vlist-vue`, `vlist-svelte`, `vlist-solidjs`
- **Docs:** [vlist.io](https://vlist.io)

## Commands

- `bun install` — install deps
- `bun test` — run all tests
- `bun test test/features/grid/` — run one folder
- `bun test --watch` — watch mode
- `bun run typecheck` — `tsc --noEmit` (src + tests)
- `bun run build` — build library (`build.ts`)
- `bun run size` — measure gzipped feature sizes

## Project Structure

```
src/
├── index.ts                # Public API — all exports
├── internals.ts            # Low-level exports for advanced users (@floor/vlist/internals)
├── constants.ts            # All defaults and magic numbers
├── types.ts                # Public type definitions
├── builder/                # Builder pattern + plugin system
│   ├── core.ts             #   Builder factory (vlist function)
│   ├── materialize.ts      #   .build() implementation
│   ├── types.ts             #   BuilderConfig, BuilderContext, VListFeature, VList interfaces
│   ├── context.ts           #   Context factory for features
│   ├── api.ts               #   Public API surface assembly
│   ├── dom.ts               #   DOM structure creation
│   ├── data.ts              #   Simple data manager
│   ├── pool.ts              #   Element pooling
│   ├── range.ts             #   Range calculations
│   ├── scroll.ts            #   Scroll controller
│   ├── measurement.ts       #   Size measurement
│   └── velocity.ts          #   Scroll velocity tracking
├── features/               # Opt-in features via .use()
│   ├── grid/               #   2D grid layout (priority 10)
│   ├── masonry/            #   Shortest-lane masonry (priority 10)
│   ├── table/              #   Virtualized data table (priority 10)
│   ├── groups/             #   Sticky group headers (priority 10)
│   ├── async/              #   Async data adapter (priority 20)
│   ├── selection/          #   Selection state (priority 50)
│   ├── scrollbar/          #   Custom scrollbar (priority 60)
│   ├── scale/              #   Large-list compression, 1M+ items (priority 70)
│   ├── page/               #   Document/window scroll mode (priority 80)
│   └── snapshots/          #   Scroll save/restore (priority 90)
├── rendering/              # Core rendering (not features)
│   ├── sizes.ts            #   Size cache (prefix sums)
│   ├── renderer.ts         #   DOM rendering with pooling
│   ├── measured.ts         #   Auto-measurement for variable sizes
│   ├── scale.ts            #   Compression/scale utilities
│   ├── sort.ts             #   DOM sort utilities
│   └── viewport.ts         #   Viewport state
├── events/                 # Event emitter
├── utils/                  # Padding helpers, stats utility
└── styles/                 # vlist.css, vlist-table.css, vlist-extras.css
test/                       # Mirrors src/ structure
├── helpers/                #   setupDOM, createTestItems, createContainer, timer utils
├── builder/
├── features/               #   One folder per feature
├── rendering/
├── events/
├── utils/
└── integration/            #   Cross-feature, memory, performance tests
```

## Architecture

Builder pattern with composable features: `vlist(config).use(withGrid(...)).use(withSelection(...)).build()`.

- **Builder** (`src/builder/`): DOM structure, scroll handling, element pooling, virtual scrolling
- **Features** (`src/features/`): Self-contained plugins composed via `.use()`, each implements `VListFeature<T>`
- **BuilderContext**: Internal interface features receive in `setup()` — hooks, registration arrays, replacement methods. Read `src/builder/types.ts` for the full interface.
- **Auto-detection**: Framework adapters (separate repos) translate convenience config fields into `.use()` calls

Key interfaces are in `src/builder/types.ts`: `BuilderConfig`, `BuilderContext`, `VListFeature`, `VList`, `ResolvedBuilderConfig`. Always read this file when working on features.

## TypeScript Rules

1. **Strict mode** — all compiler checks enabled (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.)
2. **No `any`** — use `unknown` or proper interfaces. Zero tolerance.
3. **Explicit types** on all function parameters and return values
4. **Pure functions** over stateful classes
5. **`const` over `let`** unless mutation is required
6. **Early returns** over deep nesting
7. **Descriptive names** — clarity over brevity
8. **Small, focused functions** — one responsibility each
9. **Comment why, not what**
10. **JSDoc on all public exports**

## Performance Rules

The scroll handler runs every frame. These are non-negotiable:

1. **Zero allocations on the hot path** — reuse objects, mutate in place
2. **No `.map()`, `.filter()`, spread (`...`), or object creation per frame**
3. **Direct property access** over getters in hot paths
4. **Cache calculations** — don't recompute what hasn't changed
5. **Lazy resolution** — resolve feature method references once, cache by reference
6. **Early-exit guards** — skip work when scroll position hasn't changed
7. **Prefix sums** for O(1) offset lookups in size cache
8. **Element pooling** — recycle DOM elements, never create/destroy per frame

## Dimension-Agnostic Design

Use orientation-neutral terminology. The library supports both vertical and horizontal scrolling:

- `sizeCache.getSize(index)` not `getHeight(index)`
- `state.scrollPosition` not `state.scrollTop`
- `state.containerSize` not `state.height`
- `ResolvedBuilderConfig` has `horizontal: boolean` to determine axis

## CSS Rules

- **No inline styles** — external CSS files only
- **BEM naming:** `{classPrefix}-{block}__{element}--{modifier}` (default prefix: `"vlist"`)
- **CSS custom properties** for theming
- **Low specificity** — avoid deep nesting
- **Dark mode** via `prefers-color-scheme` and `[data-theme-mode="dark"]`
- All classes use `resolvedConfig.classPrefix`

## Testing

Bun test runner with JSDOM. Tests mirror `src/` structure.

- Shared helpers in `test/helpers/`: `setupDOM`, `teardownDOM`, `createTestItems`, `createContainer`, `simpleTemplate`, timer flush utilities
- Each feature tested by: factory/validation, setup/registration, public methods, cross-feature integration
- Features are unit-tested via mock `BuilderContext` — see existing tests for the pattern

## Adding a New Feature

1. Create `src/features/{name}/` with `feature.ts` and `index.ts`
2. Implement `VListFeature<T>`: `name`, `priority`, `setup(ctx)`, optional `destroy()`
3. Add tests in `test/features/{name}/`
4. Export from `src/index.ts`
5. Add build entry in `build.ts`
6. Add `package.json` export path if needed
7. Add auto-detection in adapter repos if applicable

## Commits

Conventional Commits: `type(scope): description`

- **Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `style`, `chore`, `perf`
- **Scopes:** `core`, `builder`, `render`, `styles`, or feature name (`grid`, `selection`, `table`, `async`, `scale`, `scrollbar`, `page`, `masonry`, `groups`, `snapshots`)

## Zero Dependencies

Never add runtime dependencies. Everything is built from scratch. Dev dependencies for testing/building are fine.
