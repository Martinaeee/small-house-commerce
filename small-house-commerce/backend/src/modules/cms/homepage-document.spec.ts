import { describe, expect, it } from 'vitest';
import {
  emptyDocument,
  homepageDocumentSchema,
  isScheduleActive,
  normalizeLegacyDocument,
  type HomepageDocument,
  type HomepageSection,
} from './homepage-document.js';

/** Deterministic uuid v7-shaped ids for fixtures. */
const uuid = (n: number) =>
  `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const SECTION_ID = uuid(1);
const SLIDE_ID = uuid(10);

function heroSectionOf(doc: HomepageDocument): HomepageSection {
  const hero = doc.sections.find((section) => section.type === 'HERO');
  if (!hero) throw new Error('fixture is missing the HERO section');
  return hero;
}

function heroPayloadOf(doc: HomepageDocument): Record<string, unknown> {
  return heroSectionOf(doc).payload;
}

function heroSlidesOf(doc: HomepageDocument): Array<Record<string, unknown>> {
  return heroPayloadOf(doc).slides as Array<Record<string, unknown>>;
}

const imageMedia = (): Record<string, unknown> => ({
  type: 'IMAGE',
  image: { url: '/uploads/catalog/2026/hero.jpg', alt: '' },
  video: null,
  mobileOverride: { enabled: false, image: null, video: null },
  fit: 'COVER',
  focal: { x: 50, y: 50 },
  objectPosition: { desktop: { x: 50, y: 50 }, tablet: null, mobile: null },
});

const videoMedia = (): Record<string, unknown> => ({
  type: 'VIDEO',
  image: null,
  video: {
    url: 'https://cdn.example/hero.mp4',
    poster: '/uploads/catalog/2026/poster.jpg',
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

/** The empty document's default slide is valid; swap its media in. */
function slideWith(
  media: Record<string, unknown>,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...structuredClone(heroSlidesOf(emptyDocument())[0]),
    ...over,
    media,
  };
}

function legacyDocument(
  payload: Record<string, unknown>,
  over: Partial<HomepageSection> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    announcement: emptyDocument().announcement,
    sections: [
      {
        id: SECTION_ID,
        type: 'HERO',
        title: null,
        subtitle: null,
        enabled: true,
        sortOrder: 0,
        schedule: { publishAt: null, unpublishAt: null },
        products: [],
        payload,
        ...over,
      },
    ],
  };
}

describe('homepage document schema v1', () => {
  it('accepts the empty document and rejects any other schema version', () => {
    const doc = emptyDocument();
    expect(homepageDocumentSchema.parse(doc)).toMatchObject({
      schemaVersion: 1,
    });
    for (const schemaVersion of [0, 2, '1', null]) {
      expect(
        homepageDocumentSchema.safeParse({ ...doc, schemaVersion }).success,
      ).toBe(false);
    }
  });

  it('rejects an IMAGE slide whose media has no image', () => {
    const doc = emptyDocument();
    heroPayloadOf(doc).slides = [
      slideWith({ ...imageMedia(), image: null }, { id: SLIDE_ID }),
    ];
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('rejects a VIDEO slide without a video object', () => {
    const doc = emptyDocument();
    heroPayloadOf(doc).slides = [
      slideWith({ ...videoMedia(), video: null }, { id: SLIDE_ID }),
    ];
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('keeps a VIDEO slide with a null poster schema-valid (publish validation is the gate)', () => {
    // HERO_POSTER_MISSING (Task 4) blocks publishing a poster-less video, so
    // the document schema itself must accept the draft intermediate state.
    const doc = emptyDocument();
    const media = videoMedia();
    (media.video as Record<string, unknown>).poster = null;
    heroPayloadOf(doc).slides = [slideWith(media, { id: SLIDE_ID })];
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('rejects a mobile override that disables itself while keeping media', () => {
    const doc = emptyDocument();
    const media = imageMedia();
    media.mobileOverride = {
      enabled: false,
      image: { url: '/uploads/catalog/2026/mobile.jpg', alt: '' },
      video: null,
    };
    heroPayloadOf(doc).slides = [slideWith(media, { id: SLIDE_ID })];
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('rejects non-https external links, non-uuid entity ids and unknown link types', () => {
    const doc = emptyDocument();
    const slide = heroSlidesOf(doc)[0];
    const cta = (slide.elements as Record<string, Record<string, unknown>>)
      .ctaPrimary;

    cta.link = { type: 'EXTERNAL', url: 'http://insecure.example' };
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);

    cta.link = { type: 'PRODUCT', id: 'not-a-uuid' };
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);

    cta.link = { type: 'HASH', url: '#solutions' };
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);

    cta.link = { type: 'EXTERNAL', url: 'https://example.com/sale' };
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('rejects injected colour strings and out-of-range typography values', () => {
    const doc = emptyDocument();
    const slide = heroSlidesOf(doc)[0];
    const heading = (slide.elements as Record<string, Record<string, unknown>>)
      .heading;
    const style = heading.style as Record<string, unknown>;

    style.textColor = 'red; background:url(x)';
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);

    style.textColor = '#C4552D';
    style.fontSize = 4;
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);

    delete style.fontSize;
    style.fontWeight = 300;
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);

    delete style.fontWeight;
    style.textAlign = 'JUSTIFY';
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);

    delete style.textAlign;
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('rejects hero payloads with zero or more than six slides', () => {
    const doc = emptyDocument();
    heroPayloadOf(doc).slides = [];
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);

    const template = heroSlidesOf(emptyDocument())[0];
    heroPayloadOf(doc).slides = Array.from({ length: 7 }, (_, index) => ({
      ...structuredClone(template),
      id: uuid(20 + index),
    }));
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('rejects announcement items beyond six and out-of-range rotation', () => {
    const doc = emptyDocument();
    const item = {
      id: uuid(30),
      text: 'Free Metro Manila delivery',
      link: null,
      linkLabel: null,
      textColor: '#292724',
      backgroundColor: '#F2EFE9',
      schedule: { publishAt: null, unpublishAt: null },
      enabled: true,
      sortOrder: 0,
    };
    doc.announcement.items = Array.from({ length: 7 }, (_, index) => ({
      ...item,
      id: uuid(30 + index),
      sortOrder: index,
    }));
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);

    doc.announcement.items = [item];
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(true);

    doc.announcement.rotationMs = 1000;
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('rejects sections with more than 24 products or an over-long badge', () => {
    const doc = emptyDocument();
    doc.sections[0].products = Array.from({ length: 25 }, (_, index) => ({
      productId: uuid(100 + index),
      sortOrder: index,
      badge: null,
    }));
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);

    doc.sections[0].products = [
      { productId: uuid(100), sortOrder: 0, badge: 'x'.repeat(21) },
    ];
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('validates offer chip and CTA button ranges', () => {
    const doc = emptyDocument();
    const slide = heroSlidesOf(doc)[0];
    const elements = slide.elements as Record<string, Record<string, unknown>>;

    (elements.offer.chip as Record<string, unknown>).borderRadius = 60;
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);

    (elements.offer.chip as Record<string, unknown>).borderRadius = 4;
    (elements.ctaPrimary.button as Record<string, unknown>).variant = 'GHOST';
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);

    (elements.ctaPrimary.button as Record<string, unknown>).variant = 'OUTLINE';
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('keeps stored buttons without the arrow field schema-valid', () => {
    const doc = emptyDocument();
    const slide = heroSlidesOf(doc)[0];
    const elements = slide.elements as Record<string, Record<string, unknown>>;
    // Legacy stored documents (the migrated v1 included) predate the optional
    // `arrow` flag: their buttons carry no field and must keep validating.
    delete (elements.ctaPrimary.button as Record<string, unknown>).arrow;
    delete (elements.ctaSecondary.button as Record<string, unknown>).arrow;
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('writes arrow: false on fresh buttons and accepts true once toggled', () => {
    const doc = emptyDocument();
    const slide = heroSlidesOf(doc)[0];
    const elements = slide.elements as Record<string, Record<string, unknown>>;
    expect((elements.ctaPrimary.button as Record<string, unknown>).arrow).toBe(
      false,
    );
    expect((elements.ctaSecondary.button as Record<string, unknown>).arrow).toBe(
      false,
    );

    // The builder writes true when the operator toggles the trailing arrow on.
    (elements.ctaPrimary.button as Record<string, unknown>).arrow = true;
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('passes non-hero payloads through untouched', () => {
    const doc = emptyDocument();
    const usp: HomepageSection = {
      id: uuid(2),
      type: 'USP',
      title: 'Why LUWAG',
      subtitle: null,
      enabled: true,
      sortOrder: 10,
      schedule: { publishAt: null, unpublishAt: null },
      payload: { items: [{ label: 'Free delivery', extra: { nested: true } }] },
      products: [],
    };
    doc.sections.push(usp);

    const parsed = homepageDocumentSchema.parse(doc);
    expect(parsed.sections[1].payload).toEqual(usp.payload);
    expect(parsed.sections[1].title).toBe('Why LUWAG');
  });

  it('rejects a HERO section whose payload is still the legacy shape', () => {
    const doc = emptyDocument();
    heroSectionOf(doc).payload = {
      desktopImage: '/uploads/catalog/2026/a.jpg',
    } as Record<string, unknown>;
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
  });
});

describe('normalizeLegacyDocument', () => {
  it('converts a legacy hero payload into a single v2 slide', () => {
    const legacy = legacyDocument({
      desktopImage: '/uploads/catalog/2026/a.jpg',
      mobileImage: '/uploads/catalog/2026/b.jpg',
      videoUrl: 'https://cdn.example/hero.mp4',
      posterImage: '/uploads/catalog/2026/p.jpg',
      ctaPrimaryText: 'Shop now',
      ctaPrimaryLink: '/collections/new-arrivals',
      ctaSecondaryText: null,
      ctaSecondaryLink: null,
    });

    const doc = normalizeLegacyDocument(legacy);
    const payload = heroPayloadOf(doc);
    expect(payload.behavior).toMatchObject({ autoplay: true });
    const slides = heroSlidesOf(doc);
    expect(slides).toHaveLength(1);
    const media = slides[0].media as Record<string, unknown>;
    expect(media.type).toBe('VIDEO');
    const video = media.video as Record<string, unknown>;
    expect(video.url).toBe('https://cdn.example/hero.mp4');
    expect(video.poster).toBe('/uploads/catalog/2026/p.jpg');
    const elements = slides[0].elements as Record<
      string,
      Record<string, unknown>
    >;
    expect(elements.ctaPrimary.text).toBe('Shop now');
    // Entity paths cannot be mapped to ids at read time; the link degrades to
    // null (publish validation warns the operator to re-pick it).
    expect(elements.ctaPrimary.link).toBeNull();
    // Already-normalized documents pass through idempotently.
    expect(normalizeLegacyDocument(doc)).toEqual(doc);
  });

  it('keeps image-only legacy heroes as IMAGE slides with the mobile image as override', () => {
    const doc = normalizeLegacyDocument(
      legacyDocument({
        desktopImage: '/uploads/catalog/2026/a.jpg',
        mobileImage: '/uploads/catalog/2026/b.jpg',
      }),
    );

    const media = heroSlidesOf(doc)[0].media as Record<string, unknown>;
    expect(media.type).toBe('IMAGE');
    expect(media.image).toEqual({
      url: '/uploads/catalog/2026/a.jpg',
      alt: '',
    });
    expect(media.video).toBeNull();
    expect(media.mobileOverride).toEqual({
      enabled: true,
      image: { url: '/uploads/catalog/2026/b.jpg', alt: '' },
      video: null,
    });
  });

  it('maps the legacy section title and subtitle into heading and subheading text', () => {
    const doc = normalizeLegacyDocument(
      legacyDocument(
        { desktopImage: '/uploads/catalog/2026/a.jpg' },
        {
          title: 'Small Space. Big Luwag.',
          subtitle: 'Furniture for condos and rentals.',
        },
      ),
    );

    const section = doc.sections[0];
    const elements = heroSlidesOf(doc)[0].elements as Record<
      string,
      Record<string, unknown>
    >;
    expect(elements.heading.text).toBe('Small Space. Big Luwag.');
    expect(elements.subheading.text).toBe('Furniture for condos and rentals.');
    // The section-level fields stay in place for the response contract.
    expect(section.title).toBe('Small Space. Big Luwag.');
    expect(section.subtitle).toBe('Furniture for condos and rentals.');
  });

  it('drops unmappable legacy links but keeps the button text', () => {
    const doc = normalizeLegacyDocument(
      legacyDocument({
        desktopImage: '/uploads/catalog/2026/a.jpg',
        ctaPrimaryText: 'Shop picks',
        ctaPrimaryLink: '#solutions',
        ctaSecondaryText: 'View sale',
        ctaSecondaryLink: 'https://example.com/sale',
      }),
    );

    const elements = heroSlidesOf(doc)[0].elements as Record<
      string,
      Record<string, unknown>
    >;
    expect(elements.ctaPrimary.text).toBe('Shop picks');
    expect(elements.ctaPrimary.link).toBeNull();
    expect(elements.ctaSecondary.text).toBe('View sale');
    expect(elements.ctaSecondary.link).toEqual({
      type: 'EXTERNAL',
      url: 'https://example.com/sale',
    });
  });

  it('normalizes a legacy hero without any media to a null-media slide', () => {
    const doc = normalizeLegacyDocument(legacyDocument({}));

    const slides = heroSlidesOf(doc);
    expect(slides).toHaveLength(1);
    expect(slides[0].media).toBeNull();
    // HERO_MEDIA_MISSING (Task 4) blocks publishing until media is added.
    expect(doc.sections[0].enabled).toBe(true);
  });

  it('keeps a video slide valid when the legacy payload has no poster', () => {
    const doc = normalizeLegacyDocument(
      legacyDocument({
        videoUrl: 'https://cdn.example/hero.mp4',
        ctaPrimaryText: 'Watch',
      }),
    );

    const video = (heroSlidesOf(doc)[0].media as Record<string, unknown>)
      .video as Record<string, unknown>;
    expect(video.url).toBe('https://cdn.example/hero.mp4');
    expect(video.poster).toBeNull();
  });

  it('passes non-hero sections and the announcement through unchanged', () => {
    const legacy = legacyDocument({
      desktopImage: '/uploads/catalog/2026/a.jpg',
    });
    const usp = {
      id: uuid(2),
      type: 'USP',
      title: null,
      subtitle: null,
      enabled: true,
      sortOrder: 10,
      schedule: { publishAt: null, unpublishAt: null },
      products: [],
      payload: { items: [{ label: 'Free delivery', sub: 'Metro Manila' }] },
    };
    (legacy.sections as unknown[]).push(usp);

    const doc = normalizeLegacyDocument(legacy);
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[1]).toEqual(usp);
    expect(doc.announcement).toEqual(emptyDocument().announcement);
  });

  it('uses half-open schedule boundaries', () => {
    const now = new Date('2026-09-27T12:00:00.000Z');

    expect(isScheduleActive({ publishAt: null, unpublishAt: null }, now)).toBe(
      true,
    );
    expect(
      isScheduleActive(
        { publishAt: now.toISOString(), unpublishAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      isScheduleActive(
        {
          publishAt: null,
          unpublishAt: now.toISOString(),
        },
        now,
      ),
    ).toBe(false);
    expect(
      isScheduleActive(
        {
          publishAt: new Date(now.getTime() + 1).toISOString(),
          unpublishAt: null,
        },
        now,
      ),
    ).toBe(false);
    expect(
      isScheduleActive(
        {
          publishAt: null,
          unpublishAt: new Date(now.getTime() + 1).toISOString(),
        },
        now,
      ),
    ).toBe(true);
  });
});
