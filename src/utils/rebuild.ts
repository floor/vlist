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

  // Capture scroll snapshot from old list
  let snapshot: ScrollSnapshot | undefined;
  if (previous) {
    const getSnapshot = previous.getScrollSnapshot as
      | (() => ScrollSnapshot)
      | undefined;
    if (typeof getSnapshot === "function") {
      snapshot = getSnapshot();
    }
  }

  // Persist to sessionStorage so snapshots plugin auto-restores
  if (snapshot && key) {
    try {
      sessionStorage.setItem(key, JSON.stringify(snapshot));
    } catch { /* sessionStorage full or unavailable */ }
  }

  // Pre-configured snapshots plugin: autoSave for persistence, restore for one-shot
  const snapshotPlugin = snapshots<T>(
    key
      ? { autoSave: key }
      : snapshot
        ? { restore: snapshot }
        : undefined,
  );

  // Create new list in the same container — old DOM stays visible
  const newList = create(snapshotPlugin);
  const newRoot = newList.element;

  // Hide new list behind old (overlay, invisible, but renders for layout).
  // The container must have position: relative for this to work.
  newRoot.style.position = "absolute";
  newRoot.style.inset = "0";
  newRoot.style.visibility = "hidden";

  // Wait for ready signal (default: one frame for initial render)
  if (options?.ready) {
    await options.ready(newList);
  } else {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  // Optional settle delay
  const delay = options?.delay;
  if (delay && delay > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }

  const raw = options?.transition;
  const fadeIn = typeof raw === "number" ? raw : raw?.fadeIn ?? 0;
  const fadeOut = typeof raw === "number" ? raw : raw?.fadeOut ?? 0;
  const fadeOutDelay = typeof raw === "object" ? raw?.fadeOutDelay ?? 0 : 0;
  const longest = Math.max(fadeIn, fadeOut + fadeOutDelay);

  if (longest > 0 && previous) {
    const oldRoot = previous.element;

    newRoot.style.visibility = "";
    newRoot.style.opacity = "0";
    newRoot.offsetHeight; // force reflow so browser registers opacity: 0

    newRoot.style.transition = `opacity ${fadeIn}ms ease`;
    oldRoot.style.transition = `opacity ${fadeOut}ms ease ${fadeOutDelay}ms`;
    newRoot.style.opacity = "1";
    oldRoot.style.opacity = "0";

    await new Promise<void>((resolve) => {
      setTimeout(resolve, longest + 50);
    });

    newRoot.style.transition = "";
    newRoot.style.opacity = "";
    oldRoot.style.transition = "";
    oldRoot.style.opacity = "";
  } else {
    newRoot.style.visibility = "";
  }

  newRoot.style.position = "";
  newRoot.style.inset = "";

  if (previous) previous.destroy();

  return newList;
}
