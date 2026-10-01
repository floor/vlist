/**
 * The synthetic driver `scroll.mode` loads on first need (RFC-015), built as
 * dist/synthetic-driver.js: the input handler, and the scrollbar a synthetic
 * list gets by default. Synthetic content is the size of its viewport, so the
 * browser draws no scrollbar; without this one a list would have none.
 */
import type { EngineState } from "../core/state";
import type { SizeCache } from "../core/sizes";
import type { ResolvedConfig } from "../core/types";
import type { ScrollbarOptions } from "../types";
import { createScrollbar } from "../plugins/scrollbar/scrollbar";

export { createSyntheticScrollHandler } from "./handler";

/** What the core drives: `sync` after every frame and forced render. */
export interface AttachedScrollbar {
  sync(): void;
  destroy(): void;
}

/**
 * The scrollbar() plugin's wiring, for a synthetic list without one. None
 * when the list asked for none (`scroll.scrollbar: "none"`), or already has
 * scrollbar(): the plugin marks the viewport with its class during setup.
 */
export function attachScrollbar(
  state: EngineState,
  dom: { viewport: HTMLElement; root: HTMLElement },
  config: ResolvedConfig,
  sizeCache: SizeCache,
  scrollTo: (position: number) => void,
  options?: ScrollbarOptions | "native" | "none",
): AttachedScrollbar | null {
  const { viewport, root } = dom;
  const custom = `${config.classPrefix}-viewport--custom-scrollbar`;
  if (options === "none" || viewport.classList.contains(custom)) return null;
  const bar = createScrollbar(viewport, scrollTo, typeof options === "object" ? options : {}, config.classPrefix, config.axis.primary === "x", root, () => sizeCache, root.parentElement!);
  let total = -1;
  let container = -1;
  viewport.classList.add(custom);
  return {
    sync(): void {
      const size = state.totalSize + config.mainAxisPadding;
      if (size !== total || state.containerSize !== container) {
        total = size;
        container = state.containerSize;
        bar.updateBounds(total, container);
      }
      bar.updatePosition(state.scrollPosition);
      bar.show();
    },
    destroy(): void {
      bar.destroy();
      viewport.classList.remove(custom);
    },
  };
}
