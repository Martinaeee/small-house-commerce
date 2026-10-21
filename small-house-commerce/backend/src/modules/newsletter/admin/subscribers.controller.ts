import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { Permissions } from '../../auth/permissions.decorator.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { NewsletterService } from '../newsletter.service.js';
import {
  subscriberQuerySchema,
  subscriberStatusSchema,
  type SubscriberQuery,
  type SubscriberStatusInput,
} from '../dto/newsletter.dto.js';

/**
 * Newsletter subscriber list. Reading requires NEWSLETTER_READ; changing a
 * subscriber's status additionally requires NEWSLETTER_WRITE.
 */
@Controller('admin/newsletter/subscribers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('NEWSLETTER_READ')
export class AdminSubscribersController {
  constructor(private readonly newsletter: NewsletterService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(subscriberQuerySchema)) query: SubscriberQuery,
  ) {
    return this.newsletter.listSubscribers(query);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="newsletter-subscribers.csv"',
  )
  export() {
    return this.newsletter.exportSubscribersCsv();
  }

  @Patch(':id')
  @Permissions('NEWSLETTER_WRITE')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(subscriberStatusSchema))
    body: SubscriberStatusInput,
  ) {
    return this.newsletter.setSubscriberStatus(id, body.status);
  }
}
