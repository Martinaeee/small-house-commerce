import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Cart } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AddItemInput } from './dto/cart.dto.js';

/** 30 days, decided: COD customers get a long reconsideration window. */
const CART_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const CART_WITH_ITEMS = {
  items: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      quantity: true,
      sku: {
        select: {
          id: true,
          skuCode: true,
          price: true,
          compareAtPrice: true,
          variant: { select: { name: true, product: { select: { name: true, slug: true } } } },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

export interface CartSummary {
  cartId: string;
  expiresAt: Date;
  items: {
    itemId: string;
    skuId: string;
    skuCode: string;
    productName: string;
    productSlug: string;
    variantName: string;
    quantity: number;
    unitPrice: number | null;
    compareAtPrice: number | null;
    lineTotal: number;
  }[];
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
}

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async addItem(input: AddItemInput): Promise<{ created: boolean } & CartSummary> {
    const { cart, created } = await this.resolveCart(input.cartId);
    const sku = await this.findPricedSku(input.skuId);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.cartItem.findUnique({
        where: { cartId_skuId: { cartId: cart.id, skuId: sku.id } },
      });

      if (existing) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: Math.min(99, existing.quantity + input.quantity) },
        });
      } else {
        await tx.cartItem.create({
          data: { cartId: cart.id, skuId: sku.id, quantity: input.quantity },
        });
      }
    });

    const summary = await this.buildSummary(cart.id);
    return { created, ...summary };
  }

  async updateQuantity(cartId: string, itemId: string, quantity: number): Promise<CartSummary> {
    const cart = await this.resolveCart(cartId);
    const item = await this.ownedItem(cart.cart.id, itemId);

    await this.prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
    return this.buildSummary(cart.cart.id);
  }

  async removeItem(cartId: string, itemId: string): Promise<CartSummary> {
    const cart = await this.resolveCart(cartId);
    const item = await this.ownedItem(cart.cart.id, itemId);

    await this.prisma.cartItem.delete({ where: { id: item.id } });
    return this.buildSummary(cart.cart.id);
  }

  async summary(cartId: string): Promise<CartSummary> {
    const { cart } = await this.resolveCart(cartId);
    return this.buildSummary(cart.id);
  }

  // --- internals -----------------------------------------------------------

  /**
   * Lazy expiry: a cart that does not exist or is past expiresAt is replaced
   * by a fresh one (the stale row, if any, is deleted with its items).
   */
  private async resolveCart(cartId?: string): Promise<{ cart: Cart; created: boolean }> {
    if (cartId !== undefined) {
      if (!isUuid(cartId)) {
        throw new BadRequestException('cartId must be a valid UUID');
      }

      const existing = await this.prisma.cart.findUnique({
        where: { id: cartId },
        include: { items: { select: { id: true } } },
      });

      if (existing && existing.expiresAt > new Date()) {
        return { cart: existing, created: false };
      }

      if (existing) {
        await this.prisma.cart.delete({ where: { id: existing.id } });
      }
    }

    const cart = await this.prisma.cart.create({
      data: { expiresAt: new Date(Date.now() + CART_TTL_MS) },
    });
    return { cart, created: true };
  }

  private async findPricedSku(skuId: string) {
    const sku = await this.prisma.sku.findUnique({
      where: { id: skuId },
      include: { variant: { include: { product: { select: { id: true, status: true } } } } },
    });

    if (!sku || sku.status !== 'ACTIVE' || sku.variant.product.status !== 'ACTIVE') {
      throw new BadRequestException('SKU is not available for purchase');
    }
    if (sku.price === null) {
      throw new BadRequestException('SKU is not priced');
    }

    return sku;
  }

  private async ownedItem(cartId: string, itemId: string) {
    const item = await this.prisma.cartItem.findUnique({ where: { id: itemId } });

    if (!item || item.cartId !== cartId) {
      throw new NotFoundException('Cart item not found');
    }

    return item;
  }

  private async buildSummary(cartId: string): Promise<CartSummary> {
    const cart = await this.prisma.cart.findUniqueOrThrow({
      where: { id: cartId },
      include: CART_WITH_ITEMS,
    });

    let subtotal = 0;
    let discount = 0;

    const items = cart.items.map((item) => {
      const unitPrice = item.sku.price === null ? 0 : Number(item.sku.price);
      const compareAt = item.sku.compareAtPrice === null ? 0 : Number(item.sku.compareAtPrice);
      const lineTotal = unitPrice * item.quantity;

      subtotal += lineTotal;
      if (compareAt > unitPrice) {
        discount += (compareAt - unitPrice) * item.quantity;
      }

      return {
        itemId: item.id,
        skuId: item.sku.id,
        skuCode: item.sku.skuCode,
        productName: item.sku.variant.product.name,
        productSlug: item.sku.variant.product.slug,
        variantName: item.sku.variant.name,
        quantity: item.quantity,
        unitPrice: item.sku.price === null ? null : Number(item.sku.price),
        compareAtPrice: item.sku.compareAtPrice === null ? null : Number(item.sku.compareAtPrice),
        lineTotal,
      };
    });

    // Shipping is 0 until the shipping-rate-rules module lands (DATABASE.md §81).
    return {
      cartId: cart.id,
      expiresAt: cart.expiresAt,
      items,
      subtotal,
      discount,
      shipping: 0,
      total: subtotal - discount,
    };
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
