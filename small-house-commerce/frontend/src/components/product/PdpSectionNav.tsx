import type { ReactNode } from "react";

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
  const links: SectionLink[] = [
    { href: "#details", label: "Details", visible: hasDetails },
    {
      href: "#specifications",
      label: "Specifications",
      visible: hasSpecifications,
    },
    { href: "#shipping-faq", label: "Delivery & FAQs", visible: true },
    { href: "#reviews", label: "Reviews", visible: true },
    { href: "#pdp-purchase", label: "Order Now", visible: true },
  ];

  return (
    <nav
      aria-label="Product sections"
      className="sticky top-16 z-20 mt-10 flex overflow-x-auto border-b border-border bg-background/95 py-3 text-sm font-semibold backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex min-w-max items-center gap-6 px-1">
        {links
          .filter((link) => link.visible)
          .map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-sm text-ink-secondary outline-none hover:text-cta focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2"
            >
              {link.label}
            </a>
          ))}
      </div>
    </nav>
  );
}
