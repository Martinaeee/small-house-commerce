import { z } from 'zod';
import { OrderStatus, SourceType } from '../../../generated/prisma/client.js';

export const checkoutSchema = z.object({
  customer: z.object({
    name: z.string().min(1).max(120),
    // Loose on purpose: normalized to E.164 in the service.
    phone: z.string().min(7).max(24),
    province: z.string().min(1).max(120),
    city: z.string().min(1).max(120),
    barangay: z.string().max(120).nullable().optional(),
    postalCode: z.string().max(20).nullable().optional(),
    streetAddress: z.string().min(1).max(255),
    landmark: z.string().max(255).nullable().optional(),
  }),
  items: z
    .array(
      z.object({
        skuId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1),
  attribution: z.object({
    sourceType: z.nativeEnum(SourceType).default('ORGANIC'),
    aid: z.string().max(64).nullable().optional(),
    optimizerId: z.string().uuid().nullable().optional(),
    facebookPostId: z.string().max(64).nullable().optional(),
    campaignId: z.string().max(64).nullable().optional(),
    adsetId: z.string().max(64).nullable().optional(),
    adId: z.string().max(64).nullable().optional(),
    landingPageId: z.string().uuid().nullable().optional(),
    utmSource: z.string().max(120).nullable().optional(),
    utmMedium: z.string().max(120).nullable().optional(),
    utmCampaign: z.string().max(120).nullable().optional(),
  }),
  preferredDeliveryDate: z
    .string()
    .date()
    .refine((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0, {
      message: 'Delivery is not available on Sundays.',
    })
    .refine((d) => {
      // Manila 日历日（规范时刻 = UTC 零点）：d ∈ [Manila今天+3, Manila今天+30]（自然日界；
      // 前端可选集为工作日并跳过周日，合法选择必然满足）
      const date = new Date(`${d}T00:00:00Z`);
      // Manila「今天」须按 Asia/Manila 墙钟取（服务器可能跑 UTC）——用
      // Intl.DateTimeFormat(timeZone "Asia/Manila") 取 y/m/d（与 deliveryWindow.ts 同族惯用法）
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      }).formatToParts(new Date());
      const v = (t: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((p) => p.type === t)?.value ?? '0');
      const today = new Date(Date.UTC(v('year'), v('month') - 1, v('day')));
      const min = new Date(today);
      min.setUTCDate(min.getUTCDate() + 3);
      const max = new Date(today);
      max.setUTCDate(max.getUTCDate() + 30);
      const dNum = (x: Date) =>
        x.getUTCFullYear() * 10000 + (x.getUTCMonth() + 1) * 100 + x.getUTCDate();
      return dNum(date) >= dNum(min) && dNum(date) <= dNum(max);
    }, { message: 'Preferred delivery date must be within the next 30 days.' })
    .nullable()
    .optional(),
});

export const orderQuerySchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  classification: z.enum(['NEW', 'AGAIN', 'RPT', 'RECHECK']).optional(),
  assignedTo: z.string().uuid().optional(),
  risk: z.enum(['POSSIBLE_DUPLICATE', 'CUSTOMER_RECHECK', 'CUSTOMER_BLOCKED']).optional(),
  search: z.string().max(255).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const lookupSchema = z.object({
  orderNumber: z.string().regex(/^PH\d+$/),
  phone: z.string().min(1).max(32),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type OrderQuery = z.infer<typeof orderQuerySchema>;
export type LookupInput = z.infer<typeof lookupSchema>;

// --- Order workbench DTOs (2026-09-18 spec) ---

export const assignOrderSchema = z.object({
  assignedToId: z.string().uuid(),
});
export type AssignOrderInput = z.infer<typeof assignOrderSchema>;

// Optional on purpose: the legacy confirm call posts NO body at all (plain
// order confirm); RPT/RECHECK review decisions send { decision, note? }.
export const confirmDecisionSchema = z
  .object({
    decision: z.enum(['CONFIRM', 'CANCEL', 'REQUEST_INFO']),
    note: z.string().max(500).optional(),
  })
  .optional();

export const updateOrderStatusSchema = z.object({
  status: z.nativeEnum(OrderStatus),
  comment: z.string().max(500).optional(),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

export const editOrderSchema = z.object({
  shippingAddress: z
    .object({
      fullName: z.string().min(1).max(120),
      phone: z.string().min(7).max(24),
      province: z.string().min(1).max(120),
      city: z.string().min(1).max(120),
      barangay: z.string().max(120).nullable().optional(),
      postalCode: z.string().max(20).nullable().optional(),
      streetAddress: z.string().min(1).max(255),
      landmark: z.string().max(255).nullable().optional(),
    })
    .optional(),
  items: z
    .array(
      z.object({
        skuId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .optional(),
  note: z.string().max(500).optional(),
});
export type EditOrderInput = z.infer<typeof editOrderSchema>;

export const addOrderNoteSchema = z.object({
  content: z.string().min(1).max(1000),
  noteType: z.enum(['CUSTOMER_SERVICE', 'SYSTEM', 'WAREHOUSE']).default('CUSTOMER_SERVICE'),
});
export type AddOrderNoteInput = z.infer<typeof addOrderNoteSchema>;

export const addCustomerNoteSchema = z.object({
  note: z.string().min(1).max(1000),
  orderId: z.string().uuid().nullable().optional(),
});
export type AddCustomerNoteInput = z.infer<typeof addCustomerNoteSchema>;

export const addRiskFlagSchema = z.object({
  flagType: z.enum(['POSSIBLE_DUPLICATE', 'CUSTOMER_RECHECK', 'CUSTOMER_BLOCKED']),
  reason: z.string().max(500).optional(),
});
export type AddRiskFlagInput = z.infer<typeof addRiskFlagSchema>;

export const mergeOrdersSchema = z.object({
  primaryOrderId: z.string().uuid(),
  mergedOrderId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});
export type MergeOrdersInput = z.infer<typeof mergeOrdersSchema>;
