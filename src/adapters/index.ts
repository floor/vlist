// src/adapters/index.ts
/**
 * vlist adapters — Framework integration wrappers
 *
 * Each adapter is exported from its own subpath for tree-shaking:
 *   - `vlist/react`  — React hook
 *   - `vlist/vue`    — Vue 3 composable
 *   - `vlist/svelte` — Svelte action
 *
 * This barrel file is NOT intended for direct import.
 * Import from the framework-specific subpath instead.
 *
 * @packageDocumentation
 */

// React adapter
export { useVList as useVListReact, useVListEvent } from "./react";
export type {
  UseVListConfig as UseVListConfigReact,
  UseVListReturn as UseVListReturnReact,
} from "./react";

// Vue adapter
export { useVList as useVListVue, useVListEvent as useVListEventVue } from "./vue";
export type {
  UseVListConfig as UseVListConfigVue,
  UseVListConfigInput as UseVListConfigInputVue,
  UseVListReturn as UseVListReturnVue,
} from "./vue";

// Svelte adapter
export { vlist, onVListEvent } from "./svelte";
export type {
  VListActionConfig,
  VListActionOptions,
  VListActionReturn,
  OnInstanceCallback,
} from "./svelte";
