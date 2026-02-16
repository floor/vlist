// src/adapters/react.ts
/**
 * vlist/react — Thin React wrapper for vlist
 *
 * Provides a `useVList` hook that manages the vlist lifecycle
 * within React's component model. The hook creates a vlist instance
 * on mount, syncs items reactively, and destroys on unmount.
 *
 * @packageDocumentation
 */

import { useRef, useEffect, useCallback } from "react";
import { createVList } from "../vlist";
import type {
  VListConfig,
  VListItem,
  VList,
  VListEvents,
  EventHandler,
  Unsubscribe,
} from "../types";

// =============================================================================
// Types
// =============================================================================

/** Configuration for useVList (VListConfig without container) */
export type UseVListConfig<T extends VListItem = VListItem> = Omit<
  VListConfig<T>,
  "container"
>;

/** Return value from the useVList hook */
export interface UseVListReturn<T extends VListItem = VListItem> {
  /**
   * Ref to attach to your container element.
   *
   * ```tsx
   * const { containerRef } = useVList(config);
   * return <div ref={containerRef} style={{ height: 400 }} />;
   * ```
   */
  containerRef: React.RefObject<HTMLDivElement | null>;

  /**
   * Ref holding the underlying vlist instance.
   * Populated after mount, `null` before.
   *
   * Use `.current` to access vlist methods:
   * ```tsx
   * const handleJump = () => instanceRef.current?.scrollToIndex(100);
   * ```
   */
  instanceRef: React.RefObject<VList<T> | null>;

  /**
   * Stable helper to get the vlist instance (or null).
   * Convenient for inline usage without `.current`:
   * ```tsx
   * onClick={() => getInstance()?.scrollToIndex(0)}
   * ```
   */
  getInstance: () => VList<T> | null;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * React hook for vlist integration.
 *
 * Creates a virtual list instance bound to a container ref.
 * The instance is created on mount and destroyed on unmount.
 * When `config.items` changes (by reference), items are synced automatically.
 *
 * **Usage:**
 * ```tsx
 * import { useVList } from 'vlist/react';
 *
 * function UserList({ users }) {
 *   const { containerRef, instanceRef } = useVList({
 *     item: {
 *       height: 48,
 *       template: (user) => `<div class="user">${user.name}</div>`,
 *     },
 *     items: users,
 *     selection: { mode: 'single' },
 *   });
 *
 *   return (
 *     <div
 *       ref={containerRef}
 *       style={{ height: 400 }}
 *       onClick={() => {
 *         const selected = instanceRef.current?.getSelected();
 *         console.log('Selected:', selected);
 *       }}
 *     />
 *   );
 * }
 * ```
 *
 * **With adapter (async/infinite scroll):**
 * ```tsx
 * const { containerRef } = useVList({
 *   item: {
 *     height: 64,
 *     template: (item) => `<div>${item.title}</div>`,
 *   },
 *   adapter: {
 *     read: async ({ offset, limit }) => {
 *       const res = await fetch(`/api/items?offset=${offset}&limit=${limit}`);
 *       const data = await res.json();
 *       return { items: data.items, total: data.total };
 *     },
 *   },
 * });
 * ```
 *
 * @param config - VList configuration (without `container`)
 * @returns containerRef, instanceRef, and getInstance helper
 */
export function useVList<T extends VListItem = VListItem>(
  config: UseVListConfig<T>,
): UseVListReturn<T> {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<VList<T> | null>(null);

  // Keep a mutable ref to the latest config so the mount effect
  // always reads fresh values without re-running.
  const configRef = useRef(config);
  configRef.current = config;

  // Track whether we've mounted (to distinguish mount from item updates)
  const mountedRef = useRef(false);

  // --- Lifecycle: create on mount, destroy on unmount ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const instance = createVList<T>({
      ...configRef.current,
      container,
    });

    instanceRef.current = instance;
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      instance.destroy();
      instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Mount once — config changes are handled below

  // --- Sync items when they change by reference ---
  useEffect(() => {
    // Skip the initial mount (items are already passed to createVList)
    if (!mountedRef.current || !instanceRef.current) return;

    if (config.items) {
      instanceRef.current.setItems(config.items);
    }
  }, [config.items]);

  // --- Stable getInstance helper ---
  const getInstance = useCallback((): VList<T> | null => {
    return instanceRef.current;
  }, []);

  return {
    containerRef,
    instanceRef,
    getInstance,
  };
}

// =============================================================================
// Event Hook (optional convenience)
// =============================================================================

/**
 * Subscribe to a vlist event within React's lifecycle.
 * Automatically unsubscribes on unmount or when the handler changes.
 *
 * ```tsx
 * const { instanceRef } = useVList(config);
 *
 * useVListEvent(instanceRef, 'selection:change', ({ selected }) => {
 *   console.log('Selected items:', selected);
 * });
 *
 * useVListEvent(instanceRef, 'scroll', ({ scrollTop, direction }) => {
 *   console.log(`Scrolling ${direction} at ${scrollTop}px`);
 * });
 * ```
 *
 * @param instanceRef - Ref to the vlist instance (from useVList)
 * @param event - Event name
 * @param handler - Event handler
 */
export function useVListEvent<
  T extends VListItem,
  K extends keyof VListEvents<T>,
>(
  instanceRef: React.RefObject<VList<T> | null>,
  event: K,
  handler: EventHandler<VListEvents<T>[K]>,
): void {
  // Keep latest handler in a ref to avoid re-subscribing on every render
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;

    // Wrap so we always call the latest handler
    const wrappedHandler: EventHandler<VListEvents<T>[K]> = (payload) => {
      handlerRef.current(payload);
    };

    const unsub: Unsubscribe = instance.on(event, wrappedHandler);
    return unsub;
    // Re-subscribe if the instance or event name changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceRef.current, event]);
}
