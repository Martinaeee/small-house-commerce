"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

const SDK_URL = "https://cashier.acq.sunrate.com/acq-checkout/sunrate-checkout-v1.js";

interface SunrateCheckoutSdk {
  init: (options: {
    paySession: string;
    env: string;
    paymentMethods: string[];
  }) => { mount: (element: HTMLElement) => void };
}

declare global {
  interface Window {
    SunrateCheckout?: SunrateCheckoutSdk;
  }
}

export interface SunrateMountProps {
  paySession: string;
  /** "test" or "production" — never guessed. */
  env: string;
  /** The SDK reports its own failures; they only change what is shown. */
  onError?: (message: string) => void;
}

/**
 * The SUNRATE card field. The SDK is loaded from SUNRATE's own domain and
 * mounts the hosted card fields into this element — the card number never
 * touches this site.
 *
 * The environment is never defaulted: a production checkout must not be
 * mounted against the test gateway (and the other way round), so a missing
 * environment is reported instead of guessed.
 */
export function SunrateMount({ paySession, env, onError }: SunrateMountProps) {
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const usable = env === "test" || env === "production";

  useEffect(() => {
    if (!loaded || !usable) return;
    let alive = true;
    void (async () => {
      // The await keeps the setState out of the effect's synchronous body
      // (react-hooks/set-state-in-effect; the codebase's convention).
      await Promise.resolve();
      if (!alive) return;
      const checkout = window.SunrateCheckout;
      const element = containerRef.current;
      if (!checkout || !element) {
        const message = "The secure card form could not be loaded. Please try again.";
        setFailure(message);
        onError?.(message);
        return;
      }
      try {
        checkout.init({ paySession, env, paymentMethods: ["card"] }).mount(element);
      } catch {
        const message = "The secure card form could not be loaded. Please try again.";
        setFailure(message);
        onError?.(message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loaded, usable, paySession, env, onError]);

  if (!usable) {
    return (
      <p data-testid="sunrate-mount-error" className="text-sm text-sale">
        The payment form is unavailable right now. Please try again later.
      </p>
    );
  }

  return (
    <>
      <Script
        src={SDK_URL}
        strategy="afterInteractive"
        onLoad={() => setLoaded(true)}
        onError={() => {
          const message = "The secure card form could not be loaded. Please try again.";
          setFailure(message);
          onError?.(message);
        }}
      />
      <div ref={containerRef} data-testid="sunrate-card-mount" />
      {failure !== null && (
        <p data-testid="sunrate-mount-error" className="text-sm text-sale">
          {failure}
        </p>
      )}
    </>
  );
}
