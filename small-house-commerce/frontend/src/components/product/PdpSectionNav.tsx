"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

interface SectionLink {
  href: string;
  label: string;
  visible: boolean;
}

export function PdpSectionNav({
  hasDetails,
  hasSpecifications,
  hasDelivery = false,
}: {
  hasDetails: boolean;
  hasSpecifications: boolean;
  hasDelivery?: boolean;
}): ReactNode {
  const navRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState("#pdp-purchase");
  const links = useMemo(() => ([
    { href: "#details", label: "Details", visible: hasDetails },
    { href: "#specifications", label: "Specifications", visible: hasSpecifications },
    { href: "#pdp-delivery", label: "Delivery", visible: hasDelivery },
    { href: "#reviews", label: "Reviews & Q&A", visible: true },
    { href: "#pdp-purchase", label: "Order Now", visible: true },
  ] satisfies SectionLink[]).filter(link => link.visible), [hasDetails, hasSpecifications, hasDelivery]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const nav = navRef.current;
      if (!nav) return;
      const line = Math.max(128, (parseFloat(getComputedStyle(nav).top) || 0) + nav.getBoundingClientRect().height + 8);
      // Delivery and purchase precede Details in the document, not in the menu.
      const targets = links.flatMap(link => {
        const target = document.getElementById(link.href.slice(1));
        return target ? [{ href: link.href, top: target.getBoundingClientRect().top }] : [];
      }).sort((a, b) => a.top - b.top);
      const passed = targets.filter(target => target.top <= line + 1);
      const current = passed.at(-1) ?? targets[0];
      if (current) setActive(current.href);
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    window.addEventListener("hashchange", queue);
    const observer = new ResizeObserver(queue);
    observer.observe(document.documentElement);
    for (const link of links) {
      const target = document.getElementById(link.href.slice(1));
      if (target) observer.observe(target);
    }
    queue();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
      window.removeEventListener("hashchange", queue);
    };
  }, [links]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const reveal = () => {
      const link = nav.querySelector<HTMLAnchorElement>('[aria-current="location"]');
      if (!link || !nav.clientWidth) return;
      // Only move the rail; scrollIntoView would also move the product page.
      if (link.offsetLeft < nav.scrollLeft) nav.scrollLeft = link.offsetLeft;
      else if (link.offsetLeft + link.offsetWidth > nav.scrollLeft + nav.clientWidth) {
        nav.scrollLeft = link.offsetLeft + link.offsetWidth - nav.clientWidth;
      }
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(nav);
    window.addEventListener("resize", reveal);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reveal);
    };
  }, [active]);

  return (
    <nav
      ref={navRef}
      aria-label="Product sections"
      className="sticky top-16 z-20 mt-8 flex overflow-x-auto border-b border-border bg-background/95 py-1 text-sm font-semibold backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex min-w-max items-center gap-6 px-1">
        {links.map(link => (
          <a
            key={link.href}
            href={link.href}
            aria-current={active === link.href ? "location" : undefined}
            onClick={() => setActive(link.href)}
            className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-sm border-b-2 outline-none hover:text-cta focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 ${
              active === link.href ? "border-cta text-cta" : "border-transparent text-ink-secondary"
            }`}
          >
            {link.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
