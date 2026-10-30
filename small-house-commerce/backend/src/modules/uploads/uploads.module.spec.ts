import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { UploadsModule } from './uploads.module.js';
import { UploadsService } from './uploads.service.js';
import { VideoTranscoderService } from './video-transcoder.service.js';

describe('UploadsModule provider boundary', () => {
  it('exports UploadsService for StorefrontShellModule injection', () => {
    const exported = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      UploadsModule,
    ) as unknown[];

    expect(exported).toBeDefined();
    expect(exported).toContain(UploadsService);
  });

  it('injects the actual video transcoder rather than an erased type token', async () => {
    const module = await Test.createTestingModule({
      providers: [
        UploadsService,
        { provide: ConfigService, useValue: { get: () => null } },
        { provide: VideoTranscoderService, useValue: { transcode: () => null } },
      ],
    }).compile();
    try {
      const service = module.get(UploadsService);
      expect((service as unknown as { transcoder: unknown }).transcoder)
        .toBe(module.get(VideoTranscoderService));
    } finally {
      await module.close();
    }
  });
});
