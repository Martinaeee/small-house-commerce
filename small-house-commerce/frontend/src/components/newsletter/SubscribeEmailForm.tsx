"use client";

import { useState } from "react";
import { copyText } from "@/lib/clipboard";
import { grantNewsletterCode } from "./newsletterOfferChannel";

export interface SubscribeEmailFormProps {
  source: "POPUP" | "FOOTER";
  variant?: "band" | "popup" | "footer-pill";
  placeholder: string;
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
  placeholder,
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
      // The revealed code belongs to this shopper now: an open promo field
      // puts it on the running total instead of making them type it in.
      grantNewsletterCode(promoCode);
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
  const pill = variant === "footer-pill";

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
              ? "text-center text-sm font-medium text-[#53382c]"
              : pill
                ? "text-sm font-medium text-footer-foreground"
                : "text-sm font-medium text-[#fff8f1]"
          }
        >
          You&apos;re subscribed. Thanks for joining LUWAG Living.
        </p>
        {state.promoCode ? (
          <div
            data-testid="newsletter-success-ticket"
            className={
              stacked
                ? "relative overflow-hidden rounded-2xl border border-[#e8c6b7] bg-white px-5 py-4 text-center shadow-[0_12px_32px_rgba(91,55,38,0.12)] before:absolute before:-left-3 before:top-1/2 before:h-6 before:w-6 before:-translate-y-1/2 before:rounded-full before:bg-[#fff4ed] after:absolute after:-right-3 after:top-1/2 after:h-6 after:w-6 after:-translate-y-1/2 after:rounded-full after:bg-[#fff4ed]"
                : "flex min-w-0 flex-wrap items-center justify-between gap-3 border-y border-dashed border-[#d7b8a6] py-3 text-[#fff8f1]"
            }
          >
            <div className={stacked ? "" : "min-w-0"}>
              <p
                className={
                  stacked
                    ? "text-[10px] font-semibold uppercase tracking-[0.24em] text-[#9b6c56]"
                    : "text-[10px] font-semibold uppercase tracking-[0.22em] text-[#ead7ca]"
                }
              >
                Your checkout code
              </p>
              <code
                data-testid="newsletter-subscribe-code"
                className={
                  stacked
                    ? "mt-1 block break-all font-mono text-2xl font-bold tracking-[0.12em] text-[#b5543a]"
                    : "mt-1 block break-all font-mono text-lg font-bold tracking-[0.1em] text-white"
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
                  ? "mt-3 inline-flex h-10 items-center justify-center rounded-full bg-[#704632] px-5 text-sm font-semibold text-white transition hover:bg-[#5f3929]"
                  : "shrink-0 border-b border-[#fff8f1] pb-0.5 text-sm font-semibold text-[#fff8f1] transition hover:text-white"
              }
            >
              {copied ? "Copied" : "Copy code"}
            </button>
            {stacked ? (
              <p className="mt-3 text-xs text-[#80604f]">
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
            : pill
              ? "flex min-w-0 items-center gap-2 rounded-full bg-white py-1 pl-4 pr-1 shadow-[0_1px_2px_rgba(35,48,31,0.12)]"
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
          placeholder={placeholder}
          className={
            stacked
              ? "h-12 min-w-0 w-full rounded-xl border border-[#b9927c] bg-white px-4 text-base text-[#34261f] outline-none transition placeholder:text-[#9b918c] focus:border-[#8d5138] focus:ring-2 focus:ring-[#c97b5d]/15"
              : pill
                ? "h-9 min-w-0 flex-1 bg-transparent px-0 text-[13px] text-footer-foreground outline-none transition placeholder:text-footer-muted"
                : "h-11 min-w-0 flex-1 border-0 border-b border-[#d7b8a6] bg-transparent px-0 text-base text-white outline-none transition placeholder:text-[#ead7ca]/75 focus:border-white"
          }
        />
        <button
          data-testid="newsletter-subscribe-submit"
          type="submit"
          disabled={busy}
          aria-label={busy ? "Subscribing" : "Subscribe"}
          className={
            stacked
              ? "inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#a85238] px-6 text-base font-semibold text-white shadow-[0_8px_20px_rgba(121,62,40,0.2)] transition hover:-translate-y-0.5 hover:bg-[#93462f] disabled:cursor-not-allowed disabled:opacity-60"
              : pill
                ? "group inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-footer-foreground text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                : "group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#fff8f1] text-[#704632] transition hover:scale-105 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 sm:h-12 sm:w-12"
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
              : pill
                ? "mt-2 text-xs text-[#8a2f1f]"
                : "mt-2 text-sm text-[#ffe0d3]"
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
