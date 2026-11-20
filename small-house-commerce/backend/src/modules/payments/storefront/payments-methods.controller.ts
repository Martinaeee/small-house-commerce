import { Controller, Get } from '@nestjs/common';
import { PaymentMethodsService } from '../payment-methods.service.js';

/**
 * Public list of payment methods the shopper may choose at checkout. It
 * intentionally carries no merchant id, keys or readiness detail: only what
 * the UI needs to render the selector. `no-store` so a switch flip is seen
 * on the very next visit.
 */
@Controller('storefront/payments')
export class StorefrontPaymentsMethodsController {
  constructor(private readonly methods: PaymentMethodsService) {}

  @Get('methods')
  async methods() {
    const result = await this.methods.listEffectiveMethods();
    return {
      codEnabled: result.codEnabled,
      revision: result.revision,
      methods: result.methods.map(({ id, enabled }) => ({ id, enabled })),
    };
  }
}
