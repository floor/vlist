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
    expect(SCENARIO_DEFS.length).toBe(23);
    for (const scenario of SCENARIO_DEFS) {
      expect(BUDGET_BYTES[scenario.name]).toBeGreaterThan(0);
    }
  });

  it("keeps the 9.9 KB base target", () => {
    expect(BUDGET_BYTES["Base (createVList)"]).toBe(kb(9.9));
    expect(BUDGET_BYTES.native).toBe(kb(9.9));
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
