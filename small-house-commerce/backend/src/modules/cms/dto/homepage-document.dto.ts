import { z } from 'zod';

/** Request body for the canonical draft save endpoint. */
export const saveDraftSchema = z.object({
  draft: z.unknown(),
  expectedRev: z.number().int().nonnegative(),
});

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

/**
 * Request body for publishing the currently saved draft. Optional fields are
 * normalized to null so the document service receives its complete options.
 */
export const publishSchema = z
  .object({
    note: z.string().max(200).nullable().default(null),
    publishAt: z.string().datetime({ offset: true }).nullable().default(null),
    unpublishAt: z.string().datetime({ offset: true }).nullable().default(null),
    confirmWarnings: z.boolean().default(false),
  })
  .superRefine((input, ctx) => {
    if (input.publishAt === null || input.unpublishAt === null) return;
    if (Date.parse(input.unpublishAt) > Date.parse(input.publishAt)) return;
    ctx.addIssue({
      code: 'custom',
      path: ['unpublishAt'],
      message: 'unpublishAt must be later than publishAt',
    });
  });

export type PublishInput = z.infer<typeof publishSchema>;

export const restoreSchema = z.object({});
export const unpublishSchema = z.object({});
export const previewTokenSchema = z.object({});
