"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Storefront-wide "back to top" floating button, mounted once from the
 * storefront layout. Fades in after 60% of a viewport of scrolling (a full
 * viewport would never be reachable on pages 1-2 screens tall, e.g. a short
 * catalog). Hidden controls leave the tab sequence (tabIndex -1).
 *
 * Bottom offsets clear the fixed mobile chrome that owns each route —
 * MobileTabBar's 4rem bar by default, and the taller (~8rem) sticky CTA bar
 * from MobileStickyCta (PDP/LP) or CartView on their routes. The desktop
 * offset stacks above the Messenger bubble's default 16px/56px slot.
 */
export function BackToTop() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(window.scrollY > window.innerHeight * 0.6);
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const scrollToTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  const tallMobileBar =
    pathname.startsWith("/products/") ||
    pathname.startsWith("/lp/") ||
    pathname === "/cart";

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Back to top"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={`fixed right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-cta shadow-md outline-none transition-opacity duration-200 hover:bg-primary-light focus-visible:ring-2 focus-visible:ring-cta ${
        tallMobileBar
          ? "bottom-[calc(8rem+env(safe-area-inset-bottom)+0.75rem)]"
          : "bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)]"
      } md:bottom-24 ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden="true">
        <path d="M12 19V5" strokeLinecap="round" />
        <path d="M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
