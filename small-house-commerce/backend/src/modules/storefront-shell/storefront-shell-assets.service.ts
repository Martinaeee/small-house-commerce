import { BadRequestException, Injectable } from '@nestjs/common';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  UPLOAD_MAX_BYTES,
  UploadsService,
  type ProcessedImageType,
} from '../uploads/uploads.service.js';
import type { StorefrontShellDocument } from './storefront-shell-document.js';
import type {
  PublicAssetView,
  ShellAssetLookup,
} from './storefront-shell-validation.js';

const MAX_SOURCE_AXIS = 4096;
const MAX_SOURCE_PIXELS = MAX_SOURCE_AXIS * MAX_SOURCE_AXIS;
const ALLOWED_INPUT_FORMATS = new Set(['png', 'webp', 'jpeg']);

export type BrandAssetKind = 'HORIZONTAL' | 'SQUARE';

export type AdminShellAsset = {
  id: string;
  kind: BrandAssetKind;
  url: string;
  mimeType: ProcessedImageType;
  width: number;
  height: number;
  durable: boolean;
  createdAt: string;
};

export type ShellDocumentAssets = {
  byId: Record<string, AdminShellAsset>;
  lookup: ShellAssetLookup;
  horizontalLogo: PublicAssetView | null;
  squareMark: PublicAssetView | null;
};

type AssetRow = {
  id: string;
  kind: BrandAssetKind;
  publicUrl: string;
  mimeType: string;
  width: number;
  height: number;
  durable: boolean;
  createdAt: Date;
};

type ShellAssetRegistryClient = Pick<PrismaService, 'storefrontShellAsset'>;

@Injectable()
export class StorefrontShellAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  async processAndStore(
    kind: BrandAssetKind,
    bytes: Buffer,
    _claimedMime: string,
    userId: string,
  ): Promise<AdminShellAsset> {
    if (bytes.length === 0 || bytes.length > UPLOAD_MAX_BYTES) {
      throw assetError(
        'SHELL_ASSET_INVALID_SIZE',
        'Brand asset must contain between 1 byte and 5 MB',
      );
    }

    let decoded: Sharp;
    let metadata: Metadata;
    try {
      decoded = sharp(bytes, {
        failOn: 'error',
        limitInputPixels: MAX_SOURCE_PIXELS,
      }).rotate();
      metadata = await decoded.metadata();
    } catch {
      throw assetError(
        'SHELL_ASSET_UNSUPPORTED_RASTER',
        'Brand asset must be a decodable single-frame PNG, WebP or JPEG',
      );
    }

    if (
      !metadata.format ||
      !ALLOWED_INPUT_FORMATS.has(metadata.format) ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw assetError(
        'SHELL_ASSET_UNSUPPORTED_RASTER',
        'Brand asset must be a single-frame PNG, WebP or JPEG',
      );
    }

    const width = metadata.autoOrient?.width ?? metadata.width;
    const height = metadata.autoOrient?.height ?? metadata.height;
    if (!width || !height) {
      throw assetError(
        'SHELL_ASSET_INVALID_DIMENSIONS',
        'Brand asset dimensions could not be detected',
      );
    }
    validateSourceDimensions(kind, width, height);

    const contentType: ProcessedImageType =
      kind === 'HORIZONTAL' ? 'image/webp' : 'image/png';
    const derivative =
      kind === 'HORIZONTAL'
        ? await decoded
            .clone()
            .resize({
              width: 1200,
              height: 400,
              fit: 'inside',
              withoutEnlargement: true,
            })
            .webp({ quality: 90 })
            .toBuffer()
        : await decoded
            .clone()
            .resize(512, 512, {
              fit: 'contain',
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .png()
            .toBuffer();

    const output = await sharp(derivative).metadata();
    const expectedFormat = kind === 'HORIZONTAL' ? 'webp' : 'png';
    if (
      output.format !== expectedFormat ||
      !output.width ||
      !output.height
    ) {
      throw assetError(
        'SHELL_ASSET_PROCESSING_FAILED',
        'Processed brand asset metadata is invalid',
      );
    }

    const stored = await this.uploads.saveProcessed(
      derivative,
      contentType,
      'brand',
    );
    const row = await this.prisma.storefrontShellAsset.create({
      data: {
        kind,
        storage: stored.storage,
        storageKey: stored.key,
        publicUrl: stored.url,
        mimeType: contentType,
        width: output.width,
        height: output.height,
        durable: stored.durable,
        createdByUserId: userId,
      },
    });

    const asset = safeAdminAsset(row as AssetRow);
    if (!asset) {
      throw assetError(
        'SHELL_ASSET_PROCESSING_FAILED',
        'Stored brand asset metadata is invalid',
      );
    }
    return asset;
  }

  async assetsForDocument(
    document: StorefrontShellDocument,
    client: ShellAssetRegistryClient = this.prisma,
  ): Promise<ShellDocumentAssets> {
    const ids = [
      document.brand.horizontalLogo?.assetId,
      document.brand.squareMark?.assetId,
    ].filter((id): id is string => id !== undefined);

    const rows = ids.length === 0
      ? []
      : await client.storefrontShellAsset.findMany({
          where: { id: { in: [...new Set(ids)] } },
          select: {
            id: true,
            kind: true,
            publicUrl: true,
            mimeType: true,
            width: true,
            height: true,
            durable: true,
            createdAt: true,
          },
        });
    const rowById = new Map(rows.map((row) => [row.id, row as AssetRow]));
    const byId: Record<string, AdminShellAsset> = {};
    for (const row of rows) {
      const parsed = safeAdminAsset(row as AssetRow);
      if (parsed) byId[parsed.id] = parsed;
    }

    const horizontal = document.brand.horizontalLogo
      ? rowById.get(document.brand.horizontalLogo.assetId) ?? null
      : null;
    const square = document.brand.squareMark
      ? rowById.get(document.brand.squareMark.assetId) ?? null
      : null;

    return {
      byId,
      lookup: {
        horizontalLogo: horizontal
          ? { id: horizontal.id, kind: horizontal.kind, durable: horizontal.durable }
          : null,
        squareMark: square
          ? { id: square.id, kind: square.kind, durable: square.durable }
          : null,
      },
      horizontalLogo: publicAsset(horizontal, 'HORIZONTAL'),
      squareMark: publicAsset(square, 'SQUARE'),
    };
  }
}

function validateSourceDimensions(
  kind: BrandAssetKind,
  width: number,
  height: number,
): void {
  const minimum = kind === 'HORIZONTAL' ? 32 : 64;
  if (
    width < minimum ||
    height < minimum ||
    width > MAX_SOURCE_AXIS ||
    height > MAX_SOURCE_AXIS
  ) {
    throw assetError(
      'SHELL_ASSET_INVALID_DIMENSIONS',
      `${kind === 'HORIZONTAL' ? 'Horizontal' : 'Square'} source axes must be ${minimum}–${MAX_SOURCE_AXIS} pixels`,
    );
  }

  if (kind === 'SQUARE') {
    const ratio = width / height;
    if (ratio < 0.9 || ratio > 1.1) {
      throw assetError(
        'SHELL_ASSET_INVALID_ASPECT_RATIO',
        'Square mark aspect ratio must be between 0.9 and 1.1',
      );
    }
  }
}

function assetError(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}

function safeAdminAsset(row: AssetRow): AdminShellAsset | null {
  if (row.mimeType !== 'image/png' && row.mimeType !== 'image/webp') return null;
  return adminAsset({ ...row, mimeType: row.mimeType });
}

function adminAsset(
  row: AssetRow & { mimeType: ProcessedImageType },
): AdminShellAsset {
  return {
    id: row.id,
    kind: row.kind,
    url: row.publicUrl,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    durable: row.durable,
    createdAt: row.createdAt.toISOString(),
  };
}

function publicAsset(
  row: AssetRow | null,
  expectedKind: BrandAssetKind,
): PublicAssetView | null {
  if (
    !row ||
    row.kind !== expectedKind ||
    !row.durable ||
    (row.mimeType !== 'image/png' && row.mimeType !== 'image/webp')
  ) {
    return null;
  }
  return {
    id: row.id,
    url: row.publicUrl,
    width: row.width,
    height: row.height,
  };
}
