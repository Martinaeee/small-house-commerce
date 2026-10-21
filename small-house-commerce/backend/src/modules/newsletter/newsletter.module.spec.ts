import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AuthModule } from '../auth/auth.module.js';
import { NewsletterModule } from './newsletter.module.js';

describe('NewsletterModule', () => {
  it('imports AuthModule for its guarded admin controllers', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      NewsletterModule,
    ) as unknown[];

    expect(imports).toContain(AuthModule);
  });
});
