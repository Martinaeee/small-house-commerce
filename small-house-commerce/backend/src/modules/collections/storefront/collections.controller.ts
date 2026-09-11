import { Controller, Get, Param, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CollectionsService } from '../collections.service.js';

/**
 * Public collection endpoints. Navigation data for the header comes from
 * here — the frontend MUST NOT hard-code navigation (DESIGN_SYSTEM §11).
 */
@Controller('storefront/collections')
export class StorefrontCollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get()
  list(@Query() query: { type?: string; page?: string; pageSize?: string }) {
    return this.collections.storefrontList({
      type: query.type,
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 50,
    });
  }

  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.collections.storefrontGetBySlug(slug);
  }

  @Get(':slug/products')
  products(
    @Param('slug') slug: string,
    @Query() query: { page?: string; pageSize?: string; room?: string; solution?: string; minPrice?: string; maxPrice?: string },
  ) {
    return this.collections.storefrontProducts(slug, {
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 24,
      room: query.room,
      solution: query.solution,
      minPrice: query.minPrice !== undefined ? Number(query.minPrice) : undefined,
      maxPrice: query.maxPrice !== undefined ? Number(query.maxPrice) : undefined,
    });
  }
}
