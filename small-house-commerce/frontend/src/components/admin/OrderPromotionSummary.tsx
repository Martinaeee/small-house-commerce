export function OrderPromotionSummary({
  promoCode,
}: {
  promoCode?: string | null;
}) {
  if (!promoCode) return null;
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-ink-secondary">Promo code</span>
      <code className="rounded bg-background px-2 py-0.5 text-xs font-semibold text-ink">
        {promoCode}
      </code>
    </div>
  );
}
