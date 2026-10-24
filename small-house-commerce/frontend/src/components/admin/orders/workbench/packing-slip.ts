import type { AdminOrderListRow } from "@/lib/admin-api";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/**
 * A local packing slip for the warehouse. It is deliberately not a carrier
 * label: no tracking number, no barcode and no price, so it can never be
 * mistaken for the third-party shipping document.
 */
export function buildPackingSlipHtml(row: AdminOrderListRow): string {
  const address = row.shippingAddress
    ? [
        row.shippingAddress.streetAddress,
        row.shippingAddress.barangay,
        row.shippingAddress.city,
        row.shippingAddress.province,
        row.shippingAddress.postalCode,
      ]
        .filter(Boolean)
        .join(", ")
    : "—";

  const lines = row.items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.productNameSnapshot)}</td>
          <td class="mono">${escapeHtml(item.skuCodeSnapshot)}</td>
          <td>${escapeHtml(item.variantSnapshot || "—")}</td>
          <td class="qty">× ${escapeHtml(item.quantity)}</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Packing slip ${escapeHtml(row.orderNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #14211b; margin: 28px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .note { color: #5b6b63; font-size: 11px; margin: 0 0 20px; }
    .meta { display: grid; grid-template-columns: 110px 1fr; gap: 4px 12px; font-size: 12px; margin-bottom: 20px; }
    .meta dt { color: #5b6b63; }
    .meta dd { margin: 0; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #d9dfdb; padding: 7px 6px; text-align: left; }
    th { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #5b6b63; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .qty { text-align: right; white-space: nowrap; }
    @media print { body { margin: 12mm; } }
  </style>
</head>
<body>
  <h1>Packing slip · ${escapeHtml(row.orderNumber)}</h1>
  <p class="note">Internal packing slip — not a carrier shipping label.</p>
  <dl class="meta">
    <dt>Customer</dt><dd>${escapeHtml(row.customer.name || "—")}</dd>
    <dt>Phone</dt><dd>${escapeHtml(row.customer.normalizedPhone)}</dd>
    <dt>Address</dt><dd>${escapeHtml(address)}</dd>
  </dl>
  <table>
    <thead><tr><th>Product</th><th>SKU</th><th>Variant</th><th class="qty">Quantity</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
</body>
</html>`;
}
