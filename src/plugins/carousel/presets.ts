/**
 * vlist v2 — Carousel Presets
 *
 * Registry-based preset system. Each preset is a `SlotConfigResolver`
 * registered by name. Built-in presets are pre-registered; users can
 * add or override presets via `registerPreset()`.
 *
 * Returning `null` from a resolver means "no layout engine" — the
 * plugin falls back to variable-width item rendering.
 */

export interface SlotConfig {
  slots: number[];
  focalSlot: number;
}

/** Resolves a variant name to a slot configuration (or null for no-engine mode). */
export type SlotConfigResolver = (containerSize: number, peek: number) => SlotConfig | null;

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

/** Resolve a named preset to a SlotConfig. Returns null if the name is unknown or the resolver returns null. */
export function resolvePreset(
  variant: string,
  containerSize: number,
  peek: number,
): SlotConfig | null {
  const resolver = presetRegistry.get(variant);
  return resolver ? resolver(containerSize, peek) : null;
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
