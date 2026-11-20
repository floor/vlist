/**
 * Directional smear for fast scroll.
 *
 * The filter graph is the one merged on vlist.io: a one-axis gaussian, offset
 * along the scroll, drawn at 0.7 alpha behind the row. Off means this module
 * is never asked to build a filter or touch a frame.
 *
 * The stylesheet owns the filter rule. The url is a custom property set once,
 * because each list's filter id is unique and a static sheet cannot name it.
 */

import type { MotionBlurConfig } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";
const SPREAD_MIN = 1.5;
const SPREAD_K = 0.28;
const SHIFT_MIN = 4;
const SHIFT_MAX = 22;
const SHIFT_K = 0.55;
const DEFAULT_THRESHOLD = 15;
const DEFAULT_MAX = 12;

let nextId = 0;

export interface MotionBlurHandle {
  onVelocity(velocity: number, reliable: boolean, direction: number): void;
  destroy(): void;
}

/** Build the smear for one list, or null when the option is off. */
export function createMotionBlur(
  root: HTMLElement,
  classPrefix: string,
  axis: "x" | "y",
  option: boolean | MotionBlurConfig | undefined,
): MotionBlurHandle | null {
  if (!option) return null;

  const opts = option === true ? {} : option;
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const max = opts.max ?? DEFAULT_MAX;
  const target = opts.target ?? "placeholders";
  const fastClass = classPrefix + "--fast";
  const horizontal = axis === "x";

  let svg: SVGElement | null = null;
  let blur: SVGElement | null = null;
  let shiftEl: SVGElement | null = null;
  let fastOn = false;
  let spreadQ = -1;
  let shiftQ = 0;

  root.setAttribute("data-vlist-motion", target);

  function svgEl(name: string): SVGElement {
    return document.createElementNS(SVG_NS, name);
  }

  function ensure(): void {
    if (svg) return;
    const id = classPrefix + "-motion-" + (++nextId);
    svg = svgEl("svg");
    svg.setAttribute("class", classPrefix + "-motion-defs");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");

    const filter = svgEl("filter");
    filter.setAttribute("id", id);
    filter.setAttribute("color-interpolation-filters", "sRGB");
    if (horizontal) {
      filter.setAttribute("x", "-70%");
      filter.setAttribute("y", "-8%");
      filter.setAttribute("width", "240%");
      filter.setAttribute("height", "116%");
    } else {
      filter.setAttribute("x", "-8%");
      filter.setAttribute("y", "-70%");
      filter.setAttribute("width", "116%");
      filter.setAttribute("height", "240%");
    }

    blur = svgEl("feGaussianBlur");
    blur.setAttribute("in", "SourceGraphic");
    blur.setAttribute("stdDeviation", "0 0");
    blur.setAttribute("result", "smear");

    shiftEl = svgEl("feOffset");
    shiftEl.setAttribute("in", "smear");
    shiftEl.setAttribute("dx", "0");
    shiftEl.setAttribute("dy", "0");
    shiftEl.setAttribute("result", "shifted");

    const transfer = svgEl("feComponentTransfer");
    transfer.setAttribute("in", "shifted");
    transfer.setAttribute("result", "trail");
    const funcA = svgEl("feFuncA");
    funcA.setAttribute("type", "linear");
    funcA.setAttribute("slope", "0.7");
    transfer.appendChild(funcA);

    const merge = svgEl("feMerge");
    const trail = svgEl("feMergeNode");
    trail.setAttribute("in", "trail");
    const source = svgEl("feMergeNode");
    source.setAttribute("in", "SourceGraphic");
    merge.appendChild(trail);
    merge.appendChild(source);

    filter.appendChild(blur);
    filter.appendChild(shiftEl);
    filter.appendChild(transfer);
    filter.appendChild(merge);
    svg.appendChild(filter);
    root.appendChild(svg);
    root.style.setProperty("--vlist-motion-filter", 'url("#' + id + '")');
  }

  function writeSpread(velocity: number): void {
    const spread = Math.min(max, Math.max(SPREAD_MIN, velocity * SPREAD_K));
    const q = Math.round(spread * 10);
    if (q === spreadQ || !blur) return;
    spreadQ = q;
    const n = (q / 10).toFixed(1);
    blur.setAttribute("stdDeviation", horizontal ? n + " 0" : "0 " + n);
  }

  function writeShift(velocity: number, direction: number): void {
    if (!shiftEl) return;
    const sign = direction > 0 ? 1 : -1;
    const amount = Math.min(SHIFT_MAX, Math.max(SHIFT_MIN, velocity * SHIFT_K));
    const q = sign * Math.round(amount * 10);
    if (q === shiftQ) return;
    shiftQ = q;
    const s = (q / 10).toFixed(1);
    if (horizontal) shiftEl.setAttribute("dx", s);
    else shiftEl.setAttribute("dy", s);
  }

  return {
    onVelocity(velocity: number, reliable: boolean, direction: number): void {
      const fast = reliable && velocity > threshold;
      if (!fast) {
        if (fastOn) {
          fastOn = false;
          root.classList.remove(fastClass);
        }
        return;
      }
      if (!fastOn) {
        fastOn = true;
        ensure();
        root.classList.add(fastClass);
      }
      writeSpread(velocity);
      if (direction !== 0) writeShift(velocity, direction);
    },
    destroy(): void {
      fastOn = false;
      root.classList.remove(fastClass);
      root.removeAttribute("data-vlist-motion");
      root.style.removeProperty("--vlist-motion-filter");
      svg?.remove();
      svg = null;
      blur = null;
      shiftEl = null;
    },
  };
}
