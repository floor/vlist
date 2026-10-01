/**
 * vlist/vue — Vue composables, feature-first (#328).
 *
 *   const { containerRef } = useVList({ items, item }, [grid({ columns: 4 })]);
 *
 * Features are passed explicitly, so an app only bundles what it uses. The
 * core comes from the root entry, never a copy of its own.
 */
import { ref, shallowRef, onMounted, onBeforeUnmount, watch, isRef, unref, type Ref, type ShallowRef } from "vue";
import { createVList } from "./index";
import type {
  CreateVListConfig,
  EventHandler,
  PluginMethods,
  VList,
  VListEvents,
  VListItem,
  VListPlugin,
} from "./index";

/** `createVList`'s config without `container`: the composable owns the element. */
export type UseVListConfig<T extends VListItem = VListItem> = Omit<CreateVListConfig<T>, "container">;

export interface UseVListReturn<T extends VListItem = VListItem, P extends readonly VListPlugin<T, any>[] = VListPlugin<T>[]> {
  /** Bind to the element the list renders into (`ref="containerRef"`). */
  containerRef: Ref<HTMLDivElement | null>;
  /** The list once mounted, with the methods its plugins add. */
  instance: ShallowRef<(VList<T> & PluginMethods<P>) | null>;
}

/**
 * A vlist in a component. `plugins` are read at mount. With a `Ref` config,
 * `items` changes update the list.
 *
 * @param create Advanced: the factory that builds the list, `createVList` by
 * default. The deprecated vlist-vue package passes its own.
 */
export function useVList<
  T extends VListItem = VListItem,
  const P extends readonly VListPlugin<T, any>[] = VListPlugin<T>[],
>(
  config: UseVListConfig<T> | Ref<UseVListConfig<T>>,
  plugins: P = [] as unknown as P,
  create: typeof createVList = createVList,
): UseVListReturn<T, P> {
  type Instance = VList<T> & PluginMethods<P>;
  const containerRef = ref<HTMLDivElement | null>(null);
  const instance: ShallowRef<Instance | null> = shallowRef(null);

  onMounted(() => {
    const container = containerRef.value;
    if (!container) return;
    instance.value = create({ ...unref(config), container }, plugins as unknown as VListPlugin<T>[]) as Instance;
  });

  onBeforeUnmount(() => {
    instance.value?.destroy();
    instance.value = null;
  });

  if (isRef(config)) {
    watch(
      () => config.value.items,
      (items) => {
        if (instance.value && items) instance.value.setItems(items as T[]);
      },
    );
  }

  return { containerRef, instance };
}

/** Subscribe to a list event for the component's lifetime. */
export function useVListEvent<T extends VListItem, K extends keyof VListEvents<T>>(
  instance: Ref<VList<T> | null> | ShallowRef<VList<T> | null>,
  event: K,
  handler: EventHandler<VListEvents<T>[K]>,
): void {
  let off: (() => void) | undefined;
  watch(
    () => instance.value,
    (list) => {
      off?.();
      off = list?.on(event, handler);
    },
    { immediate: true },
  );
  onBeforeUnmount(() => off?.());
}
