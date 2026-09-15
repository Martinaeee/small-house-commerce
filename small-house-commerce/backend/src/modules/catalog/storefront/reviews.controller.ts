import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Throttle, ThrottleGuard } from '../../../common/throttle.guard.js';
import { ensureVisitorHash } from '../../../common/visitor-id.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import {
  reportReviewSchema,
  type ReportReviewInput,
} from '../dto/review-feedback.dto.js';
import { ReviewsService } from '../reviews.service.js';

/**
 * Anonymous PDP review feedback ("Helpful" / "Report"). No auth, but IP-rate-
 * limited; per-shopper dedupe uses an httpOnly cookie hashed with the JWT
 * secret (see common/visitor-id.ts).
 */
@Controller('storefront/reviews')
@UseGuards(ThrottleGuard)
export class StorefrontReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly config: ConfigService,
  ) {}

  @Post(':id/helpful')
  @HttpCode(HttpStatus.OK)
  @Throttle({ key: 'review-helpful:ip', bucket: 'ip', limit: 30, windowMs: 10 * 60_000 })
  helpful(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const visitorHash = ensureVisitorHash(req, res, this.config.getOrThrow<string>('jwt.secret'));
    return this.reviews.addHelpfulVote(id, visitorHash);
  }

  @Post(':id/report')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ key: 'review-report:ip', bucket: 'ip', limit: 5, windowMs: 60 * 60_000 })
  report(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body(new ZodValidationPipe(reportReviewSchema)) body: ReportReviewInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const visitorHash = ensureVisitorHash(req, res, this.config.getOrThrow<string>('jwt.secret'));
    return this.reviews
      .addReport(id, body.reason ? body.reason : null, visitorHash)
      .then(() => ({ ok: true }));
  }
}
