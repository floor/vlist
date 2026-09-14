import type { VListItem } from "../../types";
import type { VListPlugin } from "../../core/types";

export interface ScalePluginConfig {
  force?: boolean;
}

let warned = false;

export function scale<T extends VListItem = VListItem>(
  _config?: ScalePluginConfig,
): VListPlugin<T> {
  return createScalePlugin<T>(true);
}

/** Internal: the config entry installs the compatibility stub without warning. */
export function createScalePlugin<T extends VListItem = VListItem>(warn: boolean): VListPlugin<T> {
  return {
    name: "scale",
    priority: 20,
    setup(): void {
      if (warn && !warned) {
        warned = true;
        console.warn(
          "[vlist] scale() is deprecated and will be removed in vlist 3.0. " +
          "Use scroll: { mode: \"synthetic\" } from the vlist/synthetic entry " +
          "(bounded remains available in 2.x). See https://vlist.io/docs/rfcs/RFC-014-Scroll-Input-Model",
        );
      }
    },
  };
}
