import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/tests/**/*.test.mjs"],
    testTimeout: 20000,
  },
});
