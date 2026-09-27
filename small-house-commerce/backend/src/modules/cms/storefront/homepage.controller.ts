import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HomepageService } from '../homepage.service.js';

/** Public homepage composition endpoint. Anonymous; data is whitelisted in the service. */
@Controller('storefront')
export class StorefrontHomepageController {
  constructor(private readonly homepage: HomepageService) {}

  @Get('homepage')
  get(
    @Query('previewToken') previewToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.markPreviewResponse(previewToken, res);
    return this.homepage.storefrontGet({ previewToken });
  }

  @Get('announcement')
  announcement(
    @Query('previewToken') previewToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.markPreviewResponse(previewToken, res);
    return this.homepage.storefrontGetAnnouncement({ previewToken });
  }

  private markPreviewResponse(
    previewToken: string | undefined,
    res: Response,
  ): void {
    if (typeof previewToken === 'string' && previewToken.length > 0) {
      res.setHeader('Cache-Control', 'private, no-store');
    }
  }
}
