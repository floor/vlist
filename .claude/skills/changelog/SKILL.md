---
name: changelog
description: Generate a changelog entry from recent commits since a given ref or tag
argument-hint: [since-ref]
allowed-tools: Bash(git log *) Bash(git tag *) Bash(git describe *) Read
---

# Generate Changelog Entry

Generate a changelog entry for the vlist project based on recent commits.

## Context

- Latest tag: !`git describe --tags --abbrev=0 2>/dev/null || echo "no tags"`
- Recent commits since last tag: !`git log $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~20")..HEAD --oneline --no-merges 2>/dev/null || git log --oneline -20`

## Instructions

1. If `$ARGUMENTS` is provided, use it as the base ref. Otherwise use the latest tag (shown above).
2. Categorize commits using conventional commit types:
   - **Added** — `feat` commits
   - **Changed** — `refactor`, `perf` commits
   - **Fixed** — `fix` commits
   - **Testing** — `test` commits
   - **Other** — `docs`, `chore`, `style` commits
3. Output a markdown changelog entry in this format:

```markdown
## [version] — YYYY-MM-DD

### Added
- Description (scope)

### Changed
- Description (scope)

### Fixed
- Description (scope)
```

4. Omit empty categories. Use the scope from commit messages in parentheses.
5. Write clear, user-facing descriptions — reword commit messages if needed for clarity.
6. Do NOT write the entry to any file — just output it for review.
