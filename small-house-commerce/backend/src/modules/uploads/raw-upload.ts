import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { presignUploadSchema } from './dto/upload.dto.js';

export function readRawBody(req: Request, maxBytes: number): Promise<Buffer> {
  const contentType = req.headers['content-type']?.split(';')[0]?.trim() ?? '';
  if (!presignUploadSchema.shape.contentType.safeParse(contentType).success) {
    throw new BadRequestException(`Unsupported media type: ${contentType}`);
  }
  const cap = maxBytes >= 1024 * 1024 ? `${Math.round(maxBytes / (1024 * 1024))}MB` : `${maxBytes}B`;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new BadRequestException(`文件超过 ${cap} 限制`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err: Error) => reject(new BadRequestException(err.message)));
  });
}
