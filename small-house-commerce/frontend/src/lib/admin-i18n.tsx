"use client";

/**
 * Admin back-office i18n (order-workbench spec §7.1): lightweight zh/en
 * dictionary with a React context + hook. Default language is zh; the choice
 * is persisted to localStorage. Keys missing from the active dictionary fall
 * back to English (progressive migration of the rest of the admin area).
 *
 * No external dependency: the dictionary is plain TS and the store is a
 * useSyncExternalStore on a module-level state (survives across admin pages).
 */
import { createContext, useContext, useMemo } from "react";
import { useSyncExternalStore } from "react";
import { zh } from "@/i18n/zh";
import { en } from "@/i18n/en";

export type Lang = "zh" | "en";
export type TKey = keyof typeof zh;

const STORAGE_KEY = "luwag_admin_lang";
const listeners = new Set<() => void>();
let currentLang: Lang = "zh";

function readStored(): Lang {
  if (typeof window === "undefined") return "zh";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

function emit() {
  for (const l of listeners) l();
}

export function setAdminLang(lang: Lang) {
  currentLang = lang;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // storage unavailable: session-only.
  }
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): Lang {
  return currentLang;
}

export interface AdminI18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Translate a key; falls back to en, then to the key itself. */
  t: (key: TKey, vars?: Record<string, string | number>) => string;
}

const AdminI18nContext = createContext<AdminI18n | null>(null);

export function AdminI18nProvider({ children }: { children: React.ReactNode }) {
  const lang: Lang = useSyncExternalStore(subscribe, getSnapshot, () => "zh");
  const i18n = useMemo<AdminI18n>(() => {
    const dict = lang === "zh" ? zh : en;
    const fallback = lang === "zh" ? en : zh;
    return {
      lang,
      setLang: setAdminLang,
      t: (key, vars) => {
        const tmpl = dict[key] ?? fallback[key] ?? (key as string);
        if (!vars) return tmpl;
        return tmpl.replace(/\{(\w+)\}/g, (_, k: string) =>
          vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
        );
      },
    };
  }, [lang]);

  return <AdminI18nContext.Provider value={i18n}>{children}</AdminI18nContext.Provider>;
}

export function useAdminI18n(): AdminI18n {
  const ctx = useContext(AdminI18nContext);
  if (!ctx) {
    // Fallback outside the provider: caller is free to use t() directly.
    throw new Error("useAdminI18n must be used within AdminI18nProvider");
  }
  return ctx;
}
