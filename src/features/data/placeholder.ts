/**
 * vlist - Placeholder System
 * Smart placeholder generation for loading states
 *
 * Key features:
 * - Analyzes loaded data to generate realistic placeholders
 * - Supports masked text with configurable character
 * - Random length variance for natural appearance
 * - Efficient placeholder detection
 */

import type { VListItem } from "../../types";

// =============================================================================
// Types
// =============================================================================

/** Placeholder configuration */
export interface PlaceholderConfig {
  /** Enable placeholder generation (default: true) */
  enabled?: boolean;

  /** Character used for masking text (default: '█') */
  maskCharacter?: string;

  /** Add random variance to text lengths (default: true) */
  randomVariance?: boolean;

  /** Maximum items to sample for structure analysis (default: 20) */
  maxSampleSize?: number;

  /** Custom placeholder generator */
  customGenerator?: (index: number) => VListItem;
}

/** Field structure detected from data */
interface FieldStructure {
  /** Minimum length observed */
  minLength: number;

  /** Maximum length observed */
  maxLength: number;

  /** Average length observed */
  avgLength: number;

  /** Field type detected */
  type: "string" | "number" | "boolean" | "object" | "array";
}

/** Placeholder manager instance */
export interface PlaceholderManager<T extends VListItem = VListItem> {
  /** Analyze data structure from sample items */
  analyzeStructure: (items: T[]) => void;

  /** Check if structure has been analyzed */
  hasAnalyzedStructure: () => boolean;

  /** Generate a single placeholder item */
  generate: (index: number) => T;

  /** Generate multiple placeholder items */
  generateRange: (start: number, end: number) => T[];

  /** Check if an item is a placeholder */
  isPlaceholder: (item: unknown) => boolean;

  /** Get the placeholder flag key */
  getPlaceholderKey: () => string;

  /** Clear analyzed structure */
  clear: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MASK_CHARACTER = "█";
const DEFAULT_MAX_SAMPLE_SIZE = 20;
const PLACEHOLDER_FLAG = "_isPlaceholder";
const PLACEHOLDER_ID_PREFIX = "__placeholder_";

// =============================================================================
// Placeholder Manager
// =============================================================================

/**
 * Create a placeholder manager
 */
export const createPlaceholderManager = <T extends VListItem = VListItem>(
  config: PlaceholderConfig = {},
): PlaceholderManager<T> => {
  const {
    enabled = true,
    maskCharacter = DEFAULT_MASK_CHARACTER,
    randomVariance = true,
    maxSampleSize = DEFAULT_MAX_SAMPLE_SIZE,
    customGenerator,
  } = config;

  // State
  let fieldStructures: Map<string, FieldStructure> | null = null;
  let hasAnalyzed = false;
  let idCounter = 0;

  // ==========================================================================
  // Structure Analysis
  // ==========================================================================

  /**
   * Analyze data structure from sample items
   */
  const analyzeStructure = (items: T[]): void => {
    if (!enabled || hasAnalyzed || items.length === 0) {
      return;
    }

    const structures = new Map<string, FieldStructure>();
    const fieldStats = new Map<
      string,
      { lengths: number[]; types: Set<string> }
    >();

    // Sample items for analysis
    const sampleSize = Math.min(items.length, maxSampleSize);

    for (let i = 0; i < sampleSize; i++) {
      const item = items[i];
      if (!item || typeof item !== "object") continue;

      // Analyze each field
      for (const [field, value] of Object.entries(item)) {
        // Skip internal fields
        if (field.startsWith("_") || field === "id") {
          continue;
        }

        if (!fieldStats.has(field)) {
          fieldStats.set(field, { lengths: [], types: new Set() });
        }

        const stats = fieldStats.get(field)!;
        const valueType = Array.isArray(value) ? "array" : typeof value;
        stats.types.add(valueType);

        // Track string lengths
        if (typeof value === "string") {
          stats.lengths.push(value.length);
        } else if (value !== null && value !== undefined) {
          stats.lengths.push(String(value).length);
        }
      }
    }

    // Calculate statistics for each field
    for (const [field, stats] of fieldStats) {
      if (stats.lengths.length === 0) continue;

      const minLength = Math.min(...stats.lengths);
      const maxLength = Math.max(...stats.lengths);
      const avgLength = Math.round(
        stats.lengths.reduce((sum, len) => sum + len, 0) / stats.lengths.length,
      );

      // Determine primary type
      let primaryType: FieldStructure["type"] = "string";
      if (stats.types.has("number") && stats.types.size === 1) {
        primaryType = "number";
      } else if (stats.types.has("boolean") && stats.types.size === 1) {
        primaryType = "boolean";
      } else if (stats.types.has("array")) {
        primaryType = "array";
      } else if (stats.types.has("object") && !stats.types.has("string")) {
        primaryType = "object";
      }

      structures.set(field, {
        minLength,
        maxLength,
        avgLength,
        type: primaryType,
      });
    }

    fieldStructures = structures;
    hasAnalyzed = true;
  };

  /**
   * Check if structure has been analyzed
   */
  const hasAnalyzedStructure = (): boolean => hasAnalyzed;

  // ==========================================================================
  // Placeholder Generation
  // ==========================================================================

  /**
   * Generate masked text with optional variance
   */
  const generateMaskedText = (structure: FieldStructure): string => {
    let length = structure.avgLength;

    if (randomVariance && structure.minLength !== structure.maxLength) {
      // Random length within range
      length = Math.floor(
        Math.random() * (structure.maxLength - structure.minLength + 1) +
          structure.minLength,
      );

      // Add slight additional variance
      if (Math.random() < 0.3) {
        length = Math.max(1, length + Math.floor(Math.random() * 3) - 1);
      }
    }

    return maskCharacter.repeat(Math.max(1, length));
  };

  /**
   * Generate a single placeholder item
   */
  const generate = (index: number): T => {
    // Use custom generator if provided
    if (customGenerator) {
      const item = customGenerator(index);
      return {
        ...item,
        [PLACEHOLDER_FLAG]: true,
      } as unknown as T;
    }

    // Create base placeholder
    const placeholder: Record<string, unknown> = {
      id: `${PLACEHOLDER_ID_PREFIX}${idCounter++}`,
      [PLACEHOLDER_FLAG]: true,
      _index: index,
    };

    // If no structure analyzed, create basic placeholder
    if (!fieldStructures || fieldStructures.size === 0) {
      placeholder.label = maskCharacter.repeat(12);
      return placeholder as T;
    }

    // Generate fields based on analyzed structure
    for (const [field, structure] of fieldStructures) {
      switch (structure.type) {
        case "string":
          placeholder[field] = generateMaskedText(structure);
          break;
        case "number":
          placeholder[field] = 0;
          break;
        case "boolean":
          placeholder[field] = false;
          break;
        case "array":
          placeholder[field] = [];
          break;
        case "object":
          placeholder[field] = {};
          break;
        default:
          placeholder[field] = generateMaskedText(structure);
      }
    }

    return placeholder as T;
  };

  /**
   * Generate multiple placeholder items
   */
  const generateRange = (start: number, end: number): T[] => {
    const items: T[] = [];

    for (let i = start; i <= end; i++) {
      items.push(generate(i));
    }

    return items;
  };

  // ==========================================================================
  // Detection
  // ==========================================================================

  /**
   * Check if an item is a placeholder
   */
  const isPlaceholder = (item: unknown): boolean => {
    if (!item || typeof item !== "object") {
      return false;
    }

    return (item as Record<string, unknown>)[PLACEHOLDER_FLAG] === true;
  };

  /**
   * Get the placeholder flag key
   */
  const getPlaceholderKey = (): string => PLACEHOLDER_FLAG;

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Clear analyzed structure
   */
  const clear = (): void => {
    fieldStructures = null;
    hasAnalyzed = false;
    idCounter = 0;
  };

  // ==========================================================================
  // Return Public API
  // ==========================================================================

  return {
    analyzeStructure,
    hasAnalyzedStructure,
    generate,
    generateRange,
    isPlaceholder,
    getPlaceholderKey,
    clear,
  };
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if an item is a placeholder (standalone function)
 */
export const isPlaceholderItem = (item: unknown): boolean => {
  if (!item || typeof item !== "object") {
    return false;
  }

  return (item as Record<string, unknown>)[PLACEHOLDER_FLAG] === true;
};

/**
 * Filter out placeholder items from an array
 */
export const filterPlaceholders = <T extends VListItem>(items: T[]): T[] => {
  return items.filter((item) => !isPlaceholderItem(item));
};

/**
 * Count non-placeholder items in an array
 */
export const countRealItems = <T extends VListItem>(
  items: (T | undefined)[],
): number => {
  let count = 0;

  for (const item of items) {
    if (item !== undefined && !isPlaceholderItem(item)) {
      count++;
    }
  }

  return count;
};

/**
 * Replace placeholders in a sparse array with real items
 */
export const replacePlaceholders = <T extends VListItem>(
  target: (T | undefined)[],
  items: T[],
  offset: number,
): number => {
  let replacedCount = 0;

  for (let i = 0; i < items.length; i++) {
    const targetIndex = offset + i;
    const currentItem = target[targetIndex];

    // Only replace if current is placeholder or undefined
    if (currentItem === undefined || isPlaceholderItem(currentItem)) {
      target[targetIndex] = items[i];
      if (isPlaceholderItem(currentItem)) {
        replacedCount++;
      }
    }
  }

  return replacedCount;
};
