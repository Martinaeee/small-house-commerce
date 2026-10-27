import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { checkoutRequestMeta } from '../../meta-capi/request-meta.js';
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
    @Req() request: Request,
  ) {
    return this.ordersService.checkout(body, checkoutRequestMeta(request));
  }

  // Guest order tracking (spec §3.1): no guard — the order number OR the
  // mobile number identifies the order. Distinct static path, no conflict
  // with @Post().
  @Post('lookup')
  @HttpCode(200)
  lookup(@Body(new ZodValidationPipe(lookupSchema)) body: LookupInput) {
    return this.ordersService.lookup(body.orderNumber ?? null, body.phone ?? null);
  }
}
