export { carousel } from "./plugin";
export type { CarouselPluginConfig, CarouselVariant, CarouselDirection, CarouselState } from "./plugin";
export { createLayoutEngine } from "./engine";
export type { LayoutConfig, ItemLayout } from "./engine";
export { resolvePreset, registerPreset, getPreset, hasSlots, full, hero, heroCenter, multi, uncontained } from "./presets";
export type { SlotConfig, NoEngineConfig, PresetResult, SlotConfigResolver, TextFade } from "./presets";
