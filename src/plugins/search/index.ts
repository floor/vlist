/**
 * vlist - Search Domain
 * Ready-to-use search bar with client-side filtering, match navigation,
 * and `<mark>` highlighting.
 */

export {
  search,
  DEFAULT_SEARCH_TEXT,
  type SearchPluginConfig,
  type SearchPluginInstance,
  type SearchText,
} from "./plugin";
export { makeGetText, type FieldAccessor } from "./match";
