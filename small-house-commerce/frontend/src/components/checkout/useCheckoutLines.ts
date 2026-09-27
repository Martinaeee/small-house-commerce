"use client";
import { useEffect, useMemo, useState } from "react";
import { api, type CartItem, type Product } from "@/lib/api";
import { useCart } from "@/components/cart/CartContext";
import { clampQty, parseItemsParam, totalsFor, buyNowLineOptions, buyNowThumbnail, cartLineOptions, type CheckoutLine, type CheckoutTotals } from "./checkoutItems";

export interface CheckoutLineInput {
  skuId?: string;
  qty?: string;
  itemsParam?: string;
  slug?: string;
  directItems?: { skuId: string; quantity: number }[];
  directSlug?: string;
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
  totals: CheckoutTotals;
  total: number | null;
}

export function useCheckoutLines({
  skuId,
  qty,
  itemsParam,
  slug,
  directItems,
  directSlug,
}: CheckoutLineInput): CheckoutLines {
  const { cart, loading: cartLoading } = useCart();
  const [product, setProduct] = useState<Product | null>(null);
  const [productError, setProductError] = useState(false);

  const buyNowQty = clampQty(qty);
  const normalizedDirectItems = useMemo(
    () =>
      (directItems ?? []).map((item) => ({
        skuId: item.skuId,
        quantity: Math.min(99, Math.max(1, Math.floor(item.quantity) || 1)),
      })),
    [directItems],
  );
  const hasDirectItems = normalizedDirectItems.length > 0;
  const isBuyNow = Boolean(skuId) || hasDirectItems;
  const productSlug = hasDirectItems ? directSlug : slug;
  const requestedIds = useMemo(() => parseItemsParam(itemsParam), [itemsParam]);

  // Direct checkout (single Buy Now or PDP inline items): resolve the
  // canonical names, variants, options and prices from the product endpoint.
  useEffect(() => {
    if (!isBuyNow || !productSlug) return;
    let cancelled = false;
    api
      .getProductBySlug(productSlug)
      .then((p) => {
        if (!cancelled) setProduct(p);
      })
      .catch(() => {
        if (!cancelled) setProductError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isBuyNow, productSlug]);

  const selectedItems: CartItem[] = useMemo(() => {
    if (isBuyNow || !cart) return [];
    const wanted = new Set(requestedIds);
    return cart.items.filter((item) => wanted.has(item.itemId));
  }, [isBuyNow, cart, requestedIds]);

  const lines: CheckoutLine[] = useMemo(() => {
    if (hasDirectItems) {
      if (!product) return [];
      return normalizedDirectItems.map((item) => {
        const variant = product.variants.find((v) => v.sku?.id === item.skuId);
        const sku = variant?.sku ?? null;
        return {
          key: item.skuId,
          slug: product.slug,
          name: product.name,
          variant: variant?.name ?? "Default",
          options: buyNowLineOptions(product, item.skuId),
          thumbnail: buyNowThumbnail(product),
          quantity: item.quantity,
          unitPrice: sku?.price ?? null,
          compareAtPrice: sku?.compareAtPrice ?? null,
        };
      });
    }
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
          options: buyNowLineOptions(product, skuId),
          thumbnail: buyNowThumbnail(product),
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
      options: cartLineOptions(item),
      thumbnail: item.thumbnail
        ? {
            url: item.thumbnail.url,
            type: item.thumbnail.type,
            altText: item.thumbnail.altText,
          }
        : null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      compareAtPrice: item.compareAtPrice,
    }));
  }, [
    hasDirectItems,
    normalizedDirectItems,
    isBuyNow,
    product,
    skuId,
    buyNowQty,
    selectedItems,
  ]);

  const totals = useMemo(() => totalsFor(lines), [lines]);
  const total = isBuyNow ? (product ? totals.total : null) : totals.total;

  const orderItems = useMemo(() => {
    if (hasDirectItems) return normalizedDirectItems;
    if (isBuyNow) return skuId ? [{ skuId, quantity: buyNowQty }] : [];
    return selectedItems.map((item) => ({ skuId: item.skuId, quantity: item.quantity }));
  }, [hasDirectItems, normalizedDirectItems, isBuyNow, skuId, buyNowQty, selectedItems]);

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
  // skuId belongs to an ACTIVE SKU of one of its variants. A hand-edited or
  // DISABLED deep link (?skuId=) is a dead end here instead of failing at
  // backend order submit.
  const buyNowMatchedSku =
    !isBuyNow ||
    (product !== null &&
      (hasDirectItems
        ? normalizedDirectItems.every((item) =>
            product.variants.some(
              (variant) =>
                variant.sku?.id === item.skuId &&
                variant.sku?.status === "ACTIVE",
            ),
          )
        : product.variants.some(
            (variant) =>
              variant.sku?.id === skuId && variant.sku?.status === "ACTIVE",
          )));

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
