// Deliberately red, to prove the Gate step names every red gate. Reverted
// before merge; if you are reading this on next, the revert was skipped.
import { it, expect } from "bun:test";
const wrong: number = "not a number";
it("gate probe: this assertion is meant to fail", () => { expect(wrong).toBe(1); });
