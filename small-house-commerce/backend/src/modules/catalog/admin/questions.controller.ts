// src/modules/catalog/admin/questions.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import {
  adminQuestionQuerySchema,
  convertQuestionSchema,
  type AdminQuestionQuery,
  type ConvertQuestionInput,
} from '../dto/question.dto.js';
import { QuestionsService } from '../questions.service.js';

/**
 * Admin inbox for "Ask a question" submissions. Converting hands the question
 * to the product FAQ (the same storefront content the FAQ workspace edits), so
 * it reuses the product-management permission there.
 */
@Controller('admin/questions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('PRODUCT_MANAGE')
export class AdminQuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(adminQuestionQuerySchema))
    query: AdminQuestionQuery,
  ) {
    return this.questions.adminList(query);
  }

  @Post(':id/convert')
  @HttpCode(HttpStatus.OK)
  convert(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body(new ZodValidationPipe(convertQuestionSchema)) body: ConvertQuestionInput,
  ) {
    return this.questions.convert(id, body);
  }

  @Post(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  dismiss(@Param('id', new ParseUUIDPipe({ version: '7' })) id: string) {
    return this.questions.dismiss(id);
  }
}
