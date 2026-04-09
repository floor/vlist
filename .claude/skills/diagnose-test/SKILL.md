---
name: diagnose-test
description: Debug a failing test by loading full context — test file, source file, error output
argument-hint: <test-file-or-pattern>
allowed-tools: Bash(bun test *) Read Glob Grep
---

# Diagnose Failing Test

Debug a failing vlist test with full context.

## Instructions

1. Run the failing test:
   - `bun test $ARGUMENTS 2>&1`

2. If the test passes, report that and stop.

3. If it fails, gather context:
   - Read the full test file
   - Identify which source file(s) the test covers (from imports)
   - Read those source files
   - Read relevant test helpers if used (`test/helpers/`)

4. Analyze the failure:
   - What does the test expect?
   - What actually happened?
   - Is this a test bug or a source bug?
   - If it's a recent regression, check `git log --oneline -10 -- <source-file>` for recent changes

5. Output:
   ```
   ## Failing Test
   **File:** test/features/async/feature.test.ts
   **Test:** "should cancel load when velocity exceeds threshold"
   **Error:** Expected 0 but received 1

   ## Diagnosis
   The test expects `loadAdapter.load` to not be called when velocity > LOAD_VELOCITY_THRESHOLD,
   but the velocity check in src/features/async/feature.ts:87 uses `>=` instead of `>`.

   ## Suggested Fix
   Change line 87 from `velocity >= threshold` to `velocity > threshold`,
   or update the test to use a velocity strictly above the threshold.
   ```

6. Be specific — include line numbers, variable names, and exact values.
