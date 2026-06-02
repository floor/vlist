/**
 * vlist/search — Search bar DOM
 *
 * A small, self-contained search bar: input + match counter + prev/next +
 * close. Injected before (top) or after (bottom) the viewport. Invisible mode
 * (`position: "none"`) renders no bar — the plugin drives the query from
 * keystrokes only.
 */

export interface SearchBarCallbacks {
  onInput(value: string): void;
  onPrev(): void;
  onNext(): void;
  onClose(): void;
  /** Forwarded keydown from the input (Enter / Escape / arrows). */
  onKeydown(event: KeyboardEvent): void;
}

export interface SearchBar {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  setCounter(text: string): void;
  /** Show/hide navigation buttons (only meaningful in navigate mode). */
  showNav(show: boolean): void;
  focus(): void;
  setValue(value: string): void;
  destroy(): void;
}

const btn = (cls: string, label: string, html: string): HTMLButtonElement => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.setAttribute("aria-label", label);
  b.tabIndex = -1;
  b.innerHTML = html;
  return b;
};

export const createSearchBar = (
  parent: HTMLElement,
  before: HTMLElement | null,
  classPrefix: string,
  position: "top" | "bottom",
  placeholder: string,
  listId: string | undefined,
  cb: SearchBarCallbacks,
): SearchBar => {
  const root = document.createElement("div");
  root.className = `${classPrefix}-search ${classPrefix}-search--${position}`;
  root.setAttribute("role", "search");
  root.setAttribute("aria-label", "Search list");

  const input = document.createElement("input");
  input.type = "text";
  input.className = `${classPrefix}-search-input`;
  input.placeholder = placeholder;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", placeholder);
  if (listId) input.setAttribute("aria-controls", listId);

  const counter = document.createElement("span");
  counter.className = `${classPrefix}-search-counter`;
  counter.setAttribute("aria-live", "polite");

  const prev = btn(`${classPrefix}-search-prev`, "Previous match", "&#8593;");
  const next = btn(`${classPrefix}-search-next`, "Next match", "&#8595;");
  const close = btn(`${classPrefix}-search-close`, "Close search", "&#10005;");

  root.append(input, counter, prev, next, close);

  // Insert before the viewport for top, after it for bottom.
  if (position === "top" && before) parent.insertBefore(root, before);
  else if (position === "top") parent.insertBefore(root, parent.firstChild);
  else parent.appendChild(root);

  const onInput = (): void => cb.onInput(input.value);
  const onKeydown = (e: KeyboardEvent): void => cb.onKeydown(e);
  const onPrev = (): void => cb.onPrev();
  const onNext = (): void => cb.onNext();
  const onClose = (): void => cb.onClose();

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeydown);
  prev.addEventListener("click", onPrev);
  next.addEventListener("click", onNext);
  close.addEventListener("click", onClose);

  return {
    root,
    input,
    setCounter(text: string): void {
      counter.textContent = text;
    },
    showNav(show: boolean): void {
      prev.style.display = show ? "" : "none";
      next.style.display = show ? "" : "none";
    },
    focus(): void {
      input.focus();
      input.select();
    },
    setValue(value: string): void {
      input.value = value;
    },
    destroy(): void {
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeydown);
      prev.removeEventListener("click", onPrev);
      next.removeEventListener("click", onNext);
      close.removeEventListener("click", onClose);
      root.remove();
    },
  };
};
