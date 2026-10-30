import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { VideoTranscoderService } from './video-transcoder.service.js';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const ffmpegAvailable = spawnSync(FFMPEG, ['-version']).status === 0;
let workDir: string;
let fixture: Buffer;

function serviceWith(cfg: Record<string, unknown>): VideoTranscoderService {
  return new VideoTranscoderService({ get: (key: string) => cfg[key] } as unknown as ConfigService);
}

function mp4Boxes(buffer: Buffer): string[] {
  const boxes: string[] = [];
  for (let offset = 0; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32BE(offset);
    boxes.push(buffer.toString('ascii', offset + 4, offset + 8));
    if (size < 8) break;
    offset += size;
  }
  return boxes;
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'vt-spec-'));
  if (!ffmpegAvailable) return;
  const out = join(workDir, 'fixture.mp4');
  const run = spawnSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-crf', '18',
    '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-y', out,
  ], { timeout: 30_000 });
  if (run.status !== 0) throw new Error(`fixture build failed: ${run.stderr?.toString().slice(0, 300)}`);
  fixture = await readFile(out);
}, 40_000);

afterAll(async () => { if (workDir) await rm(workDir, { recursive: true, force: true }); });

describe('VideoTranscoderService', () => {
  it('keeps the original when ffmpeg cannot start', async () => {
    const svc = serviceWith({ 'upload.ffmpegPath': '/nonexistent/ffmpeg' });
    await expect(svc.transcode(Buffer.from('invalid'), 'video/mp4')).resolves.toBeNull();
  });

  it('rejects a failed encoder result without returning partial output', async () => {
    const svc = serviceWith({ 'upload.ffmpegPath': '/bin/false' });
    await expect(svc.transcode(Buffer.from('invalid'), 'video/mp4')).resolves.toBeNull();
  });

  it('skips webm and honours the disabled flag', async () => {
    const svc = serviceWith({ 'upload.ffmpegPath': '/nonexistent/ffmpeg' });
    await expect(svc.transcode(Buffer.alloc(10), 'video/webm')).resolves.toBeNull();
    const disabled = serviceWith({ 'upload.videoTranscode': false });
    await expect(disabled.transcode(Buffer.alloc(10), 'video/mp4')).resolves.toBeNull();
  });

  it.runIf(ffmpegAvailable)('produces a smaller decodable H.264/AAC mp4 with moov before mdat and <=720p', async () => {
    const svc = serviceWith({ 'upload.ffmpegPath': FFMPEG });
    const result = await svc.transcode(fixture, 'video/mp4');
    expect(result).not.toBeNull();
    expect(result!.contentType).toBe('video/mp4');
    expect(result!.buffer.length).toBeLessThan(fixture.length);
    const boxes = mp4Boxes(result!.buffer);
    expect(boxes.indexOf('moov')).toBeGreaterThan(-1);
    expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'));
    const out = join(workDir, 'output.mp4');
    await writeFile(out, result!.buffer);
    const decoded = spawnSync(FFMPEG, ['-hide_banner', '-i', out, '-f', 'null', '-'], { timeout: 15_000 });
    expect(decoded.status).toBe(0);
    expect(decoded.stderr.toString()).toMatch(/Video: h264[^\n]*1280x720/);
    expect(decoded.stderr.toString()).toMatch(/Audio: aac/);
  }, 40_000);

  it('bounds execution time and cleans up after a hanging child', async () => {
    const hanging = join(workDir, 'hanging.cjs');
    await writeFile(hanging, `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
    const svc = serviceWith({ 'upload.ffmpegPath': hanging, 'upload.videoTranscodeTimeoutMs': 150 });
    const start = Date.now();
    await expect(svc.transcode(Buffer.from('unused'), 'video/mp4')).resolves.toBeNull();
    expect(Date.now() - start).toBeLessThan(3000);
  });
});
