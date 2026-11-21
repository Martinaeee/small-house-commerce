import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IMAGE_WARM_PATH,
  buildOptimizerWarmUrls,
  collectProductMediaUrls,
  warmProductImages,
} from './image-warming.js';

const SECRET = 's3cret';
const ORIGIN = 'http://frontend:3000';

/**
 * The warm bridge must ask the Next.js optimizer for exactly the renditions
 * the storefront requests, so a phone that opens the PDP right after a
 * product is published finds every variant already cached.
 */
describe('buildOptimizerWarmUrls', () => {
  it('requests every width the storefront renders, at the storefront quality', () => {
    const urls = buildOptimizerWarmUrls(["/uploads/catalog/2026/a.png"]);

    expect(urls).toHaveLength(5);
    expect(urls).toContain(
      `${ORIGIN}${IMAGE_WARM_PATH}?url=%2Fuploads%2Fcatalog%2F2026%2Fa.png&w=96&q=75`,
    );
    expect(urls).toContain(
      `${ORIGIN}${IMAGE_WARM_PATH}?url=%2Fuploads%2Fcatalog%2F2026%2Fa.png&w=1280&q=75`,
    );
    expect(urls).toContain(
      `${ORIGIN}${IMAGE_WARM_PATH}?url=%2Fuploads%2Fcatalog%2F2026%2Fa.png&w=1440&q=75`,
    );
    // Every rendition must be distinct: the same width twice would only
    // warm one cache entry while the storefront asks for another.
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('skips URLs the optimizer cannot serve and non-upload paths', () => {
    const urls = buildOptimizerWarmUrls([
      "/uploads/catalog/2026/a.png",
      "/about/photo.jpg",
      "https://cdn.example.com/x.png",
      "",
    ]);

    expect(urls.every((url) => url.includes("%2Fuploads%2Fcatalog%2F2026%2Fa.png"))).toBe(true);
    expect(urls).toHaveLength(5);
  });

  it('deduplicates repeated source URLs', () => {
    const urls = buildOptimizerWarmUrls([
      "/uploads/catalog/2026/a.png",
      "/uploads/catalog/2026/a.png",
    ]);

    expect(urls).toHaveLength(5);
  });
});

describe('collectProductMediaUrls', () => {
  it('collects gallery and detail images, including variant-scoped ones', () => {
    const urls = collectProductMediaUrls({
      images: [
        { url: '/uploads/catalog/2026/gallery.png', type: 'IMAGE' },
        { url: '/uploads/catalog/2026/scoped.png', type: 'IMAGE' },
      ],
      detailBlocks: [
        { url: '/uploads/catalog/2026/detail.png', type: 'IMAGE' },
        { url: '/uploads/catalog/2026/scoped-detail.png', type: 'IMAGE' },
      ],
    });

    expect(urls).toEqual([
      '/uploads/catalog/2026/gallery.png',
      '/uploads/catalog/2026/scoped.png',
      '/uploads/catalog/2026/detail.png',
      '/uploads/catalog/2026/scoped-detail.png',
    ]);
  });

  it('skips video rows: the optimizer cannot render them', () => {
    const urls = collectProductMediaUrls({
      images: [{ url: '/uploads/catalog/2026/clip.mp4', type: 'VIDEO' }],
      detailBlocks: [
        { url: '/uploads/catalog/2026/detail.png', type: 'IMAGE' },
        { url: '/uploads/catalog/2026/detail.mp4', type: 'VIDEO' },
      ],
    });

    expect(urls).toEqual(['/uploads/catalog/2026/detail.png']);
  });

  it('deduplicates a file reused in both the gallery and the detail deck', () => {
    const urls = collectProductMediaUrls({
      images: [{ url: '/uploads/catalog/2026/same.png', type: 'IMAGE' }],
      detailBlocks: [{ url: '/uploads/catalog/2026/same.png', type: 'IMAGE' }],
    });

    expect(urls).toEqual(['/uploads/catalog/2026/same.png']);
  });

  it('tolerates a row without media', () => {
    expect(collectProductMediaUrls({})).toEqual([]);
  });
});

describe('warmProductImages', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('is a no-op when the bridge env is unset', async () => {
    vi.stubEnv("REVALIDATE_URL", "");
    vi.stubEnv("REVALIDATE_SECRET", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await warmProductImages(["/uploads/catalog/2026/a.png"]);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches every rendition with the secret header and the browser's accept", async () => {
    vi.stubEnv("REVALIDATE_URL", "http://frontend:3000/");
    vi.stubEnv("REVALIDATE_SECRET", SECRET);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, status: 200 } as Response);

    await warmProductImages(["/uploads/catalog/2026/a.png"]);

    expect(fetchSpy).toHaveBeenCalledTimes(5);
    const [firstUrl, firstInit] = fetchSpy.mock.calls[0];
    expect(firstUrl).toContain(IMAGE_WARM_PATH);
    const headers = firstInit?.headers as Record<string, string>;
    expect(headers["x-revalidate-secret"]).toBe(SECRET);
    // The optimizer caches one entry per output format: a warm request that
    // does not advertise WebP fills the cache with an entry no browser reads.
    expect(headers["accept"]).toContain("image/webp");
  });

  it("never throws when a rendition fails", async () => {
    vi.stubEnv("REVALIDATE_URL", ORIGIN);
    vi.stubEnv("REVALIDATE_SECRET", SECRET);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockRejectedValueOnce(new TypeError("network down"));

    await expect(
      warmProductImages(["/uploads/catalog/2026/a.png"]),
    ).resolves.toBeUndefined();
  });
});
