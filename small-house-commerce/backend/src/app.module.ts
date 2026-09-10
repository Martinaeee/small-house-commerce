import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { configuration } from './config/configuration.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      // Global so any module can inject ConfigService without re-importing.
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      // Runs parseEnv during bootstrap: an invalid environment stops the app.
      load: [configuration],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
