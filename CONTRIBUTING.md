# Contributing to vlist

Thanks for your interest in contributing to vlist! This guide will help you get started.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- Node.js 18+ (for editor tooling)

### Setup

```bash
# Clone the repository
git clone https://github.com/floor/vlist.git
cd vlist

# Install dependencies
bun install

# Run tests
bun test

# Type check
bun run typecheck

# Build the library
bun run build
```

Interactive examples and documentation are available at **[vlist.io](https://vlist.io)** (source: [github.com/floor/vlist.io](https://github.com/floor/vlist.io)).

## Project Structure

```
vlist/
├── src/
│   ├── index.ts              # Main entry — exports everything
│   ├── types.ts              # Public type definitions
│   ├── constants.ts          # Shared constants
│   ├── builder/              # Builder pattern + core materialize
│   │   ├── index.ts          #   Builder entry + vlist() factory
│   │   ├── core.ts           #   Core materialize function (hot path)
│   │   ├── materialize.ts    #   Context factory + $ (MRefs) setup
│   │   ├── types.ts          #   BuilderContext, VListFeature, VList interfaces
│   │   ├── context.ts        #   Simplified context creator
│   │   ├── data.ts           #   Simple data manager
│   │   ├── dom.ts            #   DOM structure creation
│   │   ├── pool.ts           #   Element pool (DOM recycling)
│   │   ├── range.ts          #   Range calculations
│   │   ├── scroll.ts         #   Scroll utilities
│   │   └── velocity.ts       #   Scroll velocity tracking
│   ├── features/             # Composable features (opt-in via .use())
│   │   ├── async/            #   Async data adapter (infinite scroll)
│   │   ├── grid/             #   2D grid / card layout
│   │   ├── groups/           #   Sticky group headers
│   │   ├── masonry/          #   Pinterest-style layout
│   │   ├── page/             #   Window scroll mode
│   │   ├── scale/            #   Large-list compression (1M+ items)
│   │   ├── scrollbar/        #   Custom scrollbar
│   │   ├── selection/        #   Selection state management
│   │   ├── snapshots/        #   Scroll save/restore
│   │   └── table/            #   Data table with columns + sorting
│   ├── rendering/            # Core rendering engine
│   │   ├── index.ts          #   Rendering entry
│   │   ├── sizes.ts          #   Size cache (prefix sums)
│   │   ├── measured.ts       #   Auto-measurement (Mode B)
│   │   ├── renderer.ts       #   DOM rendering with pooling
│   │   ├── viewport.ts       #   Virtual scroll calculations
│   │   ├── scale.ts          #   Scale/compression utilities
│   │   └── sort.ts           #   Sort utilities
│   ├── events/               # Event emitter
│   │   ├── index.ts
│   │   └── emitter.ts
│   └── styles/               # CSS files
│       ├── vlist.css          #   Core styles
│       ├── vlist-table.css    #   Table feature styles
│       └── vlist-extras.css   #   Optional variants
├── test/                     # Tests (mirrors src/ structure)
│   ├── builder/
│   ├── features/
│   │   ├── async/
│   │   ├── grid/
│   │   ├── groups/
│   │   ├── masonry/
│   │   ├── page/
│   │   ├── scale/
│   │   ├── scrollbar/
│   │   ├── selection/
│   │   ├── snapshots/
│   │   └── table/
│   ├── rendering/
│   ├── events/
│   └── integration/
├── scripts/                  # Build & measurement scripts
├── build.ts                  # Build script
├── package.json
└── tsconfig.json
```

> **Note:** Sandbox examples and documentation live in the [vlist.io](https://github.com/floor/vlist.io) repository.

### Architecture

vlist uses a **builder/feature architecture**. The core provides virtual scrolling essentials, and everything else is opt-in via composable features.

```
vlist({ config })          → VListBuilder    (configure)
  .use(withGrid())         → VListBuilder    (compose features)
  .use(withSelection())    → VListBuilder    (chainable)
  .build()                 → VList           (materialize)
```

- **Builder** (`src/builder/`) — The `vlist()` factory creates a builder. `.use()` registers features, `.build()` materializes the DOM and returns the public `VList` API.
- **Features** (`src/features/`) — Self-contained capabilities that compose via `BuilderContext` hooks. Each feature receives the context in `setup()` and wires event handlers, DOM modifications, and public methods.
- **Rendering** (`src/rendering/`) — Pure rendering engine: size cache (prefix sums), virtual scroll calculations, DOM rendering with element pooling, and scale/compression for 1M+ items.
- **Events** (`src/events/`) — Typed event emitter.

**Key patterns:**

- **`$` (MRefs)** — Shared mutable state lives in a single object with short property names (`$.st` for scroll target, `$.vp` for viewport state, etc.). Both `core.ts` and `materialize.ts` read/write through it. Short names survive minification without bloating the bundle.
- **`BuilderContext`** — The context object passed to every feature's `setup()`. Features register callbacks on arrays (`afterScroll`, `clickHandlers`, `keydownHandlers`, `resizeHandlers`, `destroyHandlers`) and can replace core components (`renderer`, `dataManager`, `scrollController`).
- **`VListFeature`** — The interface every feature implements: `name`, `priority` (lower runs first), `setup(ctx)`, optional `destroy()`, optional `conflicts` array.

## Development Workflow

### Making Changes

1. **Find the right domain** — most changes live in a specific domain folder
2. **Write tests first** — add tests in `test/` before implementing
3. **Run tests** — `bun test` (runs all), `bun test test/features/grid/` (runs one folder)
4. **Type check** — `bun run typecheck`
5. **Build** — `bun run build`
6. **Test visually** — check relevant examples at [vlist.io](https://vlist.io/sandbox/)

### Running Tests

```bash
# All tests
bun test

# Specific file
bun test test/features/grid/layout.test.ts

# Specific folder
bun test test/features/grid/

# Watch mode
bun test --watch
```

Tests use [Bun's test runner](https://bun.sh/docs/cli/test) with JSDOM for DOM testing. Every domain has corresponding tests mirroring the `src/` structure.

### Building

```bash
# Build library (single bundle + CSS)
bun run build

# Build with type declarations
bun run build --types
```

The build produces:
- `dist/index.js` — full bundle (ESM, minified)
- `dist/index.d.ts` — TypeScript declarations
- `dist/vlist.css` + `dist/vlist-table.css` + `dist/vlist-extras.css` — stylesheets

### Measuring Bundle Size

```bash
bun run size
```

## Code Standards

### TypeScript

- **Strict mode** — all compiler checks enabled (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- **Explicit types** — type all function parameters and return values
- **No `any`** — use `unknown` or proper interfaces
- **Pure functions** — prefer pure functions over stateful classes
- **JSDoc comments** — document all public APIs

### Style

- Use `const` over `let` where possible
- Prefer early returns over deep nesting
- Use descriptive names — clarity over brevity
- Keep functions small and focused
- Comment **why**, not **what**

### Performance

Performance is critical in a virtual scrolling library. The scroll handler runs on every frame.

- **Zero allocations on the scroll hot path** — reuse objects, mutate in place
- **No object creation per frame** — avoid spreading (`...`), `.map()`, `.filter()` in handlers
- **Prefer direct property access** over getter functions in hot paths
- **Cache calculations** — don't recompute what hasn't changed
- **Measure before optimizing** — use the sandbox for real-world testing

### CSS

- No inline styles in components — use external CSS files
- Follow BEM naming: `vlist-{block}__{element}--{modifier}`
- Use CSS custom properties for theming
- Keep specificity low
- Support dark mode via `prefers-color-scheme` and `.dark` class

### Zero Dependencies

vlist has **zero runtime dependencies** by design. Do not add external packages. Everything is built from scratch — this keeps the bundle small and eliminates supply chain risk.

Dev dependencies (testing, building) are fine.

## Adding a New Feature

Features are the primary extension mechanism. Each feature is a self-contained module in `src/features/`.

### 1. Create the feature directory

```
src/features/{name}/
├── feature.ts    # VListFeature implementation
├── index.ts      # Public exports
├── types.ts      # Type definitions (if needed)
└── ...           # Supporting files (layout.ts, renderer.ts, etc.)
```

### 2. Implement `VListFeature`

```typescript
// src/features/{name}/feature.ts
import type { VListItem } from "../../types";
import type { VListFeature, BuilderContext } from "../../builder/types";

export const withMyFeature = <
  T extends VListItem = VListItem,
>(): VListFeature<T> => {
  // Local state lives in the closure — persists across setup/destroy
  let cleanup: (() => void) | null = null;

  return {
    name: "withMyFeature",
    priority: 50, // Lower runs first. Use 5-10 for early, 50 for standard, 90+ for late.

    // Optional: declare conflicts with other features
    conflicts: ["withGrid"], // Cannot combine with grid

    // Optional: declare methods this feature adds to the public VList API
    methods: ["myMethod"],

    setup(ctx: BuilderContext<T>): void {
      const { dom, config, emitter, state } = ctx;

      // Wire into extension points:
      ctx.afterScroll.push((scrollPosition, direction) => {
        // Runs after each scroll-triggered render
      });

      ctx.clickHandlers.push((event: MouseEvent) => {
        // Attached as DOM click listener on the root element
      });

      ctx.keydownHandlers.push((event: KeyboardEvent) => {
        // Attached as DOM keydown listener on the root element
      });

      ctx.resizeHandlers.push((width, height) => {
        // Runs when the container resizes
      });

      ctx.destroyHandlers.push(() => {
        // Cleanup: remove listeners, free resources
      });

      // Add public API methods:
      ctx.methods.set("myMethod", () => {
        // Accessible as list.myMethod() after .build()
      });
    },

    destroy(): void {
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
    },
  };
};
```

### 3. Add tests

Create matching test files in `test/features/{name}/`:

```
test/features/{name}/
├── feature.test.ts    # Integration tests for the feature
├── layout.test.ts     # Unit tests for layout logic (if applicable)
└── ...
```

### 4. Export from `src/index.ts`

```typescript
export { withMyFeature } from "./features/{name}";
```

### 5. Add package.json export (if sub-module import is needed)

In `package.json` exports map — only if the feature needs a standalone import path.

### 6. Create a sandbox example

Add an interactive example in the [vlist.io](https://github.com/floor/vlist.io) repository.

**Reference implementations:**
- `src/features/page/` — simple feature (single file, ~180 lines)
- `src/features/selection/` — medium feature (state management + keyboard)
- `src/features/grid/` — complex feature (layout engine + custom renderer)
- `src/features/table/` — complex feature (columns, headers, sorting, resizing)

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

# Examples
feat(grid): add 2D grid layout mode
fix(scroll): prevent jitter on fast scroll
docs(readme): update API reference
test(rendering): add scale edge cases
refactor(builder): simplify context creation
perf(core): reduce allocations in scroll handler
chore(deps): update dev dependencies
```

**Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `style`, `chore`, `perf`

**Scopes:** `core`, `builder`, `rendering`, or specific feature names (`grid`, `selection`, `table`, `scale`, `async`, `groups`, `masonry`, `page`, `scrollbar`, `snapshots`). Also: `styles`, `deps`, `readme`.

## Pull Requests

1. Fork the repository
2. Create a feature branch from `staging`: `git checkout -b feat/my-feature`
3. Make your changes following the standards above
4. Ensure all checks pass:
   ```bash
   bun test          # All tests pass
   bun run typecheck # No type errors
   bun run build     # Builds cleanly
   ```
5. Open a PR against `staging`
6. Describe what changed and why

### PR Checklist

- [ ] Tests added or updated
- [ ] All tests pass (`bun test`)
- [ ] Type check passes (`bun run typecheck`)
- [ ] Build succeeds (`bun run build`)
- [ ] Sandbox example updated or added at [vlist.io](https://github.com/floor/vlist.io) (if user-facing)
- [ ] No new runtime dependencies added
- [ ] Commit messages follow conventional commits

## Reporting Issues

- Use [GitHub Issues](https://github.com/floor/vlist/issues)
- Include a minimal reproduction
- Mention browser, OS, and vlist version
- For performance issues, include measurements

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
