---
name: release-check
description: Run the full pre-release checklist — version, changelog, tests, types, build, size
argument-hint: [version]
allowed-tools: Bash(bun *) Bash(git *) Bash(cat *) Read Glob Grep
---

# Pre-Release Checklist

Run all checks needed before publishing a new vlist release.

## Context

- Current version: !`node -p "require('./package.json').version"`
- Latest tag: !`git describe --tags --abbrev=0 2>/dev/null || echo "none"`
- Unreleased commits: !`git log $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~10")..HEAD --oneline --no-merges 2>/dev/null | head -20`

## Instructions

Run each check and report results. Do NOT fix issues — just report them.

### 1. Version
- If `$ARGUMENTS` provides a target version, check that `package.json` matches
- Check that the version follows semver
- Based on commits since last tag, suggest whether this should be patch/minor/major

### 2. Changelog
- Check if CHANGELOG.md has an entry for the target version
- If not, flag it as missing

### 3. Typecheck
- Run `bun run typecheck`
- Report pass/fail

### 4. Tests
- Run `bun test`
- Report pass/fail with counts

### 5. Build
- Run `bun run build`
- Report pass/fail

### 6. Size
- Run `bun run size`
- Report gzipped sizes
- Flag any regressions if previous sizes are known

### 7. Git State
- Check for uncommitted changes
- Check that branch is up to date with remote

## Output

```
## Release Checklist: vX.Y.Z

| Check | Status | Notes |
|-------|--------|-------|
| Version | ✅/❌ | ... |
| Changelog | ✅/❌ | ... |
| Typecheck | ✅/❌ | ... |
| Tests | ✅/❌ | N passed |
| Build | ✅/❌ | ... |
| Size | ✅/❌ | core: X.XKB |
| Git state | ✅/❌ | ... |

**Ready to publish** / **Blocked — N issues to resolve**
```
