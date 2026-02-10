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

Interactive examples and documentation are available at **[vlist.dev](https://vlist.dev)** (source: [github.com/floor/vlist.dev](https://github.com/floor/vlist.dev)).

## Project Structure

```
vlist/
├── src/
│   ├── index.ts          # Main entry — exports everything
│   ├── core.ts           # Lightweight standalone entry (7.3 KB)
│   ├── vlist.ts          # Full factory — wires all domains together
│   ├── types.ts          # Public type definitions
│   ├── context.ts        # Internal state container (dependency injection)
│   ├── handlers.ts       # Scroll, click, keyboard event handlers
│   ├── methods.ts        # Public API methods (data, scroll, selection)
│   ├── constants.ts      # All default values and magic numbers
│   ├── compression.ts    # Re-export for tree-shakeable sub-module
│   ├── render/           # Rendering domain
│   │   ├── heights.ts    #   Height cache (fixed + variable via prefix sums)
│   │   ├── renderer.ts   #   DOM rendering with element pooling
│   │   ├── virtual.ts    #   Virtual scrolling calculations
│   │   └── compression.ts#   Large-list compression (1M+ items)
│   ├── grid/             # Grid layout domain
│   │   ├── types.ts      #   GridConfig, GridLayout interfaces
│   │   ├── layout.ts     #   O(1) row/col calculations
│   │   └── renderer.ts   #   2D grid renderer (translate(x, y))
│   ├── groups/           # Sticky headers domain
│   │   ├── types.ts      #   GroupsConfig, GroupLayout interfaces
│   │   ├── layout.ts     #   Group boundary mapping
│   │   └── sticky.ts     #   Sticky header positioning
│   ├── data/             # Data management domain
│   ├── scroll/           # Scroll controller + custom scrollbar
│   ├── selection/        # Selection state management
│   ├── events/           # Event emitter
│   ├── styles/           # CSS files
│       ├── vlist.css     #   Core styles
│       └── vlist-extras.css # Optional variants and animations
├── test/                 # Tests (mirrors src/ structure)
└── build.ts              # Build script
```

> **Note:** Sandbox examples and documentation live in the [vlist.dev](https://github.com/floor/vlist.dev) repository.

### Architecture

vlist follows a **domain-driven** architecture. Each domain (`render/`, `grid/`, `groups/`, `data/`, `scroll/`, `selection/`, `events/`) is self-contained with its own types, pure functions, and tests.

The composition root is `vlist.ts` — it creates all domain components and wires them together via the **context** (`context.ts`), which acts as a dependency injection container. Handlers and methods receive the context and operate on its state.

**Key principle:** domains never import from each other horizontally. They only depend on shared types and the context.

## Development Workflow

### Making Changes

1. **Find the right domain** — most changes live in a specific domain folder
2. **Write tests first** — add tests in `test/` before implementing
3. **Run tests** — `bun test` (runs all), `bun test test/grid/` (runs one folder)
4. **Type check** — `bun run typecheck`
5. **Build** — `bun run build`
6. **Test visually** — check relevant examples at [vlist.dev](https://vlist.dev/sandbox/)

### Running Tests

```bash
# All tests
bun test

# Specific file
bun test test/grid/layout.test.ts

# Specific folder
bun test test/render/

# Watch mode
bun test --watch
```

Tests use [Bun's test runner](https://bun.sh/docs/cli/test) with JSDOM for DOM testing. Every domain has corresponding tests.

### Building

```bash
# Build library (main bundle + sub-modules + CSS)
bun run build

# Build with type declarations
bun run build --types
```

The build produces:
- `dist/index.js` — full bundle (ESM, minified)
- `dist/{domain}/index.js` — tree-shakeable sub-modules
- `dist/vlist.css` + `dist/vlist-extras.css` — stylesheets

## Code Standards

### TypeScript

- **Strict mode** — all compiler checks enabled (`strict`, `noUncheckedIndexedAccess`, etc.)
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

### New Domain

If your feature is a new capability (like grid or groups were):

1. Create `src/{domain}/` with `types.ts`, implementation files, and `index.ts`
2. Add tests in `test/{domain}/`
3. Wire into `vlist.ts` following the existing pattern (see how `grid/` or `groups/` integrate)
4. Add exports to `src/index.ts`
5. Add sub-module build entry to `build.ts`
6. Add package.json export path
7. Create a sandbox example in the [vlist.dev](https://github.com/floor/vlist.dev) repository

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

# Examples
feat(grid): add 2D grid layout mode
fix(scroll): prevent jitter on fast scroll
docs(readme): update API reference
test(render): add compression edge cases
refactor(data): simplify sparse storage
chore(deps): update dev dependencies
```

**Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `style`, `chore`, `perf`

**Scopes:** `grid`, `render`, `scroll`, `data`, `selection`, `groups`, `events`, `core`, `styles`, `sandbox`, `readme`, `deps`

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
5. Open a PR against `main`
6. Describe what changed and why

### PR Checklist

- [ ] Tests added or updated
- [ ] All tests pass (`bun test`)
- [ ] Type check passes (`bun run typecheck`)
- [ ] Build succeeds (`bun run build`)
- [ ] Sandbox example updated or added at [vlist.dev](https://github.com/floor/vlist.dev) (if user-facing)
- [ ] No new dependencies added
- [ ] Commit messages follow conventional commits

## Reporting Issues

- Use [GitHub Issues](https://github.com/floor/vlist/issues)
- Include a minimal reproduction
- Mention browser, OS, and vlist version
- For performance issues, include measurements

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).