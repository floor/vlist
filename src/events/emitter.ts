/**
 * vlist - Event Emitter
 * Lightweight, type-safe event system
 */

import type { EventHandler, Unsubscribe, EventMap } from "../types";

/** Internal listener storage */
type Listeners<T extends EventMap> = {
  [K in keyof T]?: Set<EventHandler<T[K]>>;
};

// =============================================================================
// Event Emitter
// =============================================================================

/**
 * Create a type-safe event emitter
 * Functional approach - returns an object with methods
 */
export const createEmitter = <T extends EventMap>() => {
  const listeners: Listeners<T> = {};

  /**
   * Subscribe to an event
   */
  const on = <K extends keyof T>(
    event: K,
    handler: EventHandler<T[K]>,
  ): Unsubscribe => {
    if (!listeners[event]) {
      listeners[event] = new Set();
    }
    listeners[event]!.add(handler);

    // Return unsubscribe function
    return () => off(event, handler);
  };

  /**
   * Unsubscribe from an event
   */
  const off = <K extends keyof T>(
    event: K,
    handler: EventHandler<T[K]>,
  ): void => {
    listeners[event]?.delete(handler);
  };

  /**
   * Emit an event to all subscribers
   */
  const emit = <K extends keyof T>(event: K, payload: T[K]): void => {
    listeners[event]?.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        console.error(
          `[vlist] Error in event handler for "${String(event)}":`,
          error,
        );
      }
    });
  };

  /**
   * Remove all listeners for an event (or all events if no event specified)
   */
  const clear = <K extends keyof T>(event?: K): void => {
    if (event) {
      delete listeners[event];
    } else {
      for (const key in listeners) {
        delete listeners[key];
      }
    }
  };

  return { on, off, emit, clear };
};

/** Event emitter type */
export type Emitter<T extends EventMap> = ReturnType<typeof createEmitter<T>>;
