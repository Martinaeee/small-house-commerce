import { z } from 'zod';
import { siteMediaUrl } from '../../common/site-media-url.js';
import { internalPathSchema } from '../../common/internal-path.js';

/**
 * Homepage V2 versioned document contract (spec
 * docs/superpowers/specs/2026-09-27-homepage-visual-builder-design.md §3.2/§3.3).
 *
 * The document is the single source of truth for the storefront homepage: the
 * editor sends it, the draft/publish pipeline stores it, and the storefront
 * renders it. Every value that reaches generated inline CSS is whitelisted
 * here (numbers, booleans, enums, `#rrggbb` colours, http(s)/site-relative
 * media URLs), which is the first line of defence against style injection.
 *
 * Legacy `homepage_sections` payloads (pre-V2 hero fields) are converted at
 * read time by `normalizeLegacyDocument`; the rest of the document is passed
 * through untouched. Non-HERO payloads are intentionally opaque
 * (`z.record(unknown)`) because their shapes are still owned by the legacy
 * per-type DTOs.
 */

export const SCHEMA_VERSION = 1;

/** Only `#rrggbb` colours may enter the document (CSS-injection whitelist). */
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const horizontalAlignSchema = z.enum(['LEFT', 'CENTER', 'RIGHT']);
const verticalAlignSchema = z.enum(['TOP', 'MIDDLE', 'BOTTOM']);

const sectionTypeSchema = z.enum([
  'HERO',
  'USP',
  'CATEGORY_TILES',
  'PRODUCT_GRID',
  'SOLUTIONS',
  'PRODUCT_STORY',
  'ROOM_INSPIRATION',
  'UGC',
  'BRAND_STORY',
  'CONFIDENCE',
  'PROMO_BANNER',
  'COUNTDOWN_BANNER',
]);

// --- shared value objects ---------------------------------------------------

const scheduleSchema = z.object({
  publishAt: z.iso.datetime().nullable(),
  unpublishAt: z.iso.datetime().nullable(),
});

/**
 * A section/announcement link. Entity links carry the target row id (the
 * storefront resolves it to an href); external links must be https; internal
 * links carry a validated site-relative path so a CTA can point at an in-app
 * route (for example `/track-order`) without a lookup.
 */
const linkSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['PRODUCT', 'COLLECTION', 'CATEGORY', 'LANDING']),
    id: z.string().uuid(),
  }),
  z.object({
    type: z.literal('INTERNAL'),
    path: internalPathSchema,
  }),
  z.object({
    type: z.literal('EXTERNAL'),
    url: z.url({ protocol: /^https$/ }).max(2048),
  }),
]);

// --- hero element styles ----------------------------------------------------

/**
 * Typography overrides. Every field is optional: unset means "inherit the
 * site design tokens" (the renderer falls back to the component defaults).
 */
const elementStyleSchema = z
  .object({
    fontSize: z.number().min(8).max(200),
    fontWeight: z.literal([400, 500, 600, 700, 800]),
    lineHeight: z.number().min(0.8).max(3),
    letterSpacing: z.number().min(-5).max(20),
    textColor: hexColor,
    textAlign: horizontalAlignSchema,
    maxWidthPct: z.number().min(5).max(100),
  })
  .partial();

/** Percentage box produced by the editor canvas. */
const elementLayoutSchema = z.object({
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  widthPct: z.number().min(5).max(100),
  align: horizontalAlignSchema,
  verticalAlign: verticalAlignSchema,
});

const elementOverrideSchema = z
  .object({
    style: elementStyleSchema,
    layout: elementLayoutSchema.partial(),
  })
  .partial();

/** Per-device overrides; unset means "inherit the desktop values". */
const elementOverridesSchema = z
  .object({
    tablet: elementOverrideSchema,
    mobile: elementOverrideSchema,
  })
  .partial();

const heroElementBaseSchema = z.object({
  text: z.string().max(500),
  link: linkSchema.nullable(),
  style: elementStyleSchema,
  layout: elementLayoutSchema,
  overrides: elementOverridesSchema,
  locked: z.boolean(),
});

const heroChipSchema = z.object({
  background: hexColor,
  textColor: hexColor,
  borderRadius: z.number().min(0).max(48),
  paddingX: z.number().min(4).max(48),
  paddingY: z.number().min(2).max(32),
});

/** Button colours are `hex|null`: null inherits the site button tokens. */
const heroButtonSchema = z.object({
  variant: z.enum(['SOLID', 'OUTLINE', 'LINK']),
  background: hexColor.nullable(),
  textColor: hexColor.nullable(),
  borderColor: hexColor.nullable(),
  hoverBackground: hexColor.nullable(),
  hoverTextColor: hexColor.nullable(),
  borderRadius: z.number().min(0).max(48),
  paddingX: z.number().min(4).max(48),
  paddingY: z.number().min(2).max(32),
  size: z.enum(['SM', 'MD', 'LG']),
  // Optional: the reference design trails the primary CTA with an arrow. Kept
  // optional so existing stored documents (the migrated v1 included) keep
  // validating; absence renders on the storefront as "no arrow".
  arrow: z.boolean().optional(),
});

const heroOfferElementSchema = heroElementBaseSchema.extend({
  chip: heroChipSchema,
});

const heroCtaElementSchema = heroElementBaseSchema.extend({
  button: heroButtonSchema,
});

const heroCountdownElementSchema = heroElementBaseSchema.extend({
  endsAt: z.iso.datetime().nullable(),
});

/** The seven hero elements, in render order. */
const heroElementsSchema = z.object({
  eyebrow: heroElementBaseSchema,
  heading: heroElementBaseSchema,
  subheading: heroElementBaseSchema,
  offer: heroOfferElementSchema,
  ctaPrimary: heroCtaElementSchema,
  ctaSecondary: heroCtaElementSchema,
  countdown: heroCountdownElementSchema,
});

// --- hero slide media -------------------------------------------------------

const heroImageSchema = z.object({
  url: siteMediaUrl(),
  alt: z.string().max(300),
});

const heroVideoSchema = z.object({
  url: siteMediaUrl(),
  // Required key, nullable value: a poster-less video is a legal draft state
  // that publish validation blocks (HERO_POSTER_MISSING), never a schema error.
  poster: siteMediaUrl().nullable(),
  autoplay: z.boolean(),
  muted: z.boolean(),
  loop: z.boolean(),
  playsInline: z.boolean(),
  showSoundToggle: z.boolean(),
  pauseOffscreen: z.boolean(),
});

const mobileOverrideSchema = z.object({
  enabled: z.boolean(),
  image: heroImageSchema.nullable(),
  video: heroVideoSchema.nullable(),
});

const focalSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
});

const heroMediaSchema = z
  .object({
    type: z.enum(['IMAGE', 'VIDEO']),
    image: heroImageSchema.nullable(),
    video: heroVideoSchema.nullable(),
    mobileOverride: mobileOverrideSchema,
    fit: z.enum(['COVER', 'CONTAIN']),
    focal: focalSchema,
    objectPosition: z.object({
      desktop: focalSchema,
      tablet: focalSchema.nullable(),
      mobile: focalSchema.nullable(),
    }),
  })
  .superRefine((media, ctx) => {
    if (media.type === 'IMAGE' && media.image === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['image'],
        message: 'IMAGE media requires an image',
      });
    }
    if (media.type === 'VIDEO' && media.video === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['video'],
        message: 'VIDEO media requires a video',
      });
    }
    if (
      !media.mobileOverride.enabled &&
      (media.mobileOverride.image !== null ||
        media.mobileOverride.video !== null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['mobileOverride'],
        message: 'A disabled mobile override must not carry media',
      });
    }
  });

const slideOverlaySchema = z.object({
  color: hexColor,
  opacity: z.number().min(0).max(1),
  gradient: z.enum(['NONE', 'BOTTOM', 'FULL']),
});

// --- hero slide / payload ---------------------------------------------------

const heroSlideSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(80),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(99),
  schedule: scheduleSchema,
  // null = the slide has no media yet (gradient fallback on the storefront);
  // publish validation requires media on every enabled slide.
  media: heroMediaSchema.nullable(),
  overlay: slideOverlaySchema,
  elements: heroElementsSchema,
});

const sliderBehaviorSchema = z.object({
  autoplay: z.boolean(),
  durationMs: z.number().min(3000).max(15000),
  transition: z.enum(['FADE', 'SLIDE']),
  pauseOnHover: z.boolean(),
  arrows: z.boolean(),
  pagination: z.enum(['DOTS', 'COUNTER', 'PROGRESS']),
  manualPauseMs: z.number().min(0).max(60000),
});

const heroPayloadSchema = z.object({
  behavior: sliderBehaviorSchema,
  slides: z.array(heroSlideSchema).min(1).max(6),
});

// --- announcement -----------------------------------------------------------

const announcementItemSchema = z.object({
  id: z.string().uuid(),
  text: z.string().max(200),
  link: linkSchema.nullable(),
  linkLabel: z.string().max(40).nullable(),
  textColor: hexColor,
  backgroundColor: hexColor,
  schedule: scheduleSchema,
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(99),
});

const announcementSchema = z.object({
  enabled: z.boolean(),
  rotationMs: z.number().min(2000).max(30000),
  items: z.array(announcementItemSchema).max(6),
});

// --- section / document -----------------------------------------------------

/**
 * The per-section style block, reused as the homepage-wide default. Every
 * field is optional: a section may override any single field, and an unset
 * field falls back to the document default (then to the built-in class).
 */
const sectionStyleSchema = z
  .object({
    backgroundColor: hexColor,
    textColor: hexColor,
    contentWidth: z.enum(['FULL', 'STANDARD', 'NARROW']),
    paddingTop: z.number().min(0).max(240),
    paddingBottom: z.number().min(0).max(240),
  })
  .partial();

const sectionProductSchema = z.object({
  productId: z.string().uuid(),
  sortOrder: z.number().int().min(0).max(999),
  badge: z.string().max(20).nullable(),
});

const bannerHrefSchema = z.string().max(2048).refine(
  (value) => {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code <= 0x1f || code === 0x7f || value[index] === '\\') return false;
    }
    if (value.startsWith('/') && !value.startsWith('//')) return true;
    if (value.startsWith('#')) return true;
    return z.url({ protocol: /^https$/ }).safeParse(value).success;
  },
  { message: 'Expected a site path, anchor, or HTTPS URL' },
);

const promoBannerPayloadSchema = z
  .object({
    ctaText: z.string().max(120).optional(),
    ctaLink: bannerHrefSchema.optional(),
  })
  .strict();

const countdownBannerPayloadSchema = promoBannerPayloadSchema
  .extend({ endsAt: z.iso.datetime().nullable() })
  .strict();

export const bannerPayloadSchemas = {
  PROMO_BANNER: promoBannerPayloadSchema,
  COUNTDOWN_BANNER: countdownBannerPayloadSchema,
} as const;

const sectionSchema = z
  .object({
    id: z.string().uuid(),
    type: sectionTypeSchema,
    // Kept from the legacy table so the storefront response contract (and the
    // non-hero block components that render it) is unchanged.
    title: z.string().max(200).nullable(),
    subtitle: z.string().max(500).nullable(),
    enabled: z.boolean(),
    sortOrder: z.number().int().min(0).max(999),
    schedule: scheduleSchema,
    payload: z.record(z.string(), z.unknown()),
    products: z.array(sectionProductSchema).max(24),
    style: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((section, ctx) => {
    if (
      section.type === 'PROMO_BANNER' ||
      section.type === 'COUNTDOWN_BANNER'
    ) {
      const banner = bannerPayloadSchemas[section.type].safeParse(section.payload);
      if (!banner.success) {
        for (const issue of banner.error.issues) {
          ctx.addIssue({
            code: 'custom',
            path: ['payload', ...issue.path],
            message: issue.message,
          });
        }
      }
      if (section.products.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['products'],
          message: 'Banner sections cannot contain product joins',
        });
      }
      return;
    }

    // HERO payloads are validated strictly; existing non-HERO types stay opaque
    // and are validated by the legacy per-type DTOs at publish time.
    if (section.type !== 'HERO') return;
    const hero = heroPayloadSchema.safeParse(section.payload);
    if (hero.success) return;
    for (const issue of hero.error.issues) {
      ctx.addIssue({
        code: 'custom',
        path: ['payload', ...issue.path],
        message: issue.message,
      });
    }
  });

// --- exported types ---------------------------------------------------------

export type Schedule = z.infer<typeof scheduleSchema>;

/**
 * Returns whether a schedule is active at `now`. Windows are half-open:
 * publishAt is inclusive and unpublishAt is exclusive.
 */
export function isScheduleActive(schedule: Schedule, now: Date): boolean {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return false;

  const publishAt =
    schedule.publishAt === null ? -Infinity : Date.parse(schedule.publishAt);
  const unpublishAt =
    schedule.unpublishAt === null ? Infinity : Date.parse(schedule.unpublishAt);
  return publishAt <= nowMs && unpublishAt > nowMs;
}
export type LinkValue = z.infer<typeof linkSchema>;
export type ElementStyle = z.infer<typeof elementStyleSchema>;
export type ElementLayout = z.infer<typeof elementLayoutSchema>;
export type ElementOverrides = z.infer<typeof elementOverridesSchema>;
export type HeroChip = z.infer<typeof heroChipSchema>;
export type HeroButton = z.infer<typeof heroButtonSchema>;
export type HeroImage = z.infer<typeof heroImageSchema>;
export type HeroVideo = z.infer<typeof heroVideoSchema>;
export type HeroMedia = z.infer<typeof heroMediaSchema>;
export type SlideOverlay = z.infer<typeof slideOverlaySchema>;
export type SliderBehavior = z.infer<typeof sliderBehaviorSchema>;
export type HeroElementKey =
  | 'eyebrow'
  | 'heading'
  | 'subheading'
  | 'offer'
  | 'ctaPrimary'
  | 'ctaSecondary'
  | 'countdown';
export type HeroElement =
  | z.infer<typeof heroElementBaseSchema>
  | z.infer<typeof heroOfferElementSchema>
  | z.infer<typeof heroCtaElementSchema>
  | z.infer<typeof heroCountdownElementSchema>;
export type HeroSlide = z.infer<typeof heroSlideSchema>;
export type HeroPayload = z.infer<typeof heroPayloadSchema>;
export type PromoBannerPayload = z.infer<typeof promoBannerPayloadSchema>;
export type CountdownBannerPayload = z.infer<
  typeof countdownBannerPayloadSchema
>;
export type AnnouncementItem = z.infer<typeof announcementItemSchema>;
export type AnnouncementBlock = z.infer<typeof announcementSchema>;
export type HomepageSection = z.infer<typeof sectionSchema>;
export type SectionStyle = z.infer<typeof sectionStyleSchema>;
export type HomepageDocument = {
  schemaVersion: typeof SCHEMA_VERSION;
  sections: HomepageSection[];
  announcement: AnnouncementBlock;
  defaults?: SectionStyle;
};

export const homepageDocumentSchema: z.ZodType<HomepageDocument> = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  sections: z.array(sectionSchema),
  announcement: announcementSchema,
  defaults: sectionStyleSchema.optional(),
});

// --- publish validation contract --------------------------------------------

/**
 * A publish-blocking (ERROR) or publish-warning (WARNING) issue. `sectionId`
 * / `slideId` carry the editor jump target when the rule can locate one.
 */
export type PublishIssue = {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
  sectionId?: string;
  slideId?: string;
};

/**
 * Publish gate injected into `HomepageDocumentService`. The implementation
 * (`HomepageValidator`, P1 task 4) is deliberately decoupled behind this
 * interface so the service's spec can inject a stub; the validator module is
 * not imported here.
 */
export interface DocumentValidator {
  validate(
    doc: HomepageDocument,
  ): Promise<{ errors: PublishIssue[]; warnings: PublishIssue[] }>;
}

/** Runtime Nest token for the structural DocumentValidator interface. */
export const DOCUMENT_VALIDATOR = Symbol('DOCUMENT_VALIDATOR');

// --- defaults ---------------------------------------------------------------

/** Fixed ids for the freshly created document (mirrored by the frontend). */
const EMPTY_SECTION_ID = '00000000-0000-7000-8000-000000000001';
const EMPTY_SLIDE_ID = '00000000-0000-7000-8000-000000000010';

/**
 * Default element boxes (percentages of the hero canvas). The frontend editor
 * mirrors these exact numbers — keep the two definitions in sync.
 */
const DEFAULT_ELEMENT_LAYOUTS: Record<HeroElementKey, ElementLayout> = {
  eyebrow: {
    xPct: 7.4,
    yPct: 14,
    widthPct: 40,
    align: 'LEFT',
    verticalAlign: 'TOP',
  },
  heading: {
    xPct: 7.4,
    yPct: 22.8,
    widthPct: 40,
    align: 'LEFT',
    verticalAlign: 'TOP',
  },
  subheading: {
    xPct: 7.4,
    yPct: 38,
    widthPct: 40,
    align: 'LEFT',
    verticalAlign: 'TOP',
  },
  offer: {
    xPct: 7.4,
    yPct: 50,
    widthPct: 30,
    align: 'LEFT',
    verticalAlign: 'TOP',
  },
  ctaPrimary: {
    xPct: 7.4,
    yPct: 58,
    widthPct: 22,
    align: 'LEFT',
    verticalAlign: 'TOP',
  },
  ctaSecondary: {
    xPct: 31,
    yPct: 58,
    widthPct: 22,
    align: 'LEFT',
    verticalAlign: 'TOP',
  },
  countdown: {
    xPct: 7.4,
    yPct: 70,
    widthPct: 30,
    align: 'LEFT',
    verticalAlign: 'TOP',
  },
};

const DEFAULT_BEHAVIOR: SliderBehavior = {
  autoplay: true,
  durationMs: 6000,
  transition: 'FADE',
  pauseOnHover: true,
  arrows: true,
  pagination: 'DOTS',
  manualPauseMs: 12000,
};

const DEFAULT_OVERLAY: SlideOverlay = {
  color: '#000000',
  opacity: 0.3,
  gradient: 'BOTTOM',
};

/** Offer chip defaults (spec §3.3 example: terracotta on white). */
const DEFAULT_CHIP: HeroChip = {
  background: '#C4552D',
  textColor: '#FFFFFF',
  borderRadius: 4,
  paddingX: 12,
  paddingY: 6,
};

/** CTA button defaults; null colours inherit the site button tokens. */
const DEFAULT_BUTTON: HeroButton = {
  variant: 'SOLID',
  background: null,
  textColor: null,
  borderColor: null,
  hoverBackground: null,
  hoverTextColor: null,
  borderRadius: 0,
  paddingX: 28,
  paddingY: 14,
  size: 'MD',
  arrow: false,
};

function defaultElement(
  key: HeroElementKey,
): z.infer<typeof heroElementBaseSchema> {
  return {
    text: '',
    link: null,
    style: {},
    layout: { ...DEFAULT_ELEMENT_LAYOUTS[key] },
    overrides: {},
    locked: false,
  };
}

/** A fresh document: one empty HERO section and a disabled announcement. */
export function emptyDocument(): HomepageDocument {
  const slide: HeroSlide = {
    id: EMPTY_SLIDE_ID,
    name: 'Hero 1',
    enabled: true,
    sortOrder: 0,
    schedule: { publishAt: null, unpublishAt: null },
    media: null,
    overlay: { ...DEFAULT_OVERLAY },
    elements: {
      eyebrow: defaultElement('eyebrow'),
      heading: defaultElement('heading'),
      subheading: defaultElement('subheading'),
      offer: { ...defaultElement('offer'), chip: { ...DEFAULT_CHIP } },
      ctaPrimary: {
        ...defaultElement('ctaPrimary'),
        button: { ...DEFAULT_BUTTON },
      },
      ctaSecondary: {
        ...defaultElement('ctaSecondary'),
        button: { ...DEFAULT_BUTTON },
      },
      countdown: { ...defaultElement('countdown'), endsAt: null },
    },
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    sections: [
      {
        id: EMPTY_SECTION_ID,
        type: 'HERO',
        title: null,
        subtitle: null,
        enabled: true,
        sortOrder: 0,
        schedule: { publishAt: null, unpublishAt: null },
        payload: { behavior: { ...DEFAULT_BEHAVIOR }, slides: [slide] },
        products: [],
      },
    ],
    announcement: { enabled: false, rotationMs: 5000, items: [] },
    defaults: {},
  };
}

// --- legacy normalization ---------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mediaString(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : '';
}

function textString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Legacy CTA link → document link.
 *
 * In-app paths (`/products/…`, `/collections/…`, `/categories/…`, `/lp/…`)
 * cannot be mapped to entity ids at read time, so they degrade to `null`; the
 * publish validation (Task 4) surfaces a WARNING telling the operator to
 * re-pick the target. The CTA text always survives. https URLs become EXTERNAL
 * links; anything else (hash anchors, http, junk) degrades to `null` as well.
 */
function legacyLinkToValue(link: unknown): LinkValue | null {
  if (typeof link !== 'string') return null;
  const value = link.trim();
  if (value.startsWith('https://')) return { type: 'EXTERNAL', url: value };
  return null;
}

/**
 * Builds the v2 hero payload from a legacy payload (the old hero fields:
 * desktopImage, mobileImage, videoUrl, posterImage, ctaPrimaryText/Link and
 * ctaSecondaryText/Link).
 *
 * - The legacy visible headline lived on the section, so a non-empty
 *   `section.title`/`subtitle` is mapped into the heading/subheading elements
 *   (the section keeps its own fields for the response contract).
 * - No media at all → `media: null` (a legal draft state; publish validation
 *   blocks it). A mobile-only hero keeps its image as the main one so the
 *   IMAGE slide stays valid.
 * - A video without a poster stays schema-valid with `poster: null`; publish
 *   validation blocks it until a poster is uploaded.
 */
function legacyHeroPayloadToV2(
  section: Record<string, unknown>,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const desktopImage = mediaString(payload.desktopImage);
  const mobileImage = mediaString(payload.mobileImage);
  const videoUrl = mediaString(payload.videoUrl);
  const posterImage = mediaString(payload.posterImage);

  const mainImage = desktopImage || mobileImage;
  const hasMedia = Boolean(desktopImage || mobileImage || videoUrl);

  const media = hasMedia
    ? {
        type: videoUrl ? 'VIDEO' : 'IMAGE',
        image: mainImage ? { url: mainImage, alt: '' } : null,
        video: videoUrl
          ? {
              url: videoUrl,
              poster: posterImage || null,
              autoplay: true,
              muted: true,
              loop: true,
              playsInline: true,
              showSoundToggle: false,
              pauseOffscreen: true,
            }
          : null,
        mobileOverride:
          mobileImage && mobileImage !== mainImage
            ? {
                enabled: true,
                image: { url: mobileImage, alt: '' },
                video: null,
              }
            : { enabled: false, image: null, video: null },
        fit: 'COVER',
        focal: { x: 50, y: 50 },
        objectPosition: {
          desktop: { x: 50, y: 50 },
          tablet: null,
          mobile: null,
        },
      }
    : null;

  const sectionSchedule = isRecord(section.schedule) ? section.schedule : {};
  const slideId =
    typeof section.id === 'string' && UUID_RE.test(section.id)
      ? section.id
      : EMPTY_SLIDE_ID;

  return {
    behavior: { ...DEFAULT_BEHAVIOR },
    slides: [
      {
        id: slideId,
        name: 'Hero 1',
        enabled: section.enabled !== false,
        sortOrder: 0,
        schedule: {
          publishAt:
            typeof sectionSchedule.publishAt === 'string'
              ? sectionSchedule.publishAt
              : null,
          unpublishAt:
            typeof sectionSchedule.unpublishAt === 'string'
              ? sectionSchedule.unpublishAt
              : null,
        },
        media,
        overlay: { ...DEFAULT_OVERLAY },
        elements: {
          eyebrow: defaultElement('eyebrow'),
          heading: {
            ...defaultElement('heading'),
            text: textString(section.title),
          },
          subheading: {
            ...defaultElement('subheading'),
            text: textString(section.subtitle),
          },
          offer: { ...defaultElement('offer'), chip: { ...DEFAULT_CHIP } },
          ctaPrimary: {
            ...defaultElement('ctaPrimary'),
            text: textString(payload.ctaPrimaryText),
            link: legacyLinkToValue(payload.ctaPrimaryLink),
            button: { ...DEFAULT_BUTTON },
          },
          ctaSecondary: {
            ...defaultElement('ctaSecondary'),
            text: textString(payload.ctaSecondaryText),
            link: legacyLinkToValue(payload.ctaSecondaryLink),
            button: { ...DEFAULT_BUTTON },
          },
          countdown: { ...defaultElement('countdown'), endsAt: null },
        },
      },
    ],
  };
}

/**
 * Converts a legacy HERO section payload; everything else (including a hero
 * payload that already carries `slides`) is returned unchanged.
 */
function normalizeLegacySection(section: unknown): unknown {
  if (!isRecord(section) || section.type !== 'HERO') return section;
  const payload = isRecord(section.payload) ? section.payload : {};
  if (payload.slides !== undefined) return section;
  return { ...section, payload: legacyHeroPayloadToV2(section, payload) };
}

/**
 * Read-path normalizer: the draft and every effective version may still hold
 * legacy HERO payloads (the migration copies `homepage_sections` verbatim), so
 * the storefront serves them through this function. Idempotent and cheap: a
 * document whose hero payload already has `slides` passes straight through,
 * and the final `homepageDocumentSchema.parse` is the only validation.
 */
export function normalizeLegacyDocument(input: unknown): HomepageDocument {
  if (!isRecord(input)) return homepageDocumentSchema.parse(input);
  const sections = Array.isArray(input.sections)
    ? input.sections.map(normalizeLegacySection)
    : input.sections;
  return homepageDocumentSchema.parse({ ...input, sections });
}
