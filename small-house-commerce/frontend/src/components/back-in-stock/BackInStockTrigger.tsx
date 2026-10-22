"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSiteSettings } from "@/components/site/SiteSettingsProvider";
import { BackInStockDialog } from "./BackInStockDialog";
import { writeRestockContact, type RestockContact } from "./restock-contact";

export interface BackInStockTriggerProps {
  skuId: string;
  productName: string;
  className?: string;
  label?: string;
  /**
   * Called once the alert is saved, so the surface can also keep the item in
   * the shopper's cart.
   */
  onSubscribed?: (contact: RestockContact) => void;
}

export function BackInStockTrigger({
  skuId,
  productName,
  className,
  label = "Notify me when back in stock",
  onSubscribed,
}: BackInStockTriggerProps) {
  const { backInStockEnabled } = useSiteSettings();
  const [openSkuId, setOpenSkuId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const open = openSkuId === skuId;

  if (!backInStockEnabled) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpenSkuId(skuId)}
        className={
          className ??
          "text-sm font-semibold text-cta underline underline-offset-4 transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2"
        }
      >
        {label}
      </button>
      {open
        ? createPortal(
            <BackInStockDialog
              key={skuId}
              skuId={skuId}
              productName={productName}
              onClose={() => setOpenSkuId(null)}
              keepsInCart={onSubscribed !== undefined}
              onSubscribed={(contact) => {
                // Remember the contact so the next alert on this browser is a
                // single click.
                writeRestockContact(contact);
                onSubscribed?.(contact);
              }}
              returnFocusRef={triggerRef}
            />,
            document.body,
          )
        : null}
    </>
  );
}
