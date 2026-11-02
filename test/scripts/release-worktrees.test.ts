import { expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SIZE_ROW_SCENARIOS } from "../../scripts/release";

// Real git owns only disposable repositories. GitHub reads are supplied by a
// child-only preload, so this exercises the CLI without a network or real tag push.
for (const checkout of ["release", "feature", "detached", "local-tag", "resume"] as const) {
  it(`tags the merged main SHA from ${checkout} while main is held in another worktree`, () => {
    const root = mkdtempSync(join(tmpdir(), "vlist-release-worktrees-"));
    const repo = join(root, "caller");
    const remote = join(root, "remote.git");
    const held = join(root, "held-main");
    const env = { ...process.env, GIT_AUTHOR_NAME: "Release test", GIT_AUTHOR_EMAIL: "release@example.test", GIT_COMMITTER_NAME: "Release test", GIT_COMMITTER_EMAIL: "release@example.test" };
    const git = (cwd: string, ...args: string[]): string => {
      const result = Bun.spawnSync(["git", ...args], { cwd, env });
      if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
      return new TextDecoder().decode(result.stdout).trim();
    };
    try {
      mkdirSync(repo);
      git(root, "init", "--bare", remote);
      git(repo, "init", "-b", "main");
      writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "3.3.4" }));
      git(repo, "add", ".");
      git(repo, "commit", "-m", "initial");
      git(repo, "remote", "add", "origin", remote);
      const baseHead = git(repo, "rev-parse", "HEAD");
      git(repo, "checkout", "-b", "chore/release-3.3.5");
      writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "3.3.5" }));
      git(repo, "commit", "-am", "chore(release): v3.3.5");
      const releaseHead = git(repo, "rev-parse", "HEAD");
      git(repo, "push", "origin", "main", "chore/release-3.3.5");
      // The merge exists only on the remote: tagging must fetch its objects,
      // without moving the older main branch held by this repository's worktree.
      const operator = join(root, "operator");
      git(root, "clone", "--branch", "main", remote, operator);
      git(operator, "merge", "--no-ff", "origin/chore/release-3.3.5", "-m", "merge release");
      const mergeSha = git(operator, "rev-parse", "HEAD");
      git(operator, "push", "origin", "main");
      git(repo, "worktree", "add", held, "main");
      if (checkout === "feature") git(repo, "checkout", "-b", "feature");
      if (checkout === "detached") git(repo, "checkout", "--detach");
      if (checkout === "local-tag") {
        git(repo, "fetch", "origin", "main");
        git(repo, "tag", "-a", "v3.3.5", mergeSha, "-m", "v3.3.5");
      }
      const callerHead = git(repo, "rev-parse", "HEAD");
      const callerBranch = git(repo, "branch", "--show-current");
      const preload = join(root, "github-read-fixture.ts");
      const pr = { number: 503, title: "chore(release): v3.3.5", state: "MERGED", headRefName: "chore/release-3.3.5", baseRefName: "main", headRefOid: releaseHead, mergedAt: "2026-11-02T12:00:00Z", mergeCommit: { oid: mergeSha } };
      writeFileSync(preload, `
import { mock } from "bun:test";
import { execSync as realExec } from "node:child_process";
const pr = ${JSON.stringify(pr)};
const execute = realExec;
const mode = ${JSON.stringify(checkout)};
const timer = globalThis.setTimeout;
globalThis.setTimeout = ((fn: () => void) => timer(fn, 0)) as typeof setTimeout;
mock.module("node:child_process", () => ({ execSync(command: string, options: Parameters<typeof realExec>[1]) {
  if (command.startsWith("gh pr list")) {
    if (command.includes("--state open")) return "[]";
    return command.includes("--head chore/release-3.3.5 --base main") ? JSON.stringify([mode === "resume" ? { ...pr, state: "OPEN", mergeCommit: null, mergedAt: null } : pr]) : "[]";
  }
  if (command.startsWith("gh pr view 503")) return JSON.stringify(pr);
  if (command.startsWith("gh api") && command.includes("check-runs")) return JSON.stringify([{ total_count: 2, check_runs: ["Test & Build", "Browser suites"].map(name => ({ name, status: "completed", conclusion: "success", app: { slug: "github-actions" } })) }]);
  if (command.startsWith("gh api") && command.includes("contents/package.json")) return JSON.stringify({ content: Buffer.from('{"version":"3.3.5"}').toString("base64") });
  if (command.startsWith("gh api") && command.includes("commits/")) return JSON.stringify({ parents: ${JSON.stringify([baseHead, releaseHead])}.map(sha => ({ sha })) });
  if (command.startsWith("gh ")) throw new Error("Unexpected GitHub operation: " + command);
  return execute(command, options);
} }));
`);
      const result = Bun.spawnSync([process.execPath, "--preload", preload, resolve(import.meta.dir, "../../scripts/release.ts"), "3.3.5", ...(checkout === "resume" ? [] : ["--tag"])], { cwd: repo, env, timeout: 15_000 });
      const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
      expect(output).toContain(checkout === "resume" ? "verified with all passing checks" : "Tag v3.3.5 pushed");
      expect(result.exitCode).toBe(0);
      if (checkout === "resume") {
        expect(git(root, "--git-dir", remote, "tag", "-l", "v3.3.5")).toBe("");
      } else {
        expect(git(root, "--git-dir", remote, "rev-parse", "v3.3.5^{}")).toBe(mergeSha);
        expect(git(root, "--git-dir", remote, "cat-file", "-t", "v3.3.5")).toBe("tag");
      }
      expect(git(repo, "branch", "--show-current")).toBe(callerBranch);
      expect(git(repo, "rev-parse", "HEAD")).toBe(callerHead);
      expect(git(held, "rev-parse", "HEAD")).toBe(baseHead);
      expect(git(held, "status", "--porcelain")).toBe("");
      expect((JSON.parse(readFileSync(join(held, "package.json"), "utf8")) as { version: string }).version).toBe("3.3.4");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);
}


for (const source of ["main", "staging"] as const) {
  const version = source === "main" ? "3.3.5" : "2.8.3";
  const previous = source === "main" ? "3.3.4" : "2.8.2";
  const branch = `chore/release-${version}`;
  it(`prepares ${source === "main" ? "one main PR" : "the two staging PRs"}, waits for pinned merges, and stops before tagging`, () => {
    const root = mkdtempSync(join(tmpdir(), "vlist-release-prepare-"));
    const repo = join(root, "caller");
    const remote = join(root, "remote.git");
    const held = join(root, "held-main");
    const env = { ...process.env, GIT_AUTHOR_NAME: "Release test", GIT_AUTHOR_EMAIL: "release@example.test", GIT_COMMITTER_NAME: "Release test", GIT_COMMITTER_EMAIL: "release@example.test" };
    const git = (cwd: string, ...args: string[]): string => {
      const result = Bun.spawnSync(["git", ...args], { cwd, env });
      if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
      return new TextDecoder().decode(result.stdout).trim();
    };
    try {
      mkdirSync(repo);
      git(root, "init", "--bare", remote);
      git(repo, "init", "-b", "main");
      writeFileSync(join(repo, "package.json"), JSON.stringify({ version: previous }));
      writeFileSync(join(repo, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\nA release theme.\n\nWho is affected: release users.\n\n### Fixed\n\n- A release fix.\n\n## [3.3.4] - 2026-11-02\n\n[Unreleased]: https://github.com/floor/vlist/compare/v3.3.4...HEAD\n".split("3.3.4").join(previous));
      const readme = `**v${previous}**\n\n` + SIZE_ROW_SCENARIOS.map(({ label }) => `| ${label} | 27.3 KB | 10.3 KB |`).join("\n");
      for (const name of ["README.md", "npm-readme.md"]) writeFileSync(join(repo, name), readme);
      git(repo, "add", ".");
      git(repo, "commit", "-m", "release notes on main");
      git(repo, "remote", "add", "origin", remote);
      if (source === "staging") git(repo, "branch", "staging");
      git(repo, "push", "origin", "main", ...(source === "staging" ? ["staging"] : []));
      git(repo, "checkout", "-b", "feature");
      git(repo, "worktree", "add", held, "main");
      writeFileSync(join(repo, "private-feature.txt"), "not merged");
      git(repo, "add", ".");
      git(repo, "commit", "-m", "unmerged feature");
      if (source === "staging") git(repo, "checkout", "staging");
      const commandsFile = join(root, "commands.jsonl");
      const sizeOutput = "vlist size fixture\n\n" + SIZE_ROW_SCENARIOS.map(({ scenario }) => `  ${scenario}  27.3 KB  10.3 KB  9.1 KB\n  ✓ ${scenario}: 10539 bytes gzipped (budget 10547)`).join("\n");
      const preload = join(root, "github-operator-fixture.ts");
      writeFileSync(preload, `
  import { mock } from "bun:test";
  import { execSync as realExec, execFileSync as realFile } from "node:child_process";
  import { appendFileSync } from "node:fs";
  const execute = realExec, executeFile = realFile;
  const held = ${JSON.stringify(held)}, commandsFile = ${JSON.stringify(commandsFile)};
  const source = ${JSON.stringify(source)}, branch = ${JSON.stringify(branch)};
  let sourcePr: object | null = null, mainPr: object | null = null;
  const timer = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void) => timer(fn, 0)) as typeof setTimeout;
  mock.module("node:child_process", () => ({ execSync(command: string, options: Parameters<typeof realExec>[1]) {
    appendFileSync(commandsFile, JSON.stringify(command) + "\\n");
    if (command === "bun run size") return ${JSON.stringify(sizeOutput)};
    if (command.startsWith("gh pr list")) return "[]";
    if (command.startsWith("gh pr create --base staging --head " + branch)) {
      const operator = ${JSON.stringify(join(root, "held-staging"))};
      executeFile("git", ["worktree", "add", operator, "staging"], { stdio: "pipe" });
      const headRefOid = executeFile("git", ["rev-parse", branch], { encoding: "utf8" }).trim();
      executeFile("git", ["-C", operator, "merge", "--no-ff", branch, "-m", "operator staging merge"], { stdio: "pipe" });
      executeFile("git", ["-C", operator, "push", "origin", "staging"], { stdio: "pipe" });
      const oid = executeFile("git", ["-C", operator, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      sourcePr = { headRefOid, mergeCommit: { oid }, state: "MERGED" };
      return "https://github.com/floor/vlist/pull/503";
    }
    if (command.startsWith("gh pr create --base main --head " + (source === "main" ? branch : "staging"))) {
      const head = source === "main" ? branch : "staging";
      const headRefOid = executeFile("git", ["rev-parse", head], { encoding: "utf8" }).trim();
      executeFile("git", ["-C", held, "merge", "--no-ff", head, "-m", "operator main merge"], { stdio: "pipe" });
      executeFile("git", ["-C", held, "push", "origin", "main"], { stdio: "pipe" });
      const oid = executeFile("git", ["-C", held, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      mainPr = { headRefOid, mergeCommit: { oid }, state: "MERGED" };
      return "https://github.com/floor/vlist/pull/" + (source === "main" ? "503" : "504");
    }
    if (command.startsWith("gh pr view 503")) return JSON.stringify(sourcePr ?? mainPr);
    if (command.startsWith("gh pr view 504")) return JSON.stringify(mainPr);
    if (command.startsWith("gh api") && command.includes("check-runs")) return JSON.stringify([{ total_count: 2, check_runs: ["Test & Build", "Browser suites"].map(name => ({ name, status: "completed", conclusion: "success", app: { slug: "github-actions" } })) }]);
    if (command.startsWith("gh ")) throw new Error("Unexpected GitHub operation: " + command);
    return execute(command, options);
  } }));
  `);
      const result = Bun.spawnSync([process.execPath, "--preload", preload, resolve(import.meta.dir, "../../scripts/release.ts"), version], { cwd: repo, env, timeout: 15_000 });
      const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
      expect(output).toContain("verified with all passing checks");
      expect(result.exitCode).toBe(0);
      const commands = readFileSync(commandsFile, "utf8").trim().split("\n").map(line => JSON.parse(line) as string);
      expect(commands.filter(command => command.startsWith("gh pr create"))).toHaveLength(source === "main" ? 1 : 2);
      expect(git(repo, "branch", "--show-current")).toBe(branch);
      expect(git(repo, "ls-files", "private-feature.txt")).toBe("");
      expect(git(repo, "tag", "-l")).toBe("");
      expect((JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version: string }).version).toBe(version);
      expect(readFileSync(join(repo, "CHANGELOG.md"), "utf8")).toContain(`## [${version}] -`);
      expect(git(held, "status", "--porcelain")).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

}
