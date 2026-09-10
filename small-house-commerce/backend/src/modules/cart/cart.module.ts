import { Module } from '@nestjs/common';
import { CartService } from './cart.service.js';
import { StorefrontCartController } from './storefront/cart.controller.js';

@Module({
  controllers: [StorefrontCartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
