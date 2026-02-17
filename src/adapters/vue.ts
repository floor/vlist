// src/adapters/vue.ts
/**
 * vlist/vue — Thin Vue 3 wrapper for vlist
 *
 * Provides a `useVList` composable that manages the vlist lifecycle
 * within Vue's composition API. The composable creates a vlist instance
 * on mount, syncs items reactively, and destroys on unmount.
 *
 * @packageDocumentation
 */

import {
  ref,
  shallowRef,
  onMounted,
  onBeforeUnmount,
  watch,
  isRef,
  unref,
  type Ref,
  type ShallowRef,
} from "vue";
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

/** Configuration for useVList (VListConfig without container) */
export type UseVListConfig<T extends VListItem = VListItem> = Omit<
  VListConfig<T>,
  "container"
>;

/** Accepted config input — plain object or reactive ref */
export type UseVListConfigInput<T extends VListItem = VListItem> =
  | UseVListConfig<T>
  | Ref<UseVListConfig<T>>;

/** Return value from the useVList composable */
export interface UseVListReturn<T extends VListItem = VListItem> {
  /**
   * Template ref to bind to your container element.
   *
   * ```vue
   * <template>
   *   <div ref="containerRef" style="height: 400px" />
   * </template>
   *
   * <script setup>
   * const { containerRef } = useVList(config);
   * </script>
   * ```
   */
  containerRef: Ref<HTMLElement | null>;

  /**
   * Shallow ref holding the underlying vlist instance.
   * Populated after mount, `null` before.
   *
   * ```vue
   * <script setup>
   * const { instance } = useVList(config);
   *
   * function jumpToTop() {
   *   instance.value?.scrollToIndex(0);
   * }
   * </script>
   * ```
   */
  instance: ShallowRef<VList<T> | null>;
}

// =============================================================================
// Composable
// =============================================================================

/**
 * Vue 3 composable for vlist integration.
 *
 * Creates a virtual list instance bound to a template ref.
 * The instance is created on mount and destroyed on unmount.
 * When items change (detected via `watch`), they are synced automatically.
 *
 * **Basic usage:**
 * ```vue
 * <template>
 *   <div ref="containerRef" style="height: 400px" />
 * </template>
 *
 * <script setup lang="ts">
 * import { useVList } from 'vlist/vue';
 * import { ref } from 'vue';
 *
 * const users = ref([
 *   { id: 1, name: 'Alice' },
 *   { id: 2, name: 'Bob' },
 * ]);
 *
 * const { containerRef, instance } = useVList({
 *   item: {
 *     height: 48,
 *     template: (user) => `<div class="user">${user.name}</div>`,
 *   },
 *   items: users.value,
 * });
 * </script>
 * ```
 *
 * **With reactive config (auto-syncs items):**
 * ```vue
 * <script setup lang="ts">
 * import { useVList } from 'vlist/vue';
 * import { computed, ref } from 'vue';
 *
 * const filter = ref('');
 * const allUsers = ref([...]);
 *
 * const config = computed(() => ({
 *   item: {
 *     height: 48,
 *     template: (user) => `<div>${user.name}</div>`,
 *   },
 *   items: allUsers.value.filter(u =>
 *     u.name.includes(filter.value)
 *   ),
 * }));
 *
 * const { containerRef, instance } = useVList(config);
 * </script>
 * ```
 *
 * **With adapter (async/infinite scroll):**
 * ```vue
 * <script setup lang="ts">
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
 * </script>
 * ```
 *
 * @param configInput - VList configuration (without `container`), plain or reactive
 * @returns containerRef and reactive instance ref
 */
export function useVList<T extends VListItem = VListItem>(
  configInput: UseVListConfigInput<T>,
): UseVListReturn<T> {
  const containerRef = ref<HTMLElement | null>(null);
  const instance = shallowRef<VList<T> | null>(null);

  // --- Lifecycle: create on mount, destroy on unmount ---

  onMounted(() => {
    const container = containerRef.value;
    if (!container) return;

    const config = unref(configInput);

    instance.value = createVList<T>({
      ...config,
      container,
    });
  });

  onBeforeUnmount(() => {
    instance.value?.destroy();
    instance.value = null;
  });

  // --- Sync items when config changes ---

  if (isRef(configInput)) {
    watch(
      () => (configInput as Ref<UseVListConfig<T>>).value.items,
      (items) => {
        if (instance.value && items) {
          instance.value.setItems(items);
        }
      },
    );
  }

  return {
    containerRef,
    instance,
  };
}

// =============================================================================
// Event Composable (optional convenience)
// =============================================================================

/**
 * Subscribe to a vlist event within Vue's lifecycle.
 * Automatically unsubscribes on unmount.
 *
 * ```vue
 * <script setup lang="ts">
 * import { useVList, useVListEvent } from 'vlist/vue';
 *
 * const { containerRef, instance } = useVList(config);
 *
 * useVListEvent(instance, 'selection:change', ({ selected }) => {
 *   console.log('Selected items:', selected);
 * });
 *
 * useVListEvent(instance, 'scroll', ({ scrollTop, direction }) => {
 *   console.log(`Scrolling ${direction} at ${scrollTop}px`);
 * });
 * </script>
 * ```
 *
 * @param instance - Shallow ref to the vlist instance (from useVList)
 * @param event - Event name
 * @param handler - Event handler
 */
export function useVListEvent<
  T extends VListItem,
  K extends keyof VListEvents<T>,
>(
  instance: ShallowRef<VList<T> | null>,
  event: K,
  handler: EventHandler<VListEvents<T>[K]>,
): void {
  let unsub: Unsubscribe | null = null;

  // Watch the instance ref — subscribe when it becomes available
  watch(
    instance,
    (vlist) => {
      // Clean up previous subscription
      if (unsub) {
        unsub();
        unsub = null;
      }

      // Subscribe to the new instance
      if (vlist) {
        unsub = vlist.on(event, handler);
      }
    },
    { immediate: true },
  );

  // Clean up on unmount
  onBeforeUnmount(() => {
    if (unsub) {
      unsub();
      unsub = null;
    }
  });
}
