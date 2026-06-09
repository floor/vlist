/**
 * vlist v2 — Carousel Presets
 *
 * Registry-based preset system. Each preset is a `SlotConfigResolver`
 * registered by name. Built-in presets are pre-registered; users can
 * add or override presets via `registerPreset()`.
 *
 * Returning `null` from a resolver means "no layout engine" — the
 * plugin falls back to variable-width item rendering with default
 * textFade: "viewport".
 */

export type TextFade = "role" | "viewport" | "size";

export interface SlotConfig {
  slots: number[];
  focalSlot: number;
  textFade?: TextFade;
}

/** Config without a layout engine — just behavioral options. */
export interface NoEngineConfig {
  textFade?: TextFade;
}

/** What a preset resolver can return. */
export type PresetResult = SlotConfig | NoEngineConfig | null;

/** Resolves a variant name to a preset configuration. */
export type SlotConfigResolver = (containerSize: number, peek: number) => PresetResult;

// =============================================================================
// Registry
// =============================================================================

const presetRegistry = new Map<string, SlotConfigResolver>();

/** Register a named preset. Overwrites any existing preset with the same name. */
export function registerPreset(name: string, resolver: SlotConfigResolver): void {
  presetRegistry.set(name, resolver);
}

/** Get a preset resolver by name, or undefined if not registered. */
export function getPreset(name: string): SlotConfigResolver | undefined {
  return presetRegistry.get(name);
}

/** Resolve a named preset. Returns null if the name is unknown. */
export function resolvePreset(
  variant: string,
  containerSize: number,
  peek: number,
): PresetResult {
  const resolver = presetRegistry.get(variant);
  return resolver ? resolver(containerSize, peek) : null;
}

/** Type guard: does the result have a layout engine? */
export function hasSlots(result: PresetResult): result is SlotConfig {
  return result !== null && "slots" in result;
}

// =============================================================================
// Built-in preset resolvers
// =============================================================================

export const full: SlotConfigResolver = () => {
  return { slots: [1.0], focalSlot: 0 };
};

export const hero: SlotConfigResolver = (containerSize, peek) => {
  return {
    slots: [(containerSize - peek) / containerSize, peek / containerSize],
    focalSlot: 0,
  };
};

export const heroCenter: SlotConfigResolver = (containerSize, peek) => {
  return {
    slots: [
      peek / containerSize,
      (containerSize - 2 * peek) / containerSize,
      peek / containerSize,
    ],
    focalSlot: 1,
  };
};

export const multi: SlotConfigResolver = () => {
  const large = 0.4;
  const medium = 0.3;
  const small = 0.2;
  const tiny = 1 - large - medium - small;
  return { slots: [large, medium, small, tiny], focalSlot: 0 };
};

export const uncontained: SlotConfigResolver = (containerSize) => {
  const count = Math.max(2, Math.floor(containerSize / (containerSize * 0.33)));
  const ratio = 1 / count;
  return {
    slots: Array.from({ length: count }, () => ratio),
    focalSlot: 0,
    textFade: "size",
  };
};

// =============================================================================
// Register built-ins
// =============================================================================

registerPreset("full", full);
registerPreset("hero", hero);
registerPreset("hero-center", heroCenter);
registerPreset("multi", multi);
registerPreset("uncontained", uncontained);
