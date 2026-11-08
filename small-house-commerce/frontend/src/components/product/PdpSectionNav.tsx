"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDesktopViewport } from "./useDesktopViewport";
import mobileStyles from "./PdpMobile.module.css";

interface SectionLink {
  href: string;
  label: string;
  visible: boolean;
}

export function PdpSectionNav({
  hasDetails,
  hasSpecifications,
}: {
  hasDetails: boolean;
  hasSpecifications: boolean;
}): ReactNode {
  const navRef = useRef<HTMLElement>(null);
  const desktop = useDesktopViewport();
  const [active, setActive] = useState("#pdp-purchase");
  // JD-style rail: it must not hover over the hero gallery. Pins below the
  // header only after the main media has left the viewport.
  const [galleryVisible, setGalleryVisible] = useState(true);
  const links = useMemo(() => {
    if (!desktop) {
      // Phones: one compact rail, ordered like the JD product tabs. "Product"
      // returns to the top of the product grid; the rest match the sections.
      return [
        { href: "#product", label: "Product", visible: true },
        { href: "#details", label: "Details", visible: hasDetails },
        { href: "#specifications", label: "Specifications", visible: hasSpecifications },
        { href: "#reviews", label: "Reviews & Q&A", visible: true },
      ].filter((link) => link.visible) satisfies SectionLink[];
    }
    return [
      { href: "#details", label: "Details", visible: hasDetails },
      { href: "#specifications", label: "Specifications", visible: hasSpecifications },
      { href: "#reviews", label: "Reviews & Q&A", visible: true },
      // The phone carries a single fixed purchase bar; a second "Order Now" tab
      // here would be a competing purchase entry.
      { href: "#pdp-purchase", label: "Order Now", visible: true },
    ].filter((link) => link.visible) satisfies SectionLink[];
  }, [desktop, hasDetails, hasSpecifications]);

  useEffect(() => {
    if (desktop || typeof IntersectionObserver === "undefined") return;
    const gallery = document.querySelector("[data-pdp-gallery]");
    if (!gallery) {
      // No hero media to protect: keep the rail sticky as before.
      const timer = window.setTimeout(() => setGalleryVisible(false), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      ([entry]) => setGalleryVisible(entry.isIntersecting),
      { threshold: 0.05 },
    );
    observer.observe(gallery);
    return () => observer.disconnect();
  }, [desktop]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    // The sticky shell includes both the announcement and Header, whose height
    // changes with the viewport, fonts and announcement text.
    const header = nav.closest("[data-storefront-shell-mode]")?.querySelector("header")?.parentElement;
    const previousMargins = new Map<HTMLElement, string>();
    let frame = 0;
    const update = () => {
      frame = 0;
      if (header) {
        // Only the part of the sticky shell still pinned to the top can cover
        // the tabs. On phones the announcement may scroll away, so its height
        // must not keep offsetting the rail.
        const rect = header.getBoundingClientRect();
        const visible = Math.max(0, rect.height + Math.min(0, rect.top));
        nav.style.top = `${visible}px`;
      }
      const line = Math.max(128, (parseFloat(getComputedStyle(nav).top) || 0) + nav.getBoundingClientRect().height + 8);
      // The purchase block precedes Details in the document, not in the menu.
      const targets = links.flatMap(link => {
        const target = document.getElementById(link.href.slice(1));
        if (!target) return [];
        if (!previousMargins.has(target)) previousMargins.set(target, target.style.scrollMarginTop);
        target.style.scrollMarginTop = `${line}px`;
        return [{ href: link.href, top: target.getBoundingClientRect().top }];
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
    if (header) observer.observe(header);
    observer.observe(nav);
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
      nav.style.removeProperty("top");
      for (const [target, margin] of previousMargins) target.style.scrollMarginTop = margin;
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
      data-pinned={desktop || !galleryVisible ? "true" : "false"}
      inert={!desktop && galleryVisible ? true : undefined}
      className={`${!desktop ? mobileStyles.sectionNav : "sticky top-16 mt-6"} z-20 flex overflow-x-auto border-b border-border bg-background/95 py-1 text-sm font-semibold backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
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
