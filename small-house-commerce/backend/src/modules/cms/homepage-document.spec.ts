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

describe('explicit homepage appearance', () => {
  it('retains an explicitly selected V3 appearance', () => {
    expect(homepageDocumentSchema.parse({ ...emptyDocument(), appearance: 'STUDIO_V3' }))
      .toHaveProperty('appearance', 'STUDIO_V3');
  });
  it.each(['LEGACY', 'V4', '', { preset: 'STUDIO_V3' }, null])('rejects unsupported appearance %j', (appearance) => {
    expect(homepageDocumentSchema.safeParse({ ...emptyDocument(), appearance }).success).toBe(false);
  });
  it('does not insert an appearance into existing documents', () => {
    expect(homepageDocumentSchema.parse(emptyDocument())).not.toHaveProperty('appearance');
  });
});

describe('new homepage content draft contracts', () => {
  const entry = { id: uuid(701), link: null };
  const photo = { id: uuid(702), imageUrl: '/uploads/e2e/home.jpg', name: '', comment: '' };
  function contentDocument(type: 'CATEGORY_TILES' | 'UGC', payload: Record<string, unknown>) {
    const doc = emptyDocument();
    doc.sections.push({ ...doc.sections[0], id: uuid(700), type, enabled: false, payload });
    return doc;
  }

  it.each([
    { entries: [{ ...entry, id: 'bad-id' }] },
    { entries: [{ ...entry, link: { type: 'PRODUCT', id: uuid(703) } }] },
    { entries: [{ ...entry, link: { type: 'CATEGORY', id: 'bad-id' } }] },
    { entries: [{ ...entry, imageUrl: 'blob:local' }] },
    { entries: [{ ...entry, imageUrl: 'javascript:alert(1)' }] },
    { entries: [{ ...entry, label: 'x'.repeat(121) }] },
    { entries: [entry, entry] },
    { entries: Array.from({ length: 7 }, (_, i) => ({ ...entry, id: uuid(710 + i) })) },
    { entries: 'unfinished' },
    { presentation: 'OVAL' },
  ])('rejects malformed navigation shape even in a disabled draft: %j', (payload) => {
    expect(homepageDocumentSchema.safeParse(contentDocument('CATEGORY_TILES', payload)).success).toBe(false);
  });

  it.each([
    { entries: [], categoryIds: [uuid(730)] },
    { entries: [entry], presentation: 'CIRCLES' },
    { entries: [{ ...entry, imageUrl: '/uploads/e2e/nav.jpg', label: 'x'.repeat(120), link: { type: 'COLLECTION', id: uuid(731) } }], presentation: 'TILES' },
  ])('retains structurally valid unfinished navigation JSON: %j', (payload) => {
    expect(homepageDocumentSchema.parse(contentDocument('CATEGORY_TILES', payload)).sections[1].payload).toEqual(payload);
  });

  it.each([
    { entries: [photo], presentation: { layout: 'MASONRY' } },
    { entries: [photo], presentation: { layout: 'COLLAGE', showQuote: 'yes' } },
    { entries: [photo], presentation: { layout: 'COLLAGE', overlay: 'NONE' } },
    { entries: [photo], presentation: { layout: 'COLLAGE', featuredEntryId: uuid(799) } },
    { entries: [{ ...photo, id: undefined }], presentation: { layout: 'COLLAGE' } },
    { entries: [{ ...photo, id: 'bad-id' }] },
    { entries: [photo, photo], presentation: { layout: 'CARDS' } },
    { entries: [{ ...photo, imageUrl: 'data:image/png;base64,abcd' }] },
    { entries: [{ ...photo, productId: 'bad-id' }] },
    { entries: [{ ...photo, name: 'x'.repeat(121) }] },
    { entries: [{ ...photo, location: 'x'.repeat(121) }] },
    { entries: [{ ...photo, comment: 'x'.repeat(1001) }] },
    { entries: Array.from({ length: 13 }, (_, i) => ({ ...photo, id: uuid(750 + i) })) },
    { entries: [{ ...photo, focalX: 101 }] },
    { entries: [{ ...photo, focalY: -1 }] },
    { entries: [{ ...photo, focalX: '40' }] },
    { entries: [photo], presentation: { layout: 'COLLAGE', collageVariant: 'DIAGONAL' } },
  ])('rejects malformed new UGC shape without requiring publish completeness: %j', (payload) => {
    expect(homepageDocumentSchema.safeParse(contentDocument('UGC', payload)).success).toBe(false);
  });

  it('keeps a valid empty/unfinished collage and the full 1000-character quote', () => {
    for (const payload of [
      { entries: [], presentation: { layout: 'COLLAGE', showQuote: false } },
      { entries: [photo], presentation: { layout: 'COLLAGE', featuredEntryId: photo.id } },
      { entries: [{ ...photo, comment: 'x'.repeat(1000) }], presentation: { layout: 'CARDS' } },
    ]) expect(homepageDocumentSchema.parse(contentDocument('UGC', payload)).sections[1].payload).toEqual(payload);
  });

  it('keeps the photo focal point, the collage layout and twelve photos', () => {
    const payload = {
      entries: Array.from({ length: 12 }, (_, i) => ({ ...photo, id: uuid(760 + i), focalX: 25, focalY: 75 })),
      presentation: { layout: 'COLLAGE', collageVariant: 'STRIP', featuredEntryId: uuid(760) },
    };
    expect(homepageDocumentSchema.parse(contentDocument('UGC', payload)).sections[1].payload).toEqual(payload);
  });

  it('does not tighten opaque legacy non-Hero drafts', () => {
    for (const type of ['CATEGORY_TILES', 'UGC'] as const) {
      const payload = type === 'UGC' ? { entries: 'unfinished' } : { categoryIds: 'unfinished' };
      expect(homepageDocumentSchema.parse(contentDocument(type, payload)).sections[1].payload).toEqual(payload);
    }
  });
});

describe('responsive display contracts', () => {
  it('round trips automatic Hero flow and its independent device override without changing coordinates', () => {
    const doc = emptyDocument();
    const before = structuredClone(heroSlidesOf(doc));
    heroPayloadOf(doc).display = { contentLayout: 'AUTO', overrides: { mobile: { contentLayout: 'FREE' } } };
    const parsed = homepageDocumentSchema.parse(doc);
    expect(parsed.sections[0].payload.display).toEqual(heroPayloadOf(doc).display);
    expect(heroSlidesOf(parsed)).toEqual(before);
    heroPayloadOf(doc).display = { contentLayout: 'url(unsafe)' };
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
  });
  it('creates a new full-width screen Hero without relying on implicit read defaults', () => {
    const doc = emptyDocument();
    expect(doc.sections[0].style).toEqual({ contentWidth: 'FULL' });
    expect(doc.sections[0].payload.display).toEqual({ heightMode: 'SCREEN' });
    expect(heroSlidesOf(doc)[0].overlay).toMatchObject({
      overrides: { mobile: { gradient: 'LOCAL', opacity: 0.65 } },
    });
  });
  it('preserves sparse responsive defaults without inventing other device fields', () => {
    const input = {
      ...emptyDocument(),
      defaults: { paddingTop: 40, overrides: { mobile: { paddingTop: 12 } } },
    };
    const result = homepageDocumentSchema.parse(input);
    expect(result.defaults).toEqual(input.defaults);
    expect(result.defaults).not.toHaveProperty('overrides.tablet');
  });

  it.each([-1, 241, NaN, Infinity, '12', null])('rejects invalid mobile padding %s', (paddingTop) => {
    expect(homepageDocumentSchema.safeParse({
      ...emptyDocument(), defaults: { overrides: { mobile: { paddingTop } } },
    }).success).toBe(false);
  });

  it.each([
    { phone: { paddingTop: 12 } },
    { mobile: { overrides: { mobile: { paddingTop: 12 } } } },
    { mobile: { paddingTop: 12, css: 'url(unsafe)' } },
  ])('rejects malformed section device styles %j', (overrides) => {
    const doc = emptyDocument();
    doc.sections[0].style = { overrides };
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('accepts device-specific Hero height, fit and local overlay', () => {
    const doc = emptyDocument();
    heroPayloadOf(doc).display = { overrides: { mobile: { heightMode: 'NATURAL' } } };
    const slide = heroSlidesOf(doc)[0];
    slide.media = { ...imageMedia(), fitOverrides: { mobile: 'CONTAIN' } };
    slide.overlay = { color: '#000000', opacity: 0, gradient: 'LOCAL', overrides: {
      mobile: { gradient: 'LOCAL', opacity: 0.65 },
    } };
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it.each([
    { heightMode: 'STRETCH' },
    { overrides: { phone: { heightMode: 'SCREEN' } } },
    { overrides: { mobile: { heightMode: null } } },
    { overrides: { mobile: { arbitraryCss: 'height:999px' } } },
  ])('rejects invalid Hero display %j', (display) => {
    const doc = emptyDocument();
    heroPayloadOf(doc).display = display;
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it.each(['FILL', null, 1])('rejects invalid device fit %s', (mobile) => {
    const doc = emptyDocument();
    heroSlidesOf(doc)[0].media = { ...imageMedia(), fitOverrides: { mobile } };
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it.each([-0.1, 1.1, NaN, '0.5'])('rejects invalid device overlay opacity %s', (opacity) => {
    const doc = emptyDocument();
    heroSlidesOf(doc)[0].overlay = {
      color: '#000000', opacity: 0.3, gradient: 'BOTTOM', overrides: { mobile: { opacity } },
    };
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it.each([
    ['CATEGORY_TILES', { overrides: { mobile: { columns: 7 } } }],
    ['CATEGORY_TILES', { imageRatio: 'ARBITRARY' }],
    ['PRODUCT_GRID', { columns: 2.5 }],
    ['PRODUCT_GRID', { imageRatio: 'SQUARE' }],
    ['PRODUCT_STORY', { gap: 49 }],
    ['PRODUCT_STORY', { overrides: { mobile: { gap: Infinity } } }],
  ] as const)('rejects invalid %s layout at draft time', (type, layout) => {
    const doc = emptyDocument();
    doc.sections.push({
      ...doc.sections[0], id: uuid(200), type, payload: { layout },
    });
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('does not add display fields when normalizing an old document', () => {
    const doc = legacyDocument({ behavior: heroPayloadOf(emptyDocument()).behavior,
      slides: [slideWith(imageMedia(), { overlay: { color: '#000000', opacity: 0.3, gradient: 'BOTTOM' } })] });
    const normalized = normalizeLegacyDocument(doc);
    expect(normalized.sections[0].payload).not.toHaveProperty('display');
    expect(heroSlidesOf(normalized)[0].media).not.toHaveProperty('fitOverrides');
    expect(heroSlidesOf(normalized)[0].overlay).not.toHaveProperty('overrides');
  });
});

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

  it('accepts a safe internal path and rejects paths that leave the origin', () => {
    const doc = emptyDocument();
    const slide = heroSlidesOf(doc)[0];
    const cta = (slide.elements as Record<string, Record<string, unknown>>)
      .ctaPrimary;

    cta.link = { type: 'INTERNAL', path: '/track-order' };
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(true);

    for (const path of ['//evil.test/x', '/\\evil', '/with space', 'javascript:alert(1)', 'relative']) {
      cta.link = { type: 'INTERNAL', path };
      expect(homepageDocumentSchema.safeParse(doc).success, path).toBe(false);
    }
  });

  it('accepts a subscribe-popup link next to the url link types', () => {
    const doc = emptyDocument();
    const slide = heroSlidesOf(doc)[0];
    const cta = (slide.elements as Record<string, Record<string, unknown>>)
      .ctaPrimary;

    cta.link = { type: 'SUBSCRIBE' };
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('keeps every pre-INTERNAL document valid', () => {
    const doc = emptyDocument();
    const slide = heroSlidesOf(doc)[0];
    const cta = (slide.elements as Record<string, Record<string, unknown>>)
      .ctaPrimary;

    // The legacy shapes the document has always accepted must keep parsing.
    cta.link = null;
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(true);
    cta.link = { type: 'COLLECTION', id: '00000000-0000-7000-8000-000000000901' };
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(true);
    cta.link = { type: 'EXTERNAL', url: 'https://luwag.ph/help' };
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

  it('accepts legacy announcement items and strict rich content with a countdown', () => {
    const doc = emptyDocument();
    doc.announcement.items = [
      {
        id: uuid(30),
        text: 'Free delivery today',
        content: {
          version: 1,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                attrs: { textAlign: 'center' },
                content: [
                  {
                    type: 'text',
                    text: 'Free delivery ',
                    marks: [{ type: 'bold' }],
                  },
                  {
                    type: 'text',
                    text: 'today',
                    marks: [
                      {
                        type: 'textStyle',
                        attrs: {
                          color: '#112233',
                          fontFamily: 'POPPINS',
                          fontSize: 'LG',
                        },
                      },
                      { type: 'highlight', attrs: { color: '#FFEEDD' } },
                    ],
                  },
                ],
              },
            ],
          },
        },
        link: null,
        linkLabel: null,
        textColor: '#292724',
        backgroundColor: '#F2EFE9',
        schedule: { publishAt: null, unpublishAt: null },
        countdown: {
          endsAt: null,
          color: null,
          fontFamily: 'SANS',
          fontSize: 'MD',
          fontWeight: 700,
        },
        enabled: true,
        sortOrder: 0,
      } as never,
    ];

    const parsed = homepageDocumentSchema.parse(doc) as unknown as {
      announcement: { items: Array<Record<string, unknown>> };
    };
    expect(parsed.announcement.items[0]).toMatchObject({
      content: expect.objectContaining({ version: 1 }),
      countdown: expect.objectContaining({ fontFamily: 'SANS', fontSize: 'MD' }),
    });
    const legacy = structuredClone(doc) as Record<string, unknown>;
    const legacyItem = (
      (legacy.announcement as { items: Array<Record<string, unknown>> }).items[0]
    );
    delete legacyItem.content;
    delete legacyItem.countdown;
    expect(homepageDocumentSchema.safeParse(legacy).success).toBe(true);
  });

  it('rejects arbitrary rich nodes, duplicate marks, unsafe style values and more than two paragraphs', () => {
    const doc = emptyDocument();
    const base = {
      id: uuid(30),
      text: 'Hello',
      link: null,
      linkLabel: null,
      textColor: '#292724',
      backgroundColor: '#F2EFE9',
      schedule: { publishAt: null, unpublishAt: null },
      enabled: true,
      sortOrder: 0,
    };
    const paragraph = {
      type: 'paragraph',
      attrs: { textAlign: 'left' },
      content: [{ type: 'text', text: 'Hello' }],
    };
    const invalidContents = [
      { version: 1, doc: { type: 'doc', content: [{ type: 'script' }] } },
      {
        version: 1,
        doc: {
          type: 'doc',
          content: [
            {
              ...paragraph,
              content: [
                {
                  type: 'text',
                  text: 'Hello',
                  marks: [{ type: 'bold' }, { type: 'bold' }],
                },
              ],
            },
          ],
        },
      },
      {
        version: 1,
        doc: {
          type: 'doc',
          content: [
            {
              ...paragraph,
              content: [
                {
                  type: 'text',
                  text: 'Hello',
                  marks: [
                    {
                      type: 'textStyle',
                      attrs: { color: 'red;position:fixed' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      {
        version: 1,
        doc: { type: 'doc', content: [paragraph, paragraph, paragraph] },
      },
    ];

    for (const content of invalidContents) {
      doc.announcement.items = [{ ...base, content } as never];
      expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
    }
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

  it('accepts explicit direct-resize button boxes and keeps them in the parse', () => {
    const doc = emptyDocument();
    const slide = heroSlidesOf(doc)[0];
    const elements = slide.elements as Record<string, Record<string, unknown>>;
    const button = elements.ctaSecondary.button as Record<string, unknown>;
    button.widthPx = 200;
    button.heightPx = 56;
    (elements.ctaSecondary.overrides as Record<string, unknown>).mobile = {
      button: {
        widthPx: 150,
        heightPx: 46,
        paddingX: 18,
        paddingY: 9,
      },
      style: { fontSize: 12 },
    };

    const parsed = homepageDocumentSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
    const parsedSlide = (parsed.data!.sections[0].payload as Record<string, unknown>)
      .slides as Array<Record<string, unknown>>;
    const parsedElement = (parsedSlide[0].elements as Record<string, unknown>)
      .ctaSecondary as Record<string, unknown>;
    expect(parsedElement.button).toMatchObject({
      widthPx: 200,
      heightPx: 56,
    });
    expect(parsedElement.overrides).toMatchObject({
      mobile: {
        button: { widthPx: 150, heightPx: 46, paddingX: 18, paddingY: 9 },
        style: { fontSize: 12 },
      },
    });
  });

  it('rejects out-of-range direct-resize button boxes', () => {
    const mutations: Array<(button: Record<string, unknown>) => void> = [
      (button) => { button.widthPx = 10; },
      (button) => { button.widthPx = 5000; },
      (button) => { button.heightPx = 10; },
      (button) => { button.heightPx = 900; },
    ];
    for (const mutate of mutations) {
      const doc = emptyDocument();
      const slide = heroSlidesOf(doc)[0];
      const elements = slide.elements as Record<string, Record<string, unknown>>;
      mutate(elements.ctaPrimary.button as Record<string, unknown>);
      expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
    }

    const doc = emptyDocument();
    const slide = heroSlidesOf(doc)[0];
    const elements = slide.elements as Record<string, Record<string, unknown>>;
    const overrides = elements.ctaPrimary.overrides as Record<string, unknown>;
    overrides.tablet = { button: { paddingX: -4 } };
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('strictly validates V2 banner payloads while keeping schema version 1', () => {
    for (const ctaLink of [
      '/collections/sale',
      '#featured',
      'https://example.com/sale',
    ]) {
      const doc = emptyDocument();
      doc.sections.push({
        id: uuid(2),
        type: 'PROMO_BANNER',
        title: 'Sale',
        subtitle: null,
        enabled: true,
        sortOrder: 10,
        schedule: { publishAt: null, unpublishAt: null },
        payload: { ctaText: 'Shop now', ctaLink },
        products: [],
      } as unknown as HomepageSection);
      doc.sections.push({
        id: uuid(3),
        type: 'COUNTDOWN_BANNER',
        title: 'Ends soon',
        subtitle: null,
        enabled: true,
        sortOrder: 20,
        schedule: { publishAt: null, unpublishAt: null },
        payload: { endsAt: null },
        products: [],
      } as unknown as HomepageSection);

      const parsed = homepageDocumentSchema.parse(doc);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.sections[1].payload).toEqual({
        ctaText: 'Shop now',
        ctaLink,
      });
      expect(parsed.sections[2].payload).toEqual({ endsAt: null });
    }
  });

  it('rejects unsafe banner links, unsupported payload fields, and product joins', () => {
    const invalidLinks = [
      'http://example.com/sale',
      '//example.com/sale',
      'javascript:alert(1)',
      'data:text/html,bad',
      'https://',
      '/sale\nnext',
    ];
    for (const ctaLink of invalidLinks) {
      const doc = emptyDocument();
      doc.sections.push({
        id: uuid(2),
        type: 'PROMO_BANNER',
        title: null,
        subtitle: null,
        enabled: true,
        sortOrder: 10,
        schedule: { publishAt: null, unpublishAt: null },
        payload: { ctaLink },
        products: [],
      } as unknown as HomepageSection);
      expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
    }

    const unsupported = emptyDocument();
    unsupported.sections.push({
      id: uuid(2),
      type: 'PROMO_BANNER',
      title: null,
      subtitle: null,
      enabled: true,
      sortOrder: 10,
      schedule: { publishAt: null, unpublishAt: null },
      payload: { imageUrl: '/uploads/catalog/banner.jpg' },
      products: [],
    } as unknown as HomepageSection);
    expect(homepageDocumentSchema.safeParse(unsupported).success).toBe(false);

    const joined = emptyDocument();
    joined.sections.push({
      id: uuid(2),
      type: 'COUNTDOWN_BANNER',
      title: null,
      subtitle: null,
      enabled: true,
      sortOrder: 10,
      schedule: { publishAt: null, unpublishAt: null },
      payload: { endsAt: '2026-10-10T00:00:00.000Z' },
      products: [{ productId: uuid(100), sortOrder: 0, badge: null }],
    } as unknown as HomepageSection);
    expect(homepageDocumentSchema.safeParse(joined).success).toBe(false);

    const malformedEnd = emptyDocument();
    malformedEnd.sections.push({
      id: uuid(2),
      type: 'COUNTDOWN_BANNER',
      title: null,
      subtitle: null,
      enabled: true,
      sortOrder: 10,
      schedule: { publishAt: null, unpublishAt: null },
      payload: { endsAt: 'tomorrow' },
      products: [],
    } as unknown as HomepageSection);
    expect(homepageDocumentSchema.safeParse(malformedEnd).success).toBe(false);
  });

  it('passes existing non-hero payloads through untouched', () => {
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

  it('accepts homepage default section styles and whitelists their values', () => {
    const doc = emptyDocument();
    expect(doc.defaults).toEqual({});

    doc.defaults = {
      backgroundColor: '#F2EFE9',
      textColor: '#292724',
      contentWidth: 'STANDARD',
      paddingTop: 24,
      paddingBottom: 24,
    };
    expect(homepageDocumentSchema.parse(doc).defaults).toEqual(doc.defaults);

    // Injected CSS never reaches the document.
    expect(
      homepageDocumentSchema.safeParse({
        ...doc,
        defaults: { backgroundColor: 'red; background:url(x)' },
      }).success,
    ).toBe(false);

    // Unknown enum + out-of-range padding are rejected.
    expect(
      homepageDocumentSchema.safeParse({ ...doc, defaults: { contentWidth: 'WIDE' } })
        .success,
    ).toBe(false);
    expect(
      homepageDocumentSchema.safeParse({ ...doc, defaults: { paddingTop: 300 } })
        .success,
    ).toBe(false);
  });

  it('keeps a stored document without defaults schema-valid', () => {
    const legacy: Record<string, unknown> = structuredClone(emptyDocument());
    delete legacy.defaults;
    expect(homepageDocumentSchema.safeParse(legacy).success).toBe(true);
  });
});

describe('hero slide links and link zones', () => {
  const zone = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: uuid(31),
    layout: { xPct: 10, yPct: 20, widthPct: 30, heightPct: 25 },
    link: { type: 'COLLECTION', id: uuid(21) },
    background: { visible: true, color: '#B99B81' },
    ...over,
  });

  it('accepts a slide that links the whole banner and carries link zones', () => {
    const doc = emptyDocument();
    const slide = heroSlidesOf(doc)[0];
    slide.linkMode = 'SLIDE';
    slide.slideLink = { type: 'COLLECTION', id: uuid(21) };
    slide.zones = [zone(), zone({ id: uuid(32), background: { visible: false, color: '#292724' } })];

    const parsed = homepageDocumentSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
    const parsedSlide = (
      (parsed.success ? parsed.data : doc).sections.find(
        (section) => section.type === 'HERO',
      ) as HomepageSection
    ).payload as { slides: Array<Record<string, unknown>> };
    expect(parsedSlide.slides[0].linkMode).toBe('SLIDE');
    expect(parsedSlide.slides[0].zones).toHaveLength(2);
  });

  it('keeps a slide without links or zones schema-valid', () => {
    const doc = emptyDocument();
    const slide = heroSlidesOf(doc)[0];
    delete slide.linkMode;
    delete slide.slideLink;
    delete slide.zones;
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('rejects a zone outside the slide, an empty zone and too many zones', () => {
    const doc = emptyDocument();
    const slide = heroSlidesOf(doc)[0];

    slide.zones = [zone({ layout: { xPct: -1, yPct: 0, widthPct: 10, heightPct: 10 } })];
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);

    slide.zones = [zone({ layout: { xPct: 0, yPct: 0, widthPct: 0, heightPct: 10 } })];
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);

    slide.zones = Array.from({ length: 13 }, (_, index) => zone({ id: uuid(40 + index) }));
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('rejects an unknown link mode and an unsafe zone link', () => {
    const doc = emptyDocument();
    const slide = heroSlidesOf(doc)[0];

    slide.linkMode = 'EVERYTHING';
    expect(homepageDocumentSchema.safeParse(doc).success).toBe(false);

    slide.linkMode = 'SLIDE';
    slide.slideLink = { type: 'EXTERNAL', url: 'http://insecure.example' };
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
