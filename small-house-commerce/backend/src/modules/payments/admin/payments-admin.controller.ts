import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { updatePaymentMethodsSchema, type UpdatePaymentMethodsInput } from '../dto/payment-methods.dto.js';
import { PaymentMethodsService } from '../payment-methods.service.js';

/**
 * Per-method payment switches. SYSTEM_SETTINGS_EDIT is granted to
 * SUPER_ADMIN only — same guard class as the site settings controller.
 */
@Controller('admin/settings/payment-methods')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('SYSTEM_SETTINGS_EDIT')
export class PaymentsAdminSettingsController {
  constructor(private readonly methods: PaymentMethodsService) {}

  @Get()
  get() {
    return this.methods.listForAdmin();
  }

  @Patch()
  update(
    @Body(new ZodValidationPipe(updatePaymentMethodsSchema))
    input: UpdatePaymentMethodsInput,
    @CurrentUser() user: { userId: string },
  ) {
    return this.methods.update(input.methods, user.userId, input.revision);
  }
}
