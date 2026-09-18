import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Production sits behind exactly one reverse proxy (Caddy in the prod
  // compose). Trusting one hop makes Express derive request.ip from the
  // X-Forwarded-For entry immediately to the LEFT of the trusted proxy hop;
  // client-supplied entries further left are ignored (verified on Express 5 /
  // proxy-addr). The throttle guard buckets on that address. Do not raise this
  // above 1 without re-checking header spoofing.
  app.set('trust proxy', 1);

  // All routes live under /api/v1 per SYSTEM_ARCHITECTURE.md §62-65:
  // storefront, admin and webhooks are namespaces below this prefix.
  app.setGlobalPrefix('api/v1');

  // Validated at boot, so this is guaranteed to be present and numeric.
  const config = app.get(ConfigService);

  // Serve uploaded images at /uploads/*. The default keeps `next dev`
  // working with no configuration; production mounts a Docker volume at
  // UPLOAD_DIR=/app/uploads (docker-compose.prod.yml).
  const uploadDir = config.get<string>('upload.dir') ?? join(process.cwd(), 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  app.useStaticAssets(uploadDir, { prefix: '/uploads/' });

  await app.listen(
    config.getOrThrow<number>('app.port'),
    config.getOrThrow<string>('app.host'),
  );
}

await bootstrap();
