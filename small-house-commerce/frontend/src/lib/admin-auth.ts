/**
 * Admin (back-office User) auth client.
 *
 * Dedicated mirror of lib/auth.ts with its own storage key and state machine:
 * admin identity is a different backend table (User, not CustomerAccount), so
 * admin and storefront sessions never share state.
 *
 * The refresh token persists in localStorage under "sh_admin_refresh"; the
 * short-lived access token lives only in module memory (cleared on refresh,
 * then re-minted once). It is NEVER read from or written to localStorage —
 * no "sh_admin_access" key exists. Storefront keys ("sh_refresh", cart) are
 * never touched.
 *
 * A single in-flight refresh promise prevents parallel 401 retries from
 * rotating the same refresh token twice.
 *
 * A monotonically increasing session epoch guards in-flight refreshes:
 * the rotated tokens are committed only if no newer session (login, logout,
 * forced clear) started while the refresh was in flight. A stale response is
 * discarded entirely; it can never overwrite a newer session or resurrect one
 * that was signed out.
 */

const ADMIN_REFRESH_KEY = "sh_admin_refresh";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  status: string;
  roles: { code: string; name: string }[];
  /** PermissionCode[] granted by the user's roles, from GET /auth/me. */
  permissions: string[];
}

export type AdminAuthStatus = "loading" | "authed" | "guest";
export type AdminAuthEvent = "admin-session-start" | "admin-session-end";

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

/** Only the refresh token persists; the access token stays in module memory. */
export const adminTokenStorage = {
  getRefresh(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ADMIN_REFRESH_KEY);
  },
  setRefresh(token: string) {
    window.localStorage.setItem(ADMIN_REFRESH_KEY, token);
  },
  clearRefresh() {
    window.localStorage.removeItem(ADMIN_REFRESH_KEY);
  },
};

let accessToken: string | null = null;
let refreshFlight: Promise<string | null> | null = null;
/** Bumped on every local session transition; stale refresh flights are dropped. */
let sessionEpoch = 0;

const listeners = new Set<(event: AdminAuthEvent) => void>();

function emitAdminAuthEvent(event: AdminAuthEvent): void {
  // A misbehaving listener must not break the auth state machine.
  listeners.forEach((cb) => {
    try {
      cb(event);
    } catch {
      /* ignore */
    }
  });
}

/**
 * Subscribes to background admin session transitions. Returns an unsubscribe
 * function. Safe to call from client effects; never called during SSR render.
 */
export function onAdminAuthEvent(cb: (e: AdminAuthEvent) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Ends the admin session only if it still belongs to `epochAtStart`. A logout,
 * login, or earlier forced clear that raced the refresh has already taken
 * ownership of the state, so the stale caller must not touch it.
 * Returns true when this call performed the clear.
 */
function endAdminSessionIfCurrent(epochAtStart: number): boolean {
  if (sessionEpoch !== epochAtStart) return false;
  sessionEpoch += 1;
  accessToken = null;
  adminTokenStorage.clearRefresh();
  emitAdminAuthEvent("admin-session-end");
  return true;
}

/**
 * Unconditional local admin sign-out (e.g. an authenticated request proves the
 * bootstrap session is dead). Bumps the epoch so any in-flight refresh is
 * discarded when it settles.
 */
export function clearAdminSession(): void {
  sessionEpoch += 1;
  accessToken = null;
  adminTokenStorage.clearRefresh();
  emitAdminAuthEvent("admin-session-end");
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ?? `Request failed: ${res.status}`;
  } catch {
    return `Request failed: ${res.status}`;
  }
}

/** Mints a new admin access token from the stored refresh token (once, shared). */
export async function refreshAdminAccess(): Promise<string | null> {
  const stored = adminTokenStorage.getRefresh();
  if (!stored) return null;
  if (!refreshFlight) {
    // Capture the epoch after reading the stored token; tokens are committed
    // on settle only if the epoch is still this one.
    const epochAtStart = sessionEpoch;
    refreshFlight = (async () => {
      try {
        const res = await fetch("/api/v1/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: stored }),
        });
        if (!res.ok) {
          endAdminSessionIfCurrent(epochAtStart);
          return null;
        }
        const pair = (await res.json()) as TokenPair;
        if (sessionEpoch !== epochAtStart) {
          // Stale flight: logout/login/clear happened while the request was in
          // flight. Discard BOTH rotated tokens; never write.
          return null;
        }
        accessToken = pair.accessToken;
        adminTokenStorage.setRefresh(pair.refreshToken); // rotation
        return pair.accessToken;
      } catch {
        endAdminSessionIfCurrent(epochAtStart);
        return null;
      } finally {
        refreshFlight = null;
      }
    })();
  }
  return refreshFlight;
}

/**
 * Admin-authenticated fetch: attaches the in-memory bearer token; on 401 runs
 * the single-flight refresh and retries once. Throws Error with the backend
 * message (readError) on failure.
 */
export async function adminAuthedFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const run = (token: string | null) =>
    fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        // Caller headers come FIRST so the Authorization below can never be
        // overridden by a caller-supplied bearer token.
        ...init?.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  let res = await run(accessToken);
  if (res.status === 401) {
    const refreshed = await refreshAdminAccess();
    if (refreshed) res = await run(refreshed);
  }
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<T>;
}

/** Pure RBAC helper: the backend remains the enforcement authority. */
export function hasPermission(admin: AdminUser | null, code: string): boolean {
  return admin?.permissions.includes(code) ?? false;
}

/** True if the value contains a backslash or any C0/DEL control character. */
function hasUnsafeChar(value: string): boolean {
  for (const ch of value) {
    if (ch === "\\") return true;
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Relative redirect target whitelist for admin login: same-origin absolute
 * paths only (same validation as lib/auth.ts safeNext), but the fallback is
 * the admin orders route — an admin login must never land on the storefront
 * "/account". Rejected forms: "//evil.com", "/\evil.com", any backslash or
 * control character.
 */
export function safeAdminNext(
  next: string | null | undefined,
  fallback = "/admin/orders",
): string {
  if (
    next &&
    next.startsWith("/") &&
    !next.startsWith("//") && // second char must not be "/"
    next[1] !== "\\" && // second char must not be "\"
    !hasUnsafeChar(next)
  ) {
    return next;
  }
  return fallback;
}

export const adminAuthApi = {
  /**
   * POST /auth/login, stores only the refresh token (access stays in module
   * memory), then loads the full identity (roles + permissions) via /auth/me.
   */
  async login(email: string, password: string): Promise<AdminUser> {
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = (await res.json()) as TokenPair;
    // New session: invalidate any in-flight refresh from a previous session.
    sessionEpoch += 1;
    accessToken = data.accessToken;
    adminTokenStorage.setRefresh(data.refreshToken);
    emitAdminAuthEvent("admin-session-start");
    // Login's user payload has no roles/permissions; hydrate via /auth/me.
    return adminAuthedFetch<AdminUser>("/api/v1/auth/me");
  },

  async logout(): Promise<void> {
    const refreshToken = adminTokenStorage.getRefresh();
    // Bump/clear/emit SYNCHRONOUSLY, before the network call: an in-flight
    // refresh that settles afterwards sees the new epoch and is discarded, so
    // logout can never be undone by the late response.
    sessionEpoch += 1;
    accessToken = null;
    adminTokenStorage.clearRefresh();
    emitAdminAuthEvent("admin-session-end");
    if (refreshToken) {
      // Best effort: local sign-out happens regardless of the response.
      // Revokes the current stored token; a rotated token minted by a racing
      // refresh is never committed client-side, so it simply dies unused.
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }
  },

  me: () => adminAuthedFetch<AdminUser>("/api/v1/auth/me"),
};
