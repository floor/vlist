/**
 * vlist/solid — SolidJS primitives, feature-first (#328).
 *
 *   const { setRef } = createVList(() => ({ items, item }), [grid({ columns: 4 })]);
 *
 * `createVList` keeps the Solid primitive idiom and the vlist-solidjs name. In
 * a file that also uses the core builder, alias one of them:
 * `import { createVList as createSolidVList } from "vlist/solid"`.
 *
 * Features are passed explicitly, so an app only bundles what it uses. The
 * core comes from the root entry, never a copy of its own.
 */
import { onMount, onCleanup, createEffect, on, type Accessor } from "solid-js";
import { createVList as createCoreVList } from "./index";
import type {
  CreateVListConfig,
  EventHandler,
  PluginMethods,
  VList,
  VListEvents,
  VListItem,
  VListPlugin,
} from "./index";

/** `createVList`'s config without `container`: the primitive owns the element. */
export type CreateVListConfigInput<T extends VListItem = VListItem> = Omit<CreateVListConfig<T>, "container">;

export interface CreateVListReturn<T extends VListItem = VListItem, P extends readonly VListPlugin<T, any>[] = VListPlugin<T>[]> {
  /** Pass as `ref={setRef}` on the element the list renders into. */
  setRef: (el: HTMLDivElement) => void;
  /** The list once mounted, with the methods its plugins add. */
  instance: Accessor<(VList<T> & PluginMethods<P>) | null>;
}

/**
 * A vlist in a component. `plugins` are read at mount; `items` changes in the
 * config accessor update the list.
 *
 * @param create Advanced: the factory that builds the list, the core
 * `createVList` by default. The deprecated vlist-solidjs package passes its own.
 */
export function createVList<
  T extends VListItem = VListItem,
  const P extends readonly VListPlugin<T, any>[] = VListPlugin<T>[],
>(
  config: Accessor<CreateVListConfigInput<T>>,
  plugins: P = [] as unknown as P,
  create: typeof createCoreVList = createCoreVList,
): CreateVListReturn<T, P> {
  type Instance = VList<T> & PluginMethods<P>;
  let container: HTMLDivElement | null = null;
  let list: Instance | null = null;

  onMount(() => {
    if (!container) return;
    list = create({ ...config(), container }, plugins as unknown as VListPlugin<T>[]) as Instance;
  });

  createEffect(
    on(
      () => config().items,
      (items) => {
        if (list && items) list.setItems(items as T[]);
      },
    ),
  );

  onCleanup(() => {
    list?.destroy();
    list = null;
  });

  return {
    setRef: (el) => { container = el; },
    instance: () => list,
  };
}

/** Subscribe to a list event for the component's lifetime. */
export function createVListEvent<T extends VListItem, K extends keyof VListEvents<T>>(
  instance: Accessor<VList<T> | null>,
  event: K,
  handler: EventHandler<VListEvents<T>[K]>,
): void {
  onMount(() => {
    const list = instance();
    if (!list) return;
    const off = list.on(event, handler);
    onCleanup(off);
  });
}
