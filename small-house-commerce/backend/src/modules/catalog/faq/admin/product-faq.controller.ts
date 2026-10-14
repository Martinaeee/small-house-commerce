import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard.js';
import { Permissions } from '../../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe.js';
import {
  adminFaqProductQuerySchema,
  type AdminFaqProductQuery,
} from '../../dto/product-faq.dto.js';
import { ProductsService } from '../../products.service.js';

@Controller('admin/faq/products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminProductFaqController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(adminFaqProductQuerySchema))
    query: AdminFaqProductQuery,
  ) {
    return this.products.listFaqProducts(query);
  }
}
