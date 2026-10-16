import { describe, it, expect } from "bun:test";
import { scanTrackerIds, trackerIdPattern, type TrackerExemption } from "../../scripts/docs-check";

/** Fixtures build ids at runtime: this file is tracked, and the rule it tests
 *  would otherwise fire on its own fixtures. */
const id = (prefix: string, n: number): string => `${prefix}-${n}`;

const exempt = (file: string): TrackerExemption => ({ file, reason: "test" });

describe("scanTrackerIds", () => {
  it("fails on a fixture with an id, naming file and line", () => {
    const line = `see ${id("FLO", 12)} here`;
    const scan = scanTrackerIds([{ path: "notes.md", lines: ["clean line", line] }], []);
    expect(scan.hits).toEqual([{ file: "notes.md", line: 2, id: id("FLO", 12), text: line }]);
  });

  it("passes a clean tree", () => {
    const scan = scanTrackerIds(
      [
        { path: "README.md", lines: ["built since #305", "and #314 fixed the clamp"] },
        { path: "src/plugin.ts", lines: ["// index-space translators (#363)."] },
      ],
      [],
    );
    expect(scan.hits).toEqual([]);
  });

  it("reports every occurrence on a line", () => {
    const scan = scanTrackerIds(
      [{ path: "a.ts", lines: [`// ${id("FLO", 1)} and ${id("FLO", 2)}`] }],
      [],
    );
    expect(scan.hits.map((h) => h.id)).toEqual([id("FLO", 1), id("FLO", 2)]);
    expect(scan.hits.map((h) => h.line)).toEqual([1, 1]);
  });

  it("skips an exempt file and reports the exemption as used", () => {
    const scan = scanTrackerIds(
      [{ path: "RELEASING.md", lines: [`moves ${id("FLO", 9)}`] }],
      [exempt("RELEASING.md")],
    );
    expect(scan.hits).toEqual([]);
    expect(scan.exempted.map((e) => e.file)).toEqual(["RELEASING.md"]);
    expect(scan.unused).toEqual([]);
  });

  it("reports an exemption that skips nothing", () => {
    const scan = scanTrackerIds(
      [{ path: "RELEASING.md", lines: ["no id here"] }],
      [exempt("RELEASING.md")],
    );
    expect(scan.hits).toEqual([]);
    expect(scan.exempted).toEqual([]);
    expect(scan.unused.map((e) => e.file)).toEqual(["RELEASING.md"]);
  });
});

describe("trackerIdPattern", () => {
  it("takes another tracker prefix", () => {
    const pattern = trackerIdPattern(["FLO", "OPS"]);
    expect(pattern.test(`see ${id("OPS", 7)}`)).toBe(true);
    expect(pattern.test(`see ${id("FLO", 7)}`)).toBe(true);
    expect(pattern.test("see #314")).toBe(false);
  });
});
