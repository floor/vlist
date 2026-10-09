#!/usr/bin/env bun
/**
 * Warns when npm's `next` dist-tag sits below `latest`.
 *
 * Usage: bun scripts/check-dist-tags.ts <version>
 *
 * A stable `npm publish` moves `latest` only, and trusted publishing (OIDC)
 * authorizes `npm publish` alone, so the workflow cannot move `next` itself:
 * after a stable release, `npm install vlist@next` would install an older
 * version than `latest`. publish.yml runs this after a stable publish. It
 * reads the public dist-tags (no auth), waits for `latest` to reach the
 * version just published, and warns with the one command a maintainer runs
 * to fix `next`. A state it cannot determine — the registry unreachable, an
 * unexpected answer — is also a warning: the publish already happened, and
 * this step must not end the release run red by design.
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

/** The registry can take a minute to show a fresh publish. */
const DEFAULT_ATTEMPTS = 12;

/** Test seams: another registry to read, and a shorter wait to give it. */
const distTagsUrl = (): string =>
  process.env.VLIST_DIST_TAGS_URL ?? "https://registry.npmjs.org/-/package/vlist/dist-tags";

const waitAttempts = (): number => {
  const raw = process.env.VLIST_DIST_TAGS_ATTEMPTS;
  if (raw === undefined) return DEFAULT_ATTEMPTS;
  const attempts = Number(raw);
  if (!Number.isInteger(attempts) || attempts < 0) {
    throw new Error("VLIST_DIST_TAGS_ATTEMPTS must be a non-negative integer");
  }
  return attempts;
};

const fetchDistTags = async (): Promise<DistTags> => {
  const res = await fetch(distTagsUrl(), { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`dist-tags request failed: ${res.status}`);
  return (await res.json()) as DistTags;
};

/** One line GitHub reads as a warning annotation; the run stays green. */
const warn = (title: string, message: string): void => {
  console.log(`::warning title=${title}::${message}`);
};

const main = async (): Promise<void> => {
  const version = process.argv[2];
  if (!version) throw new Error("Usage: bun scripts/check-dist-tags.ts <version>");
  const attempts = waitAttempts();

  try {
    let tags = await fetchDistTags();
    for (let i = 0; i < attempts && tags.latest && Bun.semver.order(tags.latest, version) < 0; i++) {
      await Bun.sleep(10_000);
      tags = await fetchDistTags();
    }

    if (!tags.latest) {
      warn("next dist-tag unknown", "npm reports no `latest` dist-tag for vlist");
      return;
    }
    if (Bun.semver.order(tags.latest, version) < 0) {
      warn("next dist-tag unknown", `npm \`latest\` is ${tags.latest}, not ${version}, after two minutes`);
      return;
    }

    const result = checkDistTags(tags);
    if (!result.ok) {
      warn("next dist-tag below latest", result.message);
      return;
    }
    console.log(`✓ ${result.message}`);
  } catch (err: unknown) {
    warn("next dist-tag unknown", `could not determine the npm dist-tags (${err instanceof Error ? err.message : String(err)})`);
  }
};

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
