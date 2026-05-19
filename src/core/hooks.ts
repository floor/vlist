/**
 * vlist v2 — Build-Time Compiled Hooks
 *
 * Hooks are collected during createVList() and frozen into plain arrays.
 * On the hot path they are iterated with a for-loop — no closures,
 * no dynamic dispatch, no allocation.
 */

import type {
  CalculateHook,
  CommitHook,
  AfterScrollHook,
  IdleHook,
  ResizeHook,
  CompiledHooks,
  VListPlugin,
} from "./types";
import type { VListItem } from "../types";

// =============================================================================
// Compiler — collects hooks from plugins, returns frozen arrays
// =============================================================================

export function compileHooks<T extends VListItem>(plugins: readonly VListPlugin<T>[]): CompiledHooks {
  const calculate: CalculateHook[] = [];
  const commit: CommitHook[] = [];
  const afterScroll: AfterScrollHook[] = [];
  const idle: IdleHook[] = [];
  const resize: ResizeHook[] = [];

  for (let i = 0; i < plugins.length; i++) {
    const h = plugins[i]!.hooks;
    if (h === undefined) continue;
    if (h.onCalculate !== undefined) calculate.push(h.onCalculate);
    if (h.onCommit !== undefined) commit.push(h.onCommit);
    if (h.onAfterScroll !== undefined) afterScroll.push(h.onAfterScroll);
    if (h.onIdle !== undefined) idle.push(h.onIdle);
    if (h.onResize !== undefined) resize.push(h.onResize);
  }

  return { calculate, commit, afterScroll, idle, resize };
}

// =============================================================================
// Runners — zero allocation, linear iteration
// =============================================================================

export function runCalculateHooks(hooks: readonly CalculateHook[], state: import("./state").EngineState): void {
  for (let i = 0; i < hooks.length; i++) {
    hooks[i]!(state);
  }
}

export function runCommitHooks(hooks: readonly CommitHook[], state: import("./state").EngineState): void {
  for (let i = 0; i < hooks.length; i++) {
    hooks[i]!(state);
  }
}

export function runAfterScrollHooks(hooks: readonly AfterScrollHook[], scrollPosition: number, direction: number): void {
  for (let i = 0; i < hooks.length; i++) {
    hooks[i]!(scrollPosition, direction);
  }
}

export function runIdleHooks(hooks: readonly IdleHook[]): void {
  for (let i = 0; i < hooks.length; i++) {
    hooks[i]!();
  }
}

export function runResizeHooks(hooks: readonly ResizeHook[], width: number, height: number): void {
  for (let i = 0; i < hooks.length; i++) {
    hooks[i]!(width, height);
  }
}
