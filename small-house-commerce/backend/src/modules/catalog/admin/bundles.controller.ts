import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { BundlesService } from '../bundles.service.js';
import { setBundleComponentsSchema, type SetBundleComponentsInput } from '../dto/bundle.dto.js';

@Controller('admin/products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminBundlesController {
  constructor(private readonly bundles: BundlesService) {}

  @Get('bundle/sku-search')
  search(@Query('q', new ZodValidationPipe(z.string().trim().max(120).default(''))) q: string) {
    return this.bundles.search(q);
  }

  @Get(':productId/skus/:skuId/bundle-components')
  get(@Param('productId', new ZodValidationPipe(z.string().uuid())) productId: string, @Param('skuId', new ZodValidationPipe(z.string().uuid())) skuId: string) {
    return this.bundles.getComponents(productId, skuId);
  }

  @Put(':productId/skus/:skuId/bundle-components')
  set(@Param('productId', new ZodValidationPipe(z.string().uuid())) productId: string, @Param('skuId', new ZodValidationPipe(z.string().uuid())) skuId: string,
    @Body(new ZodValidationPipe(setBundleComponentsSchema)) input: SetBundleComponentsInput) {
    return this.bundles.setComponents(productId, skuId, input);
  }
}
