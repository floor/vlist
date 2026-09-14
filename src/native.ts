/** Opt-in native scrolling: import { createVList } from "vlist/native". */
import { createCore } from "./core/create";
import type { CreateVListConfig, VList, VListPlugin } from "./core/types";
import type { VListItem } from "./types";

export function createVList<T extends VListItem = VListItem>(
  config: CreateVListConfig<T>, plugins: VListPlugin<T>[] = [],
): VList<T> {
  return createCore(config, plugins);
}
