"use client";
import { useEffect, useMemo, useState } from "react";
import { api, type CartItem, type Product } from "@/lib/api";
import { useCart } from "@/components/cart/CartContext";
import { clampQty, parseItemsParam, totalsFor, type CheckoutLine } from "./checkoutItems";

export interface CheckoutLineInput {
  skuId?: string;
  qty?: string;
  itemsParam?: string;
  slug?: string;
}

export interface CheckoutLines {
  isBuyNow: boolean;
  cartLoading: boolean;
  product: Product | null;
  productError: boolean;
  cartBlocked: boolean;
  buyNowMatchedSku: boolean;
  ready: boolean;
  lines: CheckoutLine[];
  orderItems: { skuId: string; quantity: number }[];
  cartItemIds: string[];
  totals: { subtotal: number; discount: 0; total: number };
  total: number | null;
}

export function useCheckoutLines({ skuId, qty, itemsParam, slug }: CheckoutLineInput): CheckoutLines {
  const { cart, loading: cartLoading } = useCart();
  const [product, setProduct] = useState<Product | null>(null);
  const [productError, setProductError] = useState(false);

  const buyNowQty = clampQty(qty);
  const isBuyNow = Boolean(skuId);
  const requestedIds = useMemo(() => parseItemsParam(itemsParam), [itemsParam]);

  // Buy Now: resolve name/variant/image/price via the product endpoint.
  useEffect(() => {
    if (!isBuyNow || !slug) return;
    let cancelled = false;
    api
      .getProductBySlug(slug)
      .then((p) => {
        if (!cancelled) setProduct(p);
      })
      .catch(() => {
        if (!cancelled) setProductError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isBuyNow, slug]);

  const selectedItems: CartItem[] = useMemo(() => {
    if (isBuyNow || !cart) return [];
    const wanted = new Set(requestedIds);
    return cart.items.filter((item) => wanted.has(item.itemId));
  }, [isBuyNow, cart, requestedIds]);

  const lines: CheckoutLine[] = useMemo(() => {
    if (isBuyNow) {
      if (!product || !skuId) return [];
      const variant = product.variants.find((v) => v.sku?.id === skuId);
      const sku = variant?.sku ?? null;
      return [
        {
          key: skuId,
          slug: product.slug,
          name: product.name,
          variant: variant?.name ?? "Default",
          quantity: buyNowQty,
          unitPrice: sku?.price ?? null,
          compareAtPrice: sku?.compareAtPrice ?? null,
        },
      ];
    }
    return selectedItems.map((item) => ({
      key: item.itemId,
      slug: item.productSlug,
      name: item.productName,
      variant: item.variantName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      compareAtPrice: item.compareAtPrice,
    }));
  }, [isBuyNow, product, skuId, buyNowQty, selectedItems]);

  const totals = useMemo(() => totalsFor(lines), [lines]);
  const total = isBuyNow ? (product ? totals.total : null) : totals.total;

  const orderItems = useMemo(() => {
    if (isBuyNow) return skuId ? [{ skuId, quantity: buyNowQty }] : [];
    return selectedItems.map((item) => ({ skuId: item.skuId, quantity: item.quantity }));
  }, [isBuyNow, skuId, buyNowQty, selectedItems]);

  const cartItemIds = useMemo(() => selectedItems.map((i) => i.itemId), [selectedItems]);

  // Cart path blockers once the cart has loaded: nothing selected, unknown
  // item ids (hand-edited URL), or selected stock problems.
  const cartBlocked =
    !isBuyNow &&
    !cartLoading &&
    requestedIds.length > 0 &&
    (selectedItems.length !== requestedIds.length ||
      selectedItems.some((item) => item.unavailable));

  // Buy Now is only submittable once the product resolved AND the requested
  // skuId exists on one of its variants. A hand-edited ?skuId is a dead end.
  const buyNowMatchedSku =
    !isBuyNow || (product !== null && product.variants.some((v) => v.sku?.id === skuId));

  const ready = isBuyNow
    ? product !== null && !productError && buyNowMatchedSku
    : !cartLoading && !cartBlocked && orderItems.length > 0;

  return {
    isBuyNow,
    cartLoading,
    product,
    productError,
    cartBlocked,
    buyNowMatchedSku,
    ready,
    lines,
    orderItems,
    cartItemIds,
    totals,
    total,
  };
}
