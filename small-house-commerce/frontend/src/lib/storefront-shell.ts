import {
  serverApiUrl,
  type Category,
  type Collection,
} from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";
import { buildNav } from "@/lib/nav";
import {
  DEFAULT_SITE_SETTINGS,
  type SiteSettings,
} from "@/lib/site-settings";
import {
  CURRENT_LUWAG_THEME_SOURCE,
} from "@/lib/storefront-shell-document";
import {
  parsePublicStorefrontShell,
  type PublicStorefrontShell,
} from "@/lib/storefront-shell-api";
import {
  CURRENT_LUWAG_DERIVED_THEME,
  serializePublishedStorefrontThemeCss,
} from "@/lib/storefront-theme";

const FALLBACK_LINKS: PublicStorefrontShell["header"]["items"] = [
  {
    id: "fallback-new-arrivals",
    kind: "LINK",
    label: "New Arrivals",
    href: "/collections/new-arrivals",
  },
  {
    id: "fallback-solutions",
    kind: "LINK",
    label: "Solutions",
    href: "/collections/small-space-solutions",
  },
  {
    id: "fallback-best-sellers",
    kind: "LINK",
    label: "Best Sellers",
    href: "/collections/best-sellers",
  },
];

const FALLBACK_HELP_COLUMN: PublicStorefrontShell["footer"]["columns"][number] = {
  id: "fallback-help",
  kind: "LINKS",
  title: "Help",
  rows: [
    {
      id: "fallback-shipping",
      kind: "LINK",
      label: "Shipping & Delivery",
      href: "/shipping-delivery",
    },
    {
      id: "fallback-returns",
      kind: "LINK",
      label: "Returns & Refunds",
      href: "/returns-refunds",
    },
    {
      id: "fallback-contact-us",
      kind: "LINK",
      label: "Contact Us",
      href: "/contact",
    },
    {
      id: "fallback-terms",
      kind: "LINK",
      label: "Terms of Service",
      href: "/terms",
    },
  ],
};

const FALLBACK_LEGAL_LINKS: PublicStorefrontShell["footer"]["legal"] = [
  { id: "fallback-privacy", label: "Privacy Policy", href: "/privacy" },
  { id: "fallback-returns", label: "Returns & Refunds", href: "/returns-refunds" },
  { id: "fallback-terms", label: "Terms of Service", href: "/terms" },
];

/** Compile-time fallback used when the public shell request itself is unavailable. */
export const DEFAULT_PUBLIC_STOREFRONT_SHELL: PublicStorefrontShell = {
  publishedRevision: 0,
  brand: {
    brandName: "LUWAG",
    horizontalLogo: null,
    squareMark: null,
  },
  header: { items: FALLBACK_LINKS },
  footer: {
    tagline: "Small-space furniture, made roomy",
    description:
      "Furniture for Filipino condos and rentals. Cash on delivery, nationwide.",
    columns: [
      {
        id: "fallback-shop",
        kind: "LINKS",
        title: "Shop",
        rows: [],
      },
      FALLBACK_HELP_COLUMN,
      {
        id: "fallback-contact",
        kind: "CONTACT",
        title: "Contact",
        supportEmail: DEFAULT_SITE_SETTINGS.supportEmail,
        supportHours: DEFAULT_SITE_SETTINGS.supportHours,
        trackOrderLabel: "Track Order",
        trackOrderHref: "/track-order",
      },
    ],
    copyrightBrand: "LUWAG Living",
    socials: [],
    legal: FALLBACK_LEGAL_LINKS,
    payments: [],
  },
  theme: { ...CURRENT_LUWAG_THEME_SOURCE },
  derivedTheme: { ...CURRENT_LUWAG_DERIVED_THEME },
};

/** Strict, fail-safe read of the published public projection. */
export async function fetchStorefrontShell(
  options: { cache?: "no-store" } = {},
): Promise<PublicStorefrontShell> {
  try {
    const response = await fetch(
      serverApiUrl("/api/v1/storefront/shell"),
      options.cache === "no-store"
        ? { cache: "no-store" }
        : { next: { revalidate: 300, tags: STOREFRONT_TAGS } },
    );
    if (!response.ok) return DEFAULT_PUBLIC_STOREFRONT_SHELL;
    return parsePublicStorefrontShell(await response.json());
  } catch {
    return DEFAULT_PUBLIC_STOREFRONT_SHELL;
  }
}

/**
 * The legacy Header/Footer used live category, collection and contact data.
 * Rehydrate only the exact compile-time fallback so a real published shell is
 * never silently overwritten.
 */
export function materializeDefaultStorefrontShell(
  shell: PublicStorefrontShell,
  roots: Category[],
  collections: Collection[],
  settings: SiteSettings,
): PublicStorefrontShell {
  if (shell !== DEFAULT_PUBLIC_STOREFRONT_SHELL) return shell;

  const headerItems: PublicStorefrontShell["header"]["items"] = buildNav(
    roots,
    collections,
    null,
  ).map((item) =>
    item.kind === "tree"
      ? {
          id: item.root.id,
          kind: "CATEGORY_ROOT" as const,
          categoryId: item.root.id,
          label: item.label,
        }
      : {
          id: `legacy-link-${item.position}`,
          kind: "LINK" as const,
          label: item.label,
          href: item.href,
        },
  );

  const navigationCollections = collections.filter(
    (collection) => collection.type === "NAVIGATION",
  );

  return {
    ...DEFAULT_PUBLIC_STOREFRONT_SHELL,
    header: { items: headerItems },
    footer: {
      ...DEFAULT_PUBLIC_STOREFRONT_SHELL.footer,
      columns: [
        {
          id: "fallback-shop",
          kind: "LINKS",
          title: "Shop",
          rows: navigationCollections.map((collection) => ({
            id: collection.id,
            kind: "LINK",
            label: collection.name,
            href: `/collections/${collection.slug}`,
          })),
        },
        FALLBACK_HELP_COLUMN,
        {
          id: "fallback-contact",
          kind: "CONTACT",
          title: "Contact",
          supportEmail: settings.supportEmail,
          supportHours: settings.supportHours,
          trackOrderLabel: "Track Order",
          trackOrderHref: "/track-order",
        },
      ],
    },
  };
}

/** Validated declarations suitable for one server-rendered style element. */
export function storefrontThemeStyle(shell: PublicStorefrontShell): string {
  return serializePublishedStorefrontThemeCss(
    shell.theme,
    shell.derivedTheme,
  );
}
