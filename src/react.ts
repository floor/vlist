/**
 * vlist/react — React hooks, feature-first (#328).
 *
 * Features are passed explicitly, as with the vanilla builder, so an app only
 * bundles what it uses:
 *
 *   const { containerRef } = useVList({ items, item }, [grid({ columns: 4 })]);
 *
 * The core comes from the root entry (`import … from "vlist"` in the built
 * package), never a copy of its own.
 */
import { useRef, useEffect, useCallback, type RefObject } from "react";
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

/** `createVList`'s config without `container`: the hook owns the element. */
export type UseVListConfig<T extends VListItem = VListItem> = Omit<CreateVListConfig<T>, "container">;

export interface UseVListReturn<T extends VListItem = VListItem, P extends readonly VListPlugin<T, any>[] = VListPlugin<T>[]> {
  /** Attach to the element the list renders into. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** The list once mounted, with the methods its plugins add. */
  instanceRef: RefObject<(VList<T> & PluginMethods<P>) | null>;
  getInstance: () => (VList<T> & PluginMethods<P>) | null;
}

/**
 * A vlist in a React component. `plugins` are read at mount: changing them
 * means remounting (a `key`). `config.items` changes update the list.
 *
 * @param create Advanced: the factory that builds the list, `createVList` by
 * default. The deprecated vlist-react package passes its own.
 */
export function useVList<
  T extends VListItem = VListItem,
  const P extends readonly VListPlugin<T, any>[] = VListPlugin<T>[],
>(
  config: UseVListConfig<T>,
  plugins: P = [] as unknown as P,
  create: typeof createVList = createVList,
): UseVListReturn<T, P> {
  type Instance = VList<T> & PluginMethods<P>;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<Instance | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const pluginsRef = useRef(plugins);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const instance = create({ ...configRef.current, container }, pluginsRef.current as unknown as VListPlugin<T>[]) as Instance;
    instanceRef.current = instance;
    return () => {
      instance.destroy();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (instanceRef.current && config.items) instanceRef.current.setItems(config.items as T[]);
  }, [config.items]);

  const getInstance = useCallback((): Instance | null => instanceRef.current, []);

  return { containerRef, instanceRef, getInstance };
}

/**
 * Subscribe to a list event for the component's lifetime. After `useVList` in
 * the same component it subscribes at mount; in a child, whose effects run
 * before the parent's, on its first render once the list exists.
 */
export function useVListEvent<T extends VListItem, K extends keyof VListEvents<T>>(
  instanceRef: RefObject<VList<T> | null>,
  event: K,
  handler: EventHandler<VListEvents<T>[K]>,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    return instance.on(event, (payload) => handlerRef.current(payload));
    // `instanceRef.current` as a dependency is deliberate: a render that finds
    // a different list re-subscribes.
  }, [instanceRef.current, event]);
}
