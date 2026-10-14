"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { Product } from "@/lib/api";
import type { CardBadge } from "@/lib/plpBadges";
import { useCart } from "@/components/cart/CartContext";
import { Button, ButtonLink } from "@/components/ui/Button";
import { BackInStockTrigger } from "@/components/back-in-stock/BackInStockTrigger";
import { cardInitialVariantId } from "@/lib/product-card-presentation";
import { addToCartEvent, emitCommerceEvent, variantConfirmEvent } from "@/lib/commerce-events";
import { PdpPurchaseProvider, usePdpPurchase } from "./PdpPurchaseProvider";
import { ProductCardView } from "./ProductCardView";

export type ProductCardInteractionMode = "storefront" | "preview";

export interface ProductCardProps {
  product: Product;
  badge?: string;
  badges?: readonly CardBadge[];
  interactionMode?: ProductCardInteractionMode;
  navigationTrackAttrs?: Readonly<Record<string, string>>;
}

type CardFeedback =
  | { revision: number; kind: "added" }
  | { revision: number; kind: "error"; message: string };

function ProductCardActions({ product, selectorRoot }: Pick<ProductCardProps, "product"> & {
  selectorRoot: RefObject<HTMLDivElement | null>;
}) {
  const { addItem } = useCart();
  const { primaryLine, primaryDerived, purchaseLocked, confirmLine, setPurchaseLocked } = usePdpPurchase();
  const requestLocked = useRef(false);
  const alive = useRef(true);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<CardFeedback | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => () => {
    if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
  }, [primaryLine.selectionRevision]);
  const visibleFeedback = feedback?.revision === primaryLine.selectionRevision ? feedback : null;

  async function addSelected() {
    if (requestLocked.current) return;
    const variant = primaryDerived.resolvedVariant;
    const sku = variant?.sku;
    if (!variant || !sku || sku.price === null) {
      setFeedback({ revision: primaryLine.selectionRevision, kind: "error", message: "Choose your options before adding to cart." });
      const missingId = primaryDerived.missingOptionIds[0];
      const group = [...(selectorRoot.current?.querySelectorAll<HTMLElement>("[data-option-id]") ?? [])]
        .find(node => node.dataset.optionId === missingId);
      const target = group?.querySelector<HTMLButtonElement>("button:not(:disabled)") ??
        selectorRoot.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]:not(:disabled)');
      target?.focus();
      return;
    }
    const snapshot = {
      productId: product.id, productName: product.name, variantId: variant.id,
      skuId: sku.id, price: sku.price, revision: primaryLine.selectionRevision,
      multiple: primaryDerived.selectableVariants.length > 1,
    };
    requestLocked.current = true;
    // The provider lock suppresses selection dispatch, including confirmation.
    confirmLine(primaryLine.clientLineId);
    setPurchaseLocked(true);
    setBusy(true);
    setFeedback(null);
    if (feedbackTimer.current !== null) {
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
    try {
      await addItem({ skuId: snapshot.skuId, quantity: 1 });
      if (snapshot.multiple) emitCommerceEvent(variantConfirmEvent({
        productId: snapshot.productId, variantId: snapshot.variantId, skuId: snapshot.skuId, source: "QUICK_ADD",
      }));
      emitCommerceEvent(addToCartEvent({ ...snapshot, quantity: 1 }));
      if (alive.current) {
        setFeedback({ revision: snapshot.revision, kind: "added" });
        feedbackTimer.current = setTimeout(() => {
          if (alive.current) setFeedback(null);
          feedbackTimer.current = null;
        }, 2000);
      }
    } catch (error) {
      if (alive.current) setFeedback({ revision: snapshot.revision, kind: "error",
        message: error instanceof Error ? error.message : "Could not add this item. Try again." });
    } finally {
      requestLocked.current = false;
      if (alive.current) {
        setBusy(false);
        setPurchaseLocked(false);
      }
    }
  }

  if (primaryDerived.selectableVariants.length === 0) {
    return <ButtonLink href={`/products/${product.slug}`} variant="secondary" size="md" className="w-full">View Details</ButtonLink>;
  }
  const outOfStock = (primaryDerived.resolvedVariant?.sku?.availableInventory ?? 1) <= 0;
  // Say which real combination is unavailable, not just "Save for Later";
  // only rendered when out of stock so in-stock cards keep their height.
  const outOfStockLabels = outOfStock
    ? [...product.options]
        .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))
        .map((option) => {
          const valueId = primaryLine.selectedValueIds[option.id];
          return option.values.find((value) => value.id === valueId)?.label;
        })
        .filter((label): label is string => Boolean(label))
    : [];
  return <>
    {outOfStockLabels.length > 0 ? (
      <p data-testid="card-out-of-stock-note" className="mb-2 text-xs text-ink-muted">
        {`${outOfStockLabels.join(" / ")} is out of stock`}
      </p>
    ) : null}
    <Button onClick={() => { void addSelected(); }} disabled={busy || purchaseLocked} size="md"
      variant={outOfStock ? "secondary" : "primary"} className="w-full">
      {busy ? "Adding…" : visibleFeedback?.kind === "added" ? "Added" : outOfStock ? "Save for Later" : "Add to Cart"}
    </Button>
    {outOfStock && primaryDerived.resolvedVariant?.sku ? (
      <div className="mt-2 text-center">
        <BackInStockTrigger
          skuId={primaryDerived.resolvedVariant.sku.id}
          productName={product.name}
        />
      </div>
    ) : null}
    <span role="status" className="sr-only">{busy ? "Adding to cart" : visibleFeedback?.kind === "added" ? "Added to cart" : ""}</span>
    {visibleFeedback?.kind === "error" ? <p role="alert" className="mt-2 text-xs text-sale">{visibleFeedback.message}</p> : null}
  </>;
}

function CardBody(props: ProductCardProps) {
  const { primaryLine, primaryDerived } = usePdpPurchase();
  const selectorRoot = useRef<HTMLDivElement | null>(null);
  const mode = props.interactionMode ?? "storefront";
  return <ProductCardView {...props} interactionMode={mode} primaryLine={primaryLine}
    derived={primaryDerived} selectorRoot={selectorRoot} action={mode === "preview"
      ? <Button disabled size="md" className="w-full">Add to Cart</Button>
      : <ProductCardActions product={props.product} selectorRoot={selectorRoot} />} />;
}

export function ProductCard(props: ProductCardProps) {
  const { product } = props;
  const initialVariantId = cardInitialVariantId(product);
  const productForCard = { ...product, defaultDisplayVariantId: initialVariantId };
  return <PdpPurchaseProvider key={JSON.stringify([product.id, product.catalogGraphVersion])}
    product={productForCard} initialVariantId={initialVariantId} initialQuantity={1}>
    <CardBody {...props} product={productForCard} />
  </PdpPurchaseProvider>;
}
