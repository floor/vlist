/** RFC-014 signed motion model, ported from the reviewed standalone prototype. */
export type MotionState = "idle" | "axis-pending" | "tracking" | "inertia" | "animating" | "cancelled";
export interface MotionEvent { from?: MotionState; to?: MotionState; reason?: string; source?: string; }
export interface MotionOptions {
  getMax: () => number;
  onChange?: (position: number) => void;
  onEvent?: (type: string, detail: MotionEvent) => void;
  axis?: "x" | "y";
  reducedMotion?: boolean | (() => boolean);
}
export function createMotion({ getMax, onChange = () => {}, onEvent = () => {}, axis = "y", reducedMotion = false }: MotionOptions) {
  let position = 0;
  let state: MotionState = "idle";
  let pointer: number | null = null;
  let startMain = 0, startCross = 0, lastMain = 0, lastTime = 0;
  let velocity = 0;
  let frameTime: number | null = null;
  let animationStart = 0, animationFrom = 0, animationTo = 0;
  let duration = 400;
  let ease = (t: number): number => 1 - (1 - t) ** 3;
  let getTarget: () => number = () => animationTo;
  const prefersReduced = (): boolean => typeof reducedMotion === "function" ? reducedMotion() : reducedMotion;
  const friction = 0.006;
  const clamp = (value: number) => Math.max(0, Math.min(getMax(), value));
  const main = (x: number, y: number) => axis === "y" ? y : x;
  const cross = (x: number, y: number) => axis === "y" ? x : y;
  function transition(next: MotionState, reason: string) {
    if (state !== next) onEvent("state", { from: state, to: next, reason });
    state = next;
  }
  function commit(value: number) {
    const next = clamp(value);
    if (next !== position) { position = next; onChange(position); }
    return next !== value;
  }
  function cancel(reason = "cancel") {
    velocity = 0;
    transition(pointer === null ? "idle" : "cancelled", reason);
    onEvent("cancel", { reason });
  }
  function jump(value: number, reason = "programmatic") {
    cancel(reason);
    commit(value);
  }
  return {
    get position() { return position; },
    get state() { return state; },
    get velocity() { return velocity; },
    get active() { return state === "inertia" || state === "animating"; },
    begin(id: number, x: number, y: number, time: number) {
      if (pointer !== null) { cancel("multitouch"); return; }
      cancel("new-touch");
      pointer = id;
      startMain = lastMain = main(x, y);
      startCross = cross(x, y);
      lastTime = time;
      transition("axis-pending", "pointerdown");
    },
    move(id: number, x: number, y: number, time: number) {
      if (id !== pointer || (state !== "axis-pending" && state !== "tracking")) return false;
      const current = main(x, y);
      if (state === "axis-pending") {
        const along = Math.abs(current - startMain);
        const across = Math.abs(cross(x, y) - startCross);
        if (Math.max(along, across) < 6) return false;
        if (across > along * 1.2) { cancel("cross-axis"); return false; }
        if (along < across * 1.2) return false;
        transition("tracking", "axis-lock");
      }
      const delta = lastMain - current;
      const dt = time - lastTime;
      if (dt > 0) {
        const sample = Math.max(-3, Math.min(3, delta / dt));
        velocity = dt > 80 ? 0 : sample * velocity < 0 ? sample : 0.65 * sample + 0.35 * velocity;
      }
      lastMain = current;
      lastTime = time;
      if (commit(position + delta)) { velocity = 0; onEvent("boundary", { source: "touch" }); }
      return true;
    },
    end(id: number, time: number) {
      if (id !== pointer) return;
      pointer = null;
      if (state === "tracking" && !prefersReduced() && time - lastTime <= 80 && Math.abs(velocity) >= 0.02) {
        frameTime = null;
        transition("inertia", "release");
      } else { velocity = 0; transition("idle", "release"); }
    },
    cancel,
    reset(reason = "reset") { pointer = null; cancel(reason); },
    jump,
    by(delta: number, reason = "wheel") {
      cancel(reason);
      const previous = position;
      commit(position + delta);
      return position !== previous;
    },
    smooth(value: number | (() => number), milliseconds = 400, easing = (t: number): number => 1 - (1 - t) ** 3) {
      cancel("smooth-navigation");
      getTarget = typeof value === "function" ? value : () => value;
      if (pointer !== null || prefersReduced() || milliseconds <= 0) { commit(getTarget()); return; }
      duration = milliseconds;
      ease = easing;
      animationFrom = position;
      animationTo = clamp(getTarget());
      frameTime = null;
      transition("animating", "smooth-navigation");
    },
    resize() { cancel("resize"); commit(position); },
    tick(time: number) {
      if (state !== "inertia" && state !== "animating") return;
      // Input timestamps never seed this clock; pauses are between frames only.
      if (frameTime === null) {
        frameTime = time;
        if (state === "animating") animationStart = time;
        return;
      }
      const dt = time - frameTime;
      if (dt <= 0) return;
      frameTime = time;
      if (dt > 100) {
        if (state === "animating") {
          commit(clamp(getTarget()));
          transition("idle", "animation-end");
        } else cancel("frame-pause");
        return;
      }
      if (state === "animating") {
        animationTo = clamp(getTarget());
        const progress = Math.min(1, (time - animationStart) / duration);
        commit(animationFrom + (animationTo - animationFrom) * ease(progress));
        if (progress === 1) transition("idle", "animation-end");
        return;
      }
      const decay = Math.exp(-friction * dt);
      const hit = commit(position + velocity * (1 - decay) / friction);
      velocity *= decay;
      if (hit) onEvent("boundary", { source: "inertia" });
      if (hit || Math.abs(velocity) < 0.02) { velocity = 0; transition("idle", hit ? "boundary" : "settled"); }
    },
  };
}
