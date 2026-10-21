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
import { BackInStockService } from '../back-in-stock.service.js';
import {
  backInStockSubscribeSchema,
  backInStockUnsubscribeQuerySchema,
  type BackInStockSubscribeInput,
  type BackInStockUnsubscribeQuery,
} from '../dto/back-in-stock.dto.js';

@Controller('storefront/back-in-stock')
export class StorefrontBackInStockController {
  constructor(private readonly backInStock: BackInStockService) {}

  @Post()
  @HttpCode(200)
  @UseGuards(ThrottleGuard)
  @Throttle(
    {
      key: 'back-in-stock-subscribe:ip',
      bucket: 'ip',
      limit: 20,
      windowMs: 60 * 60_000,
    },
    {
      key: 'back-in-stock-subscribe:email',
      bucket: 'email',
      limit: 5,
      windowMs: 60 * 60_000,
    },
  )
  subscribe(
    @Body(new ZodValidationPipe(backInStockSubscribeSchema))
    input: BackInStockSubscribeInput,
  ) {
    return this.backInStock.subscribe(input);
  }

  @Get('unsubscribe')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @UseGuards(ThrottleGuard)
  @Throttle({
    key: 'back-in-stock-unsubscribe:ip',
    bucket: 'ip',
    limit: 60,
    windowMs: 10 * 60_000,
  })
  unsubscribeConfirmation(
    @Query(new ZodValidationPipe(backInStockUnsubscribeQuerySchema))
    query: BackInStockUnsubscribeQuery,
  ): string {
    const action = `/api/v1/storefront/back-in-stock/unsubscribe?token=${encodeURIComponent(query.token)}`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Confirm stock alert unsubscribe</title></head><body><main><h1>Confirm stock alert unsubscribe</h1><p>Stop receiving this LUWAG Living stock alert?</p><form method="post" action="${action}"><button type="submit">Unsubscribe</button></form></main></body></html>`;
  }

  @Post('unsubscribe')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @UseGuards(ThrottleGuard)
  @Throttle({
    key: 'back-in-stock-unsubscribe:ip',
    bucket: 'ip',
    limit: 60,
    windowMs: 10 * 60_000,
  })
  async confirmUnsubscribe(
    @Query(new ZodValidationPipe(backInStockUnsubscribeQuerySchema))
    query: BackInStockUnsubscribeQuery,
  ): Promise<string> {
    const success = await this.backInStock.cancelByToken(query.token);
    const title = success ? 'Your stock alert has been cancelled' : 'This link is invalid';
    const message = success
      ? 'You will no longer receive this LUWAG Living stock alert.'
      : 'The unsubscribe link is invalid. No stock alert was changed.';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
  }
}
