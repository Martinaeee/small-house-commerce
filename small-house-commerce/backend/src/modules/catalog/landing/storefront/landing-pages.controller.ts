import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe.js';
import { landingPageViewSchema, type LandingPageViewInput } from '../dto/landing-page.dto.js';
import { LandingPagesService } from '../landing-pages.service.js';

// Public routes: no auth guards. Not-live slugs get the same 404 as missing
// ones inside the service.
@Controller('storefront/lp')
export class StorefrontLandingPagesController {
  constructor(private readonly landingPages: LandingPagesService) {}

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.landingPages.storefrontGetComposite(slug);
  }

  @Post(':slug/view')
  @HttpCode(204)
  async recordView(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(landingPageViewSchema)) body: LandingPageViewInput,
  ): Promise<void> {
    await this.landingPages.recordView(slug, body.visitKey);
  }
}
