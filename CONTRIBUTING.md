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
│   ├── internals.ts          # Low-level exports for advanced users
│   ├── types.ts              # Public type definitions
│   ├── constants.ts          # Shared constants and defaults
│   ├── core/                 # Core engine + factory
│   │   ├── index.ts          #   Core entry
│   │   ├── create.ts         #   createVList() factory
│   │   ├── types.ts          #   PluginContext, VListPlugin, VList, CreateVListConfig
│   │   ├── pipeline.ts       #   2-phase render pipeline (calculate → commit)
│   │   ├── hooks.ts          #   Hook compilation (plugin hooks → linear arrays)
│   │   ├── state.ts          #   EngineState (TypedArray-based hot-path state)
│   │   ├── sizes.ts          #   Size cache (prefix sums, O(1) lookups)
│   │   ├── data.ts           #   Data manager
│   │   ├── dom.ts            #   DOM structure creation (root, viewport, content)
│   │   ├── pool.ts           #   Element pool (DOM recycling)
│   │   ├── range.ts          #   Visible range calculations
│   │   ├── scroll.ts         #   Scroll handler
│   │   └── velocity.ts       #   Scroll velocity tracking
│   ├── plugins/              # Composable plugins (opt-in via plugins array)
│   │   ├── async/            #   Async data adapter (infinite scroll)
│   │   ├── autosize/         #   Auto-measure items via ResizeObserver
│   │   ├── grid/             #   2D grid / card layout
│   │   ├── groups/           #   Sticky group headers
│   │   ├── masonry/          #   Pinterest-style layout
│   │   ├── page/             #   Window scroll mode
│   │   ├── scale/            #   Large-list compression (1M+ items)
│   │   ├── scrollbar/        #   Custom scrollbar
│   │   ├── selection/        #   Selection state management
│   │   ├── snapshots/        #   Scroll save/restore
│   │   ├── sortable/         #   Drag-and-drop reordering
│   │   ├── table/            #   Data table with columns + sorting
│   │   └── transition/       #   FLIP-based enter/exit animations
│   ├── events/               # Event emitter
│   └── styles/               # CSS files
│       ├── vlist.css          #   Core styles
│       ├── vlist-table.css    #   Table plugin styles
│       └── vlist-extras.css   #   Optional variants
├── test/                     # Tests (mirrors src/ structure)
│   ├── helpers/              #   setupDOM, createPluginMockContext, timer utils
│   ├── builder/              #   Core engine tests
│   ├── features/             #   One folder per plugin
│   ├── rendering/
│   ├── events/
│   └── utils/
├── scripts/                  # Build & measurement scripts
├── build.ts                  # Build script
├── package.json
└── tsconfig.json
```

> **Note:** Sandbox examples and documentation live in the [vlist.io](https://github.com/floor/vlist.io) repository.

### Architecture

vlist uses a **factory + plugin architecture**. The core provides virtual scrolling essentials, and everything else is opt-in via composable plugins.

```
createVList(config, [       → VList instance
  grid(),                      (plugins composed at creation)
  selection(),
])
```

- **Core** (`src/core/`) — The `createVList()` factory creates the DOM structure, scroll handling, element pooling, and 2-phase render pipeline. Plugins are set up during creation and their hooks are compiled into linear arrays for zero-overhead iteration.
- **Plugins** (`src/plugins/`) — Self-contained capabilities that compose via `PluginContext` hooks. Each plugin receives the context in `setup()` and wires event handlers, DOM modifications, and public methods.
- **Events** (`src/events/`) — Typed event emitter.

**Key patterns:**

- **EngineState** — TypedArray-based state singleton. All hot-path data (`visibleIndices`, `visibleOffsets`, `visibleSizes`, `visibleCount`, `scrollPosition`, `containerSize`) lives in typed arrays — zero allocation per frame.
- **2-Phase Pipeline** — Phase 1 (`onCalculate`) fills TypedArrays with visible range and positions. Phase 2 (`onCommit`) reads the buffers and updates DOM. Plugins hook into either phase.
- **`PluginContext`** — The context object passed to every plugin's `setup()`. Plugins register handlers (`registerClickHandler`, `registerKeydownHandler`, `registerDestroyHandler`), add public methods (`registerMethod`), and can replace core functions (`setSizeConfig`, `setVisibleRangeFn`, `setRenderFn`).
- **`VListPlugin`** — The interface every plugin implements: `name`, optional `priority` (lower runs first), optional `conflicts` array, `setup(ctx)`, optional `hooks` object (`onCalculate`, `onCommit`, `onAfterScroll`, `onIdle`, `onResize`), optional `destroy()`.

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
bun test test/features/grid/feature.test.ts

# Specific folder
bun test test/features/grid/

# Watch mode
bun test --watch
```

Tests use [Bun's test runner](https://bun.sh/docs/cli/test) with JSDOM for DOM testing. Every domain has corresponding tests mirroring the `src/` structure. Plugin tests use the `createPluginMockContext()` helper from `test/helpers/plugin-context.ts`.

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

## Adding a New Plugin

Plugins are the primary extension mechanism. Each plugin is a self-contained module in `src/plugins/`.

### 1. Create the plugin directory

```
src/plugins/{name}/
├── plugin.ts     # VListPlugin implementation
├── feature.ts    # Core logic
├── index.ts      # Public exports
├── types.ts      # Type definitions (if needed)
└── ...           # Supporting files (layout.ts, renderer.ts, etc.)
```

### 2. Implement `VListPlugin`

```typescript
// src/plugins/{name}/plugin.ts
import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";

export const myPlugin = <
  T extends VListItem = VListItem,
>(): VListPlugin<T> => {
  return {
    name: "myPlugin",
    priority: 50, // Lower runs first. Use 5-10 for early, 50 for standard, 90+ for late.

    // Optional: declare conflicts with other plugins
    conflicts: ["grid"], // Cannot combine with grid

    setup(ctx: PluginContext<T>): void {
      const { dom, config, emitter, sizeCache } = ctx;

      // Register click/keydown handlers:
      ctx.registerClickHandler((event: MouseEvent) => {
        // Attached as DOM click listener on the root element
      });

      ctx.registerKeydownHandler((event: KeyboardEvent) => {
        // Attached as DOM keydown listener on the root element
      });

      ctx.registerDestroyHandler(() => {
        // Cleanup: remove listeners, free resources
      });

      // Add public API methods:
      ctx.registerMethod("myMethod", () => {
        // Accessible as list.myMethod() on the VList instance
      });
    },

    // Hot-path hooks — compiled into linear arrays, iterated per frame
    hooks: {
      onCalculate(state) {
        // Phase 1: mutate EngineState TypedArrays
      },
      onCommit(state) {
        // Phase 2: read state, update DOM
      },
      onAfterScroll(scrollPosition, direction) {
        // Runs after both phases complete
      },
      onIdle() {
        // Runs when scrolling stops
      },
      onResize(width, height) {
        // Runs on container resize
      },
    },

    destroy(): void {
      // Final cleanup
    },
  };
};
```

### 3. Add tests

Create matching test files in `test/features/{name}/`:

```
test/features/{name}/
├── feature.test.ts    # Plugin tests using createPluginMockContext()
├── layout.test.ts     # Unit tests for layout logic (if applicable)
└── ...
```

### 4. Export from `src/index.ts`

```typescript
export { myPlugin } from "./plugins/{name}";
```

### 5. Add package.json export (if sub-module import is needed)

In `package.json` exports map — only if the plugin needs a standalone import path.

### 6. Create a sandbox example

Add an interactive example in the [vlist.io](https://github.com/floor/vlist.io) repository.

**Reference implementations:**
- `src/plugins/page/` — simple plugin (single file, ~180 lines)
- `src/plugins/selection/` — medium plugin (state management + keyboard)
- `src/plugins/grid/` — complex plugin (layout engine + custom renderer)
- `src/plugins/table/` — complex plugin (columns, headers, sorting, resizing)

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

# Examples
feat(grid): add 2D grid layout mode
fix(scroll): prevent jitter on fast scroll
docs(readme): update API reference
test(rendering): add scale edge cases
refactor(core): simplify pipeline
perf(core): reduce allocations in scroll handler
chore(deps): update dev dependencies
```

**Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `style`, `chore`, `perf`

**Scopes:** `core`, `render`, `styles`, or specific plugin names (`grid`, `selection`, `table`, `scale`, `async`, `groups`, `masonry`, `page`, `scrollbar`, `snapshots`, `sortable`, `transition`). Also: `deps`, `readme`.

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
