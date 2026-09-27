import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HomepageService } from '../homepage.service.js';

/** Public homepage composition endpoint. Anonymous; data is whitelisted in the service. */
@Controller('storefront')
export class StorefrontHomepageController {
  constructor(private readonly homepage: HomepageService) {}

  @Get('homepage')
  get(
    @Query('previewToken') previewToken: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.markPreviewResponse(previewToken, res);
    return this.homepage.storefrontGet({
      previewToken: this.scalarPreviewToken(previewToken),
    });
  }

  @Get('announcement')
  announcement(
    @Query('previewToken') previewToken: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.markPreviewResponse(previewToken, res);
    return this.homepage.storefrontGetAnnouncement({
      previewToken: this.scalarPreviewToken(previewToken),
    });
  }

  private scalarPreviewToken(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private markPreviewResponse(value: unknown, res: Response): void {
    const hasNonEmptyToken =
      (typeof value === 'string' && value.length > 0) ||
      (Array.isArray(value) &&
        value.some((item) => typeof item === 'string' && item.length > 0));
    if (hasNonEmptyToken) {
      res.setHeader('Cache-Control', 'private, no-store');
    }
  }
}
