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

- **3.x** lives on `next`. A 3.0.0 (and later 3.x) release is `next → main`,
  then the tag from `main`.
- **2.x** lives on `staging`. A 2.8.x patch is `staging → main`, then the tag
  from `main`. `staging` is frozen maintenance: it holds nothing `next` does
  not, and staging.vlist.io deploys from `next`.

Within a line, a patch is `fix` / `perf` / `docs` only. The moment a `feat`
lands, the next release on that line is a minor.

`main` is protected and is the released line.

## When to cut a release

Release on a trigger, not a timer:

- a cohesive batch of fixes is ready and a downstream (e.g. vlist.io examples)
  needs it, **or**
- a coherent set of features is complete and tested, **or**
- a critical fix must go out now (→ focused patch).

`CHANGELOG.md`'s `[Unreleased]` section is the rolling buffer for what's on
the integration branch but not yet published.

## Process

Work on the integration branch for the line you are releasing (`next` for 3.x,
`staging` for 2.x).

1. **Prep (manual)** — stamp `[Unreleased]` → `[X.Y.Z] - <date>` in
   `CHANGELOG.md` and add a fresh `[Unreleased]`; run `bun run size` and refresh
   the README plugin-size table + base-size tagline and `npm-readme.md`. Commit.
2. **Release** — `bun run release [patch|minor|major|<version>] [--from next|staging]`.
   The script derives the source branch from the version being released (`next`
   for 3.x, `staging` for 2.x), requires you to be on that branch, bumps
   `package.json` (a prerelease such as `3.0.0-next.2` is never bumped — its
   stable release is named, `bun run release 3.0.0` — and a version not above the
   current one is refused), updates the README version badge and
   CHANGELOG stats line, commits `chore(release): vX.Y.Z`, pushes the source
   branch, opens a PR onto `main`, waits for it to merge, then tags `vX.Y.Z` on
   `main`. The tag triggers `publish.yml` → `npm publish` + GitHub Release.
   `--from` confirms the derived branch; it cannot send 3.x through `staging`.

### Pre-releases

A prerelease ships a major, or a risky minor, to early adopters without moving
npm `latest` or production vlist.io. Any tag whose version contains a hyphen
(`v3.0.0-next.1`, `v2.9.0-rc.1`) is a prerelease: `publish.yml` publishes it
with `npm publish --tag next` and creates a GitHub prerelease. Users install it
with `npm install vlist@next`.

1. **Branch** — cut it from the branch that holds the work (`next` for 3.0), not
   from `staging`. `bun run release` does not apply.
2. **Prep** — set `package.json` to `X.Y.Z-next.N`, move the `[Unreleased]`
   entries into a `[X.Y.Z-next.N] - <date>` section of `CHANGELOG.md`, and update
   the version line in `README.md` and `npm-readme.md`. Commit
   `chore(release): vX.Y.Z-next.N` and push the branch.
3. **Verify** — CI does not run on integration branches, so verify the exact
   commit from a clean export: `bun install --frozen-lockfile`,
   `bun run typecheck`, `bun test`, `bun run scripts/coverage.ts --threshold 85`,
   `bun run build --types`, `bun run size`, `npm pack --dry-run`. A local run
   proves macOS only; the publish job reruns the tests on Linux.
4. **Tag** — `git tag -a vX.Y.Z-next.N <commit> -m vX.Y.Z-next.N`, then
   `git push origin vX.Y.Z-next.N`. The job fails unless the tag matches
   `package.json`, then typechecks, tests, builds and publishes.
5. **Confirm** — `npm view vlist dist-tags` shows `next` at the new version and
   `latest` unchanged, and the GitHub release is marked as a prerelease.

**A publish job that fails before `npm publish`** leaves the version unused on
npm. Fix the branch, delete the tag (`git push origin :refs/tags/vX.Y.Z-next.N`
and `git tag -d vX.Y.Z-next.N`), and tag the fixed commit with the same version.
**Once npm has a version, never reuse it**: bump to the next `-next.N` instead.

**Promotion** — the final `X.Y.Z` is cut from the integration branch with
`bun run release X.Y.Z` (`next → main` for 3.x). Do not merge into `staging` first;
`staging` is the 2.x maintenance line.
