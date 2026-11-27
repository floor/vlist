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
      expect(output).not.toContain("npm dist-tag add");
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


for (const source of ["main", "v2"] as const) {
  const version = source === "main" ? "3.3.5" : "2.8.3";
  const previous = source === "main" ? "3.3.4" : "2.8.2";
  const branch = `chore/release-${version}`;
  it(`prepares ${source === "main" ? "one main PR" : "the two v2 PRs"}, waits for pinned merges, and stops before tagging`, () => {
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
      if (source === "v2") git(repo, "branch", "v2");
      git(repo, "push", "origin", "main", ...(source === "v2" ? ["v2"] : []));
      git(repo, "checkout", "-b", "feature");
      git(repo, "worktree", "add", held, "main");
      writeFileSync(join(repo, "private-feature.txt"), "not merged");
      if (source === "main") {
        writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "3.3.0" }));
        writeFileSync(join(repo, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n## [3.3.0] - 2026-10-01\n");
      }
      git(repo, "add", ".");
      git(repo, "commit", "-m", "unmerged feature");
      if (source === "v2") git(repo, "checkout", "v2");
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
    if (command.startsWith("gh pr create --base v2 --head " + branch)) {
      const operator = ${JSON.stringify(join(root, "held-v2"))};
      executeFile("git", ["worktree", "add", operator, "v2"], { stdio: "pipe" });
      const headRefOid = executeFile("git", ["rev-parse", branch], { encoding: "utf8" }).trim();
      executeFile("git", ["-C", operator, "merge", "--no-ff", branch, "-m", "operator v2 merge"], { stdio: "pipe" });
      executeFile("git", ["-C", operator, "push", "origin", "v2"], { stdio: "pipe" });
      const oid = executeFile("git", ["-C", operator, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      sourcePr = { headRefOid, mergeCommit: { oid }, state: "MERGED" };
      return "https://github.com/floor/vlist/pull/503";
    }
    if (command.startsWith("gh pr create --base main --head " + (source === "main" ? branch : "v2"))) {
      const head = source === "main" ? branch : "v2";
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
      expect(output).toContain(`package.json: ${previous} → ${version}`);
      expect(output).toContain("verified with all passing checks");
      expect(result.exitCode).toBe(0);
      const commands = readFileSync(commandsFile, "utf8").trim().split("\n").map(line => JSON.parse(line) as string);
      expect(commands.filter(command => command.startsWith("gh pr create"))).toHaveLength(source === "main" ? 1 : 2);
      expect(git(repo, "branch", "--show-current")).toBe(branch);
      expect(git(repo, "ls-files", "private-feature.txt")).toBe("");
      expect(git(repo, "tag", "-l")).toBe("");
      expect((JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version: string }).version).toBe(version);
      expect(readFileSync(join(repo, "CHANGELOG.md"), "utf8")).toContain(`## [${version}] -`);
      const committed = new TextDecoder().decode(Bun.spawnSync(["git", "cat-file", "-p", "HEAD:CHANGELOG.md"], { cwd: repo, env }).stdout);
      expect(committed.endsWith("\n")).toBe(true);
      expect(committed.endsWith("\n\n")).toBe(false);
      const commitObject = new TextDecoder().decode(Bun.spawnSync(["git", "cat-file", "-p", "HEAD"], { cwd: repo, env }).stdout);
      const message = commitObject.slice(commitObject.indexOf("\n\n") + 2);
      expect(message).toBe(`chore(release): v${version}\n`);
      const releasePr = commands.find((command) => command.includes("Release commit for"));
      expect(releasePr).toBe(
        `gh pr create --base ${source} --head ${branch} --title "chore(release): v${version}" --body "Release commit for v${version}."`,
      );
      expect(git(held, "status", "--porcelain")).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

}

it("appends --signature as the release commit's last paragraph and the release PR's last line", () => {
  const version = "3.3.5";
  const previous = "3.3.4";
  const branch = `chore/release-${version}`;
  const signature = "Agent: Example";
  const root = mkdtempSync(join(tmpdir(), "vlist-release-signature-"));
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
    git(repo, "push", "origin", "main");
    git(repo, "checkout", "-b", "feature");
    git(repo, "worktree", "add", held, "main");
    const commandsFile = join(root, "commands.jsonl");
    const sizeOutput = "vlist size fixture\n\n" + SIZE_ROW_SCENARIOS.map(({ scenario }) => `  ${scenario}  27.3 KB  10.3 KB  9.1 KB\n  ✓ ${scenario}: 10539 bytes gzipped (budget 10547)`).join("\n");
    const preload = join(root, "github-operator-fixture.ts");
    writeFileSync(preload, `
import { mock } from "bun:test";
import { execSync as realExec, execFileSync as realFile } from "node:child_process";
import { appendFileSync } from "node:fs";
const execute = realExec, executeFile = realFile;
const held = ${JSON.stringify(held)}, commandsFile = ${JSON.stringify(commandsFile)};
const branch = ${JSON.stringify(branch)};
let mainPr: object | null = null;
const timer = globalThis.setTimeout;
globalThis.setTimeout = ((fn: () => void) => timer(fn, 0)) as typeof setTimeout;
mock.module("node:child_process", () => ({ execSync(command: string, options: Parameters<typeof realExec>[1]) {
  appendFileSync(commandsFile, JSON.stringify(command) + "\\n");
  if (command === "bun run size") return ${JSON.stringify(sizeOutput)};
  if (command.startsWith("gh pr list")) return "[]";
  if (command.startsWith("gh pr create --base main --head " + branch)) {
    const headRefOid = executeFile("git", ["rev-parse", branch], { encoding: "utf8" }).trim();
    executeFile("git", ["-C", held, "merge", "--no-ff", branch, "-m", "operator main merge"], { stdio: "pipe" });
    executeFile("git", ["-C", held, "push", "origin", "main"], { stdio: "pipe" });
    const oid = executeFile("git", ["-C", held, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    mainPr = { headRefOid, mergeCommit: { oid }, state: "MERGED" };
    return "https://github.com/floor/vlist/pull/503";
  }
  if (command.startsWith("gh pr view 503")) return JSON.stringify(mainPr);
  if (command.startsWith("gh api") && command.includes("check-runs")) return JSON.stringify([{ total_count: 2, check_runs: ["Test & Build", "Browser suites"].map(name => ({ name, status: "completed", conclusion: "success", app: { slug: "github-actions" } })) }]);
  if (command.startsWith("gh ")) throw new Error("Unexpected GitHub operation: " + command);
  return execute(command, options);
} }));
`);
    const result = Bun.spawnSync([process.execPath, "--preload", preload, resolve(import.meta.dir, "../../scripts/release.ts"), version, "--from", "main", "--signature", signature], { cwd: repo, env, timeout: 15_000 });
    expect(result.exitCode).toBe(0);
    const commitObject = new TextDecoder().decode(Bun.spawnSync(["git", "cat-file", "-p", "HEAD"], { cwd: repo, env }).stdout);
    const message = commitObject.slice(commitObject.indexOf("\n\n") + 2);
    expect(message).toBe(`chore(release): v${version}\n\n${signature}\n`);
    const commands = readFileSync(commandsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string);
    const releasePr = commands.find((command) => command.includes("Release commit for"));
    expect(releasePr?.endsWith(`${signature}'`) || releasePr?.endsWith(`${signature}"`)).toBe(true);
    const body = releasePr!.slice(releasePr!.indexOf("--body ") + "--body ".length).replace(/^['"]|['"]$/g, "");
    expect(body.endsWith(`\n${signature}`)).toBe(true);
    expect(body.endsWith(`\n\n${signature}`)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);

it("reads origin/<source> package.json and CHANGELOG.md during dry-run and bump resolution from feature or detached HEAD", () => {
  const root = mkdtempSync(join(tmpdir(), "vlist-release-origin-reads-"));
  const repo = join(root, "caller");
  const remote = join(root, "remote.git");
  const env = { ...process.env, GIT_AUTHOR_NAME: "Release test", GIT_AUTHOR_EMAIL: "release@example.test", GIT_COMMITTER_NAME: "Release test", GIT_COMMITTER_EMAIL: "release@example.test" };
  const git = (cwd: string, ...args: string[]): string => {
    const result = Bun.spawnSync(["git", ...args], { cwd, env });
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
    return new TextDecoder().decode(result.stdout).trim();
  };
  const readyChangelog = "# Changelog\n\n## [Unreleased]\n\nA release theme.\n\nWho is affected: release users.\n\n### Fixed\n\n- A release fix.\n\n## [3.3.4] - 2026-11-02\n\n[Unreleased]: https://github.com/floor/vlist/compare/v3.3.4...HEAD\n";
  const emptyChangelog = "# Changelog\n\n## [Unreleased]\n\n## [3.3.4] - 2026-11-02\n\n[Unreleased]: https://github.com/floor/vlist/compare/v3.3.4...HEAD\n";
  try {
    mkdirSync(repo);
    git(root, "init", "--bare", remote);
    git(repo, "init", "-b", "main");
    writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "3.3.4" }));
    writeFileSync(join(repo, "CHANGELOG.md"), readyChangelog);
    git(repo, "add", ".");
    git(repo, "commit", "-m", "main with ready unreleased notes");
    git(repo, "tag", "-a", "v3.3.4", "-m", "v3.3.4");
    git(repo, "remote", "add", "origin", remote);
    git(repo, "push", "origin", "main", "v3.3.4");

    // Feature branch has a conflicting local package.json (9.9.9) and an empty local CHANGELOG.md.
    git(repo, "checkout", "-b", "feature");
    writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "9.9.9" }));
    writeFileSync(join(repo, "CHANGELOG.md"), emptyChangelog);
    git(repo, "commit", "-am", "feature with diverged local package.json and empty changelog");

    const preload = join(root, "github-dry-run-fixture.ts");
    writeFileSync(preload, `
import { mock } from "bun:test";
import { execSync as realExec } from "node:child_process";
const execute = realExec;
mock.module("node:child_process", () => ({ execSync(command: string, options: Parameters<typeof realExec>[1]) {
  if (command.startsWith("gh pr list")) return "[]";
  if (command.startsWith("gh ")) throw new Error("Unexpected GitHub operation: " + command);
  return execute(command, options);
} }));
`);
    for (const detach of [false, true] as const) {
      if (detach) git(repo, "checkout", "--detach");
      const dryRun = Bun.spawnSync([process.execPath, "--preload", preload, resolve(import.meta.dir, "../../scripts/release.ts"), "patch", "--dry-run"], { cwd: repo, env, timeout: 15_000 });
      const dryOut = new TextDecoder().decode(dryRun.stdout) + new TextDecoder().decode(dryRun.stderr);
      expect(dryRun.exitCode).toBe(0);
      expect(dryOut).toContain("Release plan for v3.3.5 (from main):");
    }

    // Now reverse: origin/main has an empty [Unreleased], while the caller's feature branch has ready notes.
    git(repo, "checkout", "main");
    writeFileSync(join(repo, "CHANGELOG.md"), emptyChangelog);
    git(repo, "commit", "-am", "main with empty unreleased");
    git(repo, "push", "origin", "main");
    git(repo, "checkout", "feature");
    writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "3.3.4" }));
    writeFileSync(join(repo, "CHANGELOG.md"), readyChangelog);
    git(repo, "commit", "-am", "feature with ready local changelog");

    const refused = Bun.spawnSync([process.execPath, "--preload", preload, resolve(import.meta.dir, "../../scripts/release.ts"), "3.3.5", "--dry-run"], { cwd: repo, env, timeout: 15_000 });
    const refusedOut = new TextDecoder().decode(refused.stdout) + new TextDecoder().decode(refused.stderr);
    expect(refused.exitCode).toBe(1);
    expect(refusedOut).toContain("CHANGELOG.md: ## [Unreleased] is empty");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);

it("refuses to tag the release merge once main has moved, and --at tags a later green commit", () => {
  const root = mkdtempSync(join(tmpdir(), "vlist-release-tag-target-"));
  const repo = join(root, "caller");
  const remote = join(root, "remote.git");
  const operator = join(root, "operator");
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Release test",
    GIT_AUTHOR_EMAIL: "release@example.test",
    GIT_COMMITTER_NAME: "Release test",
    GIT_COMMITTER_EMAIL: "release@example.test",
  };
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
    git(root, "clone", "--branch", "main", remote, operator);
    git(operator, "merge", "--no-ff", "origin/chore/release-3.3.5", "-m", "merge release");
    const mergeSha = git(operator, "rev-parse", "HEAD");
    writeFileSync(join(operator, "package.json"), JSON.stringify({ version: "3.3.6" }));
    git(operator, "commit", "-am", "fix: keep the release fix");
    const wrongSha = git(operator, "rev-parse", "HEAD");
    writeFileSync(join(operator, "package.json"), JSON.stringify({ version: "3.3.5" }));
    git(operator, "commit", "-am", "docs: record the size row");
    const redSha = git(operator, "rev-parse", "HEAD");
    writeFileSync(join(operator, "package.json"), JSON.stringify({ private: true, version: "3.3.5" }));
    git(operator, "commit", "-am", "fix: the follow-up on main");
    const goodSha = git(operator, "rev-parse", "HEAD");
    git(operator, "push", "origin", "main");

    const callerHead = git(repo, "rev-parse", "HEAD");
    const callerBranch = git(repo, "branch", "--show-current");
    const pr = {
      number: 503,
      title: "chore(release): v3.3.5",
      state: "MERGED",
      headRefName: "chore/release-3.3.5",
      baseRefName: "main",
      headRefOid: releaseHead,
      mergedAt: "2026-11-02T12:00:00Z",
      mergeCommit: { oid: mergeSha },
    };
    const preload = join(root, "github-read-fixture.ts");
    writeFileSync(preload, `
import { mock } from "bun:test";
import { execSync as realExec } from "node:child_process";
const pr = ${JSON.stringify(pr)};
const execute = realExec;
const redSha = ${JSON.stringify(redSha)};
mock.module("node:child_process", () => ({ execSync(command: string, options: Parameters<typeof realExec>[1]) {
  if (command.startsWith("gh pr list")) {
    if (command.includes("--state open")) return "[]";
    return command.includes("--head chore/release-3.3.5 --base main") ? JSON.stringify([pr]) : "[]";
  }
  if (command.startsWith("gh pr view 503")) return JSON.stringify(pr);
  if (command.startsWith("gh api") && command.includes("check-runs")) {
    const failed = command.includes(redSha);
    const check_runs = ["Test & Build", "Browser suites"].map((name) => ({
      name,
      status: "completed",
      conclusion: failed && name === "Test & Build" ? "failure" : "success",
      app: { slug: "github-actions" },
    }));
    return JSON.stringify([{ total_count: 2, check_runs }]);
  }
  if (command.startsWith("gh api") && command.includes("contents/package.json")) {
    return JSON.stringify({ content: Buffer.from('{"version":"3.3.5"}').toString("base64") });
  }
  if (command.startsWith("gh api") && command.includes("/compare/")) {
    const sha = command.split("/compare/")[1].split("...")[0];
    return JSON.stringify({ status: "ahead", ahead_by: 3, behind_by: 0, merge_base_commit: { sha } });
  }
  if (command.startsWith("gh api") && command.includes("commits/")) {
    return JSON.stringify({ parents: ${JSON.stringify([baseHead, releaseHead])}.map((sha) => ({ sha })) });
  }
  if (command.startsWith("gh ")) throw new Error("Unexpected GitHub operation: " + command);
  return execute(command, options);
} }));
`);
    const script = resolve(import.meta.dir, "../../scripts/release.ts");
    const release = (args: readonly string[]) => {
      const result = Bun.spawnSync([process.execPath, "--preload", preload, script, ...args], {
        cwd: repo,
        env,
        timeout: 20_000,
      });
      return {
        exitCode: result.exitCode,
        output: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
      };
    };
    const remoteTag = (): string => git(root, "--git-dir", remote, "tag", "-l", "v3.3.5");

    const dryRefusal = release(["3.3.5", "--dry-run", "--tag"]);
    expect(dryRefusal.exitCode).toBe(1);
    expect(dryRefusal.output).toContain(`Cannot tag v3.3.5 at release merge ${mergeSha}`);
    expect(dryRefusal.output).toContain("--at <full oid>");
    expect(dryRefusal.output).toContain(`${wrongSha} fix: keep the release fix`);
    expect(dryRefusal.output).toContain(`${redSha} docs: record the size row`);
    expect(dryRefusal.output).toContain(`${goodSha} fix: the follow-up on main`);
    expect(remoteTag()).toBe("");

    const liveRefusal = release(["3.3.5", "--tag"]);
    expect(liveRefusal.exitCode).toBe(1);
    expect(liveRefusal.output).toContain(`${goodSha} fix: the follow-up on main`);
    expect(remoteTag()).toBe("");

    const offLine = release(["3.3.5", "--dry-run", "--tag", "--at", releaseHead]);
    expect(offLine.exitCode).toBe(1);
    expect(offLine.output).toContain("not on origin/main's first-parent line");

    const notDescendant = release(["3.3.5", "--dry-run", "--tag", "--at", baseHead]);
    expect(notDescendant.exitCode).toBe(1);
    expect(notDescendant.output).toContain(`does not descend from release merge ${mergeSha}`);

    const wrongVersion = release(["3.3.5", "--dry-run", "--tag", "--at", wrongSha]);
    expect(wrongVersion.exitCode).toBe(1);
    expect(wrongVersion.output).toContain(`package.json at --at ${wrongSha} is v3.3.6, not v3.3.5`);

    const redChecks = release(["3.3.5", "--dry-run", "--tag", "--at", redSha]);
    expect(redChecks.exitCode).toBe(1);
    expect(redChecks.output).toContain(`commit ${redSha} has non-successful check runs`);

    const planned = release(["3.3.5", "--dry-run", "--tag", "--at", goodSha]);
    expect(planned.exitCode).toBe(0);
    expect(planned.output).toContain(`git tag -a v3.3.5 ${goodSha} -m v3.3.5`);
    expect(remoteTag()).toBe("");

    const tagged = release(["3.3.5", "--tag", "--at", goodSha]);
    expect(tagged.exitCode).toBe(0);
    expect(tagged.output).toContain("Tag v3.3.5 pushed");
    expect(git(root, "--git-dir", remote, "rev-parse", "v3.3.5^{}")).toBe(goodSha);
    expect(git(root, "--git-dir", remote, "cat-file", "-t", "v3.3.5")).toBe("tag");
    expect(git(repo, "rev-parse", "HEAD")).toBe(callerHead);
    expect(git(repo, "branch", "--show-current")).toBe(callerBranch);
    expect(remoteTag()).toBe("v3.3.5");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 90_000);

interface ReleaseCheckout {
  readonly root: string;
  readonly repo: string;
  readonly remote: string;
  readonly operator: string;
  readonly env: NodeJS.ProcessEnv;
  readonly git: (cwd: string, ...args: string[]) => string;
  readonly baseHead: string;
  readonly releaseHead: string;
  readonly mergeSha: string;
  readonly goodSha: string | null;
  readonly script: string;
  dispose(): void;
}

/** A merged 3.3.5 whose remote main is the merge, or that merge plus one green follow-up. */
const createReleaseCheckout = (followUp: boolean): ReleaseCheckout => {
  const root = mkdtempSync(join(tmpdir(), "vlist-release-tag-review-"));
  const repo = join(root, "caller");
  const remote = join(root, "remote.git");
  const operator = join(root, "operator");
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Release test",
    GIT_AUTHOR_EMAIL: "release@example.test",
    GIT_COMMITTER_NAME: "Release test",
    GIT_COMMITTER_EMAIL: "release@example.test",
  };
  const git = (cwd: string, ...args: string[]): string => {
    const result = Bun.spawnSync(["git", ...args], { cwd, env });
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
    return new TextDecoder().decode(result.stdout).trim();
  };
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
  git(root, "clone", "--branch", "main", remote, operator);
  git(operator, "merge", "--no-ff", "origin/chore/release-3.3.5", "-m", "merge release");
  const mergeSha = git(operator, "rev-parse", "HEAD");
  git(operator, "push", "origin", "main");
  let goodSha: string | null = null;
  if (followUp) {
    writeFileSync(join(operator, "package.json"), JSON.stringify({ private: true, version: "3.3.5" }));
    git(operator, "commit", "-am", "fix: the follow-up on main");
    goodSha = git(operator, "rev-parse", "HEAD");
    git(operator, "push", "origin", "main");
  }
  return {
    root,
    repo,
    remote,
    operator,
    env,
    git,
    baseHead,
    releaseHead,
    mergeSha,
    goodSha,
    script: resolve(import.meta.dir, "../../scripts/release.ts"),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
};

const releasePreload = (
  checkout: ReleaseCheckout,
  checks: "green" | "red-merge" | "advance" | "advance-after-status" | "merge-checks-unavailable",
): string => {
  const pr = {
    number: 503,
    title: "chore(release): v3.3.5",
    state: "MERGED",
    headRefName: "chore/release-3.3.5",
    baseRefName: "main",
    headRefOid: checkout.releaseHead,
    mergedAt: "2026-11-02T12:00:00Z",
    mergeCommit: { oid: checkout.mergeSha },
  };
  const advance = `git -C ${checkout.operator} -c user.email=release@example.test -c user.name='Release test' commit --allow-empty -m 'fix: landed during checks' && git -C ${checkout.operator} push origin main`;
  const file = join(checkout.root, "github-read-fixture.ts");
  writeFileSync(file, `
import { mock } from "bun:test";
import { execSync as realExec } from "node:child_process";
const pr = ${JSON.stringify(pr)};
const execute = realExec;
const mergeSha = ${JSON.stringify(checkout.mergeSha)};
const checks = ${JSON.stringify(checks)};
const advance = ${JSON.stringify(advance)};
let advanced = false;
// The live run checks the worktree just before its final tag verification.
let statusRead = false;
const timer = globalThis.setTimeout;
globalThis.setTimeout = ((fn: () => void) => timer(fn, 0)) as typeof setTimeout;
mock.module("node:child_process", () => ({ execSync(command: string, options: Parameters<typeof realExec>[1]) {
  if (command.startsWith("gh pr list")) {
    if (command.includes("--state open")) return "[]";
    return command.includes("--head chore/release-3.3.5 --base main") ? JSON.stringify([pr]) : "[]";
  }
  if (command.startsWith("gh pr view 503")) return JSON.stringify(pr);
  if (command === "git status --porcelain") statusRead = true;
  if (command.startsWith("gh api") && command.includes("check-runs")) {
    const advanceNow = checks === "advance" || (checks === "advance-after-status" && statusRead);
    if (advanceNow && !advanced) {
      advanced = true;
      execute(advance, { encoding: "utf8" });
    }
    if (checks === "merge-checks-unavailable" && command.includes(mergeSha)) {
      throw new Error("HTTP 502: check runs unavailable for " + mergeSha);
    }
    const failed = checks === "red-merge" && command.includes(mergeSha);
    const check_runs = ["Test & Build", "Browser suites"].map((name) => ({
      name,
      status: "completed",
      conclusion: failed && name === "Test & Build" ? "failure" : "success",
      app: { slug: "github-actions" },
    }));
    return JSON.stringify([{ total_count: 2, check_runs }]);
  }
  if (command.startsWith("gh api") && command.includes("contents/package.json")) {
    return JSON.stringify({ content: Buffer.from('{"version":"3.3.5"}').toString("base64") });
  }
  if (command.startsWith("gh api") && command.includes("/compare/")) {
    const sha = command.split("/compare/")[1].split("...")[0];
    return JSON.stringify({ status: "ahead", ahead_by: 1, behind_by: 0, merge_base_commit: { sha } });
  }
  if (command.startsWith("gh api") && command.includes("commits/")) {
    return JSON.stringify({ parents: ${JSON.stringify([checkout.baseHead, checkout.releaseHead])}.map((sha) => ({ sha })) });
  }
  if (command.startsWith("gh ")) throw new Error("Unexpected GitHub operation: " + command);
  return execute(command, options);
} }));
`);
  return file;
};

const runRelease = (checkout: ReleaseCheckout, preload: string, args: readonly string[]) => {
  const result = Bun.spawnSync([process.execPath, "--preload", preload, checkout.script, ...args], {
    cwd: checkout.repo,
    env: checkout.env,
    timeout: 20_000,
  });
  return {
    exitCode: result.exitCode,
    output: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
  };
};

it("refuses --at of the release merge, including a local tag at that merge", () => {
  const checkout = createReleaseCheckout(true);
  try {
    const preload = releasePreload(checkout, "green");
    const mergeSha = checkout.mergeSha;
    const dry = runRelease(checkout, preload, ["3.3.5", "--dry-run", "--tag", "--at", mergeSha]);
    expect(dry.exitCode).toBe(1);
    expect(dry.output).toContain(`--at ${mergeSha} is the release merge, and origin/main has first-parent commits after it`);
    checkout.git(checkout.repo, "fetch", "origin", "main");
    checkout.git(checkout.repo, "tag", "-a", "v3.3.5", mergeSha, "-m", "v3.3.5");
    const pushed = runRelease(checkout, preload, ["3.3.5", "--tag", "--at", mergeSha]);
    expect(pushed.exitCode).toBe(1);
    expect(pushed.output).toContain("is the release merge");
    expect(checkout.git(checkout.root, "--git-dir", checkout.remote, "tag", "-l", "v3.3.5")).toBe("");
  } finally {
    checkout.dispose();
  }
}, 40_000);

it("reads a freshly fetched origin/main when the fetch refspec ignores main", () => {
  const checkout = createReleaseCheckout(true);
  try {
    const goodSha = checkout.goodSha;
    if (goodSha === null) throw new Error("missing follow-up");
    checkout.git(checkout.repo, "fetch", "origin", "main");
    checkout.git(checkout.repo, "update-ref", "refs/remotes/origin/main", checkout.mergeSha);
    checkout.git(
      checkout.repo,
      "config",
      "remote.origin.fetch",
      "+refs/heads/chore/release-3.3.5:refs/remotes/origin/chore/release-3.3.5",
    );
    const preload = releasePreload(checkout, "green");
    const stale = runRelease(checkout, preload, ["3.3.5", "--tag"]);
    expect(stale.exitCode).toBe(1);
    expect(stale.output).toContain(goodSha);
    expect(checkout.git(checkout.root, "--git-dir", checkout.remote, "tag", "-l", "v3.3.5")).toBe("");
    const tagged = runRelease(checkout, preload, ["3.3.5", "--tag", "--at", goodSha]);
    expect(tagged.exitCode).toBe(0);
    expect(checkout.git(checkout.root, "--git-dir", checkout.remote, "rev-parse", "v3.3.5^{}")).toBe(goodSha);
  } finally {
    checkout.dispose();
  }
}, 40_000);

it("does not publish a tag chosen before main moves during check verification", () => {
  const checkout = createReleaseCheckout(false);
  try {
    checkout.git(checkout.repo, "fetch", "origin", "main");
    const preload = releasePreload(checkout, "advance");
    const created = runRelease(checkout, preload, ["3.3.5", "--tag"]);
    const landed = checkout.git(checkout.operator, "rev-parse", "HEAD");
    expect(created.exitCode).toBe(1);
    expect(created.output).toContain(landed);
    expect(created.output).toContain("fix: landed during checks");
    expect(checkout.git(checkout.root, "--git-dir", checkout.remote, "tag", "-l", "v3.3.5")).toBe("");

    const again = createReleaseCheckout(false);
    try {
      again.git(again.repo, "fetch", "origin", "main");
      again.git(again.repo, "tag", "-a", "v3.3.5", again.mergeSha, "-m", "v3.3.5");
      const localPreload = releasePreload(again, "advance");
      const pushed = runRelease(again, localPreload, ["3.3.5", "--tag"]);
      const moved = again.git(again.operator, "rev-parse", "HEAD");
      expect(pushed.exitCode).toBe(1);
      expect(pushed.output).toContain(moved);
      expect(again.git(again.root, "--git-dir", again.remote, "tag", "-l", "v3.3.5")).toBe("");
    } finally {
      again.dispose();
    }
  } finally {
    checkout.dispose();
  }
}, 60_000);

it("verifies an existing remote tag against --at", () => {
  const checkout = createReleaseCheckout(true);
  try {
    const goodSha = checkout.goodSha;
    if (goodSha === null) throw new Error("missing follow-up");
    checkout.git(checkout.repo, "fetch", "origin", "main");
    checkout.git(checkout.repo, "tag", "-a", "v3.3.5", goodSha, "-m", "v3.3.5");
    const preload = releasePreload(checkout, "green");
    const next = runRelease(checkout, preload, ["3.3.5", "--at", goodSha]);
    expect(next.exitCode).toBe(0);
    expect(next.output).toContain(`bun run release 3.3.5 --tag --at ${goodSha}`);
    expect(checkout.git(checkout.root, "--git-dir", checkout.remote, "tag", "-l", "v3.3.5")).toBe("");
    checkout.git(checkout.repo, "tag", "-d", "v3.3.5");

    checkout.git(checkout.operator, "tag", "-a", "v3.3.5", checkout.mergeSha, "-m", "v3.3.5");
    checkout.git(checkout.operator, "push", "origin", "v3.3.5");
    const conflict = runRelease(checkout, preload, ["3.3.5", "--dry-run", "--tag", "--at", goodSha]);
    expect(conflict.exitCode).toBe(1);
    expect(conflict.output).toContain(
      `Remote tag v3.3.5 points to ${checkout.mergeSha}, but verified commit is ${goodSha}`,
    );
    expect(checkout.git(checkout.root, "--git-dir", checkout.remote, "rev-parse", "v3.3.5^{}")).toBe(checkout.mergeSha);

    checkout.git(checkout.operator, "push", "origin", ":refs/tags/v3.3.5");
    checkout.git(checkout.operator, "tag", "-d", "v3.3.5");
    checkout.git(checkout.operator, "tag", "-a", "v3.3.5", goodSha, "-m", "v3.3.5");
    checkout.git(checkout.operator, "push", "origin", "v3.3.5");
    // The conflict run fetched main and auto-followed the tag that then pointed at the merge.
    if (checkout.git(checkout.repo, "tag", "-l", "v3.3.5") === "v3.3.5") {
      checkout.git(checkout.repo, "tag", "-d", "v3.3.5");
    }
    const dry = runRelease(checkout, preload, ["3.3.5", "--dry-run", "--tag", "--at", goodSha]);
    expect(dry.exitCode).toBe(0);
    expect(dry.output).toContain("already released");
    const live = runRelease(checkout, preload, ["3.3.5", "--tag", "--at", goodSha]);
    expect(live.exitCode).toBe(0);
    expect(live.output).toContain("already released");
    expect(checkout.git(checkout.root, "--git-dir", checkout.remote, "rev-parse", "v3.3.5^{}")).toBe(goodSha);
  } finally {
    checkout.dispose();
  }
}, 60_000);

it("tags --at when only the release merge's checks are red", () => {
  const checkout = createReleaseCheckout(true);
  try {
    const goodSha = checkout.goodSha;
    if (goodSha === null) throw new Error("missing follow-up");
    const preload = releasePreload(checkout, "red-merge");
    const dry = runRelease(checkout, preload, ["3.3.5", "--dry-run", "--tag", "--at", goodSha]);
    expect(dry.exitCode).toBe(0);
    expect(dry.output).toContain(`git tag -a v3.3.5 ${goodSha} -m v3.3.5`);
    const live = runRelease(checkout, preload, ["3.3.5", "--tag", "--at", goodSha]);
    expect(live.exitCode).toBe(0);
    expect(checkout.git(checkout.root, "--git-dir", checkout.remote, "rev-parse", "v3.3.5^{}")).toBe(goodSha);
  } finally {
    checkout.dispose();
  }
}, 40_000);

it("reads --at checks from the selected commit when the release merge's checks are unavailable", () => {
  const checkout = createReleaseCheckout(true);
  try {
    const goodSha = checkout.goodSha;
    if (goodSha === null) throw new Error("missing follow-up");
    const preload = releasePreload(checkout, "merge-checks-unavailable");
    const dry = runRelease(checkout, preload, ["3.3.5", "--dry-run", "--tag", "--at", goodSha]);
    expect(dry.output).not.toContain("HTTP 502");
    expect(dry.exitCode).toBe(0);
    expect(dry.output).toContain(
      `Check runs on --at commit ${goodSha}: Test & Build (success), Browser suites (success)`,
    );
    expect(dry.output).toContain(`git tag -a v3.3.5 ${goodSha} -m v3.3.5`);
    const live = runRelease(checkout, preload, ["3.3.5", "--tag", "--at", goodSha]);
    expect(live.output).not.toContain("HTTP 502");
    expect(live.exitCode).toBe(0);
    expect(checkout.git(checkout.root, "--git-dir", checkout.remote, "rev-parse", "v3.3.5^{}")).toBe(goodSha);
  } finally {
    checkout.dispose();
  }
}, 40_000);

it("does not publish --at of the release merge when main moves during the final check read", () => {
  const checkout = createReleaseCheckout(false);
  try {
    const mergeSha = checkout.mergeSha;
    checkout.git(checkout.repo, "fetch", "origin", "main");
    const preload = releasePreload(checkout, "advance-after-status");
    const created = runRelease(checkout, preload, ["3.3.5", "--tag", "--at", mergeSha]);
    const landed = checkout.git(checkout.operator, "rev-parse", "HEAD");
    expect(checkout.git(checkout.root, "--git-dir", checkout.remote, "rev-parse", "main")).toBe(landed);
    expect(landed).not.toBe(mergeSha);
    expect(checkout.git(checkout.root, "--git-dir", checkout.remote, "tag", "-l", "v3.3.5")).toBe("");
    expect(created.exitCode).toBe(1);
    expect(created.output).toContain(`--at ${mergeSha} is the release merge, and origin/main has first-parent commits after it`);
  } finally {
    checkout.dispose();
  }

  const again = createReleaseCheckout(false);
  try {
    const mergeSha = again.mergeSha;
    again.git(again.repo, "fetch", "origin", "main");
    again.git(again.repo, "tag", "-a", "v3.3.5", mergeSha, "-m", "v3.3.5");
    const preload = releasePreload(again, "advance-after-status");
    const pushed = runRelease(again, preload, ["3.3.5", "--tag", "--at", mergeSha]);
    const landed = again.git(again.operator, "rev-parse", "HEAD");
    expect(again.git(again.root, "--git-dir", again.remote, "rev-parse", "main")).toBe(landed);
    expect(again.git(again.root, "--git-dir", again.remote, "tag", "-l", "v3.3.5")).toBe("");
    expect(pushed.exitCode).toBe(1);
    expect(pushed.output).toContain(`--at ${mergeSha} is the release merge, and origin/main has first-parent commits after it`);
  } finally {
    again.dispose();
  }
}, 60_000);

it("re-reads origin/main after the --at check read in dry-run and live", () => {
  for (const args of [["--dry-run", "--tag"], ["--tag"]] as const) {
    const checkout = createReleaseCheckout(false);
    try {
      const mergeSha = checkout.mergeSha;
      checkout.git(checkout.repo, "fetch", "origin", "main");
      const preload = releasePreload(checkout, "advance");
      const result = runRelease(checkout, preload, ["3.3.5", ...args, "--at", mergeSha]);
      expect(checkout.git(checkout.root, "--git-dir", checkout.remote, "tag", "-l", "v3.3.5")).toBe("");
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain(`--at ${mergeSha} is the release merge, and origin/main has first-parent commits after it`);
    } finally {
      checkout.dispose();
    }
  }
}, 60_000);
