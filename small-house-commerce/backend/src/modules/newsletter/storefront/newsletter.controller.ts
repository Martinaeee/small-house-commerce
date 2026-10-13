import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottleGuard } from '../../../common/throttle.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { NewsletterService } from '../newsletter.service.js';
import {
  subscribeSchema,
  unsubscribeQuerySchema,
  type SubscribeInput,
  type UnsubscribeQuery,
} from '../dto/newsletter.dto.js';

@Controller('storefront/newsletter')
export class StorefrontNewsletterController {
  constructor(private readonly newsletter: NewsletterService) {}

  @Post('subscribe')
  @HttpCode(200)
  @UseGuards(ThrottleGuard)
  @Throttle(
    {
      key: 'newsletter-subscribe:ip',
      bucket: 'ip',
      limit: 20,
      windowMs: 60 * 60_000,
    },
    {
      key: 'newsletter-subscribe:email',
      bucket: 'email',
      limit: 5,
      windowMs: 60 * 60_000,
    },
  )
  subscribe(
    @Body(new ZodValidationPipe(subscribeSchema)) body: SubscribeInput,
  ) {
    return this.newsletter.subscribe(body);
  }

  @Get('unsubscribe')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @UseGuards(ThrottleGuard)
  @Throttle({
    key: 'newsletter-unsubscribe:ip',
    bucket: 'ip',
    limit: 60,
    windowMs: 10 * 60_000,
  })
  unsubscribeConfirmation(
    @Query(new ZodValidationPipe(unsubscribeQuerySchema))
    query: UnsubscribeQuery,
  ): string {
    const action = `/api/v1/storefront/newsletter/unsubscribe?token=${encodeURIComponent(query.token)}`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Confirm unsubscribe</title></head><body><main><h1>Confirm unsubscribe</h1><p>Stop receiving LUWAG Living newsletter emails?</p><form method="post" action="${action}"><button type="submit">Unsubscribe</button></form></main></body></html>`;
  }

  @Post('unsubscribe')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @UseGuards(ThrottleGuard)
  @Throttle({
    key: 'newsletter-unsubscribe:ip',
    bucket: 'ip',
    limit: 60,
    windowMs: 10 * 60_000,
  })
  async confirmUnsubscribe(
    @Query(new ZodValidationPipe(unsubscribeQuerySchema))
    query: UnsubscribeQuery,
  ): Promise<string> {
    const success = await this.newsletter.unsubscribeByToken(query.token);
    const title = success ? 'You have been unsubscribed' : 'This link is invalid';
    const message = success
      ? 'You will no longer receive LUWAG Living newsletter emails.'
      : 'The unsubscribe link is invalid. No subscription was changed.';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
  }
}
