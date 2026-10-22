"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import {
  normalizeContactPhone,
  subscribeToRestockAlert,
  type RestockContact,
} from "./restock-contact";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

type DialogState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "success" }
  | { status: "error"; message: string };

export interface BackInStockDialogProps {
  skuId: string;
  productName: string;
  onClose(): void;
  /**
   * Called once the alert is saved, with the contact the shopper gave us.
   * The PDP uses it to keep the item in the cart, so one click covers both
   * wishes.
   */
  onSubscribed?: (contact: RestockContact) => void;
  /**
   * True when the surface also keeps the item in the cart, so the copy may
   * say so. It is never promised without the cart add behind it.
   */
  keepsInCart?: boolean;
  /**
   * Closes the dialog as soon as the alert is saved instead of showing the
   * success panel. The page shows its own confirmation (a toast) then.
   */
  dismissOnSuccess?: boolean;
  /** Pre-fills the contact from a previous alert. */
  initialEmail?: string;
  initialPhone?: string | null;
  /** Shown before the shopper types anything (a failed retry, for example). */
  initialError?: string | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function BackInStockDialog({
  skuId,
  productName,
  onClose,
  onSubscribed,
  keepsInCart = false,
  dismissOnSuccess = false,
  initialEmail = "",
  initialPhone = null,
  initialError = null,
  returnFocusRef,
}: BackInStockDialogProps) {
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [state, setState] = useState<DialogState>(
    initialError ? { status: "error", message: initialError } : { status: "idle" },
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const requestLocked = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const panel = panelRef.current;
    const returnFocus = returnFocusRef?.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    emailRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      alive.current = false;
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      returnFocus?.focus();
    };
  }, [onClose, returnFocusRef]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestLocked.current) return;
    const value = email.trim();
    if (!EMAIL_PATTERN.test(value)) {
      setState({ status: "error", message: "Please enter a valid email." });
      return;
    }
    const phoneValue = phone.trim();
    if (phoneValue !== "" && normalizeContactPhone(phoneValue) === null) {
      setState({
        status: "error",
        message: "Please enter a valid phone number, or leave it empty.",
      });
      return;
    }

    requestLocked.current = true;
    setState({ status: "busy" });
    try {
      await subscribeToRestockAlert({
        skuId,
        email: value,
        phone: phoneValue === "" ? null : phoneValue,
      });
      if (!alive.current) return;
      const contact: RestockContact = {
        email: value,
        phone: phoneValue === "" ? null : phoneValue,
      };
      if (dismissOnSuccess) {
        // The page confirms with its own message, so the dialog gets out of
        // the way.
        onSubscribed?.(contact);
        onClose();
        return;
      }
      setState({ status: "success" });
      onSubscribed?.(contact);
    } catch {
      if (alive.current) {
        setState({
          status: "error",
          message: "We couldn't save your alert. Please try again.",
        });
      }
    } finally {
      requestLocked.current = false;
    }
  }

  const busy = state.status === "busy";

  return (
    <div
      data-testid="back-in-stock-backdrop"
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-0 backdrop-blur-[1px] sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="back-in-stock-title"
        aria-describedby="back-in-stock-description"
        className="relative max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-t-2xl border border-border bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 shadow-2xl sm:w-[min(94vw,28rem)] sm:rounded-2xl sm:p-6"
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full text-lg text-ink-secondary transition hover:bg-background hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
        >
          ✕
        </button>
        <div className="pr-10">
          <h2
            id="back-in-stock-title"
            className="text-xl font-semibold text-ink"
          >
            Notify me when available
          </h2>
          <p
            id="back-in-stock-description"
            className="mt-1 text-sm text-ink-secondary"
          >
            We&apos;ll email you when {productName} is back in stock.
            {keepsInCart
              ? " We’ll also keep it in your cart."
              : ""}
          </p>
        </div>

        {state.status === "success" ? (
          <div className="mt-6" aria-live="polite">
            <p className="rounded-xl border border-primary bg-primary-light/40 px-4 py-3 text-sm font-medium text-ink">
              We&apos;ll email you when it&apos;s back in stock.
              {keepsInCart ? " It’s also in your cart." : ""}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-lg bg-cta px-5 text-sm font-semibold text-cta-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="mt-5">
            <label
              htmlFor={`back-in-stock-email-${skuId}`}
              className="text-sm font-semibold text-ink"
            >
              Email address
            </label>
            <input
              ref={emailRef}
              id={`back-in-stock-email-${skuId}`}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (state.status === "error") setState({ status: "idle" });
              }}
              placeholder="you@example.com"
              className="mt-2 h-12 w-full min-w-0 rounded-lg border border-border bg-background px-4 text-base text-ink outline-none transition placeholder:text-ink-muted focus:border-cta focus:ring-2 focus:ring-cta/15"
            />
            <label
              htmlFor={`back-in-stock-phone-${skuId}`}
              className="mt-4 block text-sm font-semibold text-ink"
            >
              Phone number (optional)
            </label>
            <input
              id={`back-in-stock-phone-${skuId}`}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                if (state.status === "error") setState({ status: "idle" });
              }}
              placeholder="0917 123 4567"
              className="mt-2 h-12 w-full min-w-0 rounded-lg border border-border bg-background px-4 text-base text-ink outline-none transition placeholder:text-ink-muted focus:border-cta focus:ring-2 focus:ring-cta/15"
            />
            {state.status === "error" ? (
              <p role="alert" className="mt-2 text-sm text-sale">
                {state.message}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy}
              aria-label={busy ? "Notifying" : "Notify me"}
              className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-lg bg-cta px-5 text-base font-semibold text-cta-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Saving…" : "Notify me"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
