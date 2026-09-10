import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Validated at boot, so this is guaranteed to be present and numeric.
  const config = app.get(ConfigService);
  await app.listen(config.getOrThrow<number>('app.port'));
}

await bootstrap();
