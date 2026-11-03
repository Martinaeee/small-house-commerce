import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CheckoutDraftsService } from '../checkout-drafts.service.js';
import {
  checkoutDraftQuerySchema,
  type CheckoutDraftQuery,
} from '../dto/checkout-draft.dto.js';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/checkout-drafts')
export class AdminCheckoutDraftsController {
  constructor(private readonly drafts: CheckoutDraftsService) {}

  @Get()
  @Permissions('ORDER_VIEW_ALL')
  list(@Query(new ZodValidationPipe(checkoutDraftQuerySchema)) query: CheckoutDraftQuery) {
    return this.drafts.list(query);
  }

  @Get(':id')
  @Permissions('ORDER_VIEW_ALL')
  detail(@Param('id') id: string) {
    return this.drafts.detail(id);
  }
}
