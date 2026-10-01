/**
 * vlist/svelte — a Svelte action, feature-first (#328). Works in Svelte 4 and 5.
 *
 *   <div use:vlist={{ config: { items, item }, plugins: [grid({ columns: 4 })] }} />
 *
 * Features are passed explicitly, so an app only bundles what it uses. The
 * core comes from the root entry, never a copy of its own.
 */
import { createVList } from "./index";
import type {
  CreateVListConfig,
  EventHandler,
  PluginMethods,
  Unsubscribe,
  VList,
  VListEvents,
  VListItem,
  VListPlugin,
} from "./index";

/** `createVList`'s config without `container`: the action owns the node. */
export type VListActionConfig<T extends VListItem = VListItem> = Omit<CreateVListConfig<T>, "container">;

export interface VListActionOptions<T extends VListItem = VListItem, P extends readonly VListPlugin<T, any>[] = VListPlugin<T>[]> {
  config: VListActionConfig<T>;
  /** Read when the action mounts: changing them means remounting. */
  plugins?: P;
  /** Receives the list once created, with the methods its plugins add. */
  onInstance?: (instance: VList<T> & PluginMethods<P>) => void;
  /** Advanced: the factory that builds the list, `createVList` by default. */
  create?: typeof createVList;
}

export interface VListActionReturn<T extends VListItem = VListItem, P extends readonly VListPlugin<T, any>[] = VListPlugin<T>[]> {
  update: (options: VListActionOptions<T, P>) => void;
  destroy: () => void;
}

/** A vlist on the node: `use:vlist={{ config, plugins }}`. `config.items` changes update it. */
export function vlist<
  T extends VListItem = VListItem,
  const P extends readonly VListPlugin<T, any>[] = VListPlugin<T>[],
>(node: HTMLElement, options: VListActionOptions<T, P>): VListActionReturn<T, P> {
  const create = options.create ?? createVList;
  const instance = create(
    { ...options.config, container: node },
    (options.plugins ?? []) as unknown as VListPlugin<T>[],
  ) as VList<T> & PluginMethods<P>;
  options.onInstance?.(instance);

  return {
    update(next) {
      if (next.config.items) instance.setItems(next.config.items as T[]);
    },
    destroy() {
      instance.destroy();
    },
  };
}

/** Subscribe to a list event; call the returned function to unsubscribe. */
export function onVListEvent<T extends VListItem, K extends keyof VListEvents<T>>(
  instance: VList<T>,
  event: K,
  handler: EventHandler<VListEvents<T>[K]>,
): Unsubscribe {
  return instance.on(event, handler);
}
