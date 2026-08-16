import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Resolve the app's "@/" path alias (tsconfig paths) for unit tests.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
