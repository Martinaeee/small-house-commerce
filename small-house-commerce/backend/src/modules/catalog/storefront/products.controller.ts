import { Controller, Get, Param, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import {
  storefrontProductQuerySchema,
  type StorefrontProductQuery,
} from '../dto/product.dto.js';
import { ProductsService } from '../products.service.js';
import {
  optionalMediaScope,
  requiredMediaScope,
} from '../product-media.resolver.js';

/**
 * Public storefront endpoints. No auth: these are served to anonymous
 * shoppers. The service select whitelist keeps cost and supplier data out.
 */
@Controller('storefront/products')
export class StorefrontProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(storefrontProductQuerySchema))
    query: StorefrontProductQuery,
  ) {
    return this.products.storefrontList(query);
  }

  @Get(':slug/media')
  media(
    @Param('slug') slug: string,
    @Query('variantId') variantId?: string,
    @Query('optionValueId') optionValueId?: string,
  ) {
    return this.products.storefrontMediaBySlug(
      slug,
      requiredMediaScope(variantId, optionValueId),
    );
  }

  @Get(':slug')
  getBySlug(
    @Param('slug') slug: string,
    @Query('variantId') variantId?: string,
    @Query('optionValueId') optionValueId?: string,
  ) {
    return this.products.storefrontGetBySlug(
      slug,
      optionalMediaScope(variantId, optionValueId),
    );
  }
}
