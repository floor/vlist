/** Synthetic scrolling, loaded up front. */
import { createCore } from "./core/create";
import { createSyntheticScrollHandler } from "./synthetic/handler";
import type { CreateVListConfig, PluginMethods, VList, VListPlugin } from "./core/types";
import type { VListItem } from "./types";

export type { CreateVListConfig as SyntheticVListConfig } from "./core/types";

/**
 * Synthetic scrolling, loaded up front.
 *
 * @deprecated Use createVList from "vlist" with `scroll: { mode: "synthetic" }`,
 * or the default `"auto"`, which hands over past the browser's size limit
 * (RFC-015). This entry bundles the driver instead of loading it on demand.
 */
export function createVList<
  T extends VListItem = VListItem,
  const P extends readonly VListPlugin<T, any>[] = VListPlugin<T>[],
>(
  config: CreateVListConfig<T>, plugins: P = [] as unknown as P,
): VList<T> & PluginMethods<P> {
  return createCore(config, plugins as unknown as VListPlugin<T>[], createSyntheticScrollHandler) as VList<T> & PluginMethods<P>;
}
