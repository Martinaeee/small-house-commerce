import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../src") } },
  test: { globals: true, environment: "jsdom", setupFiles: [path.resolve(import.meta.dirname, "../src/test/setup.ts")], include: [".marketing-tdd/**/*.spec.jsx"] },
});
