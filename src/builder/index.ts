/**
 * vlist/builder - Composable Virtual List Builder
 * Pick only the features you need, pay only for what you ship.
 *
 * @example
 * ```ts
 * import { vlist } from 'vlist/builder'
 * import { withSelection } from 'vlist/selection'
 * import { withScrollbar } from 'vlist/scroll'
 *
 * const list = vlist({
 *   container: '#app',
 *   item: { height: 48, template: renderItem },
 *   items: data,
 * })
 * .use(withSelection({ mode: 'multiple' }))
 * .use(withScrollbar())
 * .build()
 * ```
 *
 * @packageDocumentation
 */

// Builder factory
export { vlist } from "./core";

// Types
export type {
  // Builder API
  VListBuilder,
  BuiltVList,
  BuilderConfig,

  // Plugin system
  VListPlugin,
  BuilderContext,

  // Internal (for plugin authors)
  ResolvedBuilderConfig,
  BuilderState,
  CachedCompression,
} from "./types";
