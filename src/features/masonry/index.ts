/**
 * vlist - Masonry Domain
 * Pinterest-style layout with shortest-lane placement
 */

// Builder Feature
export { withMasonry, type MasonryFeatureConfig } from "./feature";

// Layout
export { createMasonryLayout } from "./layout";

// Renderer
export { createMasonryRenderer, type MasonryRenderer, type GetItemFn } from "./renderer";

// Types
export type {
  MasonryConfig,
  MasonryLayout,
  MasonryPosition,
  ItemPlacement,
} from "./types";