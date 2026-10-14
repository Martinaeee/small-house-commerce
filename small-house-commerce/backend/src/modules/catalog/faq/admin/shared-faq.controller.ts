import { Body, Controller, Get, HttpCode, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard.js';
import { Permissions } from '../../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe.js';
import {
  sharedFaqProductQuerySchema,
  updateSharedFaqSchema,
  type SharedFaqProductQuery,
  type UpdateSharedFaqInput,
} from '../dto/shared-faq.dto.js';
import { SharedFaqService } from '../shared-faq.service.js';

/**
 * The site-wide shared FAQ library.
 *
 * Guarded by PRODUCT_FAQ_SHARED_MANAGE rather than PRODUCT_MANAGE: editing one
 * product's questions must not imply the right to rewrite the library every
 * other product renders from.
 */
@Controller('admin/faq/shared')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_FAQ_SHARED_MANAGE')
export class AdminSharedFaqController {
  constructor(private readonly sharedFaq: SharedFaqService) {}

  @Get()
  get() {
    return this.sharedFaq.get();
  }

  /**
   * Read-only product list for choosing a targeted audience. Lives here under
   * the shared-FAQ permission so an FAQ operator can assign questions without
   * needing (or gaining) PRODUCT_MANAGE.
   */
  @Get('products')
  listProducts(
    @Query(new ZodValidationPipe(sharedFaqProductQuerySchema))
    query: SharedFaqProductQuery,
  ) {
    return this.sharedFaq.listProducts(query);
  }

  @Put()
  @HttpCode(200)
  update(
    @Body(new ZodValidationPipe(updateSharedFaqSchema)) input: UpdateSharedFaqInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.sharedFaq.update(input.items, input.expectedVersion, user.userId);
  }
}
