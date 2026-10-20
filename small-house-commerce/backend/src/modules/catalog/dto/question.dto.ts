import { z } from 'zod';

const MAX_QUESTION = 500;
const MAX_NAME = 80;
const MAX_EMAIL = 255;
const MAX_ANSWER = 8000;

/** An empty text field means "not provided", never an invalid value. */
const optionalText = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  );

export const submitQuestionSchema = z.object({
  question: z.string().trim().min(5).max(MAX_QUESTION),
  name: optionalText(z.string().trim().max(MAX_NAME)),
  email: optionalText(z.string().trim().email().max(MAX_EMAIL)),
});
export type SubmitQuestionInput = z.infer<typeof submitQuestionSchema>;

export const adminQuestionQuerySchema = z.object({
  status: z.enum(['PENDING', 'CONVERTED', 'DISMISSED']).optional(),
  productId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type AdminQuestionQuery = z.infer<typeof adminQuestionQuerySchema>;

export const convertQuestionSchema = z.object({
  answer: z.string().trim().min(1).max(MAX_ANSWER),
});
export type ConvertQuestionInput = z.infer<typeof convertQuestionSchema>;
