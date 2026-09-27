/**
 * carousel() under `scroll.mode: "synthetic"` (RFC-015).
 *
 * A carousel brings its own engine: the runway (core/runway.ts), a native
 * scroller a few viewports long. With "synthetic" it runs the synthetic handler
 * instead, the same one the deprecated vlist/synthetic entry runs a carousel on:
 * at once when the driver is loaded, otherwise on the runway until the driver
 * arrives and then, in place, on the synthetic handler (core/switching.ts).
 */
import type { LogicalScrollConfig, LogicalScrollHandler } from "../../core/logical";
import { createRunwayHandler } from "../../core/runway";
import { createSwitchingHandler, type LogicalHandlerFactory } from "../../core/switching";

type Driver = typeof import("../../synthetic/driver");

/** Loaded once per page, by the first carousel that asks. */
let synthetic: LogicalHandlerFactory | null = null;

/** Load the synthetic driver; once it resolves, new carousels start synthetic. */
export const loadDriver = (): Promise<LogicalHandlerFactory> =>
  import("../../synthetic/driver").then((driver: Driver) =>
    (synthetic = driver.createSyntheticScrollHandler as LogicalHandlerFactory));

/** The engine a `scroll.mode: "synthetic"` carousel hands the core. */
export function startSyntheticCarousel(
  config: LogicalScrollConfig,
  onSynthetic: () => void,
  onError: (error: Error) => void,
): LogicalScrollHandler {
  if (!synthetic) return createSwitchingHandler(config, createRunwayHandler, loadDriver(), onSynthetic, onError);
  // Loaded already: synthetic from the first frame, as an "auto" list would be.
  onSynthetic();
  return synthetic(config);
}
