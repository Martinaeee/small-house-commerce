"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { safeNext } from "@/lib/auth";
import { useAuth } from "@/components/auth/AuthProvider";

const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus:border-cta focus:outline-none";

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
      router.push(safeNext(searchParams.get("next")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-[420px] px-4 py-12">
      <h1 className="text-2xl font-semibold text-ink">Log in</h1>
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
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <Button type="submit" size="md" disabled={pending} className="w-full">
          {pending ? "Logging in…" : "Log in"}
        </Button>
      </form>
      <p className="mt-4 text-sm text-ink-secondary">
        New to Small House PH?{" "}
        <Link
          href={`/register?next=${encodeURIComponent(safeNext(searchParams.get("next")))}`}
          className="text-cta hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
