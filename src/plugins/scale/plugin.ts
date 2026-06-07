import type { VListItem } from "../../types";
import type { VListPlugin } from "../../core/types";

export interface ScalePluginConfig {
  force?: boolean;
}

let warned = false;

export function scale<T extends VListItem = VListItem>(
  _config?: ScalePluginConfig,
): VListPlugin<T> {
  return {
    name: "scale",
    priority: 20,
    setup(): void {
      if (!warned) {
        warned = true;
        console.warn(
          "[vlist] scale() is deprecated and will be removed in vlist 3.0. " +
          "Use scroll: { mode: \"bounded\" } instead — it handles lists of any size " +
          "without coordinate compression. See https://vlist.io/docs/logical-scroll",
        );
      }
    },
  };
}
