// src/adapters/svelte.ts
/**
 * vlist/svelte — Thin Svelte wrapper for vlist
 *
 * Provides a `vlist` action that manages the vlist lifecycle
 * within Svelte's component model. The action creates a vlist instance
 * when the element mounts, syncs items on update, and destroys on unmount.
 *
 * Works with both Svelte 4 and Svelte 5 (actions are framework-stable).
 * No Svelte imports needed — actions are plain functions.
 *
 * @packageDocumentation
 */

import { createVList } from "../core/full";
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

/** Configuration for the vlist action (VListConfig without container) */
export type VListActionConfig<T extends VListItem = VListItem> = Omit<
  VListConfig<T>,
  "container"
>;

/**
 * Callback invoked once the vlist instance is ready.
 * Use this to subscribe to events, call methods, or store a reference.
 */
export type OnInstanceCallback<T extends VListItem = VListItem> = (
  instance: VList<T>,
) => void;

/** Full options passed to the vlist action */
export interface VListActionOptions<T extends VListItem = VListItem> {
  /** VList configuration (without container) */
  config: VListActionConfig<T>;

  /**
   * Called once the instance is created (on mount).
   * Use this to get a reference to the vlist instance for calling methods.
   *
   * ```svelte
   * <script>
   *   let vlistInstance;
   *   const options = {
   *     config: { ... },
   *     onInstance: (inst) => { vlistInstance = inst; },
   *   };
   * </script>
   * <div use:vlist={options} />
   * <button on:click={() => vlistInstance?.scrollToIndex(0)}>Top</button>
   * ```
   */
  onInstance?: OnInstanceCallback<T>;
}

/** Svelte action return type */
export interface VListActionReturn<T extends VListItem = VListItem> {
  /** Called by Svelte when the action parameter changes */
  update?: (newOptions: VListActionOptions<T>) => void;

  /** Called by Svelte when the element is removed from the DOM */
  destroy?: () => void;
}

// =============================================================================
// Action
// =============================================================================

/**
 * Svelte action for vlist integration.
 *
 * Attaches a virtual list to the target element. The list is created
 * when the element mounts and destroyed when it unmounts. Passing
 * new options via Svelte's reactivity triggers an update.
 *
 * **Basic usage:**
 * ```svelte
 * <script>
 *   import { vlist } from 'vlist/svelte';
 *
 *   const users = [
 *     { id: 1, name: 'Alice' },
 *     { id: 2, name: 'Bob' },
 *   ];
 *
 *   const options = {
 *     config: {
 *       item: {
 *         height: 48,
 *         template: (user) => `<div class="user">${user.name}</div>`,
 *       },
 *       items: users,
 *     },
 *   };
 * </script>
 *
 * <div use:vlist={options} style="height: 400px" />
 * ```
 *
 * **With instance access (for methods):**
 * ```svelte
 * <script>
 *   import { vlist } from 'vlist/svelte';
 *
 *   let instance;
 *
 *   const options = {
 *     config: {
 *       item: {
 *         height: 48,
 *         template: (item) => `<div>${item.name}</div>`,
 *       },
 *       items: users,
 *       selection: { mode: 'single' },
 *     },
 *     onInstance: (inst) => { instance = inst; },
 *   };
 *
 *   function jumpToTop() {
 *     instance?.scrollToIndex(0);
 *   }
 * </script>
 *
 * <div use:vlist={options} style="height: 400px" />
 * <button on:click={jumpToTop}>Jump to top</button>
 * ```
 *
 * **Reactive items (Svelte 4):**
 * ```svelte
 * <script>
 *   import { vlist } from 'vlist/svelte';
 *
 *   let users = [...];
 *
 *   // Svelte re-runs the action's update when this object changes
 *   $: options = {
 *     config: {
 *       item: { height: 48, template: (u) => `<div>${u.name}</div>` },
 *       items: users,
 *     },
 *   };
 * </script>
 *
 * <div use:vlist={options} style="height: 400px" />
 * ```
 *
 * **With adapter (async/infinite scroll):**
 * ```svelte
 * <script>
 *   import { vlist } from 'vlist/svelte';
 *
 *   const options = {
 *     config: {
 *       item: {
 *         height: 64,
 *         template: (item) => `<div>${item.title}</div>`,
 *       },
 *       adapter: {
 *         read: async ({ offset, limit }) => {
 *           const res = await fetch(`/api/items?offset=${offset}&limit=${limit}`);
 *           const data = await res.json();
 *           return { items: data.items, total: data.total };
 *         },
 *       },
 *     },
 *   };
 * </script>
 *
 * <div use:vlist={options} style="height: 400px" />
 * ```
 *
 * @param node - The DOM element Svelte binds the action to
 * @param options - Configuration and callbacks
 * @returns Action lifecycle object (update + destroy)
 */
export function vlist<T extends VListItem = VListItem>(
  node: HTMLElement,
  options: VListActionOptions<T>,
): VListActionReturn<T> {
  let instance: VList<T> = createVList<T>({
    ...options.config,
    container: node,
  });

  // Notify consumer of the instance
  if (options.onInstance) {
    options.onInstance(instance);
  }

  return {
    update(newOptions: VListActionOptions<T>) {
      // Sync items if they changed
      if (newOptions.config.items) {
        instance.setItems(newOptions.config.items);
      }

      // Notify consumer (instance ref is stable, but consumer may want to know)
      if (newOptions.onInstance) {
        newOptions.onInstance(instance);
      }
    },

    destroy() {
      instance.destroy();
    },
  };
}

// =============================================================================
// Event Helper
// =============================================================================

/**
 * Helper to subscribe to vlist events with automatic cleanup.
 * Returns an unsubscribe function.
 *
 * ```svelte
 * <script>
 *   import { vlist, onVListEvent } from 'vlist/svelte';
 *   import { onDestroy } from 'svelte';
 *
 *   let instance;
 *   let unsubs = [];
 *
 *   function handleInstance(inst) {
 *     instance = inst;
 *
 *     unsubs.push(
 *       onVListEvent(inst, 'selection:change', ({ selected }) => {
 *         console.log('Selected:', selected);
 *       })
 *     );
 *
 *     unsubs.push(
 *       onVListEvent(inst, 'scroll', ({ scrollTop, direction }) => {
 *         console.log(`Scrolling ${direction} at ${scrollTop}px`);
 *       })
 *     );
 *   }
 *
 *   onDestroy(() => unsubs.forEach(fn => fn()));
 * </script>
 *
 * <div use:vlist={{ config, onInstance: handleInstance }} />
 * ```
 *
 * @param instance - The vlist instance
 * @param event - Event name
 * @param handler - Event handler
 * @returns Unsubscribe function
 */
export function onVListEvent<
  T extends VListItem,
  K extends keyof VListEvents<T>,
>(
  instance: VList<T>,
  event: K,
  handler: EventHandler<VListEvents<T>[K]>,
): Unsubscribe {
  return instance.on(event, handler);
}
