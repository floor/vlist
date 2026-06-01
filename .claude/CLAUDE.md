# vlist — Project Instructions

High-performance virtual scrolling library. Zero dependencies, plugin architecture, TypeScript strict mode.

- **Staging:** [staging.vlist.io](https://staging.vlist.io) (uses latest staging branch code)

**Use `trash` instead of `rm` for all file deletions.** The `rm` command is denied in permissions.

- **Package:** `vlist` on npm
- **Repo:** `github.com/floor/vlist` (core) + separate repos for `vlist-react`, `vlist-vue`, `vlist-svelte`, `vlist-solidjs`
- **Docs:** [vlist.io](https://vlist.io)

## Positioning

vlist targets developers who don't use React. The React virtual list space is saturated (TanStack Virtual, react-window, react-virtuoso). Non-React frameworks (Vue, Svelte, Solid, vanilla JS) are underserved. Lead with framework breadth and accessibility — not React.

## README Strategy

Two READMEs:
- `README.md` — full version, shown on GitHub
- `README.npm.md` — slim version (~80 lines), shown on npmjs.com

The swap is automated via `prepublishOnly` / `postpublish` scripts. When editing:
- **GitHub audience** → edit `README.md`
- **npm audience** → edit `README.npm.md`
- Never manually swap them — `npm publish` handles it

## Commands

- `bun install` — install deps
- `bun test` — run all tests
- `bun test --concurrent` — run all tests in parallel (~2x faster)
- `bun test --changed` — run only tests affected by uncommitted changes
- `bun test --changed=staging` — run tests affected by changes since staging
- `bun test test/plugins/grid/` — run one folder
- `bun test --watch` — watch mode
- `bun run typecheck` — `tsc --noEmit` (src + tests)
- `bun run build` — build library (`build.ts`)
- `bun run size` — measure gzipped feature sizes
- `bun run release [patch|minor|major]` — automated release (version bump → commit → PR → wait for merge → tag push → npm publish via CI)

## Project Structure

```
src/
├── index.ts                # Public API — all exports
├── internals.ts            # Low-level exports for advanced users (vlist/internals)
├── constants.ts            # All defaults and magic numbers
├── types.ts                # Public type definitions
├── core/                   # Core engine
│   ├── create.ts           #   createVList factory
│   ├── types.ts            #   VList, VListPlugin, PluginContext, ResolvedConfig, AxisConfig
│   ├── pipeline.ts         #   Render pipeline (phase1Diff / phase2Commit)
│   ├── dom.ts              #   DOM structure creation
│   ├── scroll.ts           #   Scroll handler (rAF loop)
│   ├── pool.ts             #   Element pooling
│   ├── sizes.ts            #   Size cache (prefix sums)
│   ├── state.ts            #   Engine state
│   ├── hooks.ts            #   Hook compilation
│   ├── velocity.ts         #   Scroll velocity tracking
│   └── index.ts            #   Core exports
├── plugins/                # Opt-in plugins passed to createVList
│   ├── a11y/               #   Keyboard nav + single-select
│   ├── async/              #   Async data loading + pagination
│   ├── autosize/           #   Dynamic item measurement
│   ├── grid/               #   2D grid layout
│   ├── groups/             #   Sticky group headers
│   ├── masonry/            #   Pinterest-style layout
│   ├── page/               #   Document/window scroll mode
│   ├── scale/              #   1M+ items via scroll compression
│   ├── scrollbar/          #   Custom scrollbar UI
│   ├── selection/          #   Single/multi selection
│   ├── snapshots/          #   Scroll save/restore
│   ├── sortable/           #   Drag-and-drop reordering
│   ├── table/              #   Virtualized data table
│   └── transition/         #   FLIP-based enter/exit animations
├── rendering/              # Core rendering (not plugins)
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
├── core/
├── plugins/                #   One folder per plugin
├── rendering/
├── events/
├── utils/
└── integration/            #   Cross-plugin, memory, performance tests
```

## Architecture

Factory + plugin array: `createVList(config, [grid({ columns: 3 }), selection(), scrollbar()])`.

- **Core** (`src/core/`): Factory, DOM structure, scroll handling, element pooling, render pipeline, size cache
- **Plugins** (`src/plugins/`): Self-contained plugins passed as second argument to `createVList`, each implements `VListPlugin<T>`
- **PluginContext**: Internal interface plugins receive in `setup()` — hooks, registration arrays, replacement methods. Read `src/core/types.ts` for the full interface.
- **AxisConfig**: Internal geometry model — `{ primary: 'x' | 'y', cross?: 'x' | 'y' }`. Resolved from `orientation` + grid plugin presence. See RFC-005.
- **Auto-detection**: Framework adapters (separate repos) translate convenience config fields into plugin arrays

Key interfaces are in `src/core/types.ts`: `VList`, `VListPlugin`, `PluginContext`, `CreateVListConfig`, `ResolvedConfig`, `AxisConfig`. Always read this file when working on plugins.

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
- `config.axis.primary` (`"x" | "y"`) determines the scroll axis; derive `const isX = config.axis.primary === "x"` locally where needed
- No `horizontal` boolean — all axis logic flows from `AxisConfig`

## CSS Rules

- **No inline styles** — external CSS files only
- **BEM naming:** `{classPrefix}-{block}__{element}--{modifier}` (default prefix: `"vlist"`)
- **CSS custom properties** for theming
- **Low specificity** — avoid deep nesting
- **Dark mode** via `prefers-color-scheme` and `[data-theme-mode="dark"]`
- All classes use `resolvedConfig.classPrefix`

## Testing

Bun test runner with happy-dom (`@happy-dom/global-registrator`). Tests mirror `src/` structure.

**Every code change MUST include its tests in the same step.** Never split a fix and its tests into separate commits. Write the tests before reporting the work as done.

- DOM environment: `GlobalRegistrator.register()` in `beforeAll`, `unregister()` in `afterAll` — sets all browser globals
- Shared helpers in `test/helpers/`: `setupDOM`, `teardownDOM`, `createTestItems`, `createContainer`, `simpleTemplate`, `useFakeTimers`
- `useFakeTimers()`: custom utility (Bun lacks `mock.timers`) — intercepts setTimeout/setInterval, use `fakeTimers.tick(ms)` to advance
- Each plugin tested by: factory/validation, setup/registration, public methods, cross-plugin integration
- Plugins are unit-tested via mock `PluginContext` — see existing tests for the pattern
- 2 files still use JSDOM for per-test DOM isolation (controller.test.ts, scale/plugin.test.ts)

## Adding a New Plugin

1. Create `src/plugins/{name}/` with `plugin.ts` and `index.ts`
2. Implement `VListPlugin<T>`: `name`, `priority`, `setup(ctx)`, optional `destroy()`
3. Add tests in `test/plugins/{name}/`
4. Export from `src/index.ts`
5. Add build entry in `build.ts`
6. Add `package.json` export path if needed
7. Add auto-detection in adapter repos if applicable

## Commits

Conventional Commits: `type(scope): description`

- **Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `style`, `chore`, `perf`
- **Scopes:** `core`, `render`, `styles`, or plugin name (`grid`, `selection`, `table`, `async`, `scale`, `scrollbar`, `page`, `masonry`, `groups`, `snapshots`, `a11y`, `autosize`, `sortable`, `transition`)

## Git Workflow

**Working branch is `staging`.** The `main` branch is protected and requires a pull request.

- ❌ **NEVER push directly to `main`** — it is protected on GitHub and will be rejected
- ❌ **NEVER commit on `main`** — always work on `staging` or feature branches
- ❌ **NEVER commit or push without explicit user permission**
- ✅ Push to `staging`: `git push origin staging`
- ✅ Merge to `main` via PR: `staging` → `main`
- ✅ Feature branches branch off `staging`, merge back to `staging`

**Before any git operation**, verify you're on the right branch:
```
git branch --show-current  # Should show 'staging' or a feature branch, NEVER 'main'
```

## CI/CD

### CI (`ci.yml`)
Runs on push to `staging`/`main` and on PRs:
- Typecheck → Test → Coverage threshold (85%) → Build → Bundle size

### Publish (`publish.yml`)
Triggered by `push: tags: v*.*.*` (not manual GitHub Release). On trigger:
1. Checks out main, installs, builds
2. Publishes to npm (`npm publish`)
3. Creates a GitHub Release automatically (`gh release create`) with auto-generated notes

**Do not manually create GitHub Releases** — the workflow handles it.

### Release Script (`scripts/release.ts`)
`bun run release [patch|minor|major]` automates the full release flow:
1. Verifies you're on `staging` with a clean tree, pulls latest
2. Bumps version in `package.json`
3. Updates README version badge and changelog stats
4. Commits `chore(release): vX.Y.Z` and pushes `staging`
5. Creates PR `staging → main` via `gh` CLI
6. Polls every 10s until the PR is merged (max 10 min)
7. Checks out `main`, pulls, pushes the version tag (triggers publish.yml)
8. Returns to `staging`

### Pre-Release Checklist
Before tagging a new version, complete ALL of these steps:
1. Bump the version in `package.json`
2. Update `CHANGELOG.md` with the new version entries
3. Run `bun run size` to get current bundle sizes
4. Update `README.md` — version reference, base size in tagline, AND verify every row in the Plugins size table against `bun run size` output
5. Update `npm-readme.md` — version reference and base size

### Cross-Repo Staging Deploy (`notify-staging.yml`)
When `staging` is pushed, dispatches a `vlist-staging-updated` event to `floor/vlist.io` via `repository_dispatch`. This triggers a redeploy of `staging.vlist.io` with the latest vlist code — no manual intervention needed.

## Zero Dependencies

Never add runtime dependencies. Everything is built from scratch. Dev dependencies for testing/building are fine.
