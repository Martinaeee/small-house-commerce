import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CheckoutDraftsService } from '../checkout-drafts.service.js';
import {
  checkoutDraftFollowUpSchema,
  checkoutDraftQuerySchema,
  type CheckoutDraftFollowUpInput,
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

  /** Customer-service follow-up: result, owner, next call and a note. */
  @Patch(':id/follow-up')
  @Permissions('ORDER_VERIFY')
  followUp(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(checkoutDraftFollowUpSchema)) body: CheckoutDraftFollowUpInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.drafts.followUp(id, body, user.userId);
  }
}
