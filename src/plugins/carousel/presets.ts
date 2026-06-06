/**
 * vlist v2 — Carousel Presets
 *
 * Each preset maps a variant name to a slot configuration
 * for the layout engine. Adding a new variant = adding a
 * new function to this file.
 */

export interface SlotConfig {
  slots: number[];
  focalSlot: number;
}

export function full(): SlotConfig {
  return { slots: [1.0], focalSlot: 0 };
}

export function hero(containerSize: number, peek: number): SlotConfig {
  return {
    slots: [(containerSize - peek) / containerSize, peek / containerSize],
    focalSlot: 0,
  };
}

export function heroCenter(containerSize: number, peek: number): SlotConfig {
  return {
    slots: [
      peek / containerSize,
      (containerSize - 2 * peek) / containerSize,
      peek / containerSize,
    ],
    focalSlot: 1,
  };
}

export function multi(): SlotConfig {
  const large = 0.4;
  const medium = 0.3;
  const small = 0.2;
  const tiny = 1 - large - medium - small;
  return { slots: [large, medium, small, tiny], focalSlot: 0 };
}

export function uncontained(containerSize: number): SlotConfig {
  const count = Math.max(2, Math.floor(containerSize / (containerSize * 0.33)));
  const ratio = 1 / count;
  return {
    slots: Array.from({ length: count }, () => ratio),
    focalSlot: 0,
  };
}

export function resolvePreset(
  variant: string,
  containerSize: number,
  peek: number,
): SlotConfig | null {
  switch (variant) {
    case "hero": return hero(containerSize, peek);
    case "hero-center": return heroCenter(containerSize, peek);
    case "multi": return multi();
    case "uncontained": return uncontained(containerSize);
    case "full": return full();
    case "static":
    default: return null;
  }
}
