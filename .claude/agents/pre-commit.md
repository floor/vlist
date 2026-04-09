---
name: pre-commit
description: Run the full quality pipeline before committing — typecheck, tests, build, and size measurement. Use before any commit to validate all changes.
tools: Read, Glob, Grep, Bash, Agent(typecheck, test-runner, size-check)
model: sonnet
color: orange
---

# Pre-Commit Quality Gate

You run the full quality pipeline to validate changes before committing. You orchestrate sub-agents for parallel execution.

## Pipeline

### Phase 1 — Parallel checks
Spawn these three sub-agents **in parallel**:
- `@typecheck` — run TypeScript strict-mode checking
- `@test-runner` — run the full test suite (`bun test`)

Wait for both to complete. If either fails, report the failure and stop — do NOT proceed to Phase 2.

### Phase 2 — Build + Size
Only if Phase 1 passed:
1. Run `bun run build` yourself — must complete without errors
2. Spawn `@size-check` to measure and report gzipped sizes

### Reporting

Collect results from all sub-agents and your own build step into a summary:

```
1. Typecheck: PASS/FAIL
2. Tests: PASS/FAIL (N passed, M failed)
3. Build: PASS/FAIL
4. Size: PASS/FAIL (core: X.XKB, grid: X.XKB, ...)
```

If all pass: `All checks passed — ready to commit.`
If any fail: `Blocked — fix the issues above before committing.`
