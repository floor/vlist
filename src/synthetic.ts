/** Opt-in RFC-014 entry: import { createVList } from "vlist/synthetic". */
import { resolveContainer } from "./core/dom";
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
  const synthetic = config.scroll?.mode === "synthetic";
  if (synthetic) {
    if (config.orientation === "horizontal" && getComputedStyle(resolveContainer(config.container)).direction === "rtl") {
      throw new Error("RTL horizontal lists are not supported with synthetic mode in this release; use native mode");
    }
    for (const plugin of plugins) {
      if (plugin.name === "carousel" || plugin.name === "sortable") {
        throw new Error(`${plugin.name} is not supported with synthetic mode in this release`);
      }
    }
  }
  return createCore(config as CreateVListConfig<T>, plugins,
    synthetic ? createSyntheticScrollHandler : undefined);
}
