/** Opt-in synthetic scrolling for huge lists and application-owned touch motion. */
import { createCore } from "./core/create";
import { createSyntheticScrollHandler } from "./synthetic/handler";
import type { CreateVListConfig, PluginMethods, VList, VListPlugin } from "./core/types";
import type { VListItem } from "./types";

export type { CreateVListConfig as SyntheticVListConfig } from "./core/types";

export function createVList<
  T extends VListItem = VListItem,
  const P extends readonly VListPlugin<T, any>[] = VListPlugin<T>[],
>(
  config: CreateVListConfig<T>, plugins: P = [] as unknown as P,
): VList<T> & PluginMethods<P> {
  // overflow() hands a native list over past the size limit; this list has
  // no limit, so it is dropped rather than refused (RFC-015).
  const kept = (plugins as unknown as VListPlugin<T>[]).filter((p) => p.name !== "overflow");
  return createCore(config, kept, createSyntheticScrollHandler) as VList<T> & PluginMethods<P>;
}
