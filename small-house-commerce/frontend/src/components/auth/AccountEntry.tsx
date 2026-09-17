"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";

/**
 * IKEA-style person icon in the header: guests go to /login, signed-in
 * shoppers to /account. SSR/first paint renders the neutral icon only.
 */
export function AccountEntry() {
  const { status, account } = useAuth();

  const icon = (
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 20c.8-3.4 3.4-5 7-5s6.2 1.6 7 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );

  if (status === "authed" && account) {
    const firstName = account.name.split(" ")[0];
    return (
      <Link
        href="/account"
        className="flex items-center gap-2 rounded-lg p-1.5 text-ink hover:text-cta max-[374px]:p-1 lg:p-2"
        aria-label="Your account"
      >
        <span className="relative inline-flex">
          {icon}
          {/* Green ✅ at the icon's bottom-right: signed-in state indicator
              (guests render the bare icon). Mirrors the cart badge geometry. */}
          <span
            data-testid="account-signedin-badge"
            className="absolute -bottom-0.5 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success ring-2 ring-background"
            aria-hidden
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-2.5 w-2.5">
              <path
                d="m5 12.5 4.5 4.5L19 7.5"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </span>
        <span className="hidden text-sm font-medium lg:inline xl:hidden">
          Hi, {firstName}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href="/login"
      className="flex items-center gap-2 rounded-lg p-1.5 text-ink hover:text-cta max-[374px]:p-1 lg:p-2"
      aria-label="Log in"
    >
      {icon}
      <span className="hidden text-sm font-medium lg:inline xl:hidden">
        {status === "loading" ? "" : "Log in"}
      </span>
    </Link>
  );
}
