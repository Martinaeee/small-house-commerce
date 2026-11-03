import { describe, expect, it } from 'vitest';
import { videoPlaybackUrl } from './video-url';

describe('videoPlaybackUrl', () => {
  it('versions local mp4 playback so immutable original caches cannot hide the optimized bytes', () => {
    expect(videoPlaybackUrl('/uploads/catalog/2026/a.mp4'))
      .toBe('/uploads/catalog/2026/a.mp4?video=stream-v1');
  });
  it('preserves existing queries and fragments and is idempotent', () => {
    expect(videoPlaybackUrl('/uploads/a.mp4?x=1#t=3'))
      .toBe('/uploads/a.mp4?x=1&video=stream-v1#t=3');
    const src = '/uploads/a.mp4?video=stream-v1';
    expect(videoPlaybackUrl(src)).toBe(src);
  });
  it('leaves remote URLs, images and non-mp4 uploads alone', () => {
    for (const src of ['https://cdn.test/a.mp4', '/uploads/a.png', '/uploads/a.webm', '', '/about/a.mp4']) {
      expect(videoPlaybackUrl(src)).toBe(src);
    }
  });
});
