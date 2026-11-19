import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { include: ["strategy/**/*.test.ts", "lib/**/*.test.ts", "app/**/*.test.ts", "workers/**/*.test.{js,ts}"] },
});
