/**
 * vlist - Data Domain
 * Data management, sparse storage, and placeholder generation
 */

// Builder Plugin
export { withData, type DataPluginConfig } from "./plugin";

// Data Manager
export {
  createDataManager,
  mergeRanges,
  calculateMissingRanges,
  isPlaceholderItem,
  filterPlaceholders,
  countRealItems,
  type DataManager,
  type DataManagerConfig,
  type DataState,
} from "./manager";

// Sparse Storage
export {
  createSparseStorage,
  type SparseStorage,
  type SparseStorageConfig,
  type SparseStorageStats,
} from "./sparse";

// Placeholder
export {
  createPlaceholderManager,
  replacePlaceholders,
  type PlaceholderManager,
  type PlaceholderConfig,
} from "./placeholder";
