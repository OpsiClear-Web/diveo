import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text"],
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 75,
        lines: 65,
      },
    },
  },
});
