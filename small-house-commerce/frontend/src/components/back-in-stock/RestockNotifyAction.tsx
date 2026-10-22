"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { BackInStockDialog } from "./BackInStockDialog";
import {
  readRestockContact,
  subscribeToRestockAlert,
  writeRestockContact,
  type RestockContact,
} from "./restock-contact";

export interface RestockNotifyActionProps {
  skuId: string;
  productName: string;
  /** The single action the shopper sees. */
  label?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
  /**
   * Runs once the alert is saved. The PDP keeps the item in the cart here,
   * so one click covers both wishes.
   */
  onSaved?: (contact: RestockContact) => void | Promise<void>;
  "data-testid"?: string;
}

/**
 * The one action an unavailable item offers: register a restock alert and
 * keep the item saved.
 *
 * The contact is asked for only when we do not have it yet. After the first
 * alert this browser remembers the shopper, so every later click subscribes
 * straight away.
 */
export function RestockNotifyAction({
  skuId,
  productName,
  label = "Notify me when available",
  variant = "primary",
  size = "md",
  className = "",
  disabled = false,
  onSaved,
  ...rest
}: RestockNotifyActionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prefill, setPrefill] = useState<RestockContact | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const request = useCallback(async () => {
    if (disabled || busy) return;
    const saved = readRestockContact();
    if (!saved?.email) {
      setPrefill(null);
      setDialogError(null);
      setDialogOpen(true);
      return;
    }
    setBusy(true);
    try {
      await subscribeToRestockAlert({
        skuId,
        email: saved.email,
        phone: saved.phone,
      });
      await onSaved?.(saved);
    } catch {
      // The alert did not save. Ask for the contact again rather than
      // pretending the shopper is on the list.
      setPrefill(saved);
      setDialogError("We couldn't save your alert. Please try again.");
      setDialogOpen(true);
    } finally {
      setBusy(false);
    }
  }, [busy, disabled, onSaved, skuId]);

  return (
    <>
      <Button
        ref={triggerRef}
        variant={variant}
        size={size}
        disabled={disabled || busy}
        onClick={() => void request()}
        className={className}
        {...rest}
      >
        {label}
      </Button>
      {dialogOpen
        ? createPortal(
            <BackInStockDialog
              key={skuId}
              skuId={skuId}
              productName={productName}
              initialEmail={prefill?.email ?? ""}
              initialPhone={prefill?.phone ?? null}
              initialError={dialogError}
              dismissOnSuccess
              keepsInCart={onSaved !== undefined}
              onClose={() => setDialogOpen(false)}
              onSubscribed={(contact) => {
                // Remember the contact so the next alert on this browser is a
                // single click.
                writeRestockContact(contact);
                void onSaved?.(contact);
              }}
              returnFocusRef={triggerRef}
            />,
            document.body,
          )
        : null}
    </>
  );
}
