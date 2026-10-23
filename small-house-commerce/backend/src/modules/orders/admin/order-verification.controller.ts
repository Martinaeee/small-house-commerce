import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { OrderVerificationService } from '../verification.service.js';
import { OrderHandoverService } from '../handover.service.js';
import { recordHandoverSchema, type RecordHandoverInput } from '../dto/handover.dto.js';
import {
  assignVerificationSchema,
  contactAttemptSchema,
  createVerificationTemplateSchema,
  setVerificationResultSchema,
  type AssignVerificationInput,
  type ContactAttemptInput,
  type CreateVerificationTemplateInput,
  type SetVerificationResultInput,
} from '../dto/verification.dto.js';

/**
 * Admin surface for the manual COD verification (stage 1A) and for the
 * handover events.
 *
 * Permissions: reading needs ORDER_VIEW_ALL; the checklist is written with
 * ORDER_ASSIGN / ORDER_VERIFY and the handover with ORDER_HANDOVER.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/orders')
export class AdminOrderVerificationController {
  constructor(
    private readonly verificationService: OrderVerificationService,
    private readonly handoverService: OrderHandoverService,
  ) {}

  @Get('verification/templates')
  @Permissions('ORDER_VIEW_ALL')
  templates() {
    return this.verificationService.templates();
  }

  @Post('verification/templates')
  @Permissions('ORDER_ASSIGN')
  createTemplate(
    @Body(new ZodValidationPipe(createVerificationTemplateSchema))
    body: CreateVerificationTemplateInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.verificationService.createTemplate(user.userId, body);
  }

  @Get(':id/verification')
  @Permissions('ORDER_VIEW_ALL')
  list(@Param('id') id: string) {
    return this.verificationService.listForOrder(id);
  }

  @Post(':id/verification/assign')
  @Permissions('ORDER_ASSIGN')
  assign(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignVerificationSchema)) body: AssignVerificationInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.verificationService.assign(id, user.userId, body);
  }

  @Patch(':id/verification/:itemKey')
  @Permissions('ORDER_VERIFY')
  setResult(
    @Param('id') id: string,
    @Param('itemKey') itemKey: string,
    @Body(new ZodValidationPipe(setVerificationResultSchema)) body: SetVerificationResultInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.verificationService.setResult(id, itemKey, user.userId, body);
  }

  @Post(':id/verification/contact')
  @Permissions('ORDER_VERIFY')
  contact(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(contactAttemptSchema)) body: ContactAttemptInput & { itemKey?: string | null },
    @CurrentUser() user: { userId: string },
  ) {
    return this.verificationService.recordContact(id, body.itemKey ?? null, user.userId, body);
  }

  @Get(':id/handover')
  @Permissions('ORDER_VIEW_ALL')
  handoverSummary(@Param('id') id: string) {
    return this.handoverService.summary(id);
  }

  @Post(':id/handover')
  @Permissions('ORDER_HANDOVER')
  recordHandover(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(recordHandoverSchema)) body: RecordHandoverInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.handoverService.record(id, user.userId, body);
  }
}
