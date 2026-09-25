/**
 * vlist — Rebuild Utility
 *
 * Seamless list recreation with deferred DOM swap.
 * Creates the new list hidden behind the old one, waits for it
 * to be ready, then swaps in a single frame. No flash.
 */

import type { VListItem, ScrollSnapshot } from "../types";
import type { VList, VListPlugin } from "../core/types";
import { snapshots } from "../plugins/snapshots";

// =============================================================================
// Types
// =============================================================================

export interface RebuildOptions {
  /** SessionStorage key for snapshot persistence across page reloads. */
  key?: string;
  /** Resolves when the new list is ready to display. Defaults to one animation frame. */
  ready?: (list: VList) => Promise<void>;
  /** Extra milliseconds to wait after ready before swapping. */
  delay?: number;
  /** Crossfade duration in ms. Number applies to both. Object uncouples them. */
  transition?: number | { fadeIn: number; fadeOut: number; fadeOutDelay?: number };
}

// =============================================================================
// rebuild()
// =============================================================================

type ListWithSnapshot<T extends VListItem> = VList<T> & {
  getScrollSnapshot?: () => ScrollSnapshot;
  getSelected?: () => Array<string | number>;
  _getFocusedId?: () => string | number | undefined;
};

/** Scroll position from the snapshots plugin, or from the list itself. */
function captureScroll<T extends VListItem>(previous: VList<T>): ScrollSnapshot | undefined {
  const list = previous as ListWithSnapshot<T>;
  if (typeof list.getScrollSnapshot === "function") return list.getScrollSnapshot();

  const scrollTop = list.getScrollPosition();
  const selectedIds = list.getSelected?.();
  const focusedId = list._getFocusedId?.();
  if (scrollTop <= 0 && !selectedIds?.length && focusedId === undefined) return undefined;

  const snap: ScrollSnapshot = {
    index: 0,
    offsetInItem: 0,
    total: list.total,
    scrollTop,
  };
  if (selectedIds?.length) snap.selectedIds = selectedIds;
  if (focusedId !== undefined) snap.focusedId = focusedId;
  return snap;
}

/**
 * Recreate a list with scroll position continuity.
 *
 * The old list stays visible while the new one renders offscreen.
 * Once ready, a single-frame swap replaces old with new — no flash.
 *
 * The callback receives a pre-configured snapshots plugin that handles
 * scroll capture and restore. Include it in your plugin array:
 *
 * ```ts
 * list = await rebuild(list, (snap) =>
 *   createVList(config, [grid({ columns: 3 }), snap])
 * );
 * ```
 */
export async function rebuild<T extends VListItem = VListItem>(
  previous: VList<T> | null | undefined,
  create: (snapshotPlugin: VListPlugin<T>) => VList<T>,
  options?: RebuildOptions,
): Promise<VList<T>> {
  const key = options?.key;

  // A list that installed snapshots() has the full snapshot. Every other list
  // still has a scroll position, and that is what the user expects to come back.
  const snapshot = previous ? captureScroll(previous) : undefined;

  // Snapshots plugin: direct restore (no sessionStorage round-trip) + optional auto-save
  const snapshotPlugin = snapshots<T>(
    snapshot
      ? key ? { restore: snapshot, autoSave: key } : { restore: snapshot }
      : key ? { autoSave: key } : undefined,
  );

  const newList = create(snapshotPlugin);
  const newRoot = newList.element;
  const oldRoot = previous?.element ?? null;
  const oldRect = oldRoot?.getBoundingClientRect();

  // Hide new list behind old (overlay, invisible, but renders for layout).
  // An absolute root inside a static container has no height, and a tree
  // then skips its first render. Pin the old size so that render happens.
  newRoot.style.position = "absolute";
  newRoot.style.inset = "0";
  if (oldRect && oldRect.height > 0) {
    newRoot.style.height = `${oldRect.height}px`;
    newRoot.style.width = `${oldRect.width}px`;
  }
  newRoot.style.visibility = "hidden";

  // Wait for ready signal (default: one frame for initial render)
  if (options?.ready) {
    await options.ready(newList);
  } else {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }

  // The first restore runs during setup, before the viewport has a size, so
  // the position is clamped away. Apply it again once the list can scroll.
  if (snapshot && Math.abs(newList.getScrollPosition() - (snapshot.scrollTop ?? 0)) > 1) {
    const restore = (newList as { restoreScroll?: (snap: ScrollSnapshot, restoreSelection?: boolean) => Promise<void> }).restoreScroll;
    if (restore) await restore(snapshot, false);
  }

  if (options?.delay && options.delay > 0) {
    await new Promise<void>((r) => setTimeout(r, options.delay));
  }

  // Crossfade
  const raw = options?.transition;
  const fadeIn = typeof raw === "number" ? raw : raw?.fadeIn ?? 0;
  const fadeOut = typeof raw === "number" ? raw : raw?.fadeOut ?? 0;
  const fadeOutDelay = typeof raw === "object" ? raw?.fadeOutDelay ?? 0 : 0;

  if (previous && (fadeIn > 0 || fadeOut > 0)) {
    const oldRoot = previous.element;

    newRoot.style.visibility = "";
    newRoot.style.opacity = "0";
    newRoot.offsetHeight; // force reflow so browser registers opacity: 0

    newRoot.style.transition = `opacity ${fadeIn}ms ease`;
    oldRoot.style.transition = `opacity ${fadeOut}ms ease ${fadeOutDelay}ms`;
    newRoot.style.opacity = "1";
    oldRoot.style.opacity = "0";

    await new Promise<void>((r) =>
      setTimeout(r, Math.max(fadeIn, fadeOut + fadeOutDelay) + 50),
    );

    newRoot.style.transition = "";
    newRoot.style.opacity = "";
    oldRoot.style.transition = "";
    oldRoot.style.opacity = "";
  } else {
    newRoot.style.visibility = "";
  }

  newRoot.style.position = "";
  newRoot.style.inset = "";
  newRoot.style.height = "";
  newRoot.style.width = "";

  if (previous) previous.destroy();

  return newList;
}
