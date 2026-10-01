import { describe, it, expect } from "bun:test";
import { checkDistTags, nextTagCommand } from "../../scripts/check-dist-tags";

describe("checkDistTags (FLO-245)", () => {
  it("fails when next is a prerelease of the stable latest, naming the fix", () => {
    const result = checkDistTags({ latest: "3.1.0", next: "3.1.0-next.3" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("npm dist-tag add vlist@3.1.0 next --auth-type=web");
  });

  it("fails when next is an older stable", () => {
    expect(checkDistTags({ latest: "3.1.0", next: "3.0.0" }).ok).toBe(false);
  });

  it("passes when next equals latest", () => {
    expect(checkDistTags({ latest: "3.1.0", next: "3.1.0" }).ok).toBe(true);
  });

  it("passes when next is a newer prerelease", () => {
    expect(checkDistTags({ latest: "3.1.0", next: "3.1.1-next.1" }).ok).toBe(true);
  });

  it("passes when there is no next tag", () => {
    expect(checkDistTags({ latest: "3.1.0" }).ok).toBe(true);
  });

  it("fails without a latest tag", () => {
    expect(checkDistTags({ next: "3.1.0-next.3" }).ok).toBe(false);
  });

  it("nextTagCommand uses browser auth, no token", () => {
    expect(nextTagCommand("3.1.1")).toBe("npm dist-tag add vlist@3.1.1 next --auth-type=web");
  });
});
