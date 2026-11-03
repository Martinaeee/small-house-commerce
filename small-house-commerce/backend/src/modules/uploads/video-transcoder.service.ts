import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type TranscodeOutcome = { buffer: Buffer; contentType: 'video/mp4' } | null;

@Injectable()
export class VideoTranscoderService {
  private readonly logger = new Logger(VideoTranscoderService.name);
  private active = 0;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  /** Best effort: smaller, streaming-friendly H.264/AAC; failures keep the original. */
  async transcode(buffer: Buffer, contentType: string): Promise<TranscodeOutcome> {
    if (this.config.get<boolean>('upload.videoTranscode') === false) return null;
    if (contentType !== 'video/mp4' && contentType !== 'video/quicktime') return null;
    // Uploads share a small VPS with checkout; don't allow a bulk upload to
    // start an unbounded number of encoders. Saturation keeps the original.
    if (this.active >= 2) {
      this.logger.warn('Video encoder busy; keeping original upload');
      return null;
    }
    this.active++;
    let workDir: string | undefined;
    try {
      workDir = await mkdtemp(join(tmpdir(), 'luwag-video-'));
      const input = join(workDir, contentType === 'video/mp4' ? 'in.mp4' : 'in.mov');
      const output = join(workDir, 'out.mp4');
      await writeFile(input, buffer);
      await execFileAsync(this.config.get<string>('upload.ffmpegPath') || 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-threads', '1', '-filter_threads', '1',
        // Only self-contained MOV/MP4 uploads, never playlists or remote URLs.
        '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-i', input,
        '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-sn', '-dn',
        '-vf', "scale=w='min(iw,1280)':h='min(ih,720)':force_original_aspect_ratio=decrease:force_divisible_by=2",
        '-c:v', 'libx264', '-threads', '1', '-preset', 'veryfast', '-crf', '26',
        '-maxrate', '2M', '-bufsize', '4M', '-fpsmax', '30', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-f', 'mp4', output,
      ], {
        timeout: Number(this.config.get<number>('upload.videoTranscodeTimeoutMs')) || 90_000,
        killSignal: 'SIGKILL',
        maxBuffer: 256 * 1024,
      });
      const size = (await stat(output)).size;
      if (size === 0 || size >= buffer.length) return null;
      const encoded = await readFile(output);
      this.logger.log(`Video optimized: ${buffer.length} -> ${encoded.length} bytes`);
      return { buffer: encoded, contentType: 'video/mp4' };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'ENCODING_FAILED';
      this.logger.warn(`Video optimization failed (${code}); keeping original upload`);
      return null;
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      this.active--;
    }
  }
}
