import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { assertProductCardV2TestTarget, PRODUCT_CARD_V2_OWNER } from "../src/test/product-card-v2-test-target";

const root = process.env.CARD_V2_ROOT;
if (!root || /^\/private\/tmp\/luwag-product-card-v2-[A-Za-z0-9_-]+$/.exec(root)?.[0] !== root || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink() || realpathSync(root) !== root)
  throw new Error("A real product-card V2 temporary root is required");
const marker = join(root, ".product-card-v2-owner");
if (!existsSync(marker)) {
  if (readdirSync(root).length !== 0) throw new Error("New product-card V2 root must be empty");
  writeFileSync(marker, PRODUCT_CARD_V2_OWNER, { flag: "wx" });
}
const target = assertProductCardV2TestTarget(process.env.CARD_V2_DB_URL, root);
const source = resolve(__dirname, "../..");
const refresh = process.argv.includes("--refresh");
if (!refresh && readdirSync(target.root).some(entry => entry !== ".product-card-v2-owner"))
  throw new Error("Initial preparation requires a new owned root; use --refresh for source updates");
if (refresh && !existsSync(join(target.root, "source-manifest.json")))
  throw new Error("Cannot refresh an unprepared root");
const excluded = new Set(["generated", "node_modules", "dist", ".next", ".env", ".git", "coverage", "logs", "test-results", "playwright-report"]);
const copies: Record<string, string[]> = {
  backend: ["src", "test", "prisma", "scripts", "prisma7.config.ts", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "tsconfig.build.json", "nest-cli.json", "vitest.config.ts", "vitest.config.e2e.ts"],
  frontend: ["src", "public", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "next-env.d.ts", "playwright.product-card-v2.config.ts"],
};
const e2e = join(source, "frontend", "e2e");
copies.frontend!.push(...readdirSync(e2e).filter(name => name.startsWith("product-card-v2") && name.endsWith(".ts")).map(name => `e2e/${name}`));
const files: Record<string, string> = {};
function record(path: string): void {
  const stat = lstatSync(path);
  if (excluded.has(basename(path)) || basename(path).startsWith(".env") || stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const name of readdirSync(path)) record(join(path, name));
  } else if (stat.isFile()) {
    files[relative(source, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
  }
}
for (const [app, entries] of Object.entries(copies)) {
  const appRoot = join(target.root, app);
  mkdirSync(appRoot, { recursive: true });
  const dependencies = join(appRoot, "node_modules");
  if (existsSync(dependencies)) {
    if (!lstatSync(dependencies).isSymbolicLink() || realpathSync(dependencies) !== realpathSync(join(source, app, "node_modules")))
      throw new Error("Refused a foreign dependency directory");
  } else symlinkSync(join(source, app, "node_modules"), dependencies, "dir");
  for (const entry of entries) {
    const path = join(source, app, entry);
    if (!existsSync(path)) {
      if (entry === "playwright.product-card-v2.config.ts") continue;
      throw new Error(`Missing copy source: ${app}/${entry}`);
    }
    cpSync(path, join(appRoot, entry), {
      recursive: true,
      filter: candidate => !excluded.has(basename(candidate)) && !basename(candidate).startsWith(".env") && !lstatSync(candidate).isSymbolicLink(),
    });
    record(path);
  }
}
const database = new URL(target.databaseUrl).pathname.slice(1);
const manifest = { owner: PRODUCT_CARD_V2_OWNER, root: target.root, database, source,
  sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim(),
  capturedAt: new Date().toISOString(), files,
};
writeFileSync(join(target.root, "source-manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Copied ${Object.keys(files).length} source files into ${target.root}`);
if (!refresh) {
  const psql = (sql: string): string => execFileSync("docker", ["exec", "small-house-postgres", "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();
  const existing = psql(`SELECT coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = '${database}'`);
  const exists = psql(`SELECT count(*) FROM pg_database WHERE datname = '${database}'`) === "1";
  if (exists && existing !== PRODUCT_CARD_V2_OWNER) throw new Error("Refused a database with an unmatched owner comment");
  if (!exists) {
    psql(`CREATE DATABASE "${database}"`);
    psql(`COMMENT ON DATABASE "${database}" IS '${PRODUCT_CARD_V2_OWNER}'`);
  }
  const env = { ...process.env, DATABASE_URL: target.databaseUrl, ADMIN_EMAIL: "dev@smallhouse.test", ADMIN_PASSWORD: "devpass1234" };
  for (const args of [
    ["exec", "prisma", "migrate", "deploy", "--config", "prisma7.config.ts"],
    ["exec", "prisma", "generate", "--config", "prisma7.config.ts"],
    ["exec", "tsx", "prisma/seed.ts"],
    ["exec", "tsx", "prisma/seed-e2e.ts"],
  ]) execFileSync("pnpm", args, { cwd: join(target.root, "backend"), env, stdio: "inherit" });
  cpSync(join(target.root, "backend", "uploads"), join(target.root, "uploads"), { recursive: true });
  console.log(`Prepared owned database ${database}; owner=${PRODUCT_CARD_V2_OWNER}`);
}
console.log(JSON.stringify({ root: target.root, database, owner: PRODUCT_CARD_V2_OWNER, refresh, sourceFiles: Object.keys(files).length }));
