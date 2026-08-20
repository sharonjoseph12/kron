import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Integration tests share one isolated SQLite DB; run files sequentially.
    fileParallelism: false,
    setupFiles: ["./src/test-setup.ts"],
    // Never run stale compiled artifacts from a previous build.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
  },
});
