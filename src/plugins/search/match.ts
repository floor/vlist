/**
 * vlist/search — Matching & highlighting helpers
 *
 * Pure, DOM-light utilities used by the search plugin:
 * - text extraction from items (field accessor or all string values)
 * - substring matching
 * - idempotent `<mark>` highlighting of a rendered element
 */

import type { VListItem } from "../../types";

/** Field(s) to search — a property key or a custom accessor. */
export type FieldAccessor<T> = string | ((item: T) => string);

/**
 * Build a text accessor for an item.
 * - function: used as-is
 * - string: reads `item[field]`
 * - undefined: concatenates all string-valued properties
 */
export const makeGetText = <T extends VListItem>(
  field?: FieldAccessor<T>,
): ((item: T) => string) => {
  if (typeof field === "function") return field;
  if (typeof field === "string") {
    return (item: T): string => {
      const v = (item as Record<string, unknown>)[field];
      return v == null ? "" : String(v);
    };
  }
  return (item: T): string => {
    if (item == null) return "";
    let out = "";
    for (const key in item as Record<string, unknown>) {
      const v = (item as Record<string, unknown>)[key];
      if (typeof v === "string") out += out ? " " + v : v;
    }
    return out;
  };
};

/** Whether `text` contains `query` (query already normalized to the right case). */
export const textMatches = (
  text: string,
  query: string,
  caseSensitive: boolean,
): boolean => {
  if (!query) return false;
  return (caseSensitive ? text : text.toLowerCase()).includes(query);
};

/**
 * Remove all `<mark>` elements with `matchClass` inside `root`, replacing
 * each with its text content. Adjacent text nodes are merged so the DOM
 * returns to its pre-highlight state.
 */
export const clearHighlights = (
  root: HTMLElement,
  matchClass: string,
): void => {
  const marks = root.querySelectorAll(`mark.${matchClass}`);
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i]!;
    const parent = mark.parentNode;
    if (!parent) continue;
    const text = document.createTextNode(mark.textContent ?? "");
    parent.replaceChild(text, mark);
    parent.normalize();
  }
};

/**
 * Wrap every occurrence of `query` inside `root`'s text nodes in
 * `<mark class="${matchClass}">`. Existing marks are cleared first so
 * the function is safe to call on every render commit — stale marks from
 * a previous query are replaced, not accumulated.
 */
export const highlightElement = (
  root: HTMLElement,
  query: string,
  caseSensitive: boolean,
  matchClass: string,
): void => {
  if (!query) return;

  clearHighlights(root, matchClass);

  const needle = caseSensitive ? query : query.toLowerCase();
  const qlen = query.length;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const value = node.nodeValue ?? "";
      const hay = caseSensitive ? value : value.toLowerCase();
      return hay.includes(needle) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const targets: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode()) !== null) targets.push(current as Text);

  for (const textNode of targets) {
    const text = textNode.nodeValue ?? "";
    const hay = caseSensitive ? text : text.toLowerCase();
    const frag = document.createDocumentFragment();
    let last = 0;
    let idx = hay.indexOf(needle, 0);
    while (idx !== -1) {
      if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
      const mark = document.createElement("mark");
      mark.className = matchClass;
      mark.textContent = text.slice(idx, idx + qlen);
      frag.appendChild(mark);
      last = idx + qlen;
      idx = hay.indexOf(needle, last);
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
};
