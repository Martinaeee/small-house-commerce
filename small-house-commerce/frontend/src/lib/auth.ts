/**
 * Storefront customer auth client.
 *
 * The refresh token persists in localStorage; the short-lived access token
 * lives only in module memory (cleared on refresh, then re-minted once).
 * A single in-flight refresh promise prevents parallel 401 retries from
 * rotating the same refresh token twice.
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
    refreshFlight = (async () => {
      try {
        const res = await fetch("/api/v1/storefront/customers/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: stored }),
        });
        if (!res.ok) {
          tokenStorage.clear();
          return null;
        }
        const pair = (await res.json()) as TokenPair;
        accessToken = pair.accessToken;
        tokenStorage.set(pair.refreshToken); // rotation
        return pair.accessToken;
      } catch {
        tokenStorage.clear();
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
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
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
    accessToken = data.accessToken;
    tokenStorage.set(data.refreshToken);
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
    accessToken = data.accessToken;
    tokenStorage.set(data.refreshToken);
    return data.account;
  },

  async logout(): Promise<void> {
    const refreshToken = tokenStorage.get();
    accessToken = null;
    tokenStorage.clear();
    if (refreshToken) {
      // Best effort: local sign-out happens regardless of the response.
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

/** Relative redirect target whitelist: same-origin paths only. */
export function safeNext(next: string | null | undefined): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/account";
}
