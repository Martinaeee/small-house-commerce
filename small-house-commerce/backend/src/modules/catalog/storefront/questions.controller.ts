// src/modules/catalog/storefront/questions.controller.ts
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottleGuard } from '../../../common/throttle.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import {
  submitQuestionSchema,
  type SubmitQuestionInput,
} from '../dto/question.dto.js';
import { QuestionsService } from '../questions.service.js';

/**
 * "Ask a question" from the PDP. Anonymous like the back-in-stock form, but
 * IP-rate-limited because it writes an operator-facing inbox row.
 */
@Controller('storefront/products')
@UseGuards(ThrottleGuard)
export class StorefrontQuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Post(':slug/questions')
  @HttpCode(HttpStatus.OK)
  @Throttle({ key: 'product-question:ip', bucket: 'ip', limit: 5, windowMs: 60 * 60_000 })
  ask(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(submitQuestionSchema)) body: SubmitQuestionInput,
  ) {
    return this.questions.create(slug, body);
  }
}
