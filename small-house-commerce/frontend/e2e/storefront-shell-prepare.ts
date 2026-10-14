/**
 * Task 14 — fixture owner for the storefront-shell browser gate.
 *
 * The gate runs against the plan-owned runtime (backend 3230, frontend 3231)
 * and the dedicated `small_house_marketing_dev` database. This module owns
 * every reversible fixture that gate needs:
 *
 *   - a SUPER_ADMIN that holds STOREFRONT_SHELL_MANAGE and an ADMIN that does
 *     not, both created with a real argon2 hash so the gate can use the normal
 *     login form;
 *   - an active root category, an active collection and an active landing page
 *     to link Header items at;
 *   - a real horizontal PNG and a near-square WebP, generated outside every
 *     upload directory;
 *   - a snapshot of the original shell/settings rows, restored in teardown.
 *
 * The database work itself lives in the plan workspace
 * (`runtime/backend/shell-fixtures.mts`) because it needs Prisma, argon2 and
 * sharp — none of which this package has. Set SHELL_GATE_BACKEND_DIR to point
 * at a different runtime copy.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/** e2e/ -> frontend/ -> small-house-commerce/ -> worktree root */
export const WORKTREE_ROOT = path.resolve(__dirname, "../../..");

export const SHELL_GATE_WORKSPACE =
  process.env.SHELL_GATE_WORKSPACE ??
  path.join(
    WORKTREE_ROOT,
    ".superpowers/sdd/2026-10-12-storefront-shell-brand-editor/runtime",
  );
export const SHELL_GATE_BACKEND_DIR =
  process.env.SHELL_GATE_BACKEND_DIR ??
  path.join(SHELL_GATE_WORKSPACE, "backend");
export const SHELL_GATE_DATABASE_URL =
  process.env.SHELL_GATE_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/small_house_marketing_dev?schema=public";
export const SHELL_GATE_FIXTURES_DIR =
  process.env.SHELL_GATE_FIXTURES_DIR ??
  path.join(SHELL_GATE_WORKSPACE, "fixtures");
export const SHELL_GATE_FRONTEND_ORIGIN =
  process.env.SHELL_GATE_FRONTEND_ORIGIN ?? "http://localhost:3231";
// Plan-owned local secret only; never used by production or a peer runtime.
export const SHELL_GATE_REVALIDATE_SECRET =
  process.env.SHELL_GATE_REVALIDATE_SECRET ??
  "hIHW26Yue4aTxwu-j9sc7pvRWyZxgSj-g78WyHVmZwg";

export const SHELL_GATE_SUPER = {
  email: "shell-gate-super@smallhouse.test",
  password: process.env.SHELL_E2E_PASSWORD ?? "ShellGatePass123!",
} as const;

export const SHELL_GATE_PLAIN = {
  email: "shell-gate-admin@smallhouse.test",
  password: process.env.SHELL_E2E_PASSWORD ?? "ShellGatePass123!",
} as const;

export const SHELL_GATE_ASSETS = {
  horizontal: path.join(SHELL_GATE_FIXTURES_DIR, "assets/horizontal-logo.png"),
  square: path.join(SHELL_GATE_FIXTURES_DIR, "assets/square-mark.webp"),
} as const;

export const SHELL_GATE_STATE_FILE = path.join(
  SHELL_GATE_FIXTURES_DIR,
  "state/shell-fixtures.json",
);
export const SHELL_GATE_SCREENSHOTS_DIR = path.join(
  SHELL_GATE_WORKSPACE,
  "evidence/screenshots",
);

/** Runs the plan-owned fixture script with the dedicated database URL. */
export function runShellFixtures(
  mode: "seed" | "restore" | "targets-off" | "targets-on",
): void {
  const script = path.join(SHELL_GATE_BACKEND_DIR, "shell-fixtures.mts");
  if (!existsSync(script)) {
    throw new Error(
      `storefront-shell gate fixtures are missing at ${script}. Set SHELL_GATE_BACKEND_DIR to the plan-owned backend runtime.`,
    );
  }
  execFileSync("pnpm", ["exec", "tsx", "shell-fixtures.mts", mode], {
    cwd: SHELL_GATE_BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: SHELL_GATE_DATABASE_URL },
    stdio: "inherit",
  });
}

/**
 * Creates the fixtures once per run. Idempotent: a second call in the same
 * run is a no-op, so a retried worker does not overwrite the original
 * snapshot with an already-mutated shell.
 */
let seeded = false;
export function ensureShellFixtures(): void {
  if (seeded) return;
  mkdirSync(SHELL_GATE_SCREENSHOTS_DIR, { recursive: true });
  runShellFixtures("seed");
  seeded = true;
}

export function restoreShellFixtures(): void {
  if (!seeded) return;
  runShellFixtures("restore");
  seeded = false;
}

/**
 * Direct Prisma setup/restore bypasses the backend publication hook, so expire
 * Next's tagged storefront cache explicitly before a browser reads the shell.
 */
export async function revalidateShellGateCache(): Promise<void> {
  const response = await fetch(
    `${SHELL_GATE_FRONTEND_ORIGIN}/api/internal/revalidate`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-revalidate-secret": SHELL_GATE_REVALIDATE_SECRET,
      },
      body: JSON.stringify({ tags: ["storefront"] }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `storefront-shell cache revalidation failed with HTTP ${response.status}`,
    );
  }
}
