"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  adminAuthApi,
  clearAdminSession,
  hasPermission as accountHasPermission,
  onAdminAuthEvent,
  refreshAdminAccess,
  type AdminAuthStatus,
  type AdminUser,
} from "@/lib/admin-auth";

interface AdminAuthContextValue {
  status: AdminAuthStatus;
  admin: AdminUser | null;
  hasPermission: (code: string) => boolean;
  login: (email: string, password: string) => Promise<AdminUser>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

/**
 * Back-office auth context. 1:1 mirror of the storefront AuthProvider, driven
 * by the separate lib/admin-auth session (storage key sh_admin_refresh; admin
 * and storefront sessions never share state).
 */
export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AdminAuthStatus>("loading");
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  // Avoid setState after unmount during the mount refresh.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    // Observe background admin session ends (explicit logout elsewhere, or a
    // refresh failure that clears the session) so the UI never keeps claiming
    // an authenticated admin after the tokens are gone.
    const unsubscribe = onAdminAuthEvent((event) => {
      if (!alive.current || event !== "admin-session-end") return;
      setAdmin(null);
      setStatus("guest");
    });
    void (async () => {
      // refreshAdminAccess() resolves to null without a network call when no
      // refresh token is stored, so the no-token case shares the guest branch.
      // The first await also keeps these setStates out of the effect's
      // synchronous body (react-hooks/set-state-in-effect).
      const token = await refreshAdminAccess();
      if (!alive.current) return;
      if (!token) {
        setAdmin(null);
        setStatus("guest");
        return;
      }
      try {
        const me = await adminAuthApi.me();
        if (!alive.current) return;
        setAdmin(me);
        setStatus("authed");
      } catch {
        if (!alive.current) return;
        // Wipes memory token + storage, bumps the epoch, emits session-end.
        clearAdminSession();
        setAdmin(null);
        setStatus("guest");
      }
    })();
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, []);

  // The authed STATE is committed only AFTER login() fully settles: the API
  // persists the refresh token before /auth/me hydrates roles/permissions, and
  // a rejected /auth/me must leave the visitor on the login page with the
  // error — no optimistic authed chrome flash.
  const login = useCallback(async (email: string, password: string) => {
    const me = await adminAuthApi.login(email, password);
    setAdmin(me);
    setStatus("authed");
    return me;
  }, []);

  const logout = useCallback(async () => {
    await adminAuthApi.logout();
    setAdmin(null);
    setStatus("guest");
  }, []);

  const hasPermission = useCallback(
    (code: string) => accountHasPermission(admin, code),
    [admin],
  );

  const value = useMemo(
    () => ({ status, admin, hasPermission, login, logout }),
    [status, admin, hasPermission, login, logout],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used inside <AdminAuthProvider>");
  return ctx;
}
