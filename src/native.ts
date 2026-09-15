/** Opt-in native scrolling: import { createVList } from "vlist/native". */
import { createScrollHandler } from "./core/scroll";
import { createBoundedScrollHandler } from "./core/runway";
import { MAX_VIRTUAL_SIZE } from "./constants";
import { createCore } from "./core/create";
import type { CreateVListConfig, VList, VListPlugin } from "./core/types";
import type { VListItem } from "./types";

export function createVList<T extends VListItem = VListItem>(
  config: CreateVListConfig<T>, plugins: VListPlugin<T>[] = [],
): VList<T> {
  let warned = false;
  return createCore(config, plugins, undefined, {
    native: createScrollHandler,
    wrap: createBoundedScrollHandler,
    onContentSize(size, emitter) {
      if (!warned && size > MAX_VIRTUAL_SIZE) {
        warned = true;
        emitter.emit("error", {
          error: new Error(`Content size (${size}px) exceeds browser limit (${MAX_VIRTUAL_SIZE}px). Use the default "vlist" synthetic entry for large datasets.`),
          context: "content:size:overflow",
        });
      }
    },
  });
}
