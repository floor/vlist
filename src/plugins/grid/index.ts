/**
 * vlist - Grid Domain
 * 2D grid/card layout with virtualized rows
 */

// Builder Feature
export { withGrid, type GridFeatureConfig } from "./feature";

// Layout
export { createGridLayout } from "./layout";

// Renderer
export { createGridRenderer, type GridRenderer } from "./renderer";

// Types
export type { GridConfig, GridLayout, GridPosition, ItemRange } from "./types";
