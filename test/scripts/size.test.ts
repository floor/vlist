/**
 * vlist — Size gate
 *
 * The measurement script used to `continue` on a failed Bun.build and to
 * budget only the base bundle. Both made `bun run size` a report, not a
 * gate: a plugin that failed to compile, or doubled in size, still exited 0.
 */

import { describe, expect, it } from "bun:test";
import {
  BUDGET_BYTES,
  SCENARIO_DEFS,
  kb,
  missingMeasuredScenarios,
  sizeGateFails,
} from "../../scripts/size";

describe("size gate", () => {
  it("budgets every measured scenario", () => {
    expect(SCENARIO_DEFS.length).toBe(28);
    for (const scenario of SCENARIO_DEFS) {
      expect(BUDGET_BYTES[scenario.name]).toBeGreaterThan(0);
    }
  });

  it("keeps the base target", () => {
    expect(BUDGET_BYTES["Base (createVList)"]).toBe(kb(10.59));
    expect(BUDGET_BYTES.native).toBe(kb(10.59));
  });

  it("pins every budget as a fixed number — a move is a recorded decision", () => {
    // The routine headroom rule is retired: a budget does not move because a
    // measurement moved. With the whole table pinned, a deliberate move edits
    // two files in one commit (`scripts/size.ts` and this table), beside the
    // measurement and the lead/orchestrator's recorded decision in the pull
    // request — never a silent re-measure.
    expect(BUDGET_BYTES).toEqual({
      "Base (createVList)": kb(10.59),
      synthetic: kb(13.22),
      "synthetic + carousel": kb(18.52),
      "synthetic + sortable": kb(16.86),
      createStats: kb(10.83),
      "synthetic + createStats": kb(13.46),
      native: kb(10.59),
      a11y: kb(12.51),
      selection: kb(13.91),
      data: kb(15.45),
      scrollbar: kb(13.53),
      sortable: kb(14.26),
      groups: kb(16.1),
      page: kb(11.53),
      snapshots: kb(11.75),
      transition: kb(12.61),
      autosize: kb(12.21),
      grid: kb(13.24),
      table: kb(16.77),
      masonry: kb(15.08),
      tree: kb(15.94),
      search: kb(13.94),
      carousel: kb(16.15),
      vue: kb(10.77),
      svelte: kb(10.67),
      solid: kb(10.73),
      react: kb(10.78),
      "react + grid": kb(13.44),
    });
  });

  it("fails the command when a scenario fails to build", () => {
    expect(sizeGateFails({
      buildFailures: ["Base (createVList)"],
      treeShakeFailures: [],
      overBudget: [],
    })).toBe(true);
  });

  it("fails the command when a published size exceeds its budget", () => {
    expect(sizeGateFails({
      buildFailures: [],
      treeShakeFailures: [],
      overBudget: ["table"],
    })).toBe(true);
  });

  it("treats a dropped measurement as a missing scenario", () => {
    const measured = SCENARIO_DEFS
      .map((s) => s.name)
      .filter((name) => name !== "Base (createVList)");
    expect(missingMeasuredScenarios(measured)).toEqual(["Base (createVList)"]);
  });

  it("fails a plugin that doubles past its published ceiling", () => {
    // table is the largest published plugin; twice that gzipped size must
    // sit above the budget, or the gate cannot catch a doubling.
    expect(kb(15.5) * 2).toBeGreaterThan(BUDGET_BYTES.table);
  });

  it("passes when every scenario built, tree-shook, and stayed in budget", () => {
    expect(sizeGateFails({
      buildFailures: [],
      treeShakeFailures: [],
      overBudget: [],
    })).toBe(false);
  });
});
