import { describe, expect, it, vi } from 'vitest';
import { homepagePayloadSchemas } from './dto/homepage-section.dto.js';
import {
  emptyDocument,
  homepageDocumentSchema,
  type AnnouncementItem,
  type HeroMedia,
  type HeroSlide,
  type HomepageDocument,
  type HomepageSection,
  type LinkValue,
  type PublishIssue,
} from './homepage-document.js';
import { HomepageValidator } from './homepage-validation.js';

/**
 * HomepageValidator is the pre-publish gate (spec §4.3): ERRORs block a
 * publish, WARNINGs require explicit operator confirmation. Every rule is
 * exercised against a minimal document, and the entity lookup is a stub whose
 * "world" is configured per test.
 */

/** Deterministic uuid v7-shaped ids for fixtures. */
const uuid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const HERO_SECTION_ID = uuid(1);
const HERO_SLIDE_ID = uuid(10);

const T_START = '2026-10-01T00:00:00.000Z';
const T_END = '2026-10-02T00:00:00.000Z';

const externalLink: LinkValue = {
  type: 'EXTERNAL',
  url: 'https://example.com/sale',
};
const productLink = (id: string): LinkValue => ({ type: 'PRODUCT', id });
const collectionLink = (id: string): LinkValue => ({ type: 'COLLECTION', id });
const categoryLink = (id: string): LinkValue => ({ type: 'CATEGORY', id });
const landingLink = (id: string): LinkValue => ({ type: 'LANDING', id });

type ProductStatus = 'ACTIVE' | 'DRAFT' | 'DISABLED';

/** A stub entity world; each lookup only answers for the ids it contains. */
function createLookup(
  world: {
    products?: Record<string, ProductStatus>;
    collections?: string[];
    categories?: string[];
    landings?: string[];
  } = {},
) {
  const products = new Map(Object.entries(world.products ?? {}));
  const collections = new Set(world.collections ?? []);
  const categories = new Set(world.categories ?? []);
  const landings = new Set(world.landings ?? []);

  return {
    productStatuses: vi.fn(async (ids: string[]) => {
      const found = new Map<string, ProductStatus>();
      for (const id of ids) {
        const status = products.get(id);
        if (status !== undefined) found.set(id, status);
      }
      return found;
    }),
    collectionExists: vi.fn(
      async (ids: string[]) => new Set(ids.filter((id) => collections.has(id))),
    ),
    categoryExists: vi.fn(
      async (ids: string[]) => new Set(ids.filter((id) => categories.has(id))),
    ),
    landingExists: vi.fn(
      async (ids: string[]) => new Set(ids.filter((id) => landings.has(id))),
    ),
    slugs: vi.fn(async () => new Map<string, string>()),
  };
}

const makeValidator = (lookup: ReturnType<typeof createLookup>) =>
  new HomepageValidator(lookup);

function heroOf(doc: HomepageDocument): HomepageSection {
  const hero = doc.sections.find((section) => section.type === 'HERO');
  if (!hero) throw new Error('fixture is missing the HERO section');
  return hero;
}

function slidesOf(doc: HomepageDocument): HeroSlide[] {
  return (heroOf(doc).payload as unknown as { slides: HeroSlide[] }).slides;
}

const imageMedia = (alt = 'Hero image'): HeroMedia => ({
  type: 'IMAGE',
  image: { url: '/uploads/catalog/2026/hero.jpg', alt },
  video: null,
  mobileOverride: { enabled: false, image: null, video: null },
  fit: 'COVER',
  focal: { x: 50, y: 50 },
  objectPosition: { desktop: { x: 50, y: 50 }, tablet: null, mobile: null },
});

const videoMedia = (poster: string | null): HeroMedia => ({
  type: 'VIDEO',
  image: null,
  video: {
    url: 'https://cdn.example.com/hero.mp4',
    poster,
    autoplay: true,
    muted: true,
    loop: true,
    playsInline: true,
    showSoundToggle: false,
    pauseOffscreen: true,
  },
  mobileOverride: { enabled: false, image: null, video: null },
  fit: 'COVER',
  focal: { x: 50, y: 50 },
  objectPosition: { desktop: { x: 50, y: 50 }, tablet: null, mobile: null },
});

/** The empty document repaired into a publishable hero: media, alt, heading. */
function validDoc(): HomepageDocument {
  const doc = emptyDocument();
  const slide = slidesOf(doc)[0];
  slide.media = imageMedia();
  slide.elements.heading.text = 'Welcome';
  return doc;
}

function addSlide(
  doc: HomepageDocument,
  over: Partial<HeroSlide> = {},
): HeroSlide {
  const slides = slidesOf(doc);
  const slide: HeroSlide = {
    ...structuredClone(slides[0]),
    id: uuid(10 + slides.length),
    sortOrder: slides.length,
    ...over,
  };
  slides.push(slide);
  return slide;
}

function addSection(
  doc: HomepageDocument,
  type: HomepageSection['type'],
  over: Partial<HomepageSection> = {},
): HomepageSection {
  const section: HomepageSection = {
    id: uuid(20 + doc.sections.length),
    type,
    title: null,
    subtitle: null,
    enabled: true,
    sortOrder: doc.sections.length,
    schedule: { publishAt: null, unpublishAt: null },
    payload: {},
    products: [],
    ...over,
  };
  doc.sections.push(section);
  return section;
}

function addAnnouncementItem(
  doc: HomepageDocument,
  over: Partial<AnnouncementItem> = {},
): AnnouncementItem {
  const item: AnnouncementItem = {
    id: uuid(30 + doc.announcement.items.length),
    text: 'Free shipping over P2,000',
    link: null,
    linkLabel: null,
    textColor: '#FFFFFF',
    backgroundColor: '#C4552D',
    schedule: { publishAt: null, unpublishAt: null },
    enabled: true,
    sortOrder: doc.announcement.items.length,
    ...over,
  };
  doc.announcement.items.push(item);
  return item;
}

const codes = (issues: PublishIssue[]): string[] =>
  issues.map((issue) => issue.code);

describe('HomepageValidator hero rules', () => {
  it('reports HERO_MEDIA_MISSING for an enabled slide without media', async () => {
    const doc = validDoc();
    slidesOf(doc)[0].media = null;

    const { errors, warnings } = await makeValidator(createLookup()).validate(
      doc,
    );

    expect(codes(errors)).toEqual(['HERO_MEDIA_MISSING']);
    expect(errors[0]).toMatchObject({
      severity: 'ERROR',
      sectionId: HERO_SECTION_ID,
      slideId: HERO_SLIDE_ID,
    });
    expect(warnings).toEqual([]);
  });

  it('reports HERO_POSTER_MISSING for a video slide without a poster', async () => {
    const doc = validDoc();
    slidesOf(doc)[0].media = videoMedia(null);

    const { errors } = await makeValidator(createLookup()).validate(doc);

    expect(codes(errors)).toEqual(['HERO_POSTER_MISSING']);
    expect(errors[0]).toMatchObject({
      severity: 'ERROR',
      sectionId: HERO_SECTION_ID,
      slideId: HERO_SLIDE_ID,
    });
  });

  it('reports HERO_POSTER_MISSING for a posterless enabled mobile override video', async () => {
    const doc = validDoc();
    const media = videoMedia('/uploads/catalog/2026/primary-poster.jpg');
    const mobileVideo = videoMedia(null).video;
    if (mobileVideo === null) throw new Error('fixture is missing mobile video');
    media.mobileOverride = { enabled: true, image: null, video: mobileVideo };
    slidesOf(doc)[0].media = media;

    const { errors } = await makeValidator(createLookup()).validate(doc);

    expect(codes(errors)).toEqual(['HERO_POSTER_MISSING']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      severity: 'ERROR',
      sectionId: HERO_SECTION_ID,
      slideId: HERO_SLIDE_ID,
    });
  });

  it('emits one slide-level poster issue when both active video sources lack posters', async () => {
    const doc = validDoc();
    const media = videoMedia(null);
    const mobileVideo = videoMedia(null).video;
    if (mobileVideo === null) throw new Error('fixture is missing mobile video');
    media.mobileOverride = { enabled: true, image: null, video: mobileVideo };
    slidesOf(doc)[0].media = media;

    const { errors } = await makeValidator(createLookup()).validate(doc);

    expect(codes(errors)).toEqual(['HERO_POSTER_MISSING']);
    expect(errors).toHaveLength(1);
  });

  it('accepts a video slide with a poster', async () => {
    const doc = validDoc();
    slidesOf(doc)[0].media = videoMedia('/uploads/catalog/2026/poster.jpg');

    const { errors, warnings } = await makeValidator(createLookup()).validate(
      doc,
    );

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('reports HERO_HEADING_REQUIRED for an enabled slide with a blank heading', async () => {
    const doc = validDoc();
    slidesOf(doc)[0].elements.heading.text = '   ';

    const { errors } = await makeValidator(createLookup()).validate(doc);

    expect(codes(errors)).toEqual(['HERO_HEADING_REQUIRED']);
    expect(errors[0]).toMatchObject({
      severity: 'ERROR',
      sectionId: HERO_SECTION_ID,
      slideId: HERO_SLIDE_ID,
    });
  });

  it('ignores disabled slides entirely', async () => {
    const doc = validDoc();
    const slide = slidesOf(doc)[0];
    slide.enabled = false;
    slide.media = null;
    slide.elements.heading.text = '';
    slide.elements.ctaPrimary.text = 'Shop now';
    slide.elements.ctaPrimary.link = productLink(uuid(201));

    const lookup = createLookup();
    const { errors, warnings } = await makeValidator(lookup).validate(doc);

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(lookup.productStatuses).not.toHaveBeenCalled();
  });

  it('does not mutate the document it validates', async () => {
    const doc = validDoc();
    slidesOf(doc)[0].media = null;
    slidesOf(doc)[0].elements.ctaPrimary.text = 'Shop now';
    const snapshot = structuredClone(doc);

    await makeValidator(createLookup()).validate(doc);

    expect(doc).toEqual(snapshot);
  });
});

describe('HomepageValidator schedule conflicts', () => {
  it('reports SCHEDULE_CONFLICT (on the later slide) for overlapping enabled windows', async () => {
    const doc = validDoc();
    slidesOf(doc)[0].schedule = { publishAt: null, unpublishAt: T_END };
    const second = addSlide(doc, {
      schedule: { publishAt: T_START, unpublishAt: null },
    });

    const { errors } = await makeValidator(createLookup()).validate(doc);

    expect(codes(errors)).toEqual(['SCHEDULE_CONFLICT']);
    expect(errors[0]).toMatchObject({
      severity: 'ERROR',
      sectionId: HERO_SECTION_ID,
      slideId: second.id,
    });
  });

  it('treats windows as half-open: starting when the other ends is not a conflict', async () => {
    const doc = validDoc();
    slidesOf(doc)[0].schedule = { publishAt: null, unpublishAt: T_START };
    addSlide(doc, { schedule: { publishAt: T_START, unpublishAt: null } });

    const { errors } = await makeValidator(createLookup()).validate(doc);

    expect(errors).toEqual([]);
  });

  it('conflicts when two enabled slides share the same open window', async () => {
    const doc = validDoc();
    addSlide(doc);

    const { errors } = await makeValidator(createLookup()).validate(doc);

    expect(codes(errors)).toEqual(['SCHEDULE_CONFLICT']);
  });

  it('ignores zero-length windows and disabled slides', async () => {
    const doc = validDoc();
    slidesOf(doc)[0].schedule = { publishAt: T_START, unpublishAt: T_START };
    addSlide(doc, { enabled: false });
    addSlide(doc, { schedule: { publishAt: null, unpublishAt: T_START } });

    const { errors } = await makeValidator(createLookup()).validate(doc);

    expect(errors).toEqual([]);
  });
});

describe('HomepageValidator link targets', () => {
  it('reports LINK_TARGET_MISSING per entity type and never resolves EXTERNAL links', async () => {
    const doc = validDoc();
    const slide = slidesOf(doc)[0];
    slide.elements.eyebrow.link = productLink(uuid(201));
    slide.elements.heading.link = collectionLink(uuid(202));
    slide.elements.offer.link = categoryLink(uuid(203));
    slide.elements.countdown.endsAt = T_END;
    slide.elements.countdown.link = landingLink(uuid(204));
    slide.elements.ctaPrimary.link = externalLink;

    const lookup = createLookup(); // empty world: nothing resolves
    const { errors, warnings } = await makeValidator(lookup).validate(doc);

    expect(codes(errors)).toEqual([
      'LINK_TARGET_MISSING',
      'LINK_TARGET_MISSING',
      'LINK_TARGET_MISSING',
      'LINK_TARGET_MISSING',
    ]);
    for (const issue of errors) {
      expect(issue).toMatchObject({
        severity: 'ERROR',
        sectionId: HERO_SECTION_ID,
        slideId: slide.id,
      });
    }
    expect(errors.map((issue) => issue.message)).toEqual([
      expect.stringContaining('product'),
      expect.stringContaining('collection'),
      expect.stringContaining('category'),
      expect.stringContaining('landing page'),
    ]);
    expect(warnings).toEqual([]);
    expect(lookup.productStatuses).toHaveBeenCalledWith([uuid(201)]);
    expect(lookup.collectionExists).toHaveBeenCalledWith([uuid(202)]);
    expect(lookup.categoryExists).toHaveBeenCalledWith([uuid(203)]);
    expect(lookup.landingExists).toHaveBeenCalledWith([uuid(204)]);
  });

  it('accepts links whose targets exist', async () => {
    const doc = validDoc();
    const slide = slidesOf(doc)[0];
    slide.elements.ctaPrimary.link = productLink(uuid(201));
    slide.elements.ctaSecondary.link = collectionLink(uuid(202));

    const lookup = createLookup({
      products: { [uuid(201)]: 'DRAFT' },
      collections: [uuid(202)],
    });
    const { errors } = await makeValidator(lookup).validate(doc);

    expect(errors).toEqual([]);
  });

  it('checks enabled announcement items and leaves disabled ones alone', async () => {
    const doc = validDoc();
    addAnnouncementItem(doc, { link: collectionLink(uuid(205)) });
    addAnnouncementItem(doc, {
      enabled: false,
      link: collectionLink(uuid(206)),
    });

    const lookup = createLookup();
    const { errors } = await makeValidator(lookup).validate(doc);

    expect(codes(errors)).toEqual(['LINK_TARGET_MISSING']);
    expect(errors[0].message).toContain('collection');
    expect(errors[0].sectionId).toBeUndefined();
    expect(errors[0].slideId).toBeUndefined();
    expect(lookup.collectionExists).toHaveBeenCalledWith([uuid(205)]);
  });

  it('ignores a stale countdown link when countdown is disabled by a null endsAt', async () => {
    const doc = validDoc();
    const slide = slidesOf(doc)[0];
    slide.elements.countdown.endsAt = null;
    slide.elements.countdown.link = collectionLink(uuid(205));

    const lookup = createLookup();
    const { errors, warnings } = await makeValidator(lookup).validate(doc);

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(lookup.collectionExists).not.toHaveBeenCalled();
  });

  it('does not call the lookup when there is nothing to resolve', async () => {
    const doc = validDoc();
    slidesOf(doc)[0].elements.ctaPrimary.link = externalLink;

    const lookup = createLookup();
    const { errors } = await makeValidator(lookup).validate(doc);

    expect(errors).toEqual([]);
    expect(lookup.productStatuses).not.toHaveBeenCalled();
    expect(lookup.collectionExists).not.toHaveBeenCalled();
    expect(lookup.categoryExists).not.toHaveBeenCalled();
    expect(lookup.landingExists).not.toHaveBeenCalled();
  });

  it('batches one lookup call per entity type with deduplicated ids', async () => {
    const doc = validDoc();
    const second = addSlide(doc, {
      schedule: { publishAt: T_END, unpublishAt: null },
    });
    const first = slidesOf(doc)[0];
    first.schedule = { publishAt: null, unpublishAt: T_START };
    const shared = uuid(201);
    const other = uuid(202);
    first.elements.ctaPrimary.link = productLink(shared);
    second.elements.ctaSecondary.link = productLink(shared);
    second.elements.offer.link = productLink(other);
    addSection(doc, 'PRODUCT_GRID', {
      payload: { columns: 4 },
      products: [
        { productId: shared, sortOrder: 0, badge: null },
        { productId: uuid(203), sortOrder: 1, badge: null },
      ],
    });

    const lookup = createLookup({
      products: {
        [shared]: 'ACTIVE',
        [other]: 'ACTIVE',
        [uuid(203)]: 'ACTIVE',
      },
    });
    const { errors, warnings } = await makeValidator(lookup).validate(doc);

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(lookup.productStatuses).toHaveBeenCalledTimes(1);
    expect(lookup.productStatuses).toHaveBeenCalledWith([
      shared,
      other,
      uuid(203),
    ]);
  });
});

describe('HomepageValidator non-hero sections', () => {
  it('reports SECTION_PAYLOAD_INVALID with the first legacy schema issue message', async () => {
    const doc = validDoc();
    const payload = { items: [{ label: '' }] }; // USP labels need min(1)
    const section = addSection(doc, 'USP', { payload });

    const parsed = homepagePayloadSchemas.USP.safeParse(payload);
    if (parsed.success) throw new Error('fixture payload should be invalid');

    const { errors } = await makeValidator(createLookup()).validate(doc);

    expect(codes(errors)).toEqual(['SECTION_PAYLOAD_INVALID']);
    expect(errors[0]).toMatchObject({
      severity: 'ERROR',
      sectionId: section.id,
    });
    expect(errors[0].message).toContain(parsed.error.issues[0].message);
  });

  it('accepts non-hero payloads that satisfy their legacy schemas', async () => {
    const doc = validDoc();
    addSection(doc, 'USP', { payload: { items: [{ label: 'Fast delivery' }] } });

    const { errors } = await makeValidator(createLookup()).validate(doc);

    expect(errors).toEqual([]);
  });

  it('requires an enabled countdown banner to end in the future', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-10-08T12:00:00.000Z');
    vi.setSystemTime(now);
    try {
      const cases: Array<{
        endsAt: string | null;
        expectedCode: string;
      }> = [
        { endsAt: null, expectedCode: 'COUNTDOWN_END_REQUIRED' },
        { endsAt: now.toISOString(), expectedCode: 'COUNTDOWN_END_NOT_FUTURE' },
        {
          endsAt: new Date(now.getTime() - 1).toISOString(),
          expectedCode: 'COUNTDOWN_END_NOT_FUTURE',
        },
      ];

      for (const testCase of cases) {
        const doc = validDoc();
        const section = addSection(
          doc,
          'COUNTDOWN_BANNER' as HomepageSection['type'],
          { payload: { endsAt: testCase.endsAt } },
        );
        const { errors } = await makeValidator(createLookup()).validate(doc);
        expect(codes(errors)).toEqual([testCase.expectedCode]);
        expect(errors[0]).toMatchObject({ sectionId: section.id });
      }

      const future = validDoc();
      addSection(future, 'COUNTDOWN_BANNER' as HomepageSection['type'], {
        payload: { endsAt: new Date(now.getTime() + 60_000).toISOString() },
      });
      await expect(
        makeValidator(createLookup()).validate(future),
      ).resolves.toMatchObject({ errors: [] });

      const disabled = validDoc();
      addSection(disabled, 'COUNTDOWN_BANNER' as HomepageSection['type'], {
        enabled: false,
        payload: { endsAt: null },
      });
      await expect(
        makeValidator(createLookup()).validate(disabled),
      ).resolves.toMatchObject({ errors: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a countdown that ends before its section can become active', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-10-08T12:00:00.000Z');
    vi.setSystemTime(now);
    try {
      const doc = validDoc();
      const section = addSection(
        doc,
        'COUNTDOWN_BANNER' as HomepageSection['type'],
        {
          schedule: {
            publishAt: new Date(now.getTime() + 120_000).toISOString(),
            unpublishAt: null,
          },
          payload: { endsAt: new Date(now.getTime() + 60_000).toISOString() },
        },
      );

      const { errors } = await makeValidator(createLookup()).validate(doc);

      expect(codes(errors)).toEqual(['COUNTDOWN_WINDOW_EMPTY']);
      expect(errors[0]).toMatchObject({ sectionId: section.id });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports issues in document order', async () => {
    const doc = validDoc();
    slidesOf(doc)[0].media = null; // HERO error first
    addSection(doc, 'USP', { payload: { items: [{ label: '' }] } });

    const { errors } = await makeValidator(createLookup()).validate(doc);

    expect(codes(errors)).toEqual([
      'HERO_MEDIA_MISSING',
      'SECTION_PAYLOAD_INVALID',
    ]);
  });
});

describe('HomepageValidator warnings', () => {
  it('warns ALT_MISSING for hero images without alt text (main and mobile)', async () => {
    const doc = validDoc();
    const slide = slidesOf(doc)[0];
    slide.media = imageMedia('');
    slide.media.mobileOverride = {
      enabled: true,
      image: { url: '/uploads/catalog/2026/mobile.jpg', alt: '' },
      video: null,
    };

    const { errors, warnings } = await makeValidator(createLookup()).validate(
      doc,
    );

    expect(errors).toEqual([]);
    expect(codes(warnings)).toEqual(['ALT_MISSING', 'ALT_MISSING']);
    for (const issue of warnings) {
      expect(issue).toMatchObject({
        severity: 'WARNING',
        sectionId: HERO_SECTION_ID,
        slideId: slide.id,
      });
    }
  });

  it('warns GRID_EMPTY for a product grid without products', async () => {
    const doc = validDoc();
    const grid = addSection(doc, 'PRODUCT_GRID', {
      payload: { columns: 4 },
      products: [],
    });

    const { errors, warnings } = await makeValidator(createLookup()).validate(
      doc,
    );

    expect(errors).toEqual([]);
    expect(codes(warnings)).toEqual(['GRID_EMPTY']);
    expect(warnings[0]).toMatchObject({
      severity: 'WARNING',
      sectionId: grid.id,
    });
  });

  it('warns PRODUCT_UNAVAILABLE for grid products that are missing or not ACTIVE', async () => {
    const doc = validDoc();
    const active = uuid(201);
    const draft = uuid(202);
    const missing = uuid(203);
    const grid = addSection(doc, 'PRODUCT_GRID', {
      payload: { columns: 4 },
      products: [
        { productId: active, sortOrder: 0, badge: null },
        { productId: draft, sortOrder: 1, badge: null },
        { productId: missing, sortOrder: 2, badge: null },
      ],
    });

    const lookup = createLookup({
      products: { [active]: 'ACTIVE', [draft]: 'DRAFT' },
    });
    const { errors, warnings } = await makeValidator(lookup).validate(doc);

    expect(errors).toEqual([]);
    expect(codes(warnings)).toEqual([
      'PRODUCT_UNAVAILABLE',
      'PRODUCT_UNAVAILABLE',
    ]);
    for (const issue of warnings) {
      expect(issue).toMatchObject({
        severity: 'WARNING',
        sectionId: grid.id,
      });
    }
    expect(warnings[0].message).toContain(draft);
    expect(warnings[0].message).toContain('DRAFT');
    expect(warnings[1].message).toContain(missing);
  });

  it('warns CTA_LINK_MISSING when a CTA has text but no link target', async () => {
    const doc = validDoc();
    const slide = slidesOf(doc)[0];
    // The legacy normalization case: the text survives, the link degrades to null.
    slide.elements.ctaPrimary.text = 'Shop now';
    slide.elements.ctaSecondary.text = 'Learn more';

    const { errors, warnings } = await makeValidator(createLookup()).validate(
      doc,
    );

    expect(errors).toEqual([]);
    expect(codes(warnings)).toEqual(['CTA_LINK_MISSING', 'CTA_LINK_MISSING']);
    for (const issue of warnings) {
      expect(issue).toMatchObject({
        severity: 'WARNING',
        sectionId: HERO_SECTION_ID,
        slideId: slide.id,
      });
    }
    expect(warnings[0].message).toContain('primary');
    expect(warnings[1].message).toContain('secondary');
  });

  it('does not warn CTA_LINK_MISSING when the CTA has a link or no text', async () => {
    const doc = validDoc();
    const slide = slidesOf(doc)[0];
    slide.elements.ctaPrimary.text = 'Shop now';
    slide.elements.ctaPrimary.link = externalLink;
    slide.elements.ctaSecondary.text = '   '; // no visible label, no warning

    const { warnings } = await makeValidator(createLookup()).validate(doc);

    expect(warnings).toEqual([]);
  });

  it('exempts announcement items from CTA_LINK_MISSING', async () => {
    const doc = validDoc();
    addAnnouncementItem(doc, { text: 'Free shipping', link: null });

    const { warnings } = await makeValidator(createLookup()).validate(doc);

    expect(warnings).toEqual([]);
  });

  it('separates errors and warnings with the matching severity field', async () => {
    const doc = validDoc();
    const slide = slidesOf(doc)[0];
    slide.media = null;
    slide.elements.ctaPrimary.text = 'Shop now';

    const { errors, warnings } = await makeValidator(createLookup()).validate(
      doc,
    );

    expect(errors.map((issue) => issue.severity)).toEqual(['ERROR']);
    expect(warnings.map((issue) => issue.severity)).toEqual(['WARNING']);
  });
});

describe('HomepageValidator valid documents', () => {
  it('passes a fully valid document with zero issues', async () => {
    const doc = validDoc();
    const slide = slidesOf(doc)[0];
    slide.elements.ctaPrimary.text = 'Shop now';
    slide.elements.ctaPrimary.link = externalLink;
    slide.elements.heading.link = collectionLink(uuid(202));
    addSection(doc, 'PRODUCT_GRID', {
      payload: { columns: 4 },
      products: [{ productId: uuid(201), sortOrder: 0, badge: null }],
    });
    addAnnouncementItem(doc, {
      text: 'Free shipping over P2,000',
      link: collectionLink(uuid(202)),
      linkLabel: 'See more',
    });
    doc.announcement.enabled = true;

    const lookup = createLookup({
      products: { [uuid(201)]: 'ACTIVE' },
      collections: [uuid(202)],
    });
    const { errors, warnings } = await makeValidator(lookup).validate(doc);

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    // Sanity check: the fixture is a schema-valid document, which is what the
    // validator is contractually given (every save path parses the document).
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(true);
  });
});
