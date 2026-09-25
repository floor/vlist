// Registers Happy DOM once, before any test file's module scope runs. See the
// note on registerDOM in helpers/dom.ts for why this is process-wide.
// native.ts must be evaluated before the DOM registers: it captures Bun's
// Response for the tests that run a real server in-process.
import "./helpers/native";
import { registerDOM } from "./helpers/dom";
registerDOM();
