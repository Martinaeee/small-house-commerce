import { execFileSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { assertE2EDatabaseUrl } from "../src/lib/e2e-guard";

const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.E2E_DATABASE_URL ??
  `postgresql://${process.env.E2E_PG_USER ?? "postgres"}:${process.env.E2E_PG_PASSWORD ?? "postgres"}@localhost:5432/${process.env.E2E_TEST_DB ?? "small_house_variant_test"}?schema=public`;

const backendDir = path.resolve(__dirname, "..", "..", "backend");
const frontendDir = path.resolve(__dirname, "..");
const backendEnv = { ...process.env, DATABASE_URL: databaseUrl };

/**
 * Playwright installs webServer plugins before it runs globalSetup. Prepare the
 * disposable database here, before Nest starts and before either readiness
 * probe can trigger an API or Next data request.
 */
export function prepareE2EDatabase(): void {
  // This must remain the first operation before any migration or seed command.
  assertE2EDatabaseUrl(databaseUrl);

  // Next 16 dev persists route/fetch state under .next/dev. Clear the
  // worktree-owned output once, before the frontend server starts, so a
  // recreated database cannot inherit IDs or responses from a prior run.
  rmSync(path.resolve(frontendDir, ".next"), { recursive: true, force: true });

  const run = (args: string[]): void => {
    execFileSync("pnpm", args, {
      cwd: backendDir,
      env: backendEnv,
      stdio: "inherit",
    });
  };

  run(["exec", "prisma", "migrate", "deploy"]);
  run(["exec", "tsx", "prisma/seed.ts"]);
  run(["exec", "tsx", "prisma/seed-e2e.ts"]);
}

export function startE2EBackend(): void {
  prepareE2EDatabase();

  // Optional project override. A different work line keeps half-finished,
  // untracked modules under backend/src (e.g. `storefront-shell/`), and those
  // files are NOT imported by app.module yet still make `tsc` fail for the
  // whole backend, so Nest never boots. Pointing Nest at a tsconfig that
  // excludes that module keeps THIS gate runnable without editing anyone
  // else's files. Unset = the project's own tsconfig, exactly as before.
  const tsconfigPath = process.env.E2E_BACKEND_TSCONFIG;
  const nestArgs = [
    "exec",
    "nest",
    "start",
    ...(tsconfigPath ? ["-p", tsconfigPath] : []),
  ];
  const child = spawn("pnpm", nestArgs, {
    cwd: backendDir,
    env: backendEnv,
    stdio: "inherit",
  });

  const forwardSignal = (signal: NodeJS.Signals): void => {
    if (!child.killed) child.kill(signal);
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));

  child.once("error", (error) => {
    console.error(`E2E backend failed to start: ${error.message}`);
    process.exit(1);
  });
  child.once("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  startE2EBackend();
}
