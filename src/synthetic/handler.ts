/** RFC-014 input provider. No native main-axis scroll position writes. */
import type { BoundedScrollConfig, BoundedScrollHandler } from "../core/runway";
import { SCROLL_IDLE_TIMEOUT, SCROLL_EASING } from "../constants";
import { createMotion } from "./motion";

const touch = (e: PointerEvent): boolean => e.pointerType === "touch" || e.pointerType === "pen";
// Buttons (including input[type=button]) and links may start a drag.
function editing(target: Element): boolean {
  if (target.closest("textarea,select,[contenteditable]:not([contenteditable=false])")) return true;
  const input = target.closest("input");
  return !!input && /^(text|search|tel|url|email|password|number|range|date|datetime-local|month|week|time)$/.test(input.type);
}

export function createSyntheticScrollHandler(config: BoundedScrollConfig): BoundedScrollHandler {
  const { state, viewport, content, isX, onFrame, onIdle, mainAxisPadding } = config;
  const root = viewport.parentElement ?? viewport;
  const win = viewport.ownerDocument.defaultView!;
  const doc = viewport.ownerDocument;
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
  let max = 0, frame: number | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;
  let attached = false, refreshing = false;
  let previousSize = -1, previousCross = -1;
  let gesture: number | null = null, suppressed: number | null = null;
  let dragged = false, caught = false, blocked = false;
  let complete: (() => void) | undefined;
  let pendingKey: KeyboardEvent | null = null;
  const pointers = new Set<number>();
  const savedViewport = { overflowX: viewport.style.overflowX, overflowY: viewport.style.overflowY, touchAction: viewport.style.touchAction, overflowAnchor: viewport.style.overflowAnchor };
  const savedContent = { overflow: content.style.overflow, overflowAnchor: content.style.overflowAnchor };

  function commit(position: number): void {
    const previous = state.scrollPosition;
    state.prevScrollPosition = previous;
    state.scrollPosition = state.baseOffset = position;
    state.scrollDirection = position > previous ? 1 : position < previous ? -1 : 0;
    if (!refreshing) { onFrame(); scheduleIdle(); }
  }
  function scheduleIdle(): void {
    if (idle !== null) clearTimeout(idle);
    idle = setTimeout(() => {
      idle = null;
      if (motion.active || motion.state === "tracking" || motion.state === "axis-pending") return;
      state.scrollDirection = 0;
      onIdle();
    }, config.idleTimeout || SCROLL_IDLE_TIMEOUT);
  }
  function schedule(): void {
    if (attached && frame === null && motion.active) frame = requestAnimationFrame(tick);
  }
  function tick(time: number): void {
    frame = null;
    motion.tick(time);
    if (motion.active) schedule(); else scheduleIdle();
  }
  const motion = createMotion({
    axis: isX ? "x" : "y", getMax: () => max, reducedMotion: () => reduced.matches,
    onChange: commit,
    onEvent(type, detail) {
      if (type === "cancel") complete = undefined;
      if (detail.reason === "animation-end") {
        const callback = complete; complete = undefined; callback?.();
      }
    },
  });

  function cancelScroll(): void {
    complete = undefined;
    if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
    motion.cancel();
    if (attached) scheduleIdle();
  }
  function reset(): void {
    cancelScroll(); motion.reset();
    for (const id of pointers) if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
    pointers.clear();
    gesture = suppressed = null; dragged = caught = blocked = false;
    scheduleIdle();
  }
  function down(e: PointerEvent): void {
    if (!touch(e)) return;
    if (e.isPrimary) {
      if (pointers.size) reset();
      pointers.clear();
    }
    pointers.add(e.pointerId);
    if (pointers.size > 1) { blocked = true; cancelScroll(); return; }
    if (!(e.target instanceof Element) || editing(e.target)) { cancelScroll(); return; }
    gesture = e.pointerId; dragged = false; caught = motion.active; suppressed = null;
    cancelScroll();
    motion.begin(e.pointerId, e.clientX, e.clientY, e.timeStamp);
  }
  function outsideDown(e: PointerEvent): void {
    if (!touch(e) || (e.target instanceof Node && viewport.contains(e.target))) return;
    if (e.isPrimary) reset();
    else if (pointers.size) { pointers.add(e.pointerId); blocked = true; cancelScroll(); }
  }
  function move(e: PointerEvent): void {
    if (!touch(e) || blocked) return;
    if (motion.move(e.pointerId, e.clientX, e.clientY, e.timeStamp)) {
      dragged = true;
      if (!viewport.hasPointerCapture(e.pointerId)) viewport.setPointerCapture(e.pointerId);
      if (e.cancelable) e.preventDefault();
    }
  }
  function end(e: PointerEvent): void {
    if (!touch(e)) return;
    const cancelled = e.type === "pointercancel";
    if (cancelled) cancelScroll();
    if (gesture === e.pointerId) {
      if (!cancelled && !blocked && (dragged || caught)) suppressed = e.pointerId;
      gesture = null; dragged = caught = false;
    }
    motion.end(e.pointerId, e.timeStamp);
    pointers.delete(e.pointerId);
    if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
    if (!pointers.size) {
      if (blocked || cancelled) motion.reset();
      blocked = false;
    }
    // The first frame initializes inertia's frame clock. This intentionally
    // adds up to one frame of release latency; input delivery delay is not a pause.
    schedule(); scheduleIdle();
  }
  function click(e: MouseEvent): void {
    const id = (e as PointerEvent).pointerId;
    if (e.detail !== 0 && suppressed !== null && (id === suppressed || id === undefined)) {
      suppressed = null; e.preventDefault(); e.stopImmediatePropagation();
    }
  }
  function wheel(e: WheelEvent): void {
    if (e.ctrlKey || e.defaultPrevented || !(e.target instanceof Element) || editing(e.target)) return;
    const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? state.containerSize : 1;
    const along = isX ? e.deltaX : e.deltaY;
    const across = isX ? e.deltaY : e.deltaX;
    const overflow = isX ? viewport.scrollHeight > viewport.clientHeight : viewport.scrollWidth > viewport.clientWidth;
    // Preserve the bounded provider's native cross-axis branch, including the
    // cross component of diagonal wheel input when main-axis movement consumes it.
    if (overflow && Math.abs(across) > Math.abs(along)) return;
    if (overflow && across !== 0) {
      e.preventDefault();
      if (isX) viewport.scrollTop += across * factor;
      else viewport.scrollLeft += across * factor;
    }
    const delta = isX && !overflow && along === 0 ? across : along;
    cancelScroll();
    if (motion.by(delta * factor)) e.preventDefault();
    scheduleIdle();
  }
  function key(e: KeyboardEvent): void {
    if (e.currentTarget === viewport && root !== viewport) {
      pendingKey = e;
      const target = e.target;
      // Preserve native activation/editing before list-level keyboard plugins.
      if (target instanceof Element && (editing(target) ||
          ((e.key === " " || e.key === "Enter") && target.closest("button,summary,a,input")))) {
        pendingKey = null; e.stopPropagation();
      }
      return;
    }
    if (root !== viewport && pendingKey !== e) return;
    pendingKey = null;
    // Root plugins run first; their handled navigation must not scroll twice.
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !(e.target instanceof Element) || editing(e.target)) return;
    if ((e.key === " " || e.key === "Enter") && e.target.closest("button,summary,a,input")) return;
    const cache = config.sizeCache;
    const step = cache ? cache.getSize(cache.indexAtOffset(motion.position)) : state.visibleSizes[0] || 40;
    let position: number | undefined;
    if (e.key === (isX ? "ArrowRight" : "ArrowDown")) position = motion.position + step;
    if (e.key === (isX ? "ArrowLeft" : "ArrowUp")) position = motion.position - step;
    if (e.key === "PageDown" || e.key === " ") position = motion.position + state.containerSize * (e.shiftKey && e.key === " " ? -1 : 1);
    if (e.key === "PageUp") position = motion.position - state.containerSize;
    if (e.key === "Home") position = 0;
    if (e.key === "End") position = max;
    if (position !== undefined) { e.preventDefault(); setLogical(position); }
  }
  function hidden(): void { if (doc.hidden) reset(); }
  function setLogical(position: number): void {
    const previous = motion.position;
    cancelScroll(); motion.jump(position);
    // Even an unchanged jump completes the external navigation/idle contract.
    if (previous === motion.position) commit(motion.position);
  }
  function refresh(totalSize: number): void {
    const changed = totalSize !== state.totalSize || previousSize !== state.containerSize || previousCross !== state.crossSize;
    previousSize = state.containerSize; previousCross = state.crossSize;
    state.totalSize = totalSize;
    max = Math.max(0, totalSize + mainAxisPadding - state.containerSize);
    content.style[isX ? "width" : "height"] = `${state.containerSize}px`;
    if (changed) {
      refreshing = true;
      cancelScroll(); motion.resize(); commit(motion.position);
      refreshing = false;
    }
  }
  return {
    setLogical, refresh, cancelScroll,
    getLogical: () => state.scrollPosition,
    getMaxLogical: () => max,
    smoothScrollTo(target, duration, _setFn, easing = SCROLL_EASING, onComplete): void {
      cancelScroll();
      motion.smooth(target, duration, easing);
      complete = onComplete;
      if (!motion.active) { complete = undefined; onComplete?.(); scheduleIdle(); }
      else schedule();
    },
    attach(): void {
      if (attached) return;
      attached = true;
      viewport.style.overflowX = isX ? "hidden" : "auto";
      viewport.style.overflowY = isX ? "auto" : "hidden";
      viewport.style.touchAction = isX ? "pan-y pinch-zoom" : "pan-x pinch-zoom";
      viewport.style.overflowAnchor = "none";
      content.style.overflow = "clip"; content.style.overflowAnchor = "none";
      viewport.addEventListener("pointerdown", down);
      win.addEventListener("pointerdown", outsideDown);
      viewport.addEventListener("pointermove", move, { passive: false });
      win.addEventListener("pointerup", end);
      win.addEventListener("pointercancel", end);
      viewport.addEventListener("click", click, true);
      if (config.wheelEnabled) viewport.addEventListener("wheel", wheel, { passive: false });
      viewport.addEventListener("keydown", key);
      if (root !== viewport) root.addEventListener("keydown", key);
      win.addEventListener("blur", reset);
      doc.addEventListener("visibilitychange", hidden);
      reduced.addEventListener("change", reset);
      schedule();
    },
    detach(): void {
      attached = false; reset();
      if (idle !== null) { clearTimeout(idle); idle = null; }
      viewport.removeEventListener("pointerdown", down);
      win.removeEventListener("pointerdown", outsideDown);
      viewport.removeEventListener("pointermove", move);
      win.removeEventListener("pointerup", end);
      win.removeEventListener("pointercancel", end);
      viewport.removeEventListener("click", click, true);
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("keydown", key);
      if (root !== viewport) root.removeEventListener("keydown", key);
      win.removeEventListener("blur", reset);
      doc.removeEventListener("visibilitychange", hidden);
      reduced.removeEventListener("change", reset);
      Object.assign(viewport.style, savedViewport); Object.assign(content.style, savedContent);
    },
  };
}
