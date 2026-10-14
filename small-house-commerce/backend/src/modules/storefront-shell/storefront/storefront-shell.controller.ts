import {
  Controller,
  Get,
  Headers,
  Res,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import {
  StorefrontShellService,
  type PublishedStorefrontShell,
} from '../storefront-shell.service.js';

@Controller('storefront')
export class StorefrontShellController {
  constructor(private readonly shell: StorefrontShellService) {}

  @Get('shell')
  async get(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublishedStorefrontShell | undefined> {
    const projection = await this.shell.getPublic();
    const hash = createHash('sha256')
      .update(canonicalStringify(projection))
      .digest('hex')
      .slice(0, 16);
    const etag = `W/"shell-${projection.publishedRevision}-${hash}"`;

    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.setHeader('ETag', etag);
    if (ifNoneMatch === etag) {
      res.status(304);
      return undefined;
    }
    return projection;
  }
}

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalStringify(entry)}`)
    .join(',')}}`;
}
