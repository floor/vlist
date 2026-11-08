/**
 * vlist — Table features
 *
 * A feature is mounted only by `table({ features })`. `table()` calls
 * `attach` once, in array order, before it returns the plugin. Hook
 * functions are copied after that return, so a feature wraps
 * `plugin.hooks` here and does its own work from the wrapped `plugin.setup`,
 * where the context and the layout both exist. A feature reads another
 * feature's hooks when it uses them.
 */

import type { VListItem } from "../../types";
import type { VListPlugin } from "../../core/types";

export interface TableFeature<T extends VListItem = VListItem, M = object> {
  /** Feature name. */
  name: string;
  /**
   * Wrap the table plugin before its hooks are compiled. Call the previous
   * `plugin.setup` first, then read `_getTableLayout()` for the live layout.
   */
  attach(plugin: VListPlugin<T>): void;
  /** Phantom: methods this feature adds to the list. Never set at runtime. */
  readonly __methods?: M;
}

type DefinedMethods<M> = Exclude<M, undefined> extends infer E
  ? [E] extends [object]
    ? E
    : object
  : object;

type MethodsOf<F> = F extends readonly []
  ? object
  : F extends readonly [infer Head, ...infer Rest]
    ? (Head extends { readonly __methods?: infer M } ? DefinedMethods<M> : object) & MethodsOf<Rest>
    : object;

/** Methods added by the features array, in order. An omitted array adds none. */
export type TableFeatureMethods<F> = MethodsOf<F>;
