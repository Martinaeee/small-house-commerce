import type {
  AnnouncementBlock,
  DocumentValidator,
  HeroElementKey,
  HeroPayload,
  HeroSlide,
  HomepageDocument,
  HomepageSection,
  LinkValue,
  PublishIssue,
  Schedule,
} from './homepage-document.js';
import { bannerPayloadSchemas } from './homepage-document.js';
import { homepagePayloadSchemas } from './dto/homepage-section.dto.js';

/**
 * Pre-publish validation for the homepage V2 document (spec §4.3).
 *
 * `HomepageValidator` implements the `DocumentValidator` gate consumed by
 * `HomepageDocumentService.publish` and the admin validate endpoint. It is a
 * pure rule engine: the only dependency is an injected `LinkLookup` (Prisma
 * backed in production, a stub in tests), so this module carries no Nest
 * lifecycle and no database imports.
 *
 * Rule codes are a frontend contract (the publish panel groups issues by
 * them), so they are frozen:
 *
 *   ERROR    HERO_MEDIA_MISSING, HERO_POSTER_MISSING, HERO_HEADING_REQUIRED,
 *            SCHEDULE_CONFLICT, LINK_TARGET_MISSING, SECTION_PAYLOAD_INVALID
 *   WARNING  ALT_MISSING, GRID_EMPTY, PRODUCT_UNAVAILABLE, CTA_LINK_MISSING
 *
 * The document is schema-valid by the time it reaches the validator: every
 * write path parses it with `homepageDocumentSchema` (or normalizes legacy
 * payloads) first. The validator therefore trusts payload shapes and only
 * enforces the content rules the schema cannot express (a slide may legally
 * be a poster-less, heading-less draft — it just cannot be published).
 */

export type LinkEntityType = 'PRODUCT' | 'COLLECTION' | 'CATEGORY' | 'LANDING';

/** A `LinkValue` that points at a stored entity row (needs a lookup). */
type EntityLink = Exclude<LinkValue, { type: 'EXTERNAL' } | { type: 'INTERNAL' }>;

/** Links that carry their own href and need no entity lookup. */
function isSelfResolvingLink(
  link: LinkValue | null,
): link is Extract<LinkValue, { type: 'EXTERNAL' | 'INTERNAL' }> {
  return link !== null && (link.type === 'EXTERNAL' || link.type === 'INTERNAL');
}

type ProductStatus = 'ACTIVE' | 'DRAFT' | 'DISABLED';

/**
 * Entity resolution for document links. The validator only needs existence /
 * status; `slugs` is part of the surface because the storefront link resolver
 * consumes the same lookup (implemented once in the cms module).
 */
export interface LinkLookup {
  productStatuses(
    ids: string[],
  ): Promise<Map<string, 'ACTIVE' | 'DRAFT' | 'DISABLED'>>;
  collectionExists(ids: string[]): Promise<Set<string>>;
  categoryExists(ids: string[]): Promise<Set<string>>;
  landingExists(ids: string[]): Promise<Set<string>>;
  slugs(type: LinkEntityType, ids: string[]): Promise<Map<string, string>>;
}

export class HomepageValidator implements DocumentValidator {
  constructor(private readonly lookup: LinkLookup) {}

  async validate(
    doc: HomepageDocument,
  ): Promise<{ errors: PublishIssue[]; warnings: PublishIssue[] }> {
    // One batched lookup call per entity type (never one per link).
    const ids = collectLookupIds(doc);
    const [productStatuses, collections, categories, landings] =
      await Promise.all([
        resolveIds(
          ids.productIds,
          (value) => this.lookup.productStatuses(value),
          new Map<string, ProductStatus>(),
        ),
        resolveIds(
          ids.collectionIds,
          (value) => this.lookup.collectionExists(value),
          new Set<string>(),
        ),
        resolveIds(
          ids.categoryIds,
          (value) => this.lookup.categoryExists(value),
          new Set<string>(),
        ),
        resolveIds(
          ids.landingIds,
          (value) => this.lookup.landingExists(value),
          new Set<string>(),
        ),
      ]);
    const results: LookupResults = {
      productStatuses,
      collections,
      categories,
      landings,
    };

    const errors: PublishIssue[] = [];
    const warnings: PublishIssue[] = [];
    const now = new Date();

    // Issues come out in document order: sections as stored, then the
    // announcement (which has no section to jump to).
    for (const section of doc.sections) {
      if (section.type === 'HERO') {
        checkHeroSection(section, results, errors, warnings);
      } else {
        checkSectionPayload(section, errors);
        if (section.type === 'COUNTDOWN_BANNER') {
          checkCountdownBanner(section, now, errors);
        }
        if (section.type === 'PRODUCT_GRID') {
          checkProductGrid(section, results, warnings);
        }
      }
    }
    checkAnnouncement(doc.announcement, results, errors);

    return { errors, warnings };
  }
}

// --- lookup plumbing --------------------------------------------------------

type LookupIds = {
  productIds: Set<string>;
  collectionIds: Set<string>;
  categoryIds: Set<string>;
  landingIds: Set<string>;
};

type LookupResults = {
  productStatuses: Map<string, ProductStatus>;
  collections: Set<string>;
  categories: Set<string>;
  landings: Set<string>;
};

/** Every id the rules below will ask about: enabled links + grid products. */
function collectLookupIds(doc: HomepageDocument): LookupIds {
  const ids: LookupIds = {
    productIds: new Set(),
    collectionIds: new Set(),
    categoryIds: new Set(),
    landingIds: new Set(),
  };
  const addLink = (link: LinkValue | null): void => {
    if (link === null || isSelfResolvingLink(link)) return;
    switch (link.type) {
      case 'PRODUCT':
        ids.productIds.add(link.id);
        break;
      case 'COLLECTION':
        ids.collectionIds.add(link.id);
        break;
      case 'CATEGORY':
        ids.categoryIds.add(link.id);
        break;
      case 'LANDING':
        ids.landingIds.add(link.id);
        break;
    }
  };

  for (const section of doc.sections) {
    if (section.type === 'HERO') {
      for (const slide of heroSlidesOf(section)) {
        if (!slide.enabled) continue;
        for (const key of HERO_ELEMENT_KEYS) {
          if (isHeroElementEnabled(slide, key)) {
            addLink(slide.elements[key].link);
          }
        }
      }
    } else if (section.type === 'PRODUCT_GRID') {
      for (const row of section.products) ids.productIds.add(row.productId);
    }
  }
  for (const item of doc.announcement.items) {
    if (item.enabled) addLink(item.link);
  }

  return ids;
}

/** Skips the round trip when there is nothing to resolve. */
function resolveIds<T>(
  ids: Set<string>,
  resolve: (ids: string[]) => Promise<T>,
  empty: T,
): Promise<T> {
  return ids.size === 0 ? Promise.resolve(empty) : resolve([...ids]);
}

function linkExists(link: EntityLink, results: LookupResults): boolean {
  switch (link.type) {
    case 'PRODUCT':
      return results.productStatuses.has(link.id);
    case 'COLLECTION':
      return results.collections.has(link.id);
    case 'CATEGORY':
      return results.categories.has(link.id);
    case 'LANDING':
      return results.landings.has(link.id);
  }
}

// --- rules ------------------------------------------------------------------

/** Element order for deterministic issue output (render order). */
const HERO_ELEMENT_KEYS: readonly HeroElementKey[] = [
  'eyebrow',
  'heading',
  'subheading',
  'offer',
  'ctaPrimary',
  'ctaSecondary',
  'countdown',
];

/** Countdown has no explicit enabled flag: a null endsAt disables it. */
function isHeroElementEnabled(
  slide: HeroSlide,
  key: HeroElementKey,
): boolean {
  return key !== 'countdown' || slide.elements.countdown.endsAt !== null;
}

const ENTITY_NOUN: Record<LinkEntityType, string> = {
  PRODUCT: 'product',
  COLLECTION: 'collection',
  CATEGORY: 'category',
  LANDING: 'landing page',
};

/**
 * HERO payloads are strictly validated by `homepageDocumentSchema`, so the
 * cast is safe for any document that passed a save path.
 */
function heroSlidesOf(section: HomepageSection): HeroSlide[] {
  return (section.payload as unknown as HeroPayload).slides;
}

function checkHeroSection(
  section: HomepageSection,
  results: LookupResults,
  errors: PublishIssue[],
  warnings: PublishIssue[],
): void {
  const slides = heroSlidesOf(section).filter((slide) => slide.enabled);

  for (const slide of slides) {
    checkSlideContent(section, slide, errors, warnings);

    for (const key of HERO_ELEMENT_KEYS) {
      if (!isHeroElementEnabled(slide, key)) continue;
      const link = slide.elements[key].link;
      if (link === null || isSelfResolvingLink(link)) continue;
      if (linkExists(link, results)) continue;
      errors.push(
        issue(
          'ERROR',
          'LINK_TARGET_MISSING',
          `Slide "${slide.name}": the ${key} link points to a ${ENTITY_NOUN[link.type]} that does not exist.`,
          section.id,
          slide.id,
        ),
      );
    }
  }

  // Overlap is only a conflict between two enabled slides; the windows are
  // half-open ([publishAt ?? -Infinity, unpublishAt ?? +Infinity)), so a slide
  // starting exactly when another ends is fine.
  for (let i = 0; i < slides.length; i += 1) {
    for (let j = i + 1; j < slides.length; j += 1) {
      if (
        windowsOverlap(windowOf(slides[i].schedule), windowOf(slides[j].schedule))
      ) {
        errors.push(
          issue(
            'ERROR',
            'SCHEDULE_CONFLICT',
            `Slide "${slides[j].name}" schedule overlaps slide "${slides[i].name}" (both enabled).`,
            section.id,
            slides[j].id,
          ),
        );
      }
    }
  }
}

function checkSlideContent(
  section: HomepageSection,
  slide: HeroSlide,
  errors: PublishIssue[],
  warnings: PublishIssue[],
): void {
  const { media } = slide;

  if (media === null) {
    errors.push(
      issue(
        'ERROR',
        'HERO_MEDIA_MISSING',
        `Enabled slide "${slide.name}" has no image or video.`,
        section.id,
        slide.id,
      ),
    );
  } else {
    const primaryVideoMissingPoster =
      media.type === 'VIDEO' && media.video?.poster === null;
    const mobileVideoMissingPoster =
      media.mobileOverride.enabled &&
      media.mobileOverride.video?.poster === null;
    if (primaryVideoMissingPoster || mobileVideoMissingPoster) {
      errors.push(
        issue(
          'ERROR',
          'HERO_POSTER_MISSING',
          `Slide "${slide.name}" uses a video without a poster image.`,
          section.id,
          slide.id,
        ),
      );
    }
    if (media.image !== null && media.image.alt.trim() === '') {
      warnings.push(
        issue(
          'WARNING',
          'ALT_MISSING',
          `Slide "${slide.name}" image is missing alt text.`,
          section.id,
          slide.id,
        ),
      );
    }
    const mobile = media.mobileOverride;
    if (
      mobile.enabled &&
      mobile.image !== null &&
      mobile.image.alt.trim() === ''
    ) {
      warnings.push(
        issue(
          'WARNING',
          'ALT_MISSING',
          `Slide "${slide.name}" mobile image is missing alt text.`,
          section.id,
          slide.id,
        ),
      );
    }
  }

  if (slide.elements.heading.text.trim() === '') {
    errors.push(
      issue(
        'ERROR',
        'HERO_HEADING_REQUIRED',
        `Slide "${slide.name}" needs a heading.`,
        section.id,
        slide.id,
      ),
    );
  }

  // The publish-time surface for links legacy normalization had to drop (and
  // for links the operator never picked): text without a target renders a
  // dead button. Announcement items are exempt — their link is optional.
  for (const key of ['ctaPrimary', 'ctaSecondary'] as const) {
    const cta = slide.elements[key];
    if (cta.text.trim() !== '' && cta.link === null) {
      warnings.push(
        issue(
          'WARNING',
          'CTA_LINK_MISSING',
          `Slide "${slide.name}" ${key === 'ctaPrimary' ? 'primary' : 'secondary'} CTA has text but no link.`,
          section.id,
          slide.id,
        ),
      );
    }
  }
}

/**
 * Non-hero payloads stay owned by the legacy per-type DTOs; the publish gate
 * re-runs the same schema so a payload the editor could not have saved (or a
 * schema tightened since) cannot go live.
 */
function checkSectionPayload(
  section: HomepageSection,
  errors: PublishIssue[],
): void {
  const schema =
    section.type === 'PROMO_BANNER' || section.type === 'COUNTDOWN_BANNER'
      ? bannerPayloadSchemas[section.type]
      : homepagePayloadSchemas[
          section.type as keyof typeof homepagePayloadSchemas
        ];
  if (schema === undefined) {
    errors.push(
      issue(
        'ERROR',
        'SECTION_PAYLOAD_INVALID',
        `Section type "${section.type}" has no payload schema.`,
        section.id,
      ),
    );
    return;
  }
  const parsed = schema.safeParse(section.payload);
  if (parsed.success) return;
  const first = parsed.error.issues[0];
  const path = first.path.join('.');
  errors.push(
    issue(
      'ERROR',
      'SECTION_PAYLOAD_INVALID',
      `Section payload is invalid${path === '' ? '' : ` at "${path}"`}: ${first.message}`,
      section.id,
    ),
  );
}

function checkCountdownBanner(
  section: HomepageSection,
  now: Date,
  errors: PublishIssue[],
): void {
  if (!section.enabled) return;

  const payload = section.payload as { endsAt?: unknown };
  if (payload.endsAt === null || payload.endsAt === undefined) {
    errors.push(
      issue(
        'ERROR',
        'COUNTDOWN_END_REQUIRED',
        'Enabled countdown banners need an end time before publishing.',
        section.id,
      ),
    );
    return;
  }

  const endsAt =
    typeof payload.endsAt === 'string' ? Date.parse(payload.endsAt) : Number.NaN;
  const nowMs = now.getTime();
  if (!Number.isFinite(endsAt) || endsAt <= nowMs) {
    errors.push(
      issue(
        'ERROR',
        'COUNTDOWN_END_NOT_FUTURE',
        'The countdown end time must be in the future.',
        section.id,
      ),
    );
    return;
  }

  const publishAt =
    section.schedule.publishAt === null
      ? nowMs
      : Date.parse(section.schedule.publishAt);
  const unpublishAt =
    section.schedule.unpublishAt === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(section.schedule.unpublishAt);
  if (Math.min(endsAt, unpublishAt) <= Math.max(nowMs, publishAt)) {
    errors.push(
      issue(
        'ERROR',
        'COUNTDOWN_WINDOW_EMPTY',
        'The countdown must remain active after its section start time.',
        section.id,
      ),
    );
  }
}

function checkProductGrid(
  section: HomepageSection,
  results: LookupResults,
  warnings: PublishIssue[],
): void {
  if (section.products.length === 0) {
    warnings.push(
      issue(
        'WARNING',
        'GRID_EMPTY',
        'This product grid has no products and will be hidden on the storefront.',
        section.id,
      ),
    );
  }

  const seen = new Set<string>();
  for (const row of section.products) {
    if (seen.has(row.productId)) continue;
    seen.add(row.productId);
    const status = results.productStatuses.get(row.productId);
    if (status === undefined) {
      warnings.push(
        issue(
          'WARNING',
          'PRODUCT_UNAVAILABLE',
          `Product ${row.productId} does not exist and will be skipped on the storefront.`,
          section.id,
        ),
      );
    } else if (status !== 'ACTIVE') {
      warnings.push(
        issue(
          'WARNING',
          'PRODUCT_UNAVAILABLE',
          `Product ${row.productId} is not ACTIVE (status ${status}) and will be skipped on the storefront.`,
          section.id,
        ),
      );
    }
  }
}

function checkAnnouncement(
  announcement: AnnouncementBlock,
  results: LookupResults,
  errors: PublishIssue[],
): void {
  for (const item of announcement.items) {
    if (!item.enabled) continue;
    const { link } = item;
    if (link === null || isSelfResolvingLink(link)) continue;
    if (linkExists(link, results)) continue;
    errors.push(
      issue(
        'ERROR',
        'LINK_TARGET_MISSING',
        `Announcement item "${item.text}" links to a ${ENTITY_NOUN[link.type]} that does not exist.`,
      ),
    );
  }
}

// --- helpers ----------------------------------------------------------------

type ScheduleWindow = { start: number; end: number };

/**
 * `[publishAt ?? -Infinity, unpublishAt ?? +Infinity)` — the same half-open
 * window semantics the storefront resolver uses (publishAt == now is active,
 * unpublishAt == now is not).
 */
function windowOf(schedule: Schedule): ScheduleWindow {
  return {
    start:
      schedule.publishAt === null
        ? Number.NEGATIVE_INFINITY
        : Date.parse(schedule.publishAt),
    end:
      schedule.unpublishAt === null
        ? Number.POSITIVE_INFINITY
        : Date.parse(schedule.unpublishAt),
  };
}

function windowsOverlap(a: ScheduleWindow, b: ScheduleWindow): boolean {
  return a.start < b.end && b.start < a.end;
}

function issue(
  severity: 'ERROR' | 'WARNING',
  code: string,
  message: string,
  sectionId?: string,
  slideId?: string,
): PublishIssue {
  const result: PublishIssue = { severity, code, message };
  if (sectionId !== undefined) result.sectionId = sectionId;
  if (slideId !== undefined) result.slideId = slideId;
  return result;
}
