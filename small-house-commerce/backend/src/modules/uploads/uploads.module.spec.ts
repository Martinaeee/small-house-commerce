import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { UploadsModule } from './uploads.module.js';
import { UploadsService } from './uploads.service.js';

describe('UploadsModule provider boundary', () => {
  it('exports UploadsService for StorefrontShellModule injection', () => {
    const exported = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      UploadsModule,
    ) as unknown[];

    expect(exported).toBeDefined();
    expect(exported).toContain(UploadsService);
  });
});
