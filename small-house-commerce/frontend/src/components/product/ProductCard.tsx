"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { Product } from "@/lib/api";
import type { CardBadge } from "@/lib/plpBadges";
import { useCart } from "@/components/cart/CartContext";
import { Button, ButtonLink } from "@/components/ui/Button";
import { RestockNotifyAction } from "@/components/back-in-stock/RestockNotifyAction";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { Toast } from "@/components/ui/Toast";
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

const CARD_ACTION_CLASS_NAME = "h-14! w-full min-w-0! px-2!";

function CardActionLabel({ label, note }: { label: string; note: string | null }) {
  return <span className="flex min-w-0 max-w-full flex-col items-center gap-0.5">
    <span className="leading-5">{label}</span>
    {note ? <span data-testid="card-action-note" title={note} className="block w-full truncate text-[11px] font-normal leading-4 opacity-85">{note}</span> : null}
  </span>;
}

function ProductCardActions({ product, selectorRoot, note }: Pick<ProductCardProps, "product"> & {
  selectorRoot: RefObject<HTMLDivElement | null>;
  note: string | null;
}) {
  const { addItem, cart } = useCart();
  const { backInStockEnabled } = useSiteSettings();
  const { primaryLine, primaryDerived, purchaseLocked, confirmLine, setPurchaseLocked } = usePdpPurchase();
  const requestLocked = useRef(false);
  const alive = useRef(true);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<CardFeedback | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => () => {
    if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
  }, [primaryLine.selectionRevision]);
  const visibleFeedback = feedback?.revision === primaryLine.selectionRevision ? feedback : null;

  async function addSelected(opts?: { openDrawer?: boolean }) {
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
      const input = { skuId: snapshot.skuId, quantity: 1 };
      // The drawer option is only passed when it matters, so the ordinary
      // add keeps its original single-argument call.
      await (opts ? addItem(input, opts) : addItem(input));
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
    return <ButtonLink href={`/products/${product.slug}`} variant="secondary" size="md" className={CARD_ACTION_CLASS_NAME}>View Details</ButtonLink>;
  }
  const outOfStock = (primaryDerived.resolvedVariant?.sku?.availableInventory ?? 1) <= 0;
  const outOfStockSku = primaryDerived.resolvedVariant?.sku ?? null;
  const actionLabel = busy ? "Adding…" : visibleFeedback?.kind === "added" ? "Added" : outOfStock ? "Save for Later" : "Add to Cart";
  return <>
    {outOfStock && outOfStockSku && backInStockEnabled ? (
      // One action for an unavailable item: register the restock alert and
      // keep the item saved. The alert service is only offered when it can
      // actually save one, so the card never promises an email the shop
      // cannot send — until then the cart save stays the single action.
      <RestockNotifyAction
        skuId={outOfStockSku.id}
        productName={product.name}
        label={<CardActionLabel label="Notify me" note={note} />}
        aria-label="Notify me"
        aria-description={note ?? undefined}
        variant="secondary"
        size="md"
        className={CARD_ACTION_CLASS_NAME}
        data-testid="card-notify"
        onSaved={() => {
          // The alert and the saved item are one action: keep the item in
          // the cart too, but never twice.
          const skuId = primaryDerived.resolvedVariant?.sku?.id;
          if (!skuId) return;
          if (!cart?.items.some((item) => item.skuId === skuId)) {
            void addSelected({ openDrawer: false });
          }
          setToast("We’ll notify you when it’s back in stock.");
        }}
      />
    ) : (
      <Button onClick={() => { void addSelected(); }} disabled={busy || purchaseLocked} size="md"
        variant={outOfStock ? "secondary" : "primary"} className={CARD_ACTION_CLASS_NAME}
        aria-label={actionLabel} aria-description={note ?? undefined}>
        <CardActionLabel label={actionLabel} note={note} />
      </Button>
    )}
    <span role="status" className="sr-only">{busy ? "Adding to cart" : visibleFeedback?.kind === "added" ? "Added to cart" : ""}</span>
    {visibleFeedback?.kind === "error" ? <p role="alert" className="mt-2 text-xs text-sale">{visibleFeedback.message}</p> : null}
    <Toast message={toast} onDismiss={() => setToast(null)} />
  </>;
}

function CardBody(props: ProductCardProps) {
  const { primaryLine, primaryDerived } = usePdpPurchase();
  const selectorRoot = useRef<HTMLDivElement | null>(null);
  const mode = props.interactionMode ?? "storefront";
  const previewVariant = mode === "preview" ? props.product.variants.find(row => row.id === props.product.cardMedia?.displayVariantId) : undefined;
  const variant = previewVariant ?? primaryDerived.resolvedVariant;
  const stock = variant?.sku?.availableInventory;
  const outOfStockLabels = stock !== undefined && stock <= 0
    ? [...props.product.options]
        .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))
        .map(option => option.values.find(value => variant?.optionValueIds.includes(value.id))?.label)
        .filter((label): label is string => Boolean(label))
    : [];
  const note = outOfStockLabels.length > 0 ? `${outOfStockLabels.join(" / ")} is out of stock`
    : stock !== undefined && stock > 0 && stock <= 5 ? `Only ${stock} left` : null;
  return <ProductCardView {...props} interactionMode={mode} primaryLine={primaryLine}
    derived={primaryDerived} selectorRoot={selectorRoot} action={mode === "preview"
      ? <Button disabled size="md" className={CARD_ACTION_CLASS_NAME} aria-label="Add to Cart" aria-description={note ?? undefined}>
          <CardActionLabel label="Add to Cart" note={note} />
        </Button>
      : <ProductCardActions product={props.product} selectorRoot={selectorRoot} note={note} />} />;
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
