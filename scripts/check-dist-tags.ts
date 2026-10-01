#!/usr/bin/env bun
/**
 * Fails when npm's `next` dist-tag sits below `latest` (FLO-245).
 *
 * Usage: bun scripts/check-dist-tags.ts <version>
 *
 * A stable `npm publish` moves `latest` only, and trusted publishing (OIDC)
 * authorizes `npm publish` alone, so the workflow cannot move `next` itself:
 * after a stable release, `npm install vlist@next` would install an older
 * version than `latest`. publish.yml runs this after a stable publish. It
 * reads the public dist-tags (no auth), waits for `latest` to reach the
 * version just published, and fails with the one command a maintainer runs
 * to fix it.
 */

export type DistTags = Record<string, string>;

export interface DistTagCheck {
  ok: boolean;
  message: string;
}

/** The command that points `next` at a stable release; needs a maintainer's npm login. */
export const nextTagCommand = (version: string): string =>
  `npm dist-tag add vlist@${version} next --auth-type=web`;

/** Whether `next` is at or above `latest`; no `next` tag at all is fine. */
export const checkDistTags = (tags: DistTags): DistTagCheck => {
  const { latest, next } = tags;
  if (!latest) return { ok: false, message: "npm reports no `latest` dist-tag for vlist" };
  if (!next) return { ok: true, message: `latest ${latest}, no next tag` };
  if (Bun.semver.order(next, latest) >= 0) return { ok: true, message: `next ${next} ≥ latest ${latest}` };
  return {
    ok: false,
    message:
      `npm \`next\` (${next}) is below \`latest\` (${latest}): \`npm install vlist@next\` installs an older version. ` +
      `A maintainer runs: ${nextTagCommand(latest)}`,
  };
};

const fetchDistTags = async (): Promise<DistTags> => {
  const res = await fetch("https://registry.npmjs.org/-/package/vlist/dist-tags", { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`dist-tags request failed: ${res.status}`);
  return (await res.json()) as DistTags;
};

const main = async (): Promise<void> => {
  const version = process.argv[2];
  if (!version) throw new Error("Usage: bun scripts/check-dist-tags.ts <version>");

  // The registry can take a minute to show a fresh publish.
  let tags = await fetchDistTags();
  for (let i = 0; i < 12 && tags.latest !== version; i++) {
    await Bun.sleep(10_000);
    tags = await fetchDistTags();
  }
  if (tags.latest !== version) {
    throw new Error(`npm \`latest\` is ${tags.latest}, not ${version}, after two minutes`);
  }

  const result = checkDistTags(tags);
  if (!result.ok) {
    console.log(`::error title=next dist-tag below latest::${result.message}`);
    throw new Error(result.message);
  }
  console.log(`✓ ${result.message}`);
};

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
