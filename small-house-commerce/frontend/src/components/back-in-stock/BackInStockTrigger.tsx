"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BackInStockDialog } from "./BackInStockDialog";

export interface BackInStockTriggerProps {
  skuId: string;
  productName: string;
  className?: string;
  label?: string;
}

export function BackInStockTrigger({
  skuId,
  productName,
  className,
  label = "Notify me when back in stock",
}: BackInStockTriggerProps) {
  const [openSkuId, setOpenSkuId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const open = openSkuId === skuId;

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
              returnFocusRef={triggerRef}
            />,
            document.body,
          )
        : null}
    </>
  );
}
