import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";
import { readFileSync, realpathSync } from "node:fs";
import { assertProductCardTestTarget } from "./src/test/product-card-test-target";

const target = assertProductCardTestTarget(
  process.env.PRODUCT_CARD_TEST_DATABASE_URL,
  process.env.PRODUCT_CARD_TEST_ROOT,
);
if (realpathSync(target.root) !== target.root || readFileSync(join(target.root, ".product-card-owner"), "utf8") !== "unified-product-card-20261010") {
  throw new Error("Product-card browser root is not owned by this acceptance run");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "product-card.spec.ts",
  outputDir: join(target.root, "test-results"),
  reporter: [["list"]],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  use: {
    baseURL: "http://localhost:3215",
    extraHTTPHeaders: { "Cache-Control": "no-cache" },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
