import { z } from 'zod';
import { storefrontShellDocumentSchema } from '../storefront-shell-document.js';

export const shellWriteSchema = z
  .object({
    expectedVersion: z.coerce.number().int().min(1),
    document: storefrontShellDocumentSchema,
  })
  .strict();

export const shellPublishSchema = z
  .object({ expectedVersion: z.coerce.number().int().min(1) })
  .strict();

export const shellUploadQuerySchema = z
  .object({ slot: z.enum(['horizontal', 'square']) })
  .strict();

export const shellValidateSchema = storefrontShellDocumentSchema;

export type ShellWriteInput = z.infer<typeof shellWriteSchema>;
export type ShellPublishInput = z.infer<typeof shellPublishSchema>;
export type ShellUploadQuery = z.infer<typeof shellUploadQuerySchema>;
export type ShellValidateInput = z.infer<typeof shellValidateSchema>;
