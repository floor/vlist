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
  return createCore(config, plugins as unknown as VListPlugin<T>[], createSyntheticScrollHandler) as VList<T> & PluginMethods<P>;
}
