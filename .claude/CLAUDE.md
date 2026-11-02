# vlist — Project Instructions

High-performance virtual scrolling library. Zero dependencies, plugin architecture, TypeScript strict mode.

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
- `bun test --concurrent` — run all tests in parallel (~2x faster); gated in CI
- `bun test --changed` — run only tests affected by uncommitted changes
- `bun test --changed=main` — run tests affected by changes since `main`
- `bun test test/plugins/grid/` — run one folder
- `bun test --watch` — watch mode
- `bun run typecheck` — `tsc --noEmit` (src + tests)
- `bun run build` — build library (`build.ts`)
- `bun run size` — measure gzipped feature sizes
- `bun run release [patch|minor|major|<version>] [--from main|staging]` — automated release (version bump → commit → PR → wait for merge → tag push → npm publish via CI). 3.x from `main`, 2.x from `staging`.

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
- **Tests must pass under `bun test --concurrent`**, which CI runs alongside the
  sequential suite. `--concurrent` runs the tests *within a file* at the same
  time, so a test owns what it builds: create the list and container inside the
  test and dispose them in a `finally`, never through a module-level `let` plus
  an `afterEach`. A test that owns a process global — `document.activeElement`,
  a mutable `HTMLElement.prototype` geometry getter, a single mocked
  `ResizeObserver`, `window.dispatchEvent` — gets `it.serial` / `test.serial`
  and a comment naming the global. `describe.serial` is not honoured by Bun 1.4
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

**Integration and release branch is `main`.** Work on feature branches cut from
`main` and propose every change through a PR into `main`. `staging` remains
the frozen 2.x maintenance branch.

- ❌ **NEVER commit or push directly to `main`** — it is protected
- ❌ **NEVER merge, tag, release, deploy, or post publicly without explicit permission**
- ✅ Feature branches branch off `main` and merge back through a PR
- ✅ Committing on your own branch and opening a PR is ordinary work — no need to ask
- ✅ A PR merges only after exact-head CI (**Test & Build** and **Browser suites**) and independent review pass
- ✅ The base on `main` must be green before a PR merges; repair a red base first

The boundary is at publication, not at authorship: writing code and proposing it is
the work, while anything the outside world sees as final — a merge, a tag, a release,
a deploy, a public post — is a decision someone takes deliberately. The same line
applies to every contributor, human or agent.

**Before any git operation**, verify you're on the right branch:
```
git branch --show-current  # a feature branch, never commit directly to `main`
```

## CI/CD

### CI (`ci.yml`)
Runs on pushes and PRs targeting `main` or 2.x `staging`:
- Typecheck, Test, Test `--concurrent`, Coverage threshold (85%), Build, Bundle size, Heap growth —
  **every gate runs even when an earlier one is red**, and the final `Gate` step fails the job
  naming each red one. Read the `Gate` step's log, not the first red step

### Publish (`publish.yml`)
Triggered by `push: tags: v*.*.*` (not manual GitHub Release). On trigger:
1. Checks out the tag, installs, builds
2. Publishes to npm (`npm publish`)
3. On a stable release, moves npm `next` to the version just published with the
   workflow's OIDC identity (`npm dist-tag add`, npm >= 11.21.0). Needs
   **Allow npm dist-tag** on the package's trusted publisher on npmjs.com
   (disabled by default); the step is allowed to fail when that is off
4. Creates a GitHub Release with the tag's `CHANGELOG.md` section and its
   compare link (`scripts/release-notes.ts`), `--verify-tag`; a re-run on the
   same tag edits the existing release's notes instead of failing
5. Its last step is the fallback for step 3: it warns while npm `next` is below
   the version just published (`scripts/check-dist-tags.ts`, #334), without
   waiting for the registry's `latest` to catch up, so a maintainer runs
   `npm dist-tag add vlist@X.Y.Z next --auth-type=web`. The step prints that
   exact command in a warning and exits 0; when the registry cannot be read, it
   warns that the tags are unknown and still exits 0

**Do not manually create GitHub Releases** — the workflow handles it.

### Release Script (`scripts/release.ts`)
`bun run release [patch|minor|major|<version>] [--from main|staging]` prepares
3.x from `main` and 2.x from `staging`. A 3.x release has one release PR into
`main`; 2.x retains its staging-to-main promotion. `--from` confirms the line.

1. Commit notes under `[Unreleased]`: a theme, Who is affected, and entries.
2. From a clean worktree, run the release command. It fetches the source and
   creates `chore/release-X.Y.Z` from its remote tip, without checking out an
   integration branch another worktree may hold. It bumps the package, dates
   the notes, updates compare links and refreshes both README versions/sizes.
3. It pushes only the release branch and opens its PR into `main`. The
   operator merges with a merge commit pinned to the verified PR head.
4. The script verifies the main merge, package version and all checks, then
   stops. A separate `bun run release X.Y.Z --tag` re-verifies and tags that
   exact merge, without switching branches before or after the tag push.
5. Publish CI handles npm, the stable npm `next` dist-tag, the GitHub Release
   and the site dispatch. Verify npm version/tags and the live version at
   `https://vlist.io/dist/version.json`; wait through registry processing,
   never republish an accepted version.

A prerelease is never bumped automatically; name its stable version explicitly.
`--dry-run` prints the plan without changing files, branches, PRs or tags.

### Pre-Release Checklist

1. Review one release PR into `main`: package bump, dated changelog with theme
   and Who is affected, compare links, both README version labels and sizes.
2. Run `bun run size`; never move a failing budget to make a release pass.
3. Require independent review and green CI on the exact head and base.
4. Have the operator merge pinned to that head; verify the main merge's checks.
5. Tag only on the explicit release decision. Confirm npm, Release and the
   deployed site's version before recording the release.

## Zero Dependencies

Never add runtime dependencies. Everything is built from scratch. Dev dependencies for testing/building are fine.
