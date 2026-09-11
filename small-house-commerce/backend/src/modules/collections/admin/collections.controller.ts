import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CollectionsService } from '../collections.service.js';
import {
  addProductsSchema,
  collectionQuerySchema,
  createCollectionSchema,
  updateCollectionSchema,
  type CollectionQuery,
  type CreateCollectionInput,
  type UpdateCollectionInput,
} from '../dto/collection.dto.js';

/**
 * Admin collection management. Collections are merchandising content, so
 * PRODUCT_MANAGE covers them (no dedicated permission exists in ADMIN_SPEC).
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/collections')
export class AdminCollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get()
  @Permissions('PRODUCT_MANAGE')
  list(@Query(new ZodValidationPipe(collectionQuerySchema)) query: CollectionQuery) {
    return this.collections.list(query);
  }

  @Post()
  @Permissions('PRODUCT_MANAGE')
  create(@Body(new ZodValidationPipe(createCollectionSchema)) body: CreateCollectionInput) {
    return this.collections.create(body);
  }

  @Patch(':id')
  @Permissions('PRODUCT_MANAGE')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCollectionSchema)) body: UpdateCollectionInput,
  ) {
    return this.collections.update(id, body);
  }

  @Post(':id/products')
  @Permissions('PRODUCT_MANAGE')
  addProducts(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addProductsSchema)) body: { productIds: string[] },
  ) {
    return this.collections.update(id, body);
  }

  @Delete(':id')
  @Permissions('PRODUCT_MANAGE')
  remove(@Param('id') id: string) {
    return this.collections.remove(id);
  }
}
