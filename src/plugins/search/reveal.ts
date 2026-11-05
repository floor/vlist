/**
 * vlist — searchReveal()
 *
 * Opt-in companion to `search()`. A letter or number typed on the list shows
 * the bar with that character already in the field. Absent, `search()` behaves
 * as it does today. The module is separate so a bundle that imports only
 * `search` does not pay for it.
 */

import type { VListItem } from "../../types";
import type { VListPlugin, PluginContext } from "../../core/types";

/** Consumer-facing label for the button that hides the bar. */
export interface SearchRevealText {
  /** Accessible name for the X button. Default "Close search". */
  close?: string;
}

export interface SearchRevealConfig {
  /** Accessible name for the hide button. Falls back to English. */
  text?: SearchRevealText;
}

const CLOSE_LABEL = "Close search";
/** One letter or number, any script. Symbols and space are not a trigger. */
const CHAR = /[\p{L}\p{N}]/u;

const isField = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

/**
 * A typed character opens the bar. Ctrl or Cmd alone is a shortcut.
 * Alt is not: on a Mac, Option sets `altKey` and puts the produced character
 * in `key`. AltGr-style Ctrl+Alt is kept when that character is a letter or
 * number; a Ctrl shortcut without Alt is not.
 */
const isRevealKey = (event: KeyboardEvent): boolean => {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return false;
  if (event.metaKey || (event.ctrlKey && !event.altKey)) return false;
  if (event.key.length !== 1 || !CHAR.test(event.key)) return false;
  return !isField(event.target);
};

const focusNode = (node: HTMLElement): void => {
  node.focus({ preventScroll: true });
};

/**
 * Show the search bar when the user types a letter or number.
 * Requires `search()` with `position: "top"` or `"bottom"`.
 */
export function searchReveal<T extends VListItem = VListItem>(
  config: SearchRevealConfig = {},
): VListPlugin<T> {
  const closeLabel = config.text?.close ?? CLOSE_LABEL;

  return {
    name: "searchReveal",
    priority: 56,

    setup(ctx: PluginContext<T>): void {
      const prefix = ctx.config.classPrefix;
      const hiddenClass = `${prefix}-search--hidden`;
      const bar = ctx.dom.root.querySelector<HTMLElement>(`.${prefix}-search--bar`);
      const input = bar?.querySelector<HTMLInputElement>(`.${prefix}-search__input`) ?? null;
      const openSearch = ctx.hooks.get("openSearch") as (() => void) | undefined;
      const closeSearch = ctx.hooks.get("closeSearch") as (() => void) | undefined;
      const setQuery = ctx.hooks.get("setQuery") as ((query: string) => void) | undefined;
      if (!bar || !input || !openSearch || !closeSearch || !setQuery) {
        throw new Error("[vlist] searchReveal: requires search() with a bar");
      }

      const clear = bar.querySelector<HTMLButtonElement>(`.${prefix}-search__clear-button`);
      clear?.setAttribute("aria-label", closeLabel);
      bar.classList.add(hiddenClass);

      let returnFocus: Element | null = null;
      const remember = (): void => {
        const active = ctx.dom.root.ownerDocument.activeElement;
        if (active !== null && active !== input) returnFocus = active;
      };
      const restore = (): void => {
        const remembered = returnFocus;
        returnFocus = null;
        if (remembered instanceof HTMLElement && remembered.isConnected) {
          focusNode(remembered);
          return;
        }
        const { content, root, viewport } = ctx.dom;
        const target = content.hasAttribute("tabindex")
          ? content
          : root.hasAttribute("tabindex")
            ? root
            : viewport;
        if (target.isConnected) focusNode(target);
      };

      const onOpen = (): void => {
        bar.classList.remove(hiddenClass);
      };
      const onClose = (): void => {
        bar.classList.add(hiddenClass);
        restore();
      };
      const offOpen = ctx.emitter.on("search:open", onOpen);
      const offClose = ctx.emitter.on("search:close", onClose);

      const onCapture = (): void => {
        if (!bar.classList.contains(hiddenClass)) return;
        remember();
      };
      const onKeydown = (event: KeyboardEvent): void => {
        if (!bar.classList.contains(hiddenClass) || !isRevealKey(event)) return;
        event.preventDefault();
        remember();
        openSearch();
        setQuery(event.key);
        const end = input.value.length;
        input.setSelectionRange(end, end);
      };
      const onClearClick = (event: MouseEvent): void => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest(`.${prefix}-search__clear-button`) === null) return;
        event.preventDefault();
        event.stopPropagation();
        closeSearch();
      };

      ctx.dom.root.addEventListener("keydown", onCapture, true);
      bar.addEventListener("click", onClearClick, true);
      ctx.hooks.onKeydown(onKeydown);
      ctx.hooks.onDestroy(() => {
        offOpen();
        offClose();
        ctx.dom.root.removeEventListener("keydown", onCapture, true);
        bar.removeEventListener("click", onClearClick, true);
      });
    },
  };
}
