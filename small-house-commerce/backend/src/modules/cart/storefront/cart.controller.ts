import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { CartService } from '../cart.service.js';
import {
  addItemSchema,
  updateItemQuantitySchema,
  type AddItemInput,
  type UpdateItemQuantityInput,
} from '../dto/cart.dto.js';

/**
 * Public storefront cart endpoints (SYSTEM_ARCHITECTURE.md §14: guest cart).
 * No auth: the cart id itself is the client's identity, kept in localStorage.
 */
@Controller('storefront/cart')
export class StorefrontCartController {
  constructor(private readonly cart: CartService) {}

  @Post('items')
  addItem(@Body(new ZodValidationPipe(addItemSchema)) input: AddItemInput) {
    return this.cart.addItem(input);
  }

  @Put(':cartId/items/:itemId')
  updateQuantity(
    @Param('cartId') cartId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(updateItemQuantitySchema)) input: UpdateItemQuantityInput,
  ) {
    return this.cart.updateQuantity(cartId, itemId, input.quantity);
  }

  @Delete(':cartId/items/:itemId')
  removeItem(@Param('cartId') cartId: string, @Param('itemId') itemId: string) {
    return this.cart.removeItem(cartId, itemId);
  }

  @Get(':cartId/summary')
  summary(@Param('cartId') cartId: string) {
    return this.cart.summary(cartId);
  }
}
