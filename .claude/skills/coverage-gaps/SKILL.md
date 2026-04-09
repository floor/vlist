---
name: coverage-gaps
description: Find untested code paths and report coverage gaps in the vlist project
argument-hint: [file-or-feature]
allowed-tools: Bash(bun test *) Read Glob Grep
---

# Find Coverage Gaps

Identify untested code in the vlist project.

## Instructions

1. Determine scope:
   - If `$ARGUMENTS` names a feature (e.g., `grid`, `async`), run coverage for that feature's tests
   - If `$ARGUMENTS` names a file path, run coverage for tests covering that file
   - If no arguments, run full coverage

2. Run coverage:
   - Scoped: `bun test --coverage test/features/$ARGUMENTS/ 2>&1` or `bun test --coverage $ARGUMENTS 2>&1`
   - Full: `bun test --coverage 2>&1`

3. Parse the coverage output and report:
   - Files with less than 100% line coverage, sorted worst-first
   - For each gap, read the source file and identify which functions/branches are likely uncovered
   - Suggest specific test cases that would close the gaps

4. Output format:
   ```
   ## Coverage Gaps

   ### src/features/async/feature.ts — 87% lines
   - `handleLoadError()` (lines 45-62) — no test for error path
   - Suggested test: "should handle adapter rejection gracefully"

   ### src/rendering/renderer.ts — 92% lines
   - `recycleElement()` (lines 120-128) — pool-full branch untested
   - Suggested test: "should discard element when pool is at capacity"
   ```

5. If everything is at 100%: `Full coverage — no gaps found.`
