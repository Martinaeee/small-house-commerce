/**
 * Storefront customer auth client.
 *
 * The refresh token persists in localStorage; the short-lived access token
 * lives only in module memory (cleared on refresh, then re-minted once).
 * A single in-flight refresh promise prevents parallel 401 retries from
 * rotating the same refresh token twice.
 *
 * A monotonically increasing session epoch guards in-flight refreshes:
 * the rotated tokens are committed only if no newer session (login/register,
 * logout, forced clear) started while the refresh was in flight. A stale
 * response is discarded entirely; it can never overwrite a newer session or
 * resurrect one that was signed out.
 */

const REFRESH_KEY = "sh_refresh";

export interface CustomerAccount {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

export interface AccountOrderItem {
  productNameSnapshot: string;
  variantSnapshot: string;
  quantity: number;
  lineTotal: number;
}

export interface AccountOrder {
  orderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  currency: string;
  grandTotal: number;
  createdAt: string;
  items: AccountOrderItem[];
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export type AuthEvent = "session-start" | "session-end";

export const tokenStorage = {
  get(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(REFRESH_KEY);
  },
  set(token: string) {
    window.localStorage.setItem(REFRESH_KEY, token);
  },
  clear() {
    window.localStorage.removeItem(REFRESH_KEY);
  },
};

let accessToken: string | null = null;
let refreshFlight: Promise<string | null> | null = null;
/** Bumped on every local session transition; stale refresh flights are dropped. */
let sessionEpoch = 0;

const listeners = new Set<(event: AuthEvent) => void>();

function emitAuthEvent(event: AuthEvent): void {
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
 * Subscribes to background session transitions. Returns an unsubscribe
 * function. Safe to call from client effects; never called during SSR render.
 */
export function onAuthEvent(cb: (event: AuthEvent) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Ends the session only if it still belongs to `epochAtStart`. A logout,
 * login/register, or earlier forced clear that raced the refresh has already
 * taken ownership of the state, so the stale caller must not touch it.
 * Returns true when this call performed the clear.
 */
function endSessionIfCurrent(epochAtStart: number): boolean {
  if (sessionEpoch !== epochAtStart) return false;
  sessionEpoch += 1;
  accessToken = null;
  tokenStorage.clear();
  emitAuthEvent("session-end");
  return true;
}

/**
 * Unconditional local sign-out (e.g. an authenticated request proves the
 * bootstrap session is dead). Bumps the epoch so any in-flight refresh is
 * discarded when it settles.
 */
export function clearSession(): void {
  sessionEpoch += 1;
  accessToken = null;
  tokenStorage.clear();
  emitAuthEvent("session-end");
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ?? `Request failed: ${res.status}`;
  } catch {
    return `Request failed: ${res.status}`;
  }
}

/** Mints a new access token from the stored refresh token (once, shared). */
export async function refreshAccessToken(): Promise<string | null> {
  const stored = tokenStorage.get();
  if (!stored) return null;
  if (!refreshFlight) {
    // Capture the epoch after reading the stored token; tokens are committed
    // on settle only if the epoch is still this one.
    const epochAtStart = sessionEpoch;
    refreshFlight = (async () => {
      try {
        const res = await fetch("/api/v1/storefront/customers/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: stored }),
        });
        if (!res.ok) {
          endSessionIfCurrent(epochAtStart);
          return null;
        }
        const pair = (await res.json()) as TokenPair;
        if (sessionEpoch !== epochAtStart) {
          // Stale flight: logout/login/register/clear happened while the
          // request was in flight. Discard BOTH rotated tokens; never write.
          return null;
        }
        accessToken = pair.accessToken;
        tokenStorage.set(pair.refreshToken); // rotation
        return pair.accessToken;
      } catch {
        endSessionIfCurrent(epochAtStart);
        return null;
      } finally {
        refreshFlight = null;
      }
    })();
  }
  return refreshFlight;
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
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
    const refreshed = await refreshAccessToken();
    if (refreshed) res = await run(refreshed);
  }
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<T>;
}

export const customerApi = {
  async register(name: string, email: string, password: string): Promise<CustomerAccount> {
    const res = await fetch("/api/v1/storefront/customers/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = (await res.json()) as TokenPair & { account: CustomerAccount };
    // New session: invalidate any in-flight refresh from a previous session.
    sessionEpoch += 1;
    accessToken = data.accessToken;
    tokenStorage.set(data.refreshToken);
    emitAuthEvent("session-start");
    return data.account;
  },

  async login(email: string, password: string): Promise<CustomerAccount> {
    const res = await fetch("/api/v1/storefront/customers/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = (await res.json()) as TokenPair & { account: CustomerAccount };
    // New session: invalidate any in-flight refresh from a previous session.
    sessionEpoch += 1;
    accessToken = data.accessToken;
    tokenStorage.set(data.refreshToken);
    emitAuthEvent("session-start");
    return data.account;
  },

  async logout(): Promise<void> {
    const refreshToken = tokenStorage.get();
    // Bump/clear/emit SYNCHRONOUSLY, before the network call: an in-flight
    // refresh that settles afterwards sees the new epoch and is discarded, so
    // logout can never be undone by the late response.
    sessionEpoch += 1;
    accessToken = null;
    tokenStorage.clear();
    emitAuthEvent("session-end");
    if (refreshToken) {
      // Best effort: local sign-out happens regardless of the response.
      // Revokes the current stored token; a rotated token minted by a racing
      // refresh is never committed client-side, so it simply dies unused.
      await fetch("/api/v1/storefront/customers/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }
  },

  me: () => authedFetch<CustomerAccount>("/api/v1/storefront/customers/me"),

  saveProfile: (input: { name?: string; phone?: string }) =>
    authedFetch<CustomerAccount>("/api/v1/storefront/customers/me", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  listOrders: (page = 1) =>
    authedFetch<{
      items: AccountOrder[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/v1/storefront/customers/me/orders?page=${page}`),
};

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
 * Relative redirect target whitelist: same-origin absolute paths only.
 * Rejected forms include protocol-relative or backslash-smuggled hosts:
 *   "//evil.com"  -> starts with two slashes
 *   "/\\evil.com" -> second char is a backslash (WHATWG resolves it cross-origin)
 * Any backslash or control character anywhere is rejected; legitimate
 * storefront paths never contain them.
 */
export function safeNext(next: string | null | undefined): string {
  if (
    next &&
    next.startsWith("/") &&
    !next.startsWith("//") && // second char must not be "/"
    next[1] !== "\\" && // second char must not be "\"
    !hasUnsafeChar(next)
  ) {
    return next;
  }
  return "/account";
}
