import { cpSync, mkdirSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { assertProductCardTestTarget } from "../src/test/product-card-test-target";

const target = assertProductCardTestTarget(
  process.env.PRODUCT_CARD_TEST_DATABASE_URL,
  process.env.PRODUCT_CARD_TEST_ROOT,
);
const source = resolve(__dirname, "../..");
if (!statSync(target.root).isDirectory() || realpathSync(target.root) !== target.root) {
  throw new Error("Test root must be a real temporary directory");
}
if (readdirSync(target.root).length !== 0) throw new Error("Test root must be new and empty");
writeFileSync(join(target.root, ".product-card-owner"), "unified-product-card-20261010");

const copies = {
  backend: ["src", "prisma", "prisma7.config.ts", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "tsconfig.build.json", "nest-cli.json"],
  frontend: ["src", "public", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "next-env.d.ts"],
};
for (const [app, entries] of Object.entries(copies)) {
  mkdirSync(join(target.root, app));
  for (const entry of entries) {
    cpSync(join(source, app, entry), join(target.root, app, entry), {
      recursive: true,
      filter: (path) => basename(path) !== "generated",
    });
  }
  symlinkSync(join(source, app, "node_modules"), join(target.root, app, "node_modules"), "dir");
}

const env = { ...process.env, DATABASE_URL: target.databaseUrl };
for (const args of [
  ["exec", "prisma", "migrate", "deploy", "--config", "prisma7.config.ts"],
  ["exec", "prisma", "generate", "--config", "prisma7.config.ts"],
  ["exec", "tsx", "prisma/seed.ts"],
  ["exec", "tsx", "prisma/seed-e2e.ts"],
]) {
  execFileSync("pnpm", args, { cwd: join(target.root, "backend"), env, stdio: "inherit" });
}
console.log(`Product-card applications prepared at ${target.root}`);
