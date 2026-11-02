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

## Release lines

3.x integrates and releases from `main`. Feature branches and release branches
reach it through reviewed PRs; never push directly to `main`. The retired
integration branch is no longer part of release preparation or publication.

2.x remains frozen maintenance on `staging`: its release branch merges into
`staging`, then a pinned `staging → main` PR carries the release onto `main`.
Its version cannot be cut from the 3.x line.

Within a line, a patch is `fix` / `perf` / `docs` only. The moment a `feat`
lands, the next release on that line is a minor.

## When to cut a release

Release on a trigger, not a timer:

- a cohesive batch of fixes is ready and a downstream (e.g. vlist.io examples)
  needs it, **or**
- a coherent set of features is complete and tested, **or**
- a critical fix must go out now (→ focused patch).

`CHANGELOG.md`'s `[Unreleased]` section is the rolling buffer for what's on
the integration branch but not yet published.

## Process

A 3.x release has three steps: one release PR into `main`, the operator's
pinned merge, then a separately authorized tag. Use a clean worktree; the
script never checks out an integration branch held by another worktree.

1. **Prepare the release PR.** Commit the notes under `[Unreleased]` through
   a PR before starting: a one-sentence theme, a Who is affected paragraph,
   then the change headings and entries. Run
   `bun run release [patch|minor|major|<version>] [--from main]`. The script
   fetches `main` and cuts `chore/release-X.Y.Z` from `origin/main` in the
   current worktree. It bumps `package.json`, rolls the notes to
   `[X.Y.Z] - <UTC date>` with a fresh empty `[Unreleased]`, refreshes compare
   links, and updates both README version markers, measured size tables and
   matching prose. A failed size gate stops preparation; never raise a budget.
   It commits and pushes only the release branch, opens its PR into `main`,
   and waits. A prerelease is never bumped: name its stable version explicitly.
2. **Merge pinned to the reviewed head.** Independent review and all CI must
   pass on the release PR's exact head and on its base. The operator performs
   a merge commit pinned to that head. The script verifies the merge's parents,
   its presence on `main`, `package.json`, and every check run on that exact
   merge commit. It waits up to ten minutes for missing or pending checks,
   stops immediately for a failed check, then stops without tagging.
3. **Tag on the release decision.** Run `bun run release X.Y.Z --tag`. It
   re-verifies from scratch, fetches main's objects without checking out main,
   creates `git tag -a vX.Y.Z <verified merge sha> -m vX.Y.Z`, and pushes only
   that tag. It leaves the caller's branch or detached HEAD unchanged and
   does not switch branches after pushing. The tag triggers `publish.yml`: npm,
   GitHub Release, stable npm `next` dist-tag and the production site dispatch.

Use `--dry-run` to print the plan without changing files, branches, PRs or
tags. `--from main|staging` confirms the derived release line; it cannot send
3.x through staging. A worktree on a feature branch or detached HEAD can
prepare or tag a 3.x release; preparation always starts from remote main,
not from unmerged feature changes. Existing release branches must be resumed
in the worktree holding them; the script never forces a checkout.

**Manual preparation / resume.** Commit the package version, dated section,
compare links and measured README versions/sizes on `chore/release-X.Y.Z`.
From that branch, the release command resumes the committed bump without
rolling the changelog again. If the branch was pushed without its PR, verify
its remote package version and release commit, open the PR into `main` using
the script's diagnostic, then resume. An unfinished local release branch is
refused. This is not a fallback after a size failure.

**2.x maintenance.** Use `--from staging` for a 2.x version. Its release PR
goes into staging and is followed by the existing staging-to-main PR. Both
merges must be pinned merge commits. Source ref updates are fetched without
checking out staging; tagging uses the same verified main SHA and leaves
the current worktree unchanged.

**npm tags.** A stable publish moves `latest` and asks npm to move the `next`
dist-tag to the same version with the workflow's OIDC identity (npm 11.21.0+,
**Allow npm dist-tag** enabled on its trusted publisher). The move is allowed
to fail; a stale or unreadable registry read warns with the exact maintainer
command: `npm dist-tag add vlist@X.Y.Z next --auth-type=web`. This is an npm
tag, not a Git branch.

**Publication follow-through.** Check the production version at
`https://vlist.io/dist/version.json`, alongside the deployment run.
If npm reports that a version is being processed,
wait for visibility rather than retrying publication: once npm has accepted a
version, do not publish it again. Check `npm view vlist@X.Y.Z version` and
`npm view vlist dist-tags` before moving `next`. A stale registry read alone does
not establish that publication failed.

If npm has accepted the version but the GitHub Release step failed, recover that
step alone instead of rerunning the workflow's publish step. From the tag's checkout,
generate its notes and create the GitHub release:

```bash
bun scripts/release-notes.ts X.Y.Z > notes.md
gh release create vX.Y.Z --title vX.Y.Z --notes-file notes.md --verify-tag --latest
```

If it already exists, update its notes with
`gh release edit vX.Y.Z --title vX.Y.Z --notes-file notes.md`. For a prerelease,
creation uses `--prerelease --latest=false` in place of `--latest`, as the workflow
does. Then check the npm tags and use the maintainer's `next` command above if
the move is still needed.

### Pre-releases

A prerelease ships a major, or a risky minor, to early adopters without moving
npm `latest` or production vlist.io. Any tag whose version contains a hyphen
(`v3.0.0-next.1`, `v2.9.0-rc.1`) is a prerelease: `publish.yml` publishes it
with `npm publish --tag next` and creates a GitHub prerelease. Users install it
with `npm install vlist@next`.

1. **Branch** — cut it from the branch that holds the work (`main` for 3.x), not
   from `staging`. `bun run release` does not apply.
2. **Prep** — set `package.json` to `X.Y.Z-next.N`, move the `[Unreleased]`
   entries into a `[X.Y.Z-next.N] - <date>` section of `CHANGELOG.md`, and update
   the version line in `README.md` and `npm-readme.md`. Commit
   `chore(release): vX.Y.Z-next.N` and push the branch.
3. **Verify** — CI runs on pushes and PRs to `main` and 2.x `staging`.
   Verify the exact tag candidate from a clean export: `bun install --frozen-lockfile`,
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
