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
  not.

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
`staging` for 2.x), with a clean working tree.

1. **Prep the notes** — keep the release's entries in `CHANGELOG.md` under
   `[Unreleased]`. When more than one change ships, open the section with a
   one-sentence theme above its first heading. The script refuses an empty section,
   a section without entries, or multiple entries without that theme. Commit the
   notes before starting; leave the section populated for the script to roll.
2. **Release** — `bun run release [patch|minor|major|<version>] [--from next|staging] [--dry-run] [--tag]`.
   The script derives the source branch from the version being released (`next`
   for 3.x, `staging` for 2.x), requires you to be on that branch, bumps
   `package.json` (a prerelease such as `3.0.0-next.2` is never bumped — its
   stable release is named, `bun run release 3.0.0` — and a version not above the
   current one is refused unless resuming an already-bumped release), and prepares
   the release on `chore/release-X.Y.Z`, cut from the source branch. It rolls
   `[Unreleased]` into `[X.Y.Z] - <UTC date>`, leaves a fresh empty `[Unreleased]`,
   and updates both compare links. It runs `bun run size`, refreshes the measured
   plugin-size tables and matching base-size prose in `README.md` and
   `npm-readme.md`, and updates both files' version markers. A failed size check
   or a missing size-table row stops preparation.
   It commits `chore(release): vX.Y.Z` on that branch, pushes
   the release branch (never the source branch directly), opens a PR into the source
   branch, and waits for it to merge. Once merged, it opens a PR from the source
   branch onto `main` and waits for it to merge. Both merges must be merge commits
   pinned to the verified PR head.
   Once the PR onto `main` merges, the script verifies the merge commit is on `main`,
   verifies `package.json` matches the release version, verifies all check runs on that
   commit are completed and successful, prints the verified SHA and the exact next
   command, and stops without tagging. It waits up to ten minutes for missing or
   pending checks; a failed check stops it immediately.
   The tag is a separate, deliberate invocation:
   `bun run release X.Y.Z --tag`.
   This re-verifies all preconditions from scratch, creates an annotated tag
   `git tag -a vX.Y.Z <sha> -m vX.Y.Z` on the verified commit, and pushes it.
   The tag triggers `publish.yml` → `npm publish` + GitHub Release, whose notes
   come from the tag's CHANGELOG section and compare link.
   Pass `--dry-run` to preview all planned steps and commands without touching files,
   branches, PRs, or tags.
   `--from` confirms the derived branch; it cannot send 3.x through `staging`.
3. **Move `next` at the release** — a stable publish moves `latest` only.
   `publish.yml` moves `next` itself with the workflow's OIDC identity
   (`npm dist-tag add vlist@X.Y.Z next`), which npm supports from 11.21.0 once
   **Allow npm dist-tag** is enabled on the package's trusted publisher on
   npmjs.com (disabled by default). The move is allowed to fail; if `next` is
   below the published version, the last step warns with the command a maintainer
   runs — `npm dist-tag add vlist@X.Y.Z next --auth-type=web`
   (browser 2FA; no token). `bun run release` also prints that command as its
   last line. The warning names the version just published even while the
   registry still shows the old `latest` (public registry visibility can lag a
   fresh publish, and the step does not wait for it). When the registry cannot be
   read, it warns that the tags are unknown. In both cases it exits 0.

**Manual preparation fallback / resume.** If preparation was completed manually,
commit the package version, dated changelog section and compare links, and both
README version markers and measured sizes on `chore/release-X.Y.Z`. From that
branch, `bun run release X.Y.Z` resumes the committed bump without rolling the
changelog again. If the branch was already pushed without its source PR, follow
the script's diagnostic: verify the remote package version and release commit
subject, open that PR, then rerun. An unfinished release branch without the target
version committed is refused. This is a resume path, not an automatic fallback
after a size failure; a fresh run from the integration branch still needs populated
`[Unreleased]`.

**Publication follow-through.** If npm reports that a version is being processed,
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

1. **Branch** — cut it from the branch that holds the work (`next` for 3.0), not
   from `staging`. `bun run release` does not apply.
2. **Prep** — set `package.json` to `X.Y.Z-next.N`, move the `[Unreleased]`
   entries into a `[X.Y.Z-next.N] - <date>` section of `CHANGELOG.md`, and update
   the version line in `README.md` and `npm-readme.md`. Commit
   `chore(release): vX.Y.Z-next.N` and push the branch.
3. **Verify** — CI runs on pushes and PRs to `next`, `staging` and `main`.
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
