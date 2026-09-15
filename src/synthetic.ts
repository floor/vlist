/** Opt-in synthetic scrolling for huge lists and application-owned touch motion. */
import { createCore } from "./core/create";
import { createSyntheticScrollHandler } from "./synthetic/handler";
import type { CreateVListConfig, VList, VListPlugin } from "./core/types";
import type { VListItem } from "./types";

export type { CreateVListConfig as SyntheticVListConfig } from "./core/types";

export function createVList<T extends VListItem = VListItem>(
  config: CreateVListConfig<T>, plugins: VListPlugin<T>[] = [],
): VList<T> {
  return createCore(config, plugins, createSyntheticScrollHandler);
}
