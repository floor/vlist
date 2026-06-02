# Releasing

How vlist versions and ships. Published to npm as `vlist`; production
[vlist.io](https://vlist.io) consumes the npm `latest` tag, so a fix only
reaches users (and the live examples) once it's published.

## Versioning (SemVer)

| Change | Bump | Example |
|--------|------|---------|
| Bug fix, perf, docs, internal refactor — **no public API change** | **patch** | `2.2.0 → 2.2.1` |
| New public API / feature (additive, backward-compatible) | **minor** | `2.1.2 → 2.2.0` |
| Breaking change to public API or behavior | **major** | `2.x → 3.0.0` |

A new export, config option, method, or event is a **feature** → minor. New
API must never ship in a patch — that's exactly the surprise SemVer prevents.

## Two trains

- **Patch train** — batches of `fix` / `perf` / `docs` only. Ship as often as
  needed; during post-2.0 stabilization that can be frequent, and it slows
  naturally as the surface stabilizes.
- **Minor train** — the moment a `feat` lands on `staging`, the next release is
  a minor. Batch features together rather than dribbling them out.

To keep `staging` patch-shippable at any time during stabilization, land
features on a short-lived branch and merge to `staging` only when you intend to
cut a minor.

## When to cut a release

Release on a trigger, not a timer:

- a cohesive batch of fixes is ready and a downstream (e.g. vlist.io examples)
  needs it, **or**
- a coherent set of features is complete and tested, **or**
- a critical fix must go out now (→ focused patch).

`CHANGELOG.md`'s `[Unreleased]` section is the rolling buffer for what's on
`staging` but not yet published.

## Process

Work on `staging`; `main` is protected and is the released line.

1. **Prep (manual)** — stamp `[Unreleased]` → `[X.Y.Z] - <date>` in
   `CHANGELOG.md` and add a fresh `[Unreleased]`; run `bun run size` and refresh
   the README plugin-size table + base-size tagline and `npm-readme.md`. Commit.
2. **Release** — `bun run release [patch|minor|major]`. The script bumps
   `package.json`, updates the README version badge and CHANGELOG stats line,
   commits `chore(release): vX.Y.Z`, pushes `staging`, opens a `staging → main`
   PR, waits for it to merge, then tags `vX.Y.Z` on `main`. The tag triggers
   `publish.yml` → `npm publish` + GitHub Release.

### Pre-releases (optional)

For a risky, feature-bearing minor, publish `X.Y.0-rc.1` under the npm `next`
dist-tag first, then promote to `latest` once confident.
