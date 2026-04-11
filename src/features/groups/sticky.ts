/**
 * vlist - Sticky Header
 *
 * Manages a floating header that sticks to the viewport edge and transitions
 * smoothly when the next group's header approaches (push-out effect).
 *
 * Two permanent slot elements are recycled — content is swapped via a
 * caller-provided `renderInto` callback, keeping the sticky header
 * template-agnostic (same pattern as item rendering).
 *
 * Header offsets and sizes are pre-cached into flat arrays on rebuild,
 * keeping the per-tick scroll handler free of function calls.
 *
 *   .vlist-sticky-header (position: relative, overflow: hidden)
 *   ├── .sticky-group  (active slot — translated during push)
 *   └── .sticky-group  (standby slot — translated during push)
 */

import type { GroupLayout, StickyHeader } from "./types";
import type { SizeCache } from "../../rendering/sizes";

export const createStickyHeader = (
  root: HTMLElement,
  layout: GroupLayout,
  sizeCache: SizeCache,
  renderInto: (slot: HTMLElement, groupIndex: number) => void,
  classPrefix: string,
  horizontal: boolean = false,
  stickyOffset: number = 0,
): StickyHeader => {
  // Orientation helpers — resolved once
  const mainProp = horizontal ? "width" : "height";
  const crossProp = horizontal ? "height" : "width";
  const translateAxis = horizontal ? "X" : "Y";

  const setMain = (el: HTMLElement, px: number): void => {
    el.style[mainProp] = `${px}px`;
  };

  // DOM setup
  const container = document.createElement("div");
  container.className = `${classPrefix}-sticky-header`;
  container.setAttribute("role", "presentation");
  container.setAttribute("aria-hidden", "true");
  container.style.cssText =
    `position:relative;z-index:5;pointer-events:none;overflow:hidden;` +
    (horizontal
      ? `top:0;bottom:0;left:${stickyOffset || 0}px`
      : `top:${stickyOffset || 0}px`);

  const mkSlot = (): HTMLElement => {
    const s = document.createElement("div");
    s.className = "sticky-group";
    s.style.position = "absolute";
    s.style.willChange = "transform";
    s.style[crossProp] = "100%";
    return s;
  };

  const slotA = mkSlot();
  const slotB = mkSlot();
  container.append(slotA, slotB);
  root.insertBefore(container, root.firstChild);

  // Slot references — swap roles after each completed transition
  let active = slotA;
  let standby = slotB;

  // Pre-cached arrays — rebuilt in cacheGroups(), read on every scroll tick
  let groups = layout.groups;
  let offsets: number[] = [];
  let sizes: number[] = [];
  let groupCount = 0;

  const cacheGroups = (): void => {
    groups = layout.groups;
    groupCount = groups.length;
    offsets = new Array(groupCount);
    sizes = new Array(groupCount);
    for (let i = 0; i < groupCount; i++) {
      offsets[i] = sizeCache.getOffset(groups[i]!.headerLayoutIndex);
      sizes[i] = layout.getHeaderHeight(i);
    }
  };
  cacheGroups();

  // Mutable state
  let curGroup = -1;
  let curSize = 0;
  let nxtGroup = -1;
  let visible = false;
  let lastOffset = 0;
  let transitioning = false;

  // Slot content — delegate to caller-provided renderInto
  const fill = (slot: HTMLElement, gi: number): number => {
    renderInto(slot, gi);
    const sz = sizes[gi]!;
    setMain(slot, sz);
    return sz;
  };

  const clear = (slot: HTMLElement): void => {
    slot.replaceChildren();
    slot.style.transform = "";
  };

  // Current group
  const setCurrent = (gi: number): void => {
    if (gi === curGroup) return;
    curGroup = gi;
    curSize = 0;
    if (gi < 0 || gi >= groupCount) { clear(active); return; }
    curSize = fill(active, gi);
    setMain(container, curSize);
    active.style.transform = "";
  };

  // Push transition
  const applyPush = (offset: number): void => {
    if (offset === lastOffset) return;
    lastOffset = offset;
    const r = Math.round(offset);
    active.style.transform = `translate${translateAxis}(${r}px)`;
    standby.style.transform = `translate${translateAxis}(${r + curSize}px)`;
  };

  const resetTransforms = (): void => {
    lastOffset = 0;
    active.style.transform = "";
    standby.style.transform = "";
  };

  const complete = (): void => {
    if (!transitioning) return;
    const prev = active;
    active = standby;
    standby = prev;
    curGroup = nxtGroup;
    curSize = curGroup >= 0 ? sizes[curGroup]! : 0;
    setMain(container, curSize);
    clear(standby);
    nxtGroup = -1;
    transitioning = false;
    resetTransforms();
  };

  const cancel = (): void => {
    if (!transitioning) return;
    clear(standby);
    nxtGroup = -1;
    transitioning = false;
    resetTransforms();
  };

  // Visibility
  const show = (): void => {
    if (visible) return;
    visible = true;
    container.style.display = "";
  };

  const hide = (): void => {
    if (!visible) return;
    visible = false;
    container.style.display = "none";
    clear(active);
    curGroup = -1;
    curSize = 0;
    cancel();
  };

  // Scroll handler — hot path
  const update = (scroll: number): void => {
    if (groupCount === 0) { hide(); return; }
    if (scroll < offsets[0]!) { hide(); return; }

    // Binary search — pure array reads, no function calls
    let lo = 0, hi = groupCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (offsets[mid]! + sizes[mid]! <= scroll) lo = mid;
      else hi = mid - 1;
    }

    if (!visible) show();
    setCurrent(lo);

    // Push transition check
    const nxt = lo + 1;
    if (nxt < groupCount) {
      const dist = offsets[nxt]! - scroll;
      if (dist <= 0 && dist > -curSize) {
        if (nxtGroup !== nxt || !transitioning) {
          nxtGroup = nxt;
          fill(standby, nxt);
          transitioning = true;
        }
        applyPush(dist);
      } else if (dist <= -curSize) {
        if (transitioning) complete();
      } else {
        if (transitioning) cancel();
      }
    } else {
      if (transitioning) cancel();
    }
  };

  const refresh = (): void => {
    cacheGroups();
    const prev = curGroup;
    curGroup = -1;
    curSize = 0;
    if (prev >= 0) setCurrent(prev);
  };

  const destroy = (): void => {
    container.remove();
    curGroup = -1;
    curSize = 0;
    nxtGroup = -1;
    visible = false;
    transitioning = false;
  };

  container.style.display = "none";

  return { update, refresh, show, hide, destroy };
};
