import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { AppModule } from '../../../app.module.js';
import { PERMISSIONS_KEY } from '../../auth/permissions.decorator.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { NotificationsModule } from '../notifications.module.js';
import { AdminNotificationsController } from './notifications.controller.js';

const USER_ID = '018f0c8b-2f4f-7f65-a409-a6bdb7de7523';

describe('AdminNotificationsController', () => {
  it('delegates with the current admin user id', async () => {
    const response = { totalCount: 0, items: [] };
    const notifications = vi.fn().mockResolvedValue(response);
    const controller = new AdminNotificationsController({ notifications } as never);

    await expect(
      controller.notifications({ userId: USER_ID, email: 'admin@test' }),
    ).resolves.toEqual(response);
    expect(notifications).toHaveBeenCalledWith(USER_ID);
  });

  it('exposes the exact authenticated GET route without all-required permissions', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminNotificationsController)).toBe(
      'admin/notifications',
    );
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        AdminNotificationsController.prototype.notifications,
      ),
    ).toBe(RequestMethod.GET);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminNotificationsController),
    ).toContain(JwtAuthGuard);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, AdminNotificationsController),
    ).toBeUndefined();
  });

  it('marks every response private and non-cacheable', () => {
    expect(
      Reflect.getMetadata(
        HEADERS_METADATA,
        AdminNotificationsController.prototype.notifications,
      ),
    ).toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
  });

  it('registers NotificationsModule in AppModule', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule)).toContain(
      NotificationsModule,
    );
  });
});
