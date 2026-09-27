/**
 * A logical handler that becomes another, in place (RFC-015).
 *
 * It runs `first` until `load` delivers the factory of the next handler, then,
 * once `first` is idle (a gesture or fling in flight is never cut off),
 * detaches it, builds the next from the same config and moves the position
 * across. The core sees one handler throughout. A failed load leaves `first`
 * running and reports through `onError`. carousel() uses it under
 * `scroll.mode: "synthetic"`: its runway until the synthetic driver loads.
 * Only a plugin that asks imports it; the core does not.
 */
import type { LogicalScrollConfig, LogicalScrollHandler } from "./logical";

export type LogicalHandlerFactory = (config: LogicalScrollConfig) => LogicalScrollHandler;

export function createSwitchingHandler(
  config: LogicalScrollConfig,
  first: LogicalHandlerFactory,
  load: Promise<LogicalHandlerFactory>,
  onSwitch: () => void,
  onError: (error: Error) => void,
): LogicalScrollHandler {
  let attached = false;
  let totalSize: number | null = null;
  let moving = false;
  let waiting: LogicalHandlerFactory | null = null;
  // `first` reports its frames and idle through these: the switch waits for idle.
  let current = first({
    ...config,
    onFrame(): void { moving = true; config.onFrame(); },
    onIdle(): void {
      moving = false;
      config.onIdle();
      if (waiting) switchTo(waiting);
    },
  });

  const switchTo = (next: LogicalHandlerFactory): void => {
    waiting = null;
    // Destroyed before the next handler arrived.
    if (!attached) return;
    const position = config.state.scrollPosition;
    current.detach();
    config.viewport[config.isX ? "scrollLeft" : "scrollTop"] = 0;
    current = next(config);
    if (totalSize !== null) current.refresh(totalSize);
    current.attach();
    current.setLogical(position);
    onSwitch();
  };

  load.then((next) => {
    if (moving) waiting = next;
    else switchTo(next);
  }, onError);

  return {
    attach(): void { attached = true; current.attach(); },
    detach(): void { attached = false; current.detach(); },
    cancelScroll: () => current.cancelScroll(),
    smoothScrollTo: (...args) => current.smoothScrollTo(...args),
    setLogical: (position) => current.setLogical(position),
    getLogical: () => current.getLogical(),
    getMaxLogical: () => current.getMaxLogical(),
    refresh(size): void { totalSize = size; current.refresh(size); },
    shiftBy(delta): void {
      if (current.shiftBy) current.shiftBy(delta);
      else current.setLogical(config.state.scrollPosition + delta);
    },
  };
}
