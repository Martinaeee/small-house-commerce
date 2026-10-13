/**
 * Origins of the e2e gate's own servers.
 *
 * Kept in one place so a run can move to a free port pair when another
 * worktree's runtime already holds 3210/3211:
 *
 *   E2E_BACKEND_PORT=3220 E2E_FRONTEND_PORT=3221 pnpm exec playwright test ...
 *
 * Defaults match playwright.config.ts, so an un-overridden run is unchanged.
 */
export const E2E_BACKEND_ORIGIN = `http://127.0.0.1:${Number(
  process.env.E2E_BACKEND_PORT ?? 3210,
)}`;
export const E2E_FRONTEND_ORIGIN = `http://localhost:${Number(
  process.env.E2E_FRONTEND_PORT ?? 3211,
)}`;
export const E2E_API = `${E2E_BACKEND_ORIGIN}/api/v1`;
