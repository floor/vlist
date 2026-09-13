/** Opt-in RFC-014 entry: import { createVList } from "vlist/synthetic". */
import { createVList as createCore } from "./core/create";
import type { CreateVListConfig, VList, VListPlugin } from "./core/types";
import type { ScrollConfig, VListItem } from "./types";
import { createSyntheticScrollHandler } from "./synthetic/handler";

export type SyntheticVListConfig<T extends VListItem = VListItem> =
  Omit<CreateVListConfig<T>, "scroll"> & {
    scroll?: Omit<ScrollConfig, "mode"> & { mode?: "native" | "bounded" | "synthetic" };
  };

export function createVList<T extends VListItem = VListItem>(
  config: SyntheticVListConfig<T>, plugins: VListPlugin<T>[] = [],
): VList<T> {
  return createCore(config as CreateVListConfig<T>, plugins,
    config.scroll?.mode === "synthetic" ? createSyntheticScrollHandler : undefined);
}
