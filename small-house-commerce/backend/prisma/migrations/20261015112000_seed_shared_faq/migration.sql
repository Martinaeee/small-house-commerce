-- Seed the seven public FAQ entries that previously lived in the PDP component.
-- The singleton is intentionally idempotent: an operator's edited library must
-- never be overwritten by a later deploy or migration replay.
INSERT INTO "shared_faq_sets" ("id", "items", "version", "updated_at")
VALUES (
  '00000000-0000-0000-0000-0000000000fa',
  '[
    {"id":"00000000-0000-4000-8000-000000000701","title":"Delivery & Cash on Delivery","answer":[{"kind":"bullets","items":["Metro Manila: 3–5 days. Free Metro Manila delivery on orders ₱3,000+.","Provinces: 5–7 days through our nationwide delivery partners.","Cash on Delivery is available nationwide — pay only when your order arrives.","Questions about your delivery? Email {{supportEmail}} ({{supportHours}})."]}],"enabled":true,"position":0,"defaultOpen":true},
    {"id":"00000000-0000-4000-8000-000000000702","title":"Returns & Damage Claims","answer":[{"kind":"paragraph","text":"Returns are accepted only for items that arrive damaged or defective. Please contact us at {{supportEmail}} within 48 hours of delivery with photos of the item and its packaging, and we will arrange a replacement or refund. Items cannot be returned for non-quality issues such as change of mind or incorrect size after delivery."}],"enabled":true,"position":1,"defaultOpen":false},
    {"id":"00000000-0000-4000-8000-000000000703","title":"Assembly","answer":[{"kind":"paragraph","text":"Assembly depends on the product. Foldable and ready-to-use items need no setup; other items ship with clear instructions and the hardware needed for assembly. Check the product details above, or contact us before ordering if you are unsure what this item requires."}],"enabled":true,"position":2,"defaultOpen":false},
    {"id":"00000000-0000-4000-8000-000000000704","title":"How does Cash on Delivery work?","answer":[{"kind":"paragraph","text":"Place your order with your name, address and phone number — no payment online. When the rider delivers, inspect the item and pay the rider in cash. Please prepare the exact amount when possible."}],"enabled":true,"position":3,"defaultOpen":false},
    {"id":"00000000-0000-4000-8000-000000000705","title":"Can I change or cancel my order?","answer":[{"kind":"paragraph","text":"Contact us as soon as possible at {{supportEmail}}. Address or item changes are possible while the order is still being processed; once an order has shipped, it can no longer be changed or redirected."}],"enabled":true,"position":4,"defaultOpen":false},
    {"id":"00000000-0000-4000-8000-000000000706","title":"Will it fit my space?","answer":[{"kind":"paragraph","text":"Check the Size guide in the product details above for exact dimensions, and measure your doorway, hallway and intended spot before ordering — especially for sofas, tables and beds. Delivery crews cannot disassemble doorframes, so a few minutes of measuring is the best way to avoid a tight fit."}],"enabled":true,"position":5,"defaultOpen":false},
    {"id":"00000000-0000-4000-8000-000000000707","title":"Do I need to drill or mount anything?","answer":[{"kind":"paragraph","text":"Most LUWAG Living pieces are freestanding or foldable and need no drilling at all, which makes them rental-friendly. If a specific item requires wall fixing, it is noted in the product details."}],"enabled":true,"position":6,"defaultOpen":false}
  ]'::jsonb,
  0,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
