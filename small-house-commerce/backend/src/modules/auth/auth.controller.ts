import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Throttle, ThrottleGuard } from '../../common/throttle.guard.js';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './current-user.decorator.js';
import {
  loginSchema,
  refreshSchema,
  type LoginInput,
  type RefreshInput,
} from './dto/auth.dto.js';
import { JwtAuthGuard, type RequestUser } from './jwt-auth.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @UseGuards(ThrottleGuard)
  @Throttle({ key: 'admin-login:ip', bucket: 'ip', limit: 10, windowMs: 10 * 60_000 })
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(loginSchema)) input: LoginInput) {
    return this.auth.login(input);
  }

  @Post('refresh')
  @UseGuards(ThrottleGuard)
  @Throttle({ key: 'admin-refresh:ip', bucket: 'ip', limit: 30, windowMs: 10 * 60_000 })
  @HttpCode(HttpStatus.OK)
  refresh(@Body(new ZodValidationPipe(refreshSchema)) input: RefreshInput) {
    return this.auth.refresh(input);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Body(new ZodValidationPipe(refreshSchema)) input: RefreshInput) {
    return this.auth.logout(input.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: RequestUser) {
    return this.auth.me(user.userId);
  }
}
