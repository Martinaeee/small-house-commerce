import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { JwtAuthGuard, type RequestUser } from '../../auth/jwt-auth.guard.js';
import { NotificationsService } from '../notifications.service.js';

@Controller('admin/notifications')
@UseGuards(JwtAuthGuard)
export class AdminNotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  notifications(@CurrentUser() user: RequestUser) {
    return this.notificationsService.notifications(user.userId);
  }
}
