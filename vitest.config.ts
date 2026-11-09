import { defineConfig } from "vitest/config";

/**
 * Suite-wide headroom over vitest's 5s default per test: on a loaded machine
 * (parallel CI, a busy laptop) module import and synchronous stage runs
 * regularly stretch past it, failing tests that pass in isolation. Tests that
 * carry their own larger budget (a spawned child with a 30s timeout) still
 * declare it explicitly.
 */
export default defineConfig({
  test: {
    testTimeout: 20_000,
  },
});
