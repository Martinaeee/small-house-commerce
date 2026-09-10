import { Controller, Get, Param, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import {
  storefrontProductQuerySchema,
  type StorefrontProductQuery,
} from '../dto/product.dto.js';
import { ProductsService } from '../products.service.js';

/**
 * Public storefront endpoints. No auth: these are served to anonymous
 * shoppers. The service select whitelist keeps cost and supplier data out.
 */
@Controller('storefront/products')
export class StorefrontProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(storefrontProductQuerySchema)) query: StorefrontProductQuery) {
    return this.products.storefrontList(query);
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.products.storefrontGetBySlug(slug);
  }
}
