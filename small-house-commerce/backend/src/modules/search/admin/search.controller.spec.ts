import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../../auth/permissions.decorator.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { AdminSearchController } from './search.controller.js';

const USER_ID = '018f0c8b-2f4f-7f65-a409-a6bdb7de7523';

describe('AdminSearchController', () => {
  it('delegates the validated query with the current admin user id', async () => {
    const search = vi.fn().mockResolvedValue({ query: 'chair', groups: {} });
    const controller = new AdminSearchController({ search } as never);

    await expect(
      controller.search(
        { q: 'chair', limit: 5 },
        { userId: USER_ID, email: 'admin@test' },
      ),
    ).resolves.toEqual({ query: 'chair', groups: {} });
    expect(search).toHaveBeenCalledWith(USER_ID, { q: 'chair', limit: 5 });
  });

  it('requires authentication without declaring all entity permissions', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminSearchController)).toContain(
      JwtAuthGuard,
    );
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AdminSearchController)).toBeUndefined();
  });

  it('marks every response private and non-cacheable', () => {
    expect(
      Reflect.getMetadata(
        HEADERS_METADATA,
        AdminSearchController.prototype.search,
      ),
    ).toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
  });
});
