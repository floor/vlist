/**
 * vlist/rendering -- ARIA position resolvers
 *
 * Lazy-resolves _getTotal and _layoutToDataIndex from the methods map
 * so that aria-setsize uses data total (not layout total including
 * group headers) and aria-posinset uses data-space position.
 */

export interface AriaResolvers {
  getSetSize: () => number;
  getPosInSet: (layoutIndex: number) => number;
}

export const createAriaResolvers = (
  methods: Map<string, Function>,
  fallbackTotal: () => number,
): AriaResolvers => {
  let gt: (() => number) | null | undefined;
  let l2d: ((i: number) => number) | null | undefined;

  return {
    getSetSize: (): number => {
      if (gt === undefined) gt = (methods.get("_getTotal") as (() => number)) ?? null;
      return gt ? gt() : fallbackTotal();
    },
    getPosInSet: (layoutIndex: number): number => {
      if (l2d === undefined) l2d = (methods.get("_layoutToDataIndex") as ((i: number) => number)) ?? null;
      return l2d ? l2d(layoutIndex) + 1 : layoutIndex + 1;
    },
  };
};
