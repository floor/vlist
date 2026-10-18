#!/usr/bin/env bun
/**
 * Warns when npm's `next` dist-tag sits below `latest`.
 *
 * Usage: bun scripts/check-dist-tags.ts <version>
 *
 * A stable `npm publish` moves `latest` only. publish.yml moves `next` itself
 * with npm's OIDC dist-tag support (`Allow npm dist-tag` on the package's
 * trusted publisher, npm >= 11.21.0); while that setting is off the move step
 * is allowed to fail, and after a stable release `npm install vlist@next`
 * would install an older version than `latest`. This check is the fallback:
 * publish.yml runs it after a stable publish. It
 * reads the public dist-tags (no auth) once and warns with the one command a
 * maintainer runs to fix `next`, for the version just published even when the
 * registry still shows an older `latest` (it lags a fresh publish by a minute
 * or two; waiting for it gave up before 3.1.3 showed, and printed no command).
 * A state it cannot determine — the registry unreachable, an
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

/**
 * Whether `next` is at or above the version that should be on it; no `next`
 * tag at all is fine. That version is `latest`, or the version just published
 * when the registry still shows an older `latest` (it lags a fresh publish).
 */
export const checkDistTags = (tags: DistTags, published?: string): DistTagCheck => {
  const { latest, next } = tags;
  if (!latest) return { ok: false, message: "npm reports no `latest` dist-tag for vlist" };
  if (!next) return { ok: true, message: `latest ${latest}, no next tag` };
  const target = published && Bun.semver.order(published, latest) > 0 ? published : latest;
  if (Bun.semver.order(next, target) >= 0) return { ok: true, message: `next ${next} ≥ latest ${latest}` };
  const below =
    target === latest
      ? `\`latest\` (${latest})`
      : `${target}, the version just published (\`latest\` still shows ${latest}: the registry lags a fresh publish)`;
  return {
    ok: false,
    message:
      `npm \`next\` (${next}) is below ${below}: \`npm install vlist@next\` installs an older version. ` +
      `A maintainer runs: ${nextTagCommand(target)}`,
  };
};

/** Test seam: another registry to read. */
const distTagsUrl = (): string =>
  process.env.VLIST_DIST_TAGS_URL ?? "https://registry.npmjs.org/-/package/vlist/dist-tags";

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

  try {
    const tags = await fetchDistTags();

    if (!tags.latest) {
      warn("next dist-tag unknown", "npm reports no `latest` dist-tag for vlist");
      return;
    }

    const result = checkDistTags(tags, version);
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
