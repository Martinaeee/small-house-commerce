// src/modules/catalog/questions.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CACHE_TAGS, revalidateCache } from '../../common/revalidation.js';
import type {
  AdminQuestionQuery,
  ConvertQuestionInput,
  SubmitQuestionInput,
} from './dto/question.dto.js';
import {
  MAX_FAQ_ITEMS,
  MAX_FAQ_TITLE,
  blocksFromPlainText,
  faqItemsSchema,
  stampItemTimestamps,
  type FaqItem,
} from './faq/faq-content.js';

/**
 * Customer product questions.
 *
 * A submission only ever lands in the inbox: nothing a shopper types reaches
 * the storefront by itself. An operator answers it and converts it into a
 * product FAQ entry, so the public surface keeps reading the single FAQ
 * resolution and there is no second content store to moderate.
 */
@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    // Test seam for per-question timestamps; production always takes the default.
    @Optional() private readonly now: () => Date = () => new Date(),
  ) {}

  async create(
    slug: string,
    input: SubmitQuestionInput,
  ): Promise<{ ok: true }> {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    await this.prisma.productQuestion.create({
      data: {
        productId: product.id,
        question: input.question.trim(),
        askerName: input.name?.trim() || null,
        askerEmail: input.email?.trim() || null,
      },
    });
    return { ok: true };
  }

  async adminList(query: AdminQuestionQuery) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.productQuestion.findMany({
        where,
        orderBy: { createdAt: 'desc' as const },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          productId: true,
          question: true,
          askerName: true,
          askerEmail: true,
          status: true,
          createdAt: true,
          product: { select: { name: true, slug: true } },
        },
      }),
      this.prisma.productQuestion.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /**
   * Turns a pending question into a product FAQ entry, in the same transaction
   * that marks it handled: either both happen or neither does.
   *
   * SHARED products become EXTEND so the shared library keeps applying and the
   * answered question is added on top; CUSTOM stays CUSTOM.
   */
  async convert(
    id: string,
    input: ConvertQuestionInput,
  ): Promise<{ ok: true }> {
    const answerBlocks = blocksFromPlainText(input.answer);
    if (answerBlocks.length === 0) {
      throw new BadRequestException({
        code: 'QUESTION_ANSWER_REQUIRED',
        message: 'An answer is required.',
      });
    }
    const now = this.now();

    await this.prisma.$transaction(async (tx) => {
      const question = await tx.productQuestion.findUnique({
        where: { id },
        select: { id: true, productId: true, question: true, status: true },
      });
      if (!question) throw new NotFoundException('Question not found');
      if (question.status !== 'PENDING') {
        throw new ConflictException({
          code: 'QUESTION_NOT_PENDING',
          message: 'This question was already handled.',
        });
      }

      const faq = await tx.productFaq.findUnique({
        where: { productId: question.productId },
        select: { mode: true, items: true, version: true },
      });
      const currentItems = (faq?.items ?? []) as unknown as FaqItem[];
      if (currentItems.length >= MAX_FAQ_ITEMS) {
        throw new ConflictException({
          code: 'FAQ_FULL',
          message: `The product FAQ already holds ${MAX_FAQ_ITEMS} questions.`,
        });
      }

      const parsed = faqItemsSchema.safeParse([
        ...currentItems,
        {
          id: randomUUID(),
          title: question.question.slice(0, MAX_FAQ_TITLE),
          answer: answerBlocks,
          enabled: true,
          position: currentItems.reduce(
            (max, item) => Math.max(max, item.position + 1),
            0,
          ),
          defaultOpen: false,
        },
      ]);
      if (!parsed.success) {
        throw new BadRequestException({
          code: 'FAQ_INVALID',
          message: 'The FAQ items do not match the product FAQ schema.',
        });
      }

      const items = stampItemTimestamps(currentItems, parsed.data, now);
      const mode = faq?.mode === 'CUSTOM' ? 'CUSTOM' : 'EXTEND';

      if (faq) {
        const { count } = await tx.productFaq.updateMany({
          where: { productId: question.productId, version: faq.version },
          data: {
            mode,
            items: items as unknown as never,
            version: faq.version + 1,
          },
        });
        if (count === 0) {
          throw new ConflictException({
            code: 'FAQ_VERSION_MISMATCH',
            message: 'The FAQ was modified concurrently; reload and retry.',
          });
        }
      } else {
        try {
          await tx.productFaq.create({
            data: {
              productId: question.productId,
              mode: 'EXTEND',
              items: items as unknown as never,
              version: 1,
            },
          });
        } catch (error) {
          // Two first-time conversions raced on the primary key; the loser
          // reloads instead of surfacing a raw constraint error.
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw new ConflictException({
              code: 'FAQ_VERSION_MISMATCH',
              message: 'The FAQ was created concurrently; reload and retry.',
            });
          }
          throw error;
        }
      }

      const { count: marked } = await tx.productQuestion.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'CONVERTED' },
      });
      if (marked === 0) {
        throw new ConflictException({
          code: 'QUESTION_NOT_PENDING',
          message: 'This question was already handled.',
        });
      }
    });

    await revalidateCache([CACHE_TAGS.STOREFRONT]);
    return { ok: true };
  }

  async dismiss(id: string): Promise<{ ok: true }> {
    await this.prisma.$transaction(async (tx) => {
      const question = await tx.productQuestion.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!question) throw new NotFoundException('Question not found');
      if (question.status !== 'PENDING') {
        throw new ConflictException({
          code: 'QUESTION_NOT_PENDING',
          message: 'This question was already handled.',
        });
      }
      const { count } = await tx.productQuestion.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'DISMISSED' },
      });
      if (count === 0) {
        throw new ConflictException({
          code: 'QUESTION_NOT_PENDING',
          message: 'This question was already handled.',
        });
      }
    });
    return { ok: true };
  }
}
