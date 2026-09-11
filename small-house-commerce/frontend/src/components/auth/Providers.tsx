"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "./AuthProvider";

/** Client providers that wrap the whole storefront shell. */
export function Providers({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
