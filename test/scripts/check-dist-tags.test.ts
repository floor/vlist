import { describe, it, expect } from "bun:test";
import { checkDistTags, nextTagCommand } from "../../scripts/check-dist-tags";
import { NativeResponse } from "../helpers/native";
import { resolve } from "node:path";

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

/** Serves one dist-tags payload for every request. */
const serveTags = (tags: unknown) =>
  Bun.serve({
    port: 0,
    fetch: () =>
      new NativeResponse(JSON.stringify(tags), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });

const script = resolve(import.meta.dir, "../../scripts/check-dist-tags.ts");

const runCheck = async (version: string, url: string, attempts?: string) => {
  const proc = Bun.spawn(["bun", script, version], {
    env: {
      ...process.env,
      VLIST_DIST_TAGS_URL: url,
      ...(attempts === undefined ? {} : { VLIST_DIST_TAGS_ATTEMPTS: attempts }),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  return { exitCode, stdout: await new Response(proc.stdout).text() };
};

describe("check-dist-tags exit behavior", () => {
  it("warns, names the command, and exits 0 when next is below latest", async () => {
    const server = serveTags({ latest: "3.1.1", next: "3.1.0-next.3" });
    try {
      const { exitCode, stdout } = await runCheck("3.1.1", `http://127.0.0.1:${server.port}/`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("::warning title=next dist-tag below latest::");
      expect(stdout).toContain("npm dist-tag add vlist@3.1.1 next --auth-type=web");
      expect(stdout).not.toContain("::error");
    } finally {
      server.stop(true);
    }
  });

  it("warns and exits 0 when the registry cannot be read", async () => {
    const { exitCode, stdout } = await runCheck("3.1.1", "http://127.0.0.1:1/");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("::warning title=next dist-tag unknown::");
  });

  it("warns and exits 0 on an unexpected answer without a latest tag", async () => {
    const server = serveTags({ next: "3.1.0-next.3" });
    try {
      const { exitCode, stdout } = await runCheck("3.1.1", `http://127.0.0.1:${server.port}/`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("::warning title=next dist-tag unknown::");
    } finally {
      server.stop(true);
    }
  });

  it("warns and exits 0 when latest never reaches the published version", async () => {
    const server = serveTags({ latest: "3.1.0", next: "3.1.0-next.3" });
    try {
      const { exitCode, stdout } = await runCheck("3.1.1", `http://127.0.0.1:${server.port}/`, "0");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("::warning title=next dist-tag unknown::");
    } finally {
      server.stop(true);
    }
  });

  it("prints the passing line, no annotation, when next is at or above latest", async () => {
    const server = serveTags({ latest: "3.1.1", next: "3.1.1" });
    try {
      const { exitCode, stdout } = await runCheck("3.1.1", `http://127.0.0.1:${server.port}/`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("✓ next 3.1.1 ≥ latest 3.1.1");
      expect(stdout).not.toContain("::warning");
    } finally {
      server.stop(true);
    }
  });
});
