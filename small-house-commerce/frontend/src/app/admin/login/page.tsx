"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { safeAdminNext } from "@/lib/admin-auth";

const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

function LoginForm() {
  const { status, login } = useAdminAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // m12: an already-authed account hitting /admin/login is redirected to the
  // safe admin destination on mount (and when bootstrap resolves authed).
  useEffect(() => {
    if (status === "authed") {
      router.replace(safeAdminNext(searchParams.get("next")));
    }
  }, [status, router, searchParams]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
      router.push(safeAdminNext(searchParams.get("next")));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      // Backend answers bad credentials with 401 "Invalid credentials"; map
      // to the friendly admin wording. Network/5xx messages stay verbatim.
      setError(
        message === "Invalid credentials" ? "Invalid email or password." : message,
      );
      setPending(false);
    }
  }

  if (status === "authed") return null;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px]">
        <div className="rounded-xl border border-border bg-card p-6">
          <h1 className="text-xl font-semibold text-ink">Small House Admin</h1>
          <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              Email
              <input
                type="email"
                autoComplete="email"
                required
                className={inputCls}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" size="md" disabled={pending} className="w-full">
              {pending ? "Logging in…" : "Log in"}
            </Button>
          </form>
        </div>
        <p className="mt-4 text-center text-sm text-ink-secondary">
          <Link href="/" className="text-cta hover:underline">
            ← Back to store
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
