"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { ProductImage } from "@/lib/api";
import { optimizedUploadImage } from "@/lib/image-url";
import { Button } from "@/components/ui/Button";
import { PdpMobilePrice } from "./PdpMobilePresentation";
import { RestockNotifyAction } from "@/components/back-in-stock/RestockNotifyAction";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { ProductOptionSelector } from "./ProductOptionSelector";
import { usePdpPurchase } from "./PdpPurchaseProvider";
import styles from "./PdpMobile.module.css";

type Intent = "ADD_TO_CART" | "ORDER_NOW";

export function PdpMobileVariantDrawer({ intent = null, busy, image, notice, onIntent, onClose, onRestockSaved }: {
  intent?: Intent | null;
  busy: boolean;
  image: ProductImage | null;
  notice: string | null;
  onIntent(intent: Intent): void;
  onClose(): void;
  onRestockSaved(): Promise<void>;
}) {
  const { product, primaryLine, primaryDerived, setQuantity } = usePdpPurchase();
  const { backInStockEnabled } = useSiteSettings();
  const nameWords = product.name.trim().split(/\s+/);
  const title = nameWords.slice(0, 3).join(" ") + (nameWords.length > 3 ? "…" : "");
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const locked = useRef(busy);
  useEffect(() => { locked.current = busy; }, [busy]);
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !locked.current) { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const items = [...(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled)") ?? [])];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = before; document.removeEventListener("keydown", onKey); };
  }, [onClose]);
  const variant = primaryDerived.resolvedVariant;
  const available = primaryDerived.availableInventory;
  const overQuantity = available > 0 && primaryLine.quantity > available;
  const unavailable = !variant || overQuantity;
  return createPortal(
    <div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={id} className={styles.drawer}>
        <div className={styles.drawerHead}>
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={optimizedUploadImage(image.url, 256)} alt={image.altText ?? product.name} />
          )}
          <div><h2 id={id} aria-label={product.name}>{title}</h2><PdpMobilePrice /><p className="mt-1 text-xs text-ink-secondary">{variant ? available > 0 ? "In stock" : "Out of stock" : "Choose a configuration"}</p></div>
          <button type="button" className={styles.close} aria-label="Close options" onClick={onClose} disabled={busy}>×</button>
        </div>
        <p className={styles.selected}>{variant?.name ?? "Choose all options"}</p>
        <div className={styles.drawerBody}>
          {/* While an add/checkout submission is in flight the selection is
              frozen too, not just the footer buttons: changing the variant
              mid-submit would leave the request pointing at a stale SKU. */}
          <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
            <ProductOptionSelector lineId={primaryLine.clientLineId} instanceId="mobile-drawer" imageCards />
          </fieldset>
          <div className={styles.quantity}>
            <span>Quantity</span>
            <div className={styles.stepper}>
              <button type="button" aria-label="Decrease quantity" disabled={busy || primaryLine.quantity <= 1} onClick={() => setQuantity(primaryLine.clientLineId, primaryLine.quantity - 1)}>−</button>
              <span>{primaryLine.quantity}</span>
              <button type="button" aria-label="Increase quantity" disabled={busy || !variant || available <= primaryLine.quantity} onClick={() => setQuantity(primaryLine.clientLineId, primaryLine.quantity + 1)}>+</button>
            </div>
          </div>
          {overQuantity && <p role="alert" className="mt-3 text-sm text-sale">Only {available} available. Please reduce the quantity.</p>}
          {notice && <p role="status" className="mt-3 text-sm text-cta">{notice}</p>}
        </div>
        <div className={styles.drawerFoot}>
          {variant?.sku && available <= 0 && backInStockEnabled ? (
            <RestockNotifyAction skuId={variant.sku.id} productName={product.name} label="Notify me when available" variant="primary" onSaved={onRestockSaved} />
          ) : <>
            {intent !== "ORDER_NOW" && <Button variant="secondary" disabled={busy || unavailable} onClick={() => onIntent("ADD_TO_CART")}>ADD TO CART</Button>}
            {intent !== "ADD_TO_CART" && <Button disabled={busy || unavailable || available <= 0} onClick={() => onIntent("ORDER_NOW")}>ORDER NOW</Button>}
          </>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
