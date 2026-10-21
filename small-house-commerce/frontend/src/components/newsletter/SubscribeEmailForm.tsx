"use client";

import { useState } from "react";
import { copyText } from "@/lib/clipboard";

export interface SubscribeEmailFormProps {
  source: "POPUP" | "FOOTER";
  variant?: "band" | "popup";
  onSuccess?: (promoCode: string | null) => void;
}

type FormState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "done"; promoCode: string | null }
  | { status: "error"; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The single subscribe control behind the popup and the footer band. The promo
 * code is returned by the subscribe response (never shipped in public
 * settings), so it is shown only after a successful submit.
 */
export function SubscribeEmailForm({
  source,
  variant = "band",
  onSuccess,
}: SubscribeEmailFormProps) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>({ status: "idle" });
  const [copied, setCopied] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (state.status === "busy") return;

    const value = email.trim();
    if (!EMAIL_PATTERN.test(value)) {
      setState({ status: "error", message: "Please enter a valid email." });
      return;
    }

    setState({ status: "busy" });
    try {
      const response = await fetch("/api/v1/storefront/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value, source }),
      });
      if (!response.ok) throw new Error(String(response.status));

      const data = (await response.json()) as { promoCode?: string | null };
      const promoCode = data.promoCode ?? null;
      if (onSuccess) {
        setEmail("");
        setCopied(false);
        setState({ status: "idle" });
        onSuccess(promoCode);
      } else {
        setState({ status: "done", promoCode });
      }
    } catch {
      setState({
        status: "error",
        message: "We could not subscribe you. Please try again.",
      });
    }
  }

  async function copyCode(code: string) {
    setCopied(await copyText(code));
  }

  const stacked = variant === "popup";

  if (state.status === "done") {
    return (
      <div
        className={stacked ? "flex flex-col gap-3" : "flex min-w-0 flex-col gap-2"}
        aria-live="polite"
      >
        <p
          data-testid="newsletter-subscribe-status"
          className={
            stacked
              ? "text-center text-sm font-medium text-newsletter-text"
              : "text-sm font-medium text-footer-foreground"
          }
        >
          You&apos;re subscribed. Thanks for joining LUWAG Living.
        </p>
        {state.promoCode ? (
          <div
            data-testid="newsletter-success-ticket"
            className={
              stacked
                ? "relative overflow-hidden rounded-2xl border border-newsletter-border bg-newsletter-card px-5 py-4 text-center shadow-[0_12px_32px_rgba(91,55,38,0.12)] before:absolute before:-left-3 before:top-1/2 before:h-6 before:w-6 before:-translate-y-1/2 before:rounded-full before:bg-newsletter-surface after:absolute after:-right-3 after:top-1/2 after:h-6 after:w-6 after:-translate-y-1/2 after:rounded-full after:bg-newsletter-surface"
                : "flex min-w-0 flex-wrap items-center justify-between gap-3 border-y border-dashed border-footer-border py-3 text-footer-foreground"
            }
          >
            <div className={stacked ? "" : "min-w-0"}>
              <p
                className={
                  stacked
                    ? "text-[10px] font-semibold uppercase tracking-[0.24em] text-newsletter-secondary"
                    : "text-[10px] font-semibold uppercase tracking-[0.22em] text-footer-secondary"
                }
              >
                Your checkout code
              </p>
              <code
                data-testid="newsletter-subscribe-code"
                className={
                  stacked
                    ? "mt-1 block break-all font-mono text-2xl font-bold tracking-[0.12em] text-newsletter-ticket"
                    : "mt-1 block break-all font-mono text-lg font-bold tracking-[0.1em] text-footer-foreground"
                }
              >
                {state.promoCode}
              </code>
            </div>
            <button
              data-testid="newsletter-copy-code"
              type="button"
              onClick={() => {
                void copyCode(state.promoCode ?? "");
              }}
              className={
                stacked
                  ? "mt-3 inline-flex h-10 items-center justify-center rounded-full bg-newsletter-accent px-5 text-sm font-semibold text-newsletter-foreground transition hover:bg-newsletter-accent-hover"
                  : "shrink-0 border-b border-footer-foreground pb-0.5 text-sm font-semibold text-footer-foreground transition hover:text-footer-foreground"
              }
            >
              {copied ? "Copied" : "Copy code"}
            </button>
            {stacked ? (
              <p className="mt-3 text-xs text-newsletter-secondary">
                Apply it at checkout to claim your welcome offer.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const busy = state.status === "busy";

  return (
    <form
      onSubmit={handleSubmit}
      // Native constraint validation would block submit before our own
      // (testable, translatable) message can render.
      noValidate
      className="min-w-0"
    >
      <div
        className={
          stacked
            ? "flex min-w-0 flex-col gap-3"
            : "flex min-w-0 items-end gap-3 sm:gap-4"
        }
      >
        <label className="sr-only" htmlFor={`newsletter-email-${source}`}>
          Email address
        </label>
        <input
          id={`newsletter-email-${source}`}
          data-testid="newsletter-subscribe-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (state.status === "error") setState({ status: "idle" });
          }}
          placeholder={stacked ? "Enter your email address" : "Your email address"}
          className={
            stacked
              ? "h-12 min-w-0 w-full rounded-xl border border-newsletter-border bg-newsletter-card px-4 text-base text-newsletter-text outline-none transition placeholder:text-newsletter-muted focus:border-newsletter-accent focus:ring-2 focus:ring-newsletter-accent/15"
              : "h-11 min-w-0 flex-1 border-0 border-b border-footer-border bg-transparent px-0 text-base text-footer-foreground outline-none transition placeholder:text-footer-secondary/75 focus:border-footer-foreground"
          }
        />
        <button
          data-testid="newsletter-subscribe-submit"
          type="submit"
          disabled={busy}
          aria-label={busy ? "Subscribing" : "Subscribe"}
          className={
            stacked
              ? "inline-flex h-12 w-full items-center justify-center rounded-xl bg-newsletter-accent px-6 text-base font-semibold text-newsletter-foreground shadow-[0_8px_20px_rgba(121,62,40,0.2)] transition hover:-translate-y-0.5 hover:bg-newsletter-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              : "group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-footer-foreground text-footer-background transition hover:scale-105 hover:bg-footer-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:h-12 sm:w-12"
          }
        >
          {busy ? (
            <span className={stacked ? "" : "text-xs"}>
              {stacked ? "Subscribing…" : "…"}
            </span>
          ) : stacked ? (
            "Unlock my offer"
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6 transition-transform group-hover:translate-x-0.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M5 12h13M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
      {state.status === "error" ? (
        <p
          data-testid="newsletter-subscribe-status"
          role="alert"
          className={
            stacked
              ? "mt-2 text-sm text-sale"
              : "mt-2 text-sm text-footer-foreground"
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
