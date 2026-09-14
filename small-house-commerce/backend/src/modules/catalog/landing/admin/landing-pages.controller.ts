import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard.js';
import { Permissions } from '../../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe.js';
import {
  adminLandingPageQuerySchema,
  bulkTitleLandingPagesSchema,
  createLandingPageSchema,
  updateLandingPageSchema,
  type AdminLandingPageQuery,
  type BulkTitleLandingPagesInput,
  type CreateLandingPageInput,
  type UpdateLandingPageInput,
} from '../dto/landing-page.dto.js';
import { LandingPagesService } from '../landing-pages.service.js';

/**
 * Global "Single Pages" screen: every landing page across products with
 * visit/order metrics, plus the bulk retitle action used for A/B themes.
 */
@Controller('admin/landing-pages')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminLandingPagesController {
  constructor(private readonly landingPages: LandingPagesService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(adminLandingPageQuerySchema)) query: AdminLandingPageQuery,
  ) {
    return this.landingPages.adminList(query);
  }

  @Post('bulk-title')
  @HttpCode(200)
  bulkTitle(
    @Body(new ZodValidationPipe(bulkTitleLandingPagesSchema)) input: BulkTitleLandingPagesInput,
  ) {
    return this.landingPages.bulkRetitle(input.ids, input.titleOverride);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateLandingPageSchema)) input: UpdateLandingPageInput,
  ) {
    return this.landingPages.adminUpdate(id, input);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.landingPages.adminRemove(id);
  }
}

/** Per-product landing page management, mounted under the product resource. */
@Controller('admin/products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminProductLandingPagesController {
  constructor(private readonly landingPages: LandingPagesService) {}

  @Get(':productId/landing-pages')
  listForProduct(@Param('productId') productId: string) {
    return this.landingPages.adminListForProduct(productId);
  }

  @Post(':productId/landing-pages')
  create(
    @Param('productId') productId: string,
    @Body(new ZodValidationPipe(createLandingPageSchema)) input: CreateLandingPageInput,
  ) {
    return this.landingPages.adminCreate(productId, input);
  }
}
