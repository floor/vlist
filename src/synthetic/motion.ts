/** RFC-014 signed motion model, ported from the reviewed standalone prototype. */
export const IDLE = 0, PENDING = 1, TRACKING = 2, INERTIA = 3, ANIMATING = 4, CANCELLED = 5;
export type MotionState = 0 | 1 | 2 | 3 | 4 | 5;
export interface MotionOptions {
  getMax: () => number;
  onChange?: (position: number) => void;
  onFinish?: () => void;
  axis?: "x" | "y";
  reducedMotion?: boolean | (() => boolean);
}
export function createMotion({ getMax, onChange = () => {}, onFinish, axis = "y", reducedMotion = false }: MotionOptions) {
  let position = 0;
  let state: MotionState = IDLE;
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
  function commit(value: number) {
    const next = clamp(value);
    if (next !== position) { position = next; onChange(position); }
    return next !== value;
  }
  function cancel() {
    velocity = 0;
    state = pointer === null ? IDLE : CANCELLED;
  }
  function jump(value: number) {
    cancel();
    commit(value);
  }
  return {
    get position() { return position; },
    get state() { return state; },
    get velocity() { return velocity; },
    get active() { return state === INERTIA || state === ANIMATING; },
    begin(id: number, x: number, y: number, time: number) {
      if (pointer !== null) { cancel(); return; }
      cancel();
      pointer = id;
      startMain = lastMain = main(x, y);
      startCross = cross(x, y);
      lastTime = time;
      state = PENDING;
    },
    move(id: number, x: number, y: number, time: number) {
      if (id !== pointer || (state !== PENDING && state !== TRACKING)) return false;
      const current = main(x, y);
      if (state === PENDING) {
        const along = Math.abs(current - startMain);
        const across = Math.abs(cross(x, y) - startCross);
        if (Math.max(along, across) < 6) return false;
        if (across > along * 1.2) { cancel(); return false; }
        if (along < across * 1.2) return false;
        state = TRACKING;
      }
      const delta = lastMain - current;
      const dt = time - lastTime;
      if (dt > 0) {
        const sample = Math.max(-3, Math.min(3, delta / dt));
        velocity = dt > 80 ? 0 : sample * velocity < 0 ? sample : 0.65 * sample + 0.35 * velocity;
      }
      lastMain = current;
      lastTime = time;
      if (commit(position + delta)) velocity = 0;
      return true;
    },
    end(id: number, time: number) {
      if (id !== pointer) return;
      pointer = null;
      if (state === TRACKING && !prefersReduced() && time - lastTime <= 80 && Math.abs(velocity) >= 0.02) {
        frameTime = null;
        state = INERTIA;
      } else { velocity = 0; state = IDLE; }
    },
    cancel,
    reset() { pointer = null; cancel(); },
    jump,
    by(delta: number) {
      cancel();
      const previous = position;
      commit(position + delta);
      return position !== previous;
    },
    smooth(value: number | (() => number), milliseconds = 400, easing = (t: number): number => 1 - (1 - t) ** 3) {
      cancel();
      getTarget = typeof value === "function" ? value : () => value;
      if (pointer !== null || prefersReduced() || milliseconds <= 0) { commit(getTarget()); return; }
      duration = milliseconds;
      ease = easing;
      animationFrom = position;
      animationTo = clamp(getTarget());
      frameTime = null;
      state = ANIMATING;
    },
    resize() { cancel(); commit(position); },
    tick(time: number) {
      if (state !== INERTIA && state !== ANIMATING) return;
      // Input timestamps never seed this clock; pauses are between frames only.
      if (frameTime === null) {
        frameTime = time;
        if (state === ANIMATING) animationStart = time;
        return;
      }
      const dt = time - frameTime;
      if (dt <= 0) return;
      frameTime = time;
      if (dt > 100) {
        if (state === ANIMATING) {
          commit(clamp(getTarget()));
          state = IDLE; onFinish?.();
        } else cancel();
        return;
      }
      if (state === ANIMATING) {
        animationTo = clamp(getTarget());
        const progress = Math.min(1, (time - animationStart) / duration);
        commit(animationFrom + (animationTo - animationFrom) * ease(progress));
        if (progress === 1) { state = IDLE; onFinish?.(); }
        return;
      }
      const decay = Math.exp(-friction * dt);
      const hit = commit(position + velocity * (1 - decay) / friction);
      velocity *= decay;
      if (hit || Math.abs(velocity) < 0.02) { velocity = 0; state = IDLE; }
    },
  };
}
