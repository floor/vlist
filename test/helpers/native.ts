// Bun's own globals, captured before Happy DOM replaces them.
//
// test/preload.ts imports this module first, so these bindings are evaluated
// while `Response` is still Bun's. Happy DOM then registers its own `Response`
// process-wide, and `Bun.serve` rejects a handler that returns that one. A
// test that runs a real server in-process needs the native class.
export const NativeResponse: typeof Response = globalThis.Response;
