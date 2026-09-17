import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { OrdersService } from '../orders.service.js';
import {
  checkoutSchema,
  lookupSchema,
  type CheckoutInput,
  type LookupInput,
} from '../dto/order.dto.js';

/**
 * Guest COD checkout (API_SPEC §18). Buy Now on the PDP uses the same
 * endpoint: the backend re-validates stock for every submitted SKU and
 * rejects the order if anything is short.
 */
@Controller('storefront/orders')
export class StorefrontOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  checkout(
    @Body(new ZodValidationPipe(checkoutSchema)) body: CheckoutInput,
  ) {
    return this.ordersService.checkout(body);
  }

  // Guest order tracking (spec §3.1): no guard — order number + phone is
  // the shared secret. Distinct static path, no conflict with @Post().
  @Post('lookup')
  @HttpCode(200)
  lookup(@Body(new ZodValidationPipe(lookupSchema)) body: LookupInput) {
    return this.ordersService.lookup(body.orderNumber, body.phone);
  }
}
