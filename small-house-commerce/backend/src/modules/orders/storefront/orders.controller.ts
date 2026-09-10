import { Body, Controller, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { OrdersService } from '../orders.service.js';
import { checkoutSchema, type CheckoutInput } from '../dto/order.dto.js';

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
}
