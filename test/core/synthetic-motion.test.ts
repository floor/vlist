import { describe, expect, test } from "bun:test";
import type { MotionOptions } from "../../src/synthetic/motion";
import { createMotion, IDLE, INERTIA, ANIMATING, CANCELLED } from "../../src/synthetic/motion";

function setup(options: Partial<MotionOptions> = {}) {
  let max = 10_000;
  let completed = 0;
  const motion = createMotion({ getMax: () => max, reducedMotion: () => false, onFinish: () => completed++, ...options });
  motion.jump(500);
  return { motion, get completed() { return completed; }, setMax: (value: number) => { max = value; } };
}
function fling(motion: ReturnType<typeof createMotion>, direction = 1) {
  motion.begin(1, 100, 100, 0);
  motion.move(1, 100, 100 - 20 * direction, 16);
  motion.move(1, 100, 100 - 40 * direction, 32);
  motion.end(1, 40);
}
describe("RFC-014 standalone synthetic motion contract", () => {
  test("release direction is signed in both directions", () => {
    for (const sign of [1, -1]) {
      const { motion } = setup();
      fling(motion, sign);
      const released = motion.position;
      expect(motion.state).toBe(INERTIA);
      motion.tick(40); motion.tick(56);
      expect((motion.position - released) * sign).toBeGreaterThan(0);
    }
  });
  test("a reversal determines release direction, not the preceding fling", () => {
    const { motion } = setup();
    motion.begin(1, 0, 100, 0);
    motion.move(1, 0, 0, 16);
    motion.move(1, 0, 15, 32);
    motion.end(1, 40);
    expect(motion.velocity).toBeLessThan(0);
  });
  test("held release and cancelled gestures never seed inertia", () => {
    const { motion } = setup();
    motion.begin(1, 0, 100, 0); motion.move(1, 0, 50, 16); motion.end(1, 100);
    expect(motion.state).toBe(IDLE);
    motion.begin(2, 0, 100, 110); motion.move(2, 0, 50, 126);
    motion.cancel(); motion.end(2, 130);
    expect(motion.state).toBe(IDLE);
  });
  test("cross-axis intent releases ownership and cannot reacquire in the gesture", () => {
    const { motion } = setup();
    motion.begin(1, 0, 0, 0);
    expect(motion.move(1, 20, 2, 16)).toBe(false);
    expect(motion.state).toBe(CANCELLED);
    expect(motion.move(1, 20, 100, 32)).toBe(false);
    expect(motion.position).toBe(500);
  });
  test("horizontal mode uses x with the same signed sampling", () => {
    const { motion } = setup({ axis: "x" });
    motion.begin(1, 100, 0, 0);
    expect(motion.move(1, 50, 2, 16)).toBe(true);
    expect(motion.position).toBe(550);
  });
  test("unrelated pointer and multitouch cannot move or resume the owned gesture", () => {
    const { motion } = setup();
    motion.begin(1, 0, 100, 0);
    expect(motion.move(2, 0, 50, 16)).toBe(false);
    motion.begin(2, 0, 100, 20);
    expect(motion.move(1, 0, 20, 32)).toBe(false);
    motion.end(1, 40);
    expect(motion.active).toBe(false);
  });
  test("inertia integrates independently of frame cadence", () => {
    const a = setup().motion, b = setup().motion;
    fling(a); fling(b);
    a.tick(40); b.tick(40);
    for (let time = 48; time <= 200; time += 8) a.tick(time);
    for (let time = 56; time <= 200; time += 16) b.tick(time);
    expect(a.position).toBeCloseTo(b.position, 8);
  });
  test("bounds are hard stops and edge wheel is unconsumed", () => {
    const { motion } = setup();
    motion.jump(9990); fling(motion);
    motion.tick(56);
    expect(motion.position).toBe(10_000);
    expect(motion.active).toBe(false);
    expect(motion.by(100)).toBe(false);
    expect(motion.by(-100)).toBe(true);
  });
  test("new touch and external navigation stop previous animation", () => {
    const { motion } = setup();
    motion.smooth(1000); motion.tick(16);
    motion.begin(1, 0, 100, 20);
    const stopped = motion.position;
    motion.tick(36); expect(motion.position).toBe(stopped);
    motion.jump(2000);
    expect(motion.move(1, 0, 0, 50)).toBe(false);
    motion.end(1, 60); motion.tick(76);
    expect(motion.position).toBe(2000);
  });
  test("wheel interrupts inertia and smooth motion shares cancellation", () => {
    const { motion } = setup(); fling(motion);
    motion.by(20); const p = motion.position;
    motion.tick(56); expect(motion.position).toBe(p);
    motion.smooth(2000); motion.tick(76);
    motion.cancel(); const q = motion.position;
    motion.tick(92); expect(motion.position).toBe(q);
  });
  test("resize clamps and frame suspension completes smooth navigation", () => {
    const { motion, setMax } = setup(); fling(motion);
    setMax(100); motion.resize();
    expect(motion.position).toBe(100); expect(motion.active).toBe(false);
    motion.smooth(0); motion.tick(116); motion.tick(250);
    expect(motion.position).toBe(0); expect(motion.active).toBe(false);
  });
  test("a pause between inertia frames stops without jumping", () => {
    const { motion } = setup(); fling(motion);
    motion.tick(56); motion.tick(72);
    const before = motion.position;
    motion.tick(192);
    expect(motion.position).toBe(before);
    expect(motion.state).toBe(IDLE);
  });
  test("a delayed first inertia frame uses the frame clock, not release time", () => {
    const { motion } = setup(); fling(motion);
    const released = motion.position;
    motion.tick(160); // 120ms after release, but no frame-to-frame pause.
    expect(motion.state).toBe(INERTIA);
    expect(motion.position).toBe(released);
    motion.tick(176);
    expect(motion.position).toBeGreaterThan(released);
  });
  test("smooth navigation starts on its first animation frame", () => {
    const { motion } = setup();
    motion.smooth(1000);
    motion.tick(1000);
    expect(motion.state).toBe(ANIMATING);
    expect(motion.position).toBe(500);
    motion.tick(1016);
    expect(motion.position).toBeGreaterThan(500);
    expect(motion.position).toBeLessThan(1000);
  });
  test("paused smooth navigation invokes completion exactly once", () => {
    const sample = setup(), motion = sample.motion;
    motion.smooth(2000); motion.tick(100);
    motion.tick(250); motion.tick(266);
    expect(sample.completed).toBe(1);
    expect(motion.position).toBe(2000);
    motion.smooth(3000); motion.tick(300); motion.cancel(); motion.tick(500);
    expect(sample.completed).toBe(1);
  });
  test("dynamic targets and custom easing retain the existing smooth-scroll API", () => {
    const { motion } = setup(); let target = 1000;
    motion.smooth(() => target, 100, t => t);
    motion.tick(100); motion.tick(150); expect(motion.position).toBe(750);
    target = 2000; motion.tick(200); expect(motion.position).toBe(2000);
    expect(motion.active).toBe(false);
  });
  test("reduced motion changes apply to subsequent gestures", () => {
    let reduced = false;
    const { motion } = setup({ reducedMotion: () => reduced });
    fling(motion); expect(motion.active).toBe(true);
    motion.reset(); reduced = true;
    fling(motion); expect(motion.active).toBe(false);
    motion.smooth(2000); expect(motion.position).toBe(2000);
  });
  test("reduced motion disables inertia and interpolation", () => {
    const { motion } = setup({ reducedMotion: () => true }); fling(motion);
    expect(motion.active).toBe(false);
    motion.smooth(8000);
    expect(motion.position).toBe(8000); expect(motion.active).toBe(false);
  });
});
