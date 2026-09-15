import { deepStrictEqual } from "node:assert/strict";

/** Capture own descriptors, including absence, before a file mocks geometry.
 * Keep prototype references so the final guard works after DOM globals unload.
 */
export function capturePrototypeGeometry() {
  const properties = [
    "clientHeight", "clientWidth", "offsetHeight", "offsetWidth",
    "getBoundingClientRect", "getClientRects",
  ];
  const snapshots = [HTMLElement.prototype, Element.prototype].flatMap(prototype =>
    properties.map(property => ({
      prototype, property,
      descriptor: Object.getOwnPropertyDescriptor(prototype, property),
      label: `${prototype.constructor.name}.prototype.${property}`,
    })),
  );
  return {
    restore(): void {
      for (const { prototype, property, descriptor } of snapshots) {
        if (descriptor) Object.defineProperty(prototype, property, descriptor);
        else Reflect.deleteProperty(prototype, property);
      }
    },
    assertRestored(): void {
      for (const { prototype, property, descriptor, label } of snapshots) {
        deepStrictEqual(Object.getOwnPropertyDescriptor(prototype, property), descriptor,
          `Geometry mock leaked after teardown: ${label}`);
      }
    },
  };
}
