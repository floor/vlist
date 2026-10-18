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

  it("keeps the 10.3 KB base target", () => {
    expect(BUDGET_BYTES["Base (createVList)"]).toBe(kb(10.3));
    expect(BUDGET_BYTES.native).toBe(kb(10.3));
  });

  it("pins every budget as a fixed number — a move needs the owner's word", () => {
    // The routine headroom rule is retired: a budget does not move because a
    // measurement moved. With the whole table pinned, a deliberate move edits
    // two files in one commit (`scripts/size.ts` and this table), beside the
    // measurement the owner approved — never a silent re-measure.
    expect(BUDGET_BYTES).toEqual({
      "Base (createVList)": kb(10.3),
      synthetic: kb(13.0),
      "synthetic + carousel": kb(18.2),
      "synthetic + sortable": kb(16.6),
      createStats: kb(10.6),
      "synthetic + createStats": kb(13.2),
      native: kb(10.3),
      a11y: kb(12.1),
      selection: kb(13.7),
      data: kb(15.2),
      scrollbar: kb(13.3),
      sortable: kb(14.0),
      groups: kb(15.8),
      page: kb(11.3),
      snapshots: kb(11.5),
      transition: kb(12.4),
      autosize: kb(12.0),
      grid: kb(13.0),
      table: kb(16.4),
      masonry: kb(14.8),
      tree: kb(15.7),
      search: kb(13.7),
      carousel: kb(15.8),
      vue: kb(10.6),
      svelte: kb(10.5),
      solid: kb(10.6),
      react: kb(10.6),
      "react + grid": kb(13.2),
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
