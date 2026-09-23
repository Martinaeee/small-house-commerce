import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Cart } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AddItemInput, ReplaceItemInput } from './dto/cart.dto.js';

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
          variant: {
            select: {
              id: true,
              name: true,
              product: { select: { id: true, name: true, slug: true } },
              optionValues: {
                select: {
                  optionId: true,
                  optionValueId: true,
                  option: {
                    select: {
                      id: true,
                      name: true,
                      position: true,
                      isActive: true,
                      isMediaDriver: true,
                    },
                  },
                  optionValue: {
                    select: { id: true, label: true, position: true, isActive: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

/** One typed option of a cart line, ordered by option position. */
export interface CartItemOptionValue {
  optionId: string;
  optionName: string;
  optionValueId: string;
  label: string;
}

export interface CartItemThumbnail {
  url: string;
  type: 'IMAGE' | 'VIDEO';
  altText: string | null;
  resolvedScope: 'VARIANT' | 'OPTION_VALUE' | 'SHARED';
}

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
    // Typed option graph; empty for legacy variants that predate options —
    // clients fall back to the variantName text.
    optionValues: CartItemOptionValue[];
    // Same precedence as the storefront media resolver: exact variant media,
    // else the active media-driver option value's media, else shared media.
    thumbnail: CartItemThumbnail | null;
    quantity: number;
    unitPrice: number | null;
    compareAtPrice: number | null;
    lineTotal: number;
    // Stock state for the item's SKU (decided rules: carts may hold
    // out-of-stock SKUs, flagged here; checkout refuses when any is short).
    availableInventory: number;
    unavailable: boolean;
  }[];
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
}

/** Product image columns the thumbnail resolution needs. */
interface ScopedProductImage {
  url: string;
  type: 'IMAGE' | 'VIDEO';
  altText: string | null;
  optionValueId: string | null;
  variantId: string | null;
}

interface MediaDriverAssignment {
  optionValueId: string;
  option: { isActive: boolean; isMediaDriver: boolean };
  optionValue: { isActive: boolean };
}

/**
 * Cart-line thumbnail, mirroring the storefront media resolver's precedence
 * (catalog/product-media.resolver.ts resolveProductMedia): the variant's
 * exact media, else the active media-driver option value's media, else shared
 * product media. `images` arrives ordered by (sortOrder, id) — the resolver's
 * gallery order — so the first hit is the picture the PDP shows first.
 */
function resolveThumbnail(
  variantId: string,
  assignments: readonly MediaDriverAssignment[],
  images: readonly ScopedProductImage[],
): CartItemThumbnail | null {
  const exact = images.find(
    (image) => image.variantId === variantId && image.optionValueId === null,
  );
  if (exact) {
    return { url: exact.url, type: exact.type, altText: exact.altText, resolvedScope: 'VARIANT' };
  }

  const driverValueId = assignments.find(
    (assignment) =>
      assignment.option.isActive &&
      assignment.option.isMediaDriver &&
      assignment.optionValue.isActive,
  )?.optionValueId;
  if (driverValueId !== undefined) {
    const scoped = images.find(
      (image) => image.optionValueId === driverValueId && image.variantId === null,
    );
    if (scoped) {
      return {
        url: scoped.url,
        type: scoped.type,
        altText: scoped.altText,
        resolvedScope: 'OPTION_VALUE',
      };
    }
  }

  const shared = images.find(
    (image) => image.optionValueId === null && image.variantId === null,
  );
  return shared
    ? { url: shared.url, type: shared.type, altText: shared.altText, resolvedScope: 'SHARED' }
    : null;
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

  /**
   * Swap a cart line to another option combination of the same product
   * ("Change options"). Validation happens entirely before the write, so a
   * rejected replace leaves every original row untouched. When the target SKU
   * already has a row in this cart the two lines merge inside one transaction
   * (bump target, delete source); otherwise the line is rewritten in place.
   * Inventory is NOT touched here — checkout stays authoritative for
   * reservation (SYSTEM_ARCHITECTURE.md §14).
   */
  async replaceItemSku(
    cartId: string,
    itemId: string,
    input: ReplaceItemInput,
  ): Promise<CartSummary> {
    const cart = await this.resolveCart(cartId);
    const item = await this.ownedItem(cart.cart.id, itemId);
    const sku = await this.findPricedSku(input.skuId);

    const sourceProduct = await this.prisma.sku.findUniqueOrThrow({
      where: { id: item.skuId },
      select: { productId: true },
    });
    if (sourceProduct.productId !== sku.productId) {
      throw new BadRequestException('Target SKU belongs to a different product');
    }

    await this.prisma.$transaction(async (tx) => {
      const target = await tx.cartItem.findUnique({
        where: { cartId_skuId: { cartId: cart.cart.id, skuId: sku.id } },
      });

      if (target && target.id !== item.id) {
        // Merge: same cap as addItem keeps a line within the per-line max.
        await tx.cartItem.update({
          where: { id: target.id },
          data: { quantity: Math.min(99, target.quantity + input.quantity) },
        });
        await tx.cartItem.delete({ where: { id: item.id } });
      } else {
        // No separate target row (including the same-SKU case): adopt the
        // requested combination and quantity on the existing line.
        await tx.cartItem.update({
          where: { id: item.id },
          data: { skuId: sku.id, quantity: input.quantity },
        });
      }
    });

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

    // available = on_hand - reserved, computed per SKU (§29).
    const availableBySku = new Map<string, number>();
    const skuIds = [...new Set(cart.items.map((item) => item.sku.id))];

    if (skuIds.length > 0) {
      const grouped = await this.prisma.inventory.groupBy({
        by: ['skuId'],
        where: { skuId: { in: skuIds } },
        _sum: { onHand: true, reserved: true },
      });

      for (const row of grouped) {
        availableBySku.set(
          row.skuId,
          (row._sum.onHand ?? 0) - (row._sum.reserved ?? 0),
        );
      }
    }

    // Scoped media for thumbnail resolution, grouped per product. The query
    // order (sortOrder, id) is the resolver's gallery order.
    const imagesByProduct = new Map<string, ScopedProductImage[]>();
    const productIds = [...new Set(cart.items.map((item) => item.sku.variant.product.id))];

    if (productIds.length > 0) {
      const images = await this.prisma.productImage.findMany({
        where: { productId: { in: productIds } },
        select: {
          productId: true,
          url: true,
          type: true,
          altText: true,
          sortOrder: true,
          optionValueId: true,
          variantId: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });

      for (const image of images) {
        const bucket = imagesByProduct.get(image.productId);
        if (bucket) {
          bucket.push(image);
        } else {
          imagesByProduct.set(image.productId, [image]);
        }
      }
    }

    let subtotal = 0;

    const items = cart.items.map((item) => {
      const unitPrice = item.sku.price === null ? 0 : Number(item.sku.price);
      const lineTotal = unitPrice * item.quantity;
      const availableInventory = availableBySku.get(item.sku.id) ?? 0;

      // compareAtPrice is a strikethrough reference, not a cart discount —
      // the total due is the selling-price subtotal.
      subtotal += lineTotal;

      // Typed option assignments, ordered by option position (same
      // canonical order the PDP picker presents).
      const assignments = [...item.sku.variant.optionValues].sort(
        (left, right) =>
          left.option.position - right.option.position ||
          left.optionId.localeCompare(right.optionId),
      );

      return {
        itemId: item.id,
        skuId: item.sku.id,
        skuCode: item.sku.skuCode,
        productName: item.sku.variant.product.name,
        productSlug: item.sku.variant.product.slug,
        variantName: item.sku.variant.name,
        optionValues: assignments.map((assignment) => ({
          optionId: assignment.option.id,
          optionName: assignment.option.name,
          optionValueId: assignment.optionValue.id,
          label: assignment.optionValue.label,
        })),
        thumbnail: resolveThumbnail(
          item.sku.variant.id,
          assignments,
          imagesByProduct.get(item.sku.variant.product.id) ?? [],
        ),
        quantity: item.quantity,
        unitPrice: item.sku.price === null ? null : Number(item.sku.price),
        compareAtPrice: item.sku.compareAtPrice === null ? null : Number(item.sku.compareAtPrice),
        lineTotal,
        availableInventory,
        unavailable: availableInventory < item.quantity,
      };
    });

    // Shipping is 0 until the shipping-rate-rules module lands (DATABASE.md §81).
    // discount stays 0 until order-level promotions exist.
    return {
      cartId: cart.id,
      expiresAt: cart.expiresAt,
      items,
      subtotal,
      discount: 0,
      shipping: 0,
      total: subtotal,
    };
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
