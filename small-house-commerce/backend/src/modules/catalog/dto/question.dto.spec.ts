import { describe, expect, it } from 'vitest';
import {
  adminQuestionQuerySchema,
  convertQuestionSchema,
  submitQuestionSchema,
} from './question.dto.js';

describe('submitQuestionSchema', () => {
  it('trims the question and treats blank optional fields as absent', () => {
    const parsed = submitQuestionSchema.parse({
      question: '  Does it fit a small hallway?  ',
      name: '   ',
      email: '   ',
    });

    expect(parsed).toEqual({
      question: 'Does it fit a small hallway?',
      name: undefined,
      email: undefined,
    });
  });

  it('rejects questions shorter than five characters after trimming', () => {
    expect(submitQuestionSchema.safeParse({ question: '   Four   ' }).success).toBe(
      false,
    );
    expect(submitQuestionSchema.safeParse({ question: '   Four!   ' }).success).toBe(
      true,
    );
  });

  it('enforces the public field limits and a real email address', () => {
    expect(
      submitQuestionSchema.safeParse({ question: 'x'.repeat(501) }).success,
    ).toBe(false);
    expect(
      submitQuestionSchema.safeParse({
        question: 'Can it ship to Mindanao?',
        name: 'n'.repeat(81),
      }).success,
    ).toBe(false);
    expect(
      submitQuestionSchema.safeParse({
        question: 'Can it ship to Mindanao?',
        email: 'not-an-email',
      }).success,
    ).toBe(false);
  });
});

describe('adminQuestionQuerySchema', () => {
  it('defaults paging and caps the page size', () => {
    expect(adminQuestionQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(adminQuestionQuerySchema.safeParse({ pageSize: 51 }).success).toBe(false);
    expect(
      adminQuestionQuerySchema.parse({ status: 'PENDING', page: '2', pageSize: '50' }),
    ).toEqual({ status: 'PENDING', page: 2, pageSize: 50 });
  });

  it('rejects unknown statuses and non-uuid product filters', () => {
    expect(adminQuestionQuerySchema.safeParse({ status: 'OPEN' }).success).toBe(false);
    expect(adminQuestionQuerySchema.safeParse({ productId: 'abc' }).success).toBe(false);
  });
});

describe('convertQuestionSchema', () => {
  it('requires a non-empty trimmed answer within the FAQ limit', () => {
    expect(convertQuestionSchema.parse({ answer: '  Yes.  ' })).toEqual({
      answer: 'Yes.',
    });
    expect(convertQuestionSchema.safeParse({ answer: '   ' }).success).toBe(false);
    expect(
      convertQuestionSchema.safeParse({ answer: 'a'.repeat(8001) }).success,
    ).toBe(false);
  });
});
