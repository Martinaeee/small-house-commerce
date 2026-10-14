import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";
import { assertProductCardV2TestTarget } from "./src/test/product-card-v2-test-target";

const target = assertProductCardV2TestTarget(process.env.CARD_V2_DB_URL, process.env.CARD_V2_ROOT);
export default defineConfig({
  testDir: "./e2e", testMatch: "product-card-v2.spec.ts",
  outputDir: join(target.root, "test-results-v2"),
  reporter: [["list"], ["json", { outputFile: join(target.root, "browser-results.json") }]],
  workers: 1, fullyParallel: false, retries: 0, timeout: 60_000,
  use: { baseURL: "http://localhost:3217", extraHTTPHeaders: { "Cache-Control": "no-cache" },
    trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
