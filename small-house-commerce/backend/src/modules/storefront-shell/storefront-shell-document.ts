import { z } from 'zod';
import { internalPathSchema, isSafeInternalPath } from '../../common/internal-path.js';

/**
 * Storefront shell document contract (spec
 * docs/superpowers/specs/2026-10-12-storefront-shell-brand-editor-design.md §7–§12).
 *
 * One versioned document owns the global Header, Footer, brand marks and the
 * base brand theme. The backend normalizes and validates it; the editor sends
 * it; the storefront renders the published projection. The document never
 * stores derived colors, resolved hrefs, CSS, MIME types, dimensions or asset
 * URLs — those stay server-owned so a client cannot forge presentation state.
 */

export const STOREFRONT_SHELL_SCHEMA_VERSION = 1;

/** Scalar bounds shared with the editor's character counters. */
export const SHELL_LIMITS = {
  label: 40,
  footerText: 120,
  tagline: 100,
  description: 300,
  brandName: 80,
  columnTitle: 40,
  supportEmail: 200,
  supportHours: 100,
  codText: 120,
  trackOrderLabel: 40,
  internalPath: 2048,
  externalUrl: 2048,
  maxEnabledHeaderItems: 8,
  maxHeaderRows: 24,
  maxFooterColumns: 5,
  maxFooterRows: 8,
  maxFooterSocials: 4,
  maxFooterLegal: 3,
  maxFooterPayments: 6,
  paymentLabel: 24,
  maxExternalUrl: 2048,
} as const;

/** Re-exported so shell callers keep one import for path safety. */
export { internalPathSchema, isSafeInternalPath };

/** Credential-free HTTPS URL. `http:` and `javascript:` never enter a document. */
export const httpsExternalUrlSchema = z
  .string()
  .trim()
  .max(SHELL_LIMITS.externalUrl)
  .refine((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return false;
    }
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '';
  }, { message: 'External links must be credential-free HTTPS URLs' });

export const structuredLinkSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['PRODUCT', 'COLLECTION', 'CATEGORY', 'LANDING']),
    id: z.string().uuid(),
  }),
  z.object({ type: z.literal('INTERNAL'), path: internalPathSchema }),
  z.object({ type: z.literal('EXTERNAL'), url: httpsExternalUrlSchema }),
]);

export type StructuredLink = z.infer<typeof structuredLinkSchema>;

export const shellAssetRefSchema = z.object({ assetId: z.string().uuid() }).nullable();

export type ShellAssetRef = z.infer<typeof shellAssetRefSchema>;

const headerItemSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1),
    kind: z.literal('CATEGORY_ROOT'),
    targetId: z.string().uuid(),
    labelOverride: z.string().trim().max(SHELL_LIMITS.label),
    enabled: z.boolean(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('COLLECTION'),
    targetId: z.string().uuid(),
    labelOverride: z.string().trim().max(SHELL_LIMITS.label),
    enabled: z.boolean(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('STRUCTURED_LINK'),
    label: z.string().trim().max(SHELL_LIMITS.label),
    link: structuredLinkSchema,
    enabled: z.boolean(),
  }),
]);

export type HeaderItem = z.infer<typeof headerItemSchema>;

const footerRowSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1),
    kind: z.literal('LINK'),
    label: z.string().trim().max(SHELL_LIMITS.label),
    link: structuredLinkSchema,
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('TEXT'),
    text: z.string().trim().max(SHELL_LIMITS.footerText),
  }),
]);

export type FooterRow = z.infer<typeof footerRowSchema>;

const footerColumnSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1),
    kind: z.literal('LINKS'),
    title: z.string().trim().max(SHELL_LIMITS.columnTitle),
    rows: z.array(footerRowSchema).max(SHELL_LIMITS.maxFooterRows),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('CONTACT'),
    title: z.string().trim().max(SHELL_LIMITS.columnTitle),
    supportEmail: z.string().trim().max(SHELL_LIMITS.supportEmail),
    supportHours: z.string().trim().max(SHELL_LIMITS.supportHours),
    codText: z.string().trim().max(SHELL_LIMITS.codText),
    trackOrderLabel: z.string().trim().max(SHELL_LIMITS.trackOrderLabel),
    trackOrderLink: structuredLinkSchema,
  }),
]);

export type FooterColumn = z.infer<typeof footerColumnSchema>;

export const footerSocialNetworkSchema = z.enum([
  'FACEBOOK',
  'INSTAGRAM',
  'TIKTOK',
  'YOUTUBE',
]);

export type FooterSocialNetwork = z.infer<typeof footerSocialNetworkSchema>;

/** Social icon link: the network picks the glyph, the URL is the real target. */
const footerSocialSchema = z
  .object({
    id: z.string().min(1),
    network: footerSocialNetworkSchema,
    url: httpsExternalUrlSchema,
  })
  .strict();

export type FooterSocial = z.infer<typeof footerSocialSchema>;

/**
 * Legal links (Privacy, Terms…) point at a page the operator owns. They are
 * projected as-is instead of going through the navigation target resolver, so
 * publishing a new policy page needs no entity row.
 */
const footerLegalLinkSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().trim().max(SHELL_LIMITS.label),
    href: z.union([internalPathSchema, httpsExternalUrlSchema]),
  })
  .strict();

export type FooterLegalLink = z.infer<typeof footerLegalLinkSchema>;

const footerPaymentSchema = z
  .string()
  .trim()
  .min(1)
  .max(SHELL_LIMITS.paymentLabel);

export const headingFontSchema = z.enum(['SYSTEM', 'POPPINS_HEADING', 'SERIF_HEADING']);
export const bodyFontSchema = z.enum(['SYSTEM']);

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, { message: 'Colors must be six-digit hex values' })
  .transform((value) => value.toLowerCase());

export const storefrontThemeSourceSchema = z
  .object({
    primary: hexColorSchema,
    action: hexColorSchema,
    background: hexColorSchema,
    surface: hexColorSchema,
    text: hexColorSchema,
    headingFont: headingFontSchema,
    bodyFont: bodyFontSchema,
  })
  .strict();

export type StorefrontThemeSource = z.infer<typeof storefrontThemeSourceSchema>;

export const storefrontShellDocumentSchema = z
  .object({
    schemaVersion: z.literal(STOREFRONT_SHELL_SCHEMA_VERSION),
    brand: z
      .object({
        brandName: z.string().trim().max(SHELL_LIMITS.brandName),
        horizontalLogo: shellAssetRefSchema,
        squareMark: shellAssetRefSchema,
      })
      .strict(),
    header: z
      .object({
        items: z.array(headerItemSchema).max(SHELL_LIMITS.maxHeaderRows),
      })
      .strict(),
    footer: z
      .object({
        tagline: z.string().trim().max(SHELL_LIMITS.tagline),
        description: z.string().trim().max(SHELL_LIMITS.description),
        columns: z.array(footerColumnSchema).max(SHELL_LIMITS.maxFooterColumns),
        copyrightBrand: z.string().trim().max(SHELL_LIMITS.brandName),
        // Optional additions ride on `.default([])` so every previously stored
        // document keeps validating and simply renders without them.
        socials: z
          .array(footerSocialSchema)
          .max(SHELL_LIMITS.maxFooterSocials)
          .default([]),
        legal: z
          .array(footerLegalLinkSchema)
          .max(SHELL_LIMITS.maxFooterLegal)
          .default([]),
        payments: z
          .array(footerPaymentSchema)
          .max(SHELL_LIMITS.maxFooterPayments)
          .default([]),
      })
      .strict(),
    theme: storefrontThemeSourceSchema,
  })
  .strict();

export type StorefrontShellDocument = z.infer<typeof storefrontShellDocumentSchema>;

/**
 * Derived theme tokens and publication issues are part of the shared document
 * contract: the theme module computes them, and every consumer (services,
 * controllers, migration assertions) imports the types from here.
 */
export type DerivedStorefrontTheme = {
  primaryDark: string;
  primaryLight: string;
  actionHover: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  focus: string;
  disabled: string;
  actionForeground: string;
};

export type ShellIssue = {
  code: string;
  path: string[];
  message: string;
  itemId?: string;
  ratio?: number;
  requiredRatio?: number;
};

/**
 * Shape-parses then re-emits the document. Zod already trims and lowercases
 * during parse, so normalization is a thin, explicit seam: it never caps a
 * value silently (an over-limit shape is a save-time 400), never reorders
 * arrays, and never invents or drops stable ids.
 */
export function normalizeStorefrontShellDocument(input: unknown): StorefrontShellDocument {
  return storefrontShellDocumentSchema.parse(input);
}

/** The compile-time LUWAG tokens the migration and runtime fallback must match. */
export const CURRENT_LUWAG_THEME_SOURCE: StorefrontThemeSource = {
  primary: '#c9a77b',
  action: '#244c3c',
  background: '#faf8f5',
  surface: '#ffffff',
  text: '#1f2a24',
  headingFont: 'SYSTEM',
  bodyFont: 'SYSTEM',
};

export type CurrentLuwagShellSeedInput = {
  rootCategories: Array<{ id: string; name: string; sortOrder: number }>;
  navigationCollections: Array<{ id: string; name: string; slug: string; sortOrder: number }>;
  supportEmail: string;
  supportHours: string;
};

/** The three legacy flat collection links, in their compile-time order. */
const LEGACY_FLAT_LINKS = [
  { label: 'New Arrivals', slug: 'new-arrivals', position: 0 },
  { label: 'Solutions', slug: 'small-space-solutions', position: 50 },
  { label: 'Best Sellers', slug: 'best-sellers', position: 60 },
] as const;

type Positioned = { position: number; item: HeaderItem };

/**
 * Builds the document equivalent to the pre-migration Header, Footer and
 * theme, so the first publication and every failure fallback reproduce the
 * current LUWAG shell exactly. Entity-backed items store only live ids.
 */
export function createCurrentLuwagShellDocument(
  input: CurrentLuwagShellSeedInput,
): StorefrontShellDocument {
  const bySlug = new Map(input.navigationCollections.map((c) => [c.slug, c]));

  const positioned: Positioned[] = [];
  for (const flat of LEGACY_FLAT_LINKS) {
    const collection = bySlug.get(flat.slug);
    if (!collection) continue;
    positioned.push({
      position: flat.position,
      item: {
        id: collection.id,
        kind: 'STRUCTURED_LINK',
        label: flat.label,
        enabled: true,
        link: { type: 'COLLECTION', id: collection.id },
      },
    });
  }
  input.rootCategories.forEach((root, index) => {
    positioned.push({
      position: (index + 1) * 10,
      item: {
        id: root.id,
        kind: 'CATEGORY_ROOT',
        targetId: root.id,
        labelOverride: root.name,
        enabled: true,
      },
    });
  });
  positioned.sort((a, b) => a.position - b.position);

  const shopRows: FooterRow[] = input.navigationCollections
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((collection) => ({
      id: collection.id,
      kind: 'LINK',
      label: collection.name,
      link: { type: 'COLLECTION', id: collection.id },
    }));

  const columns: FooterColumn[] = [
    { id: '00000000-0000-7000-8000-000000000210', kind: 'LINKS', title: 'Shop', rows: shopRows },
    {
      id: '00000000-0000-7000-8000-000000000220',
      kind: 'CONTACT',
      title: 'Contact',
      supportEmail: input.supportEmail,
      supportHours: input.supportHours,
      codText: 'Cash on Delivery nationwide',
      trackOrderLabel: 'Track Order',
      trackOrderLink: { type: 'INTERNAL', path: '/track-order' },
    },
  ];

  return normalizeStorefrontShellDocument({
    schemaVersion: STOREFRONT_SHELL_SCHEMA_VERSION,
    brand: { brandName: 'LUWAG', horizontalLogo: null, squareMark: null },
    header: { items: positioned.map((entry) => entry.item) },
    footer: {
      tagline: 'Small-space furniture, made roomy',
      description: 'Furniture for Filipino condos and rentals. Cash on delivery, nationwide.',
      columns,
      copyrightBrand: 'LUWAG Living',
    },
    theme: CURRENT_LUWAG_THEME_SOURCE,
  });
}
