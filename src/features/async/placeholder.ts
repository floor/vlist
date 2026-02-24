/**
 * vlist - Placeholder System
 * Smart placeholder generation for loading states
 *
 * Key features:
 * - Captures per-item field lengths from the first loaded batch
 * - Cycles through real data profiles for natural size variance
 * - Same item template renders both real and placeholder items
 * - Renderer adds CSS class for visual styling (no JS branching needed)
 */

import type { VListItem } from "../../types";

import {
  PLACEHOLDER_FLAG,
  PLACEHOLDER_ID_PREFIX,
  DEFAULT_MASK_CHARACTER,
  DEFAULT_MAX_SAMPLE_SIZE,
} from "../../constants";

// =============================================================================
// Types
// =============================================================================

/** Placeholder configuration */
export interface PlaceholderConfig {
  /** Character used for masking text (default: 'x') */
  maskCharacter?: string;

  /** Maximum items to sample for length profiling (default: 20) */
  maxSampleSize?: number;
}

/**
 * Per-item length profile captured from a real data item.
 * Maps field name → character length of its string representation.
 */
interface LengthProfile {
  [field: string]: number;
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

  /** Clear analyzed structure */
  clear: () => void;
}

// =============================================================================
// Placeholder Manager
// =============================================================================

/**
 * Create a placeholder manager that generates realistic placeholder items
 * by capturing per-item field lengths from the first loaded data batch.
 *
 * Placeholders carry the same field names as real items, filled with
 * mask characters sized to match actual data. The renderer detects
 * placeholders via the `_isPlaceholder` flag and applies a CSS class
 * — no template branching required.
 */
export const createPlaceholderManager = <T extends VListItem = VListItem>(
  config: PlaceholderConfig = {},
): PlaceholderManager<T> => {
  const {
    maskCharacter = DEFAULT_MASK_CHARACTER,
    maxSampleSize = DEFAULT_MAX_SAMPLE_SIZE,
  } = config;

  // State
  let lengthProfiles: LengthProfile[] = [];
  let hasAnalyzed = false;
  let idCounter = 0;

  // ==========================================================================
  // Structure Analysis
  // ==========================================================================

  /**
   * Capture per-item field lengths from the first loaded batch.
   * Each sampled item produces one LengthProfile that records the
   * string length of every non-internal field. When generating
   * placeholder #N, we cycle through these profiles so that size
   * variance mirrors the real data distribution.
   */
  const analyzeStructure = (items: T[]): void => {
    if (hasAnalyzed || items.length === 0) return;

    const sampleSize = Math.min(items.length, maxSampleSize);

    for (let i = 0; i < sampleSize; i++) {
      const item = items[i];
      if (!item || typeof item !== "object") continue;

      const profile: LengthProfile = {};

      for (const [field, value] of Object.entries(item)) {
        // Skip internal fields and id
        if (field.startsWith("_") || field === "id") continue;

        profile[field] = String(value ?? "").length;
      }

      // Only store profiles that have at least one field —
      // id-only items produce empty profiles which aren't useful
      if (Object.keys(profile).length > 0) {
        lengthProfiles.push(profile);
      }
    }

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
   * Generate a single placeholder item.
   * Uses the length profile at `index % profiles.length` so each
   * placeholder has a unique but realistic field size distribution.
   */
  const generate = (index: number): T => {
    const placeholder: Record<string, unknown> = {
      id: `${PLACEHOLDER_ID_PREFIX}${idCounter++}`,
      [PLACEHOLDER_FLAG]: true,
      _index: index,
    };

    // No profiles yet — basic fallback
    if (lengthProfiles.length === 0) {
      placeholder.label = maskCharacter.repeat(12);
      return placeholder as T;
    }

    // Cycle through captured profiles
    const profile = lengthProfiles[index % lengthProfiles.length]!;

    for (const [field, length] of Object.entries(profile)) {
      placeholder[field] = maskCharacter.repeat(Math.max(1, length));
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
  // Lifecycle
  // ==========================================================================

  /**
   * Clear analyzed structure
   */
  const clear = (): void => {
    lengthProfiles = [];
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
    clear,
  };
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if an item is a placeholder
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