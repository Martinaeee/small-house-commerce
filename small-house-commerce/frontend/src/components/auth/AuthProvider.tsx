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
  customerApi,
  refreshAccessToken,
  tokenStorage,
  type CustomerAccount,
} from "@/lib/auth";

type AuthStatus = "loading" | "authed" | "guest";

interface AuthContextValue {
  status: AuthStatus;
  account: CustomerAccount | null;
  login: (email: string, password: string) => Promise<CustomerAccount>;
  register: (name: string, email: string, password: string) => Promise<CustomerAccount>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  saveProfile: (input: { name?: string; phone?: string }) => Promise<CustomerAccount>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  // Avoid setState after unmount during the mount refresh.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      // refreshAccessToken() resolves to null without a network call when no
      // refresh token is stored, so the no-token case shares the guest branch.
      // The first await also keeps these setStates out of the effect's
      // synchronous body (react-hooks/set-state-in-effect).
      const token = await refreshAccessToken();
      if (!alive.current) return;
      if (!token) {
        setAccount(null);
        setStatus("guest");
        return;
      }
      try {
        const me = await customerApi.me();
        if (!alive.current) return;
        setAccount(me);
        setStatus("authed");
      } catch {
        if (!alive.current) return;
        tokenStorage.clear();
        setAccount(null);
        setStatus("guest");
      }
    })();
    return () => {
      alive.current = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const me = await customerApi.login(email, password);
    setAccount(me);
    setStatus("authed");
    return me;
  }, []);

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const me = await customerApi.register(name, email, password);
      setAccount(me);
      setStatus("authed");
      return me;
    },
    [],
  );

  const logout = useCallback(async () => {
    await customerApi.logout();
    setAccount(null);
    setStatus("guest");
  }, []);

  const refreshProfile = useCallback(async () => {
    const me = await customerApi.me();
    setAccount(me);
  }, []);

  const saveProfile = useCallback(
    async (input: { name?: string; phone?: string }) => {
      const me = await customerApi.saveProfile(input);
      setAccount(me);
      return me;
    },
    [],
  );

  const value = useMemo(
    () => ({ status, account, login, register, logout, refreshProfile, saveProfile }),
    [status, account, login, register, logout, refreshProfile, saveProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
