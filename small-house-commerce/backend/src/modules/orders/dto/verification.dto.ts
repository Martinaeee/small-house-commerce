import { z } from 'zod';

export const verificationPrioritySchema = z.enum(['NORMAL', 'HIGH', 'URGENT']);
export const verificationItemStatusSchema = z.enum([
  'PENDING',
  'DONE',
  'PROBLEM',
  'SKIPPED',
  'INVALIDATED',
]);

/**
 * The whole checklist of one order. `itemKeys` reference the shipped
 * library; `customItems` carry operator-written questions with a stable
 * client-generated key ("custom:<uuid>").
 */
export const assignVerificationSchema = z.object({
  assigneeId: z.string().uuid().nullable().optional(),
  priority: verificationPrioritySchema.default('NORMAL'),
  itemKeys: z.array(z.string().min(1).max(64)).max(50).default([]),
  customItems: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        title: z.string().trim().min(1).max(160),
        required: z.boolean().default(false),
      }),
    )
    .max(20)
    .default([]),
  /** The person who checks a single question (may differ from the owner). */
  itemAssignees: z
    .array(
      z.object({
        itemKey: z.string().min(1).max(64),
        assigneeId: z.string().uuid().nullable(),
      }),
    )
    .max(50)
    .default([]),
  /**
   * A short note per question ("why this one matters", "called twice"). It is
   * the handover note of the assignment, not a verification result.
   */
  itemNotes: z
    .array(
      z.object({
        itemKey: z.string().min(1).max(64),
        note: z.string().trim().max(500).nullable(),
      }),
    )
    .max(50)
    .default([]),
  note: z.string().trim().max(500).nullable().optional(),
  nextFollowUpAt: z.coerce.date().nullable().optional(),
});

export const setVerificationResultSchema = z.object({
  status: verificationItemStatusSchema,
  result: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  nextFollowUpAt: z.coerce.date().nullable().optional(),
  skippedReason: z.string().trim().max(500).nullable().optional(),
  /** Optimistic lock: the write is refused when the record moved on. */
  rev: z.number().int().min(1).optional(),
});

/** A dialled call is a fact of its own; it is not a verification result. */
export const contactAttemptSchema = z.object({
  result: z.string().trim().min(1).max(120),
  note: z.string().trim().max(500).nullable().optional(),
});

export const createVerificationTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  items: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        title: z.string().trim().min(1).max(160),
        required: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(50),
});

export type AssignVerificationInput = z.infer<typeof assignVerificationSchema>;
export type SetVerificationResultInput = z.infer<typeof setVerificationResultSchema>;
export type ContactAttemptInput = z.infer<typeof contactAttemptSchema>;
export type CreateVerificationTemplateInput = z.infer<typeof createVerificationTemplateSchema>;
