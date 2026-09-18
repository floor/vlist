# AGENTS.md — working on vlist

For any coding agent (and any person in a hurry). The project tree and setup are in
[CONTRIBUTING.md](./CONTRIBUTING.md); this page is what that tree does not tell you.

## The shape in one paragraph

`createVList(config, plugins)` (`src/core/create.ts`) builds a small core — DOM, size cache,
element pool, a two-phase render pipeline (`src/core/pipeline.ts`: calculate into typed arrays,
then commit to the DOM) — and hands each plugin a `PluginContext` (`src/core/types.ts`:
`dom`, `scroll`, `items`, `sizes`, `render`, `hooks`, `nav`, `pool`, `config`, `emitter`).
Everything beyond a plain list is a plugin in `src/plugins/<name>/`. The default entry scrolls
natively; `vlist/synthetic` owns the input for lists taller than the browser allows.

## Contracts that bite

- **Three index spaces.** *Data* (the caller's items), *layout* (what the size cache sees:
  group headers, grid rows) and, under `carousel()`, *virtual* (laps of the data). Convert
  with the published hooks — `_layoutToDataIndex`, `_dataToLayoutIndex`, `_getTotal`,
  `_getLoadedItem` — never by assuming two spaces coincide. `data-index` and `aria-posinset`
  carry the public (data) index; an element's `id` carries the index it is mounted under.
- **One owner per concern.** A plugin that owns navigation registers it with `ctx.nav.set()`
  (carousel does); one that owns scrolling an item into view publishes `_scrollItemIntoView`
  (groups, masonry). Ask the owner; do not scroll behind its back. Read how the keyboard path
  in `src/plugins/selection/plugin.ts` and `src/plugins/a11y/plugin.ts` does it before adding
  a second path.
- **Plugin order is `priority`, lowest first:** layout tier 5–11 (page, autosize, grid, table,
  masonry, tree, carousel 10, groups 11), scrollbar 15, data 20, sortable 30, transition 45,
  selection and snapshots 50, a11y and search 55. A plugin that replaces size-cache methods
  must say which others it conflicts with (`conflicts`).
- **The hot path allocates nothing.** `pipeline.ts`, `state.ts` and the scroll handlers run per
  frame: typed arrays, reused objects, no closures or array literals created per scroll event.
- **A plugin pays for its own bytes.** `bun run size` holds a budget per bundle
  (`scripts/size.ts`). Code added to `src/core/` lands in every bundle; code only one plugin
  needs lives in that plugin, or behind what the plugin already imports.
- **Public API is small on purpose.** A new option or method needs a reason in the issue.
  Types are derived from the config (`src/config.ts`); no `any`, no `@ts-ignore`.

## Commands

```bash
bun test test/plugins/selection/plugin.test.ts   # one file — use this while iterating
bun test --changed                               # tests touched by your diff
bun run typecheck                                # three tsconfigs: src, types, tests
bun run size                                     # bundle budgets
bun run build && bun scripts/synthetic-carousel-browser.mjs   # one browser script (needs a build)
```

The full gate — type check, the suite with its 85 % coverage threshold, build, size, heap,
`docs:check`, the four browser scripts — runs on a clean export of your commit. Run the parts
your change touches; the rest will be run for you.

## Tests

Real DOM (happy-dom), no mocks of vlist itself, helpers in `test/helpers/`. A change and its
tests are one commit. Test the behaviour a person would notice — the element is inside the
viewport, the same node survived — not that a line executed. A bug fix starts with the test
that fails without it.

## Do not touch

`package.json`, `bun.lock`, `.gitignore`, `.github/workflows/*`. No new dependencies. User-facing
changes get a line in `CHANGELOG.md` under `[Unreleased]`; sizes quoted in `README.md` come from
`bun run size`, never from memory. Conventions: semicolons, double quotes, two spaces, ES modules.

## When the task and the code disagree

Say so in the pull request instead of working around it. A contract that looks wrong is worth a
sentence; a silent workaround is how two plugins end up fighting over one scroll position.
