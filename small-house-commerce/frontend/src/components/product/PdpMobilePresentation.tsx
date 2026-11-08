"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { optimizedUploadImage } from "@/lib/image-url";
import { emitCommerceEvent, optionSelectEvent } from "@/lib/commerce-events";
import { PriceBox } from "@/components/ui/PriceBox";
import { usePdpPurchase } from "./PdpPurchaseProvider";
import { isCompatibleValue } from "./ProductOptionSelector";
import { RatingStars } from "./RatingStars";
import styles from "./PdpMobile.module.css";

export function PdpVariantRail({ onOpen, preview = false }: {
  onOpen(trigger: HTMLElement): void;
  preview?: boolean;
}) {
  const { product, primaryLine, primaryDerived, purchaseLocked, selectOption, changeLineVariant } = usePdpPurchase();
  const track = useRef<HTMLDivElement>(null);
  const option = [...product.options].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))[0];
  const selectedId = option ? primaryLine.selectedValueIds[option.id] : undefined;
  useEffect(() => {
    const rail = track.current;
    const selected = rail?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!rail || !selected) return;
    const left = selected.offsetLeft - rail.offsetLeft;
    if (left < rail.scrollLeft) rail.scrollLeft = left;
    else if (left + selected.offsetWidth > rail.scrollLeft + rail.clientWidth) {
      rail.scrollLeft = left + selected.offsetWidth - rail.clientWidth;
    }
  }, [selectedId, option?.id]);
  if (!option || primaryDerived.selectableVariants.length <= 1) return null;
  return (
    <div className={styles.rail} aria-label="Quick variant selection">
      <div className={styles.railTrack} ref={track}>
        {[...option.values].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map(value => (
          <button
            key={value.id}
            type="button"
            className={styles.railValue}
            aria-pressed={selectedId === value.id}
            aria-label={value.label}
            disabled={purchaseLocked || !isCompatibleValue(product.options, primaryDerived.selectableVariants, primaryLine.selectedValueIds, option.id, value.id)}
            onClick={() => {
              if (selectedId === value.id) return;
              if (!preview) emitCommerceEvent(optionSelectEvent({ productId: product.id, optionKind: option.kind, optionValueId: value.id, selectionSource: "USER" }));
              selectOption(primaryLine.clientLineId, option.id, value.id);
              if (primaryDerived.purchaseConfirmed) changeLineVariant(primaryLine.clientLineId);
            }}
          >
            {value.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={optimizedUploadImage(value.thumbnailUrl, 96)} alt="" />
            ) : value.swatchHex ? <span aria-hidden="true" className="h-5 w-5 rounded border border-black/15" style={{ backgroundColor: value.swatchHex }} /> : null}
            {value.label}
          </button>
        ))}
      </div>
      <button type="button" className={styles.all} aria-label="Choose product options" disabled={purchaseLocked} onClick={event => onOpen(event.currentTarget)}>
        All <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}

export function PdpMobilePrice({ size = "md" }: { size?: "md" | "lg" }) {
  const { primaryDerived } = usePdpPurchase();
  if (primaryDerived.price === null) return null;
  return (
    <div className={styles.priceRow}>
      <PriceBox price={primaryDerived.price} compareAtPrice={primaryDerived.compareAtPrice} size={size} showDiscountBadge={false} />
      <span className={styles.sold}>80+ sold</span>
    </div>
  );
}

export function PdpMobileInfo() {
  const { product } = usePdpPurchase();
  const review = product.reviews?.find(item => item.comment?.trim());
  return (
    <section className={styles.info} data-testid="pdp-mobile-info">
      {/* Domestic-store reading order: the price answers "how much" first,
          then the name and the shop promises read as one block. */}
      <div className={styles.price} data-testid="pdp-mobile-price"><PdpMobilePrice size="lg" /></div>
      <div className={styles.headBlock}>
        <h1>{product.name}</h1>
        {product.tagline?.trim() && <p className={styles.tagline}>{product.tagline}</p>}
        <div className={styles.services}>
          <Link href="/shipping-delivery" className={styles.service}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M1 4h14v13H1zM15 9h4l4 5v3h-8" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" /></svg>
            <span className={styles.serviceLabel}><strong>Free Shipping</strong><i>|</i><b>Cash on Delivery</b></span><span className={styles.chev} aria-hidden="true">›</span>
          </Link>
          <Link href="/returns-refunds" className={styles.service}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z" /><path d="m8 12 3 3 5-6" /></svg>
            <span className={styles.serviceLabel}><strong>7-Day Free Return &amp; Exchange</strong></span><span className={styles.chev} aria-hidden="true">›</span>
          </Link>
        </div>
      </div>
      {product.reviewCount > 0 && product.ratingAverage !== null && (
        <div className={styles.review}>
          <div className={styles.reviewHead}><strong>Reviews</strong><RatingStars value={product.ratingAverage} className="text-sm" /><span>{product.ratingAverage.toFixed(1)}</span><a href="#reviews">{product.reviewCount} reviews ›</a></div>
          {review && <p className={styles.quote}>{review.authorName}: {review.comment}</p>}
        </div>
      )}
    </section>
  );
}
