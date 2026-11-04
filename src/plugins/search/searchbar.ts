/**
 * vlist/search — Search bar DOM
 *
 * A modular, MD3-aligned structure (mirrors mtrl `_search.scss`):
 *
 *   .{p}-search .{p}-search--bar .{p}-search--{top|bottom}   (role="search")
 *   └── .{p}-search__container
 *       ├── span.{p}-search__leading-icon       (magnifier — decorative)
 *       ├── .{p}-search__input-wrapper
 *       │   └── input.{p}-search__input
 *       ├── span.{p}-search__counter              (match count — empty when idle)
 *       ├── button.{p}-search__nav-prev           (navigate mode, with matches to step)
 *       ├── button.{p}-search__nav-next           (navigate mode, with matches to step)
 *       └── button.{p}-search__clear-button       (--hidden when empty)
 *
 * Per RFC-010, the bar carries no inline human-language text: all accessible
 * names come from the `text` parameter (consumer-supplied, with English
 * defaults resolved in the plugin). The leading magnifier is decorative
 * (`aria-hidden`, not focusable, no accessible name) — the input is the
 * meaningful control. The `role="search"` landmark is unnamed unless the
 * consumer passes `text.region`.
 *
 * Invisible mode (`position: "none"`) renders no bar — the plugin drives the
 * query from keystrokes only.
 */

const PATH_SEARCH =
  "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z";
const PATH_CLEAR =
  "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z";
const PATH_PREV = "M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z";
const PATH_NEXT = "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z";

const svgIcon = (d: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" aria-hidden="true"><path d="${d}"></path></svg>`;

export interface SearchBarCallbacks {
  onInput(value: string): void;
  onClear(): void;
  onPrev(): void;
  onNext(): void;
  /** Forwarded keydown from the input (Enter / Escape / arrows). */
  onKeydown(event: KeyboardEvent): void;
}

/**
 * Resolved accessible names for the bar (consumer-supplied via the plugin's
 * `text` config; the plugin fills English defaults). `region` is `""` when the
 * search landmark should stay unnamed (the default).
 */
export interface SearchBarText {
  placeholder: string;
  clear: string;
  previous: string;
  next: string;
  region: string;
}

export interface SearchBar {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  setCounter(text: string): void;
  /** Show/hide the prev/next buttons (navigate mode, with matches to step). */
  showNav(show: boolean): void;
  focus(): void;
  setValue(value: string): void;
  destroy(): void;
}

const iconButton = (
  className: string,
  label: string,
  path: string,
): HTMLButtonElement => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.tabIndex = -1;
  b.setAttribute("aria-label", label);
  b.innerHTML = svgIcon(path);
  return b;
};

export const createSearchBar = (
  parent: HTMLElement,
  before: HTMLElement | null,
  classPrefix: string,
  position: "top" | "bottom",
  text: SearchBarText,
  listId: string | undefined,
  cb: SearchBarCallbacks,
): SearchBar => {
  const p = `${classPrefix}-search`;

  const root = document.createElement("div");
  root.className = `${p} ${p}--bar ${p}--${position}`;
  root.setAttribute("role", "search");
  root.setAttribute("aria-disabled", "false");
  // The landmark is unnamed by default; name it only if the consumer asked.
  if (text.region) root.setAttribute("aria-label", text.region);

  const container = document.createElement("div");
  container.className = `${p}__container`;

  // Decorative magnifier — not a control. The input is the meaningful element,
  // so the icon carries no accessible name and is not in the tab order.
  const leadingIcon = document.createElement("span");
  leadingIcon.className = `${p}__leading-icon`;
  leadingIcon.setAttribute("aria-hidden", "true");
  leadingIcon.innerHTML = svgIcon(PATH_SEARCH);

  const inputWrapper = document.createElement("div");
  inputWrapper.className = `${p}__input-wrapper`;
  const input = document.createElement("input");
  input.type = "text";
  input.className = `${p}__input`;
  input.placeholder = text.placeholder;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", text.placeholder);
  if (listId) input.setAttribute("aria-controls", listId);
  inputWrapper.appendChild(input);

  const counter = document.createElement("span");
  counter.className = `${p}__counter`;
  counter.setAttribute("aria-live", "polite");

  const prev = iconButton(`${p}__nav-prev`, text.previous, PATH_PREV);
  const next = iconButton(`${p}__nav-next`, text.next, PATH_NEXT);

  const clear = iconButton(
    `${p}__clear-button ${p}__clear-button--hidden`,
    text.clear,
    PATH_CLEAR,
  );

  container.append(leadingIcon, inputWrapper, counter, prev, next, clear);
  root.appendChild(container);

  parent.insertBefore(root, position === "top" ? (before ?? parent.firstChild) : null);

  const reflectClear = (): void => {
    clear.classList.toggle(`${p}__clear-button--hidden`, input.value.length === 0);
  };

  const onInput = (): void => {
    reflectClear();
    cb.onInput(input.value);
  };
  const onLeadingClick = (): void => input.focus();
  const onClearClick = (): void => {
    cb.onClear();
    input.focus();
  };

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", cb.onKeydown);
  leadingIcon.addEventListener("click", onLeadingClick);
  clear.addEventListener("click", onClearClick);
  prev.addEventListener("click", cb.onPrev);
  next.addEventListener("click", cb.onNext);

  return {
    root,
    input,
    setCounter(value: string): void {
      counter.textContent = value;
    },
    showNav(show: boolean): void {
      prev.classList.toggle(`${p}__nav-prev--hidden`, !show);
      next.classList.toggle(`${p}__nav-next--hidden`, !show);
    },
    focus(): void {
      input.focus();
      input.select();
    },
    setValue(value: string): void {
      input.value = value;
      reflectClear();
    },
    destroy(): void {
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", cb.onKeydown);
      leadingIcon.removeEventListener("click", onLeadingClick);
      clear.removeEventListener("click", onClearClick);
      prev.removeEventListener("click", cb.onPrev);
      next.removeEventListener("click", cb.onNext);
      root.remove();
    },
  };
};
