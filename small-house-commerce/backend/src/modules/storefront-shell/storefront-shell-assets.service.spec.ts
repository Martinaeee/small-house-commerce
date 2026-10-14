import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCurrentLuwagShellDocument } from './storefront-shell-document.js';
import { StorefrontShellAssetsService } from './storefront-shell-assets.service.js';

const USER_ID = '00000000-0000-7000-8000-000000000801';
const CREATED_AT = new Date('2026-10-13T03:00:00Z');

type AssetRow = {
  id: string;
  kind: 'HORIZONTAL' | 'SQUARE';
  storage: 'LOCAL' | 'R2';
  storageKey: string;
  publicUrl: string;
  mimeType: string;
  width: number;
  height: number;
  durable: boolean;
  createdByUserId: string | null;
  createdAt: Date;
};

function createHarness(storage: {
  storage?: 'LOCAL' | 'R2';
  durable?: boolean;
} = {}) {
  const rows: AssetRow[] = [];
  const stored: Array<{ buffer: Buffer; contentType: string; namespace: string }> = [];
  const saveProcessed = vi.fn(async (
    buffer: Buffer,
    contentType: 'image/png' | 'image/webp',
    namespace: 'brand',
  ) => {
    stored.push({ buffer, contentType, namespace });
    const ext = contentType === 'image/png' ? 'png' : 'webp';
    const key = `brand/2026/00000000-0000-7000-8000-${String(rows.length + 1).padStart(12, '0')}.${ext}`;
    return {
      url: `/uploads/${key}`,
      key,
      storage: storage.storage ?? 'LOCAL',
      durable: storage.durable ?? true,
    } as const;
  });
  const prisma = {
    storefrontShellAsset: {
      create: vi.fn(async ({ data }: { data: Omit<AssetRow, 'id' | 'createdAt'> }) => {
        const row: AssetRow = {
          id: `10000000-0000-7000-8000-${String(rows.length + 1).padStart(12, '0')}`,
          ...data,
          createdAt: CREATED_AT,
        };
        rows.push(row);
        return row;
      }),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        rows.filter((row) => where.id.in.includes(row.id)),
      ),
    },
  };
  const uploads = { saveProcessed };
  const service = new StorefrontShellAssetsService(prisma as never, uploads as never);
  return { service, prisma, uploads, rows, stored };
}

async function raster(
  width: number,
  height: number,
  format: 'png' | 'jpeg' | 'webp' | 'gif' | 'tiff' | 'avif' = 'png',
): Promise<Buffer> {
  const image = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#ff000080',
    },
  });
  return image[format]().toBuffer();
}

async function animatedWebp(): Promise<Buffer> {
  const first = await raster(64, 64, 'png');
  const second = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: '#0000ffff',
    },
  }).png().toBuffer();
  return sharp([first, second], { join: { animated: true } })
    .webp({ loop: 0, delay: [50, 50] })
    .toBuffer();
}

async function expectBadRequestCode(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  const error = await operation.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BadRequestException);
  expect((error as BadRequestException).getResponse()).toMatchObject({ code });
}

describe('StorefrontShellAssetsService input authority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects spoofed text even when the request claims image/png', async () => {
    const { service, uploads } = createHarness();

    await expectBadRequestCode(
      service.processAndStore(
        'HORIZONTAL',
        Buffer.from('not an image'),
        'image/png',
        USER_ID,
      ),
      'SHELL_ASSET_UNSUPPORTED_RASTER',
    );
    expect(uploads.saveProcessed).not.toHaveBeenCalled();
  });

  it('accepts JPEG bytes claimed as PNG and trusts only the decoded image', async () => {
    const { service, prisma, uploads } = createHarness();
    const jpeg = await raster(600, 120, 'jpeg');

    const asset = await service.processAndStore(
      'HORIZONTAL',
      jpeg,
      'image/png',
      USER_ID,
    );

    expect(asset.mimeType).toBe('image/webp');
    expect(uploads.saveProcessed).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/webp',
      'brand',
    );
    expect(prisma.storefrontShellAsset.create).toHaveBeenCalledTimes(1);
  });

  it('rejects decoded GIF, TIFF and AVIF inputs', async () => {
    const { service } = createHarness();
    for (const format of ['gif', 'tiff', 'avif'] as const) {
      await expectBadRequestCode(
        service.processAndStore(
          'HORIZONTAL',
          await raster(128, 64, format),
          'image/png',
          USER_ID,
        ),
        'SHELL_ASSET_UNSUPPORTED_RASTER',
      );
    }
  });

  it('rejects animated WebP and every multi-page raster', async () => {
    const { service } = createHarness();
    const bytes = await animatedWebp();
    const metadata = await sharp(bytes, { animated: true }).metadata();
    expect(metadata.pages).toBe(2);

    await expectBadRequestCode(
      service.processAndStore('HORIZONTAL', bytes, 'image/webp', USER_ID),
      'SHELL_ASSET_UNSUPPORTED_RASTER',
    );
  });

  it('rejects zero and over-5MB request bodies before storage', async () => {
    const { service, uploads } = createHarness();

    await expectBadRequestCode(
      service.processAndStore('HORIZONTAL', Buffer.alloc(0), 'image/png', USER_ID),
      'SHELL_ASSET_INVALID_SIZE',
    );
    await expectBadRequestCode(
      service.processAndStore(
        'HORIZONTAL',
        Buffer.alloc(5 * 1024 * 1024 + 1),
        'image/png',
        USER_ID,
      ),
      'SHELL_ASSET_INVALID_SIZE',
    );
    expect(uploads.saveProcessed).not.toHaveBeenCalled();
  });

  it('rejects decoded axes outside the bounded source dimensions', async () => {
    const { service } = createHarness();

    await expectBadRequestCode(
      service.processAndStore(
        'HORIZONTAL',
        await raster(4097, 32),
        'image/png',
        USER_ID,
      ),
      'SHELL_ASSET_INVALID_DIMENSIONS',
    );
    await expectBadRequestCode(
      service.processAndStore(
        'HORIZONTAL',
        await raster(31, 100),
        'image/png',
        USER_ID,
      ),
      'SHELL_ASSET_INVALID_DIMENSIONS',
    );
  });
});

describe('StorefrontShellAssetsService derivatives', () => {
  it('writes an uncropped metadata-stripped WebP inside 1200×400 without enlargement', async () => {
    const { service, stored } = createHarness();
    const source = await sharp({
      create: {
        width: 600,
        height: 120,
        channels: 4,
        background: '#ff000080',
      },
    })
      .withExif({ IFD0: { Artist: 'Untrusted operator metadata' } })
      .png()
      .toBuffer();

    const asset = await service.processAndStore(
      'HORIZONTAL',
      source,
      'image/png',
      USER_ID,
    );
    const output = await sharp(stored[0]!.buffer).metadata();

    expect(asset).toMatchObject({
      kind: 'HORIZONTAL',
      mimeType: 'image/webp',
      width: 600,
      height: 120,
    });
    expect(output).toMatchObject({ format: 'webp', width: 600, height: 120 });
    expect(output.exif).toBeUndefined();
    expect(output.icc).toBeUndefined();
  });

  it('scales oversized horizontal input inside 1200×400 without cropping', async () => {
    const { service, stored } = createHarness();

    await service.processAndStore(
      'HORIZONTAL',
      await raster(2400, 480),
      'image/png',
      USER_ID,
    );
    const output = await sharp(stored[0]!.buffer).metadata();

    expect(output).toMatchObject({ format: 'webp', width: 1200, height: 240 });
  });

  it('rejects square ratios outside 0.9–1.1 and axes below 64', async () => {
    const { service } = createHarness();

    for (const [width, height] of [[300, 200], [200, 300]]) {
      await expectBadRequestCode(
        service.processAndStore(
          'SQUARE',
          await raster(width, height),
          'image/png',
          USER_ID,
        ),
        'SHELL_ASSET_INVALID_ASPECT_RATIO',
      );
    }
    await expectBadRequestCode(
      service.processAndStore(
        'SQUARE',
        await raster(63, 63),
        'image/png',
        USER_ID,
      ),
      'SHELL_ASSET_INVALID_DIMENSIONS',
    );
  });

  it('writes a transparent-padded, metadata-stripped 512×512 PNG square', async () => {
    const { service, stored } = createHarness();
    const source = await raster(300, 280, 'webp');

    const asset = await service.processAndStore(
      'SQUARE',
      source,
      'image/webp',
      USER_ID,
    );
    const output = await sharp(stored[0]!.buffer).metadata();

    expect(asset).toMatchObject({
      kind: 'SQUARE',
      mimeType: 'image/png',
      width: 512,
      height: 512,
    });
    expect(output).toMatchObject({
      format: 'png',
      width: 512,
      height: 512,
      hasAlpha: true,
    });
    expect(output.exif).toBeUndefined();
    expect(output.icc).toBeUndefined();
  });

  it('records only detected derivative metadata and server-owned storage facts', async () => {
    const { service, prisma } = createHarness({ storage: 'R2', durable: true });

    const asset = await service.processAndStore(
      'HORIZONTAL',
      await raster(600, 120, 'jpeg'),
      'image/png',
      USER_ID,
    );

    const write = prisma.storefrontShellAsset.create.mock.calls[0]![0].data;
    expect(write).toMatchObject({
      kind: 'HORIZONTAL',
      storage: 'R2',
      storageKey: expect.stringMatching(/^brand\/2026\/.+\.webp$/),
      publicUrl: expect.stringMatching(/^\/uploads\/brand\/2026\/.+\.webp$/),
      mimeType: 'image/webp',
      width: 600,
      height: 120,
      durable: true,
      createdByUserId: USER_ID,
    });
    expect(asset).toMatchObject({
      id: expect.any(String),
      url: write.publicUrl,
      createdAt: CREATED_AT.toISOString(),
    });
    expect(write).not.toHaveProperty('claimedMime');
    expect(write).not.toHaveProperty('sourceWidth');
  });
});

describe('StorefrontShellAssetsService append-only references', () => {
  it('loads only current references without deleting replaced or removed rows', async () => {
    const harness = createHarness();
    const first = await harness.service.processAndStore(
      'HORIZONTAL',
      await raster(600, 120),
      'image/png',
      USER_ID,
    );
    const second = await harness.service.processAndStore(
      'HORIZONTAL',
      await raster(800, 160),
      'image/png',
      USER_ID,
    );
    const base = createCurrentLuwagShellDocument({
      rootCategories: [],
      navigationCollections: [],
      supportEmail: 'support@luwag.ph',
      supportHours: 'Mon–Sat, 9am–6pm (PHT)',
    });

    const replaced = await harness.service.assetsForDocument({
      ...base,
      brand: { ...base.brand, horizontalLogo: { assetId: second.id } },
    });
    const removed = await harness.service.assetsForDocument(base);

    expect(replaced.byId).toEqual({
      [second.id]: expect.objectContaining({ id: second.id }),
    });
    expect(removed.byId).toEqual({});
    expect(harness.rows.map((row) => row.id)).toEqual([first.id, second.id]);
    expect(harness.prisma.storefrontShellAsset.create).toHaveBeenCalledTimes(2);
  });
});
