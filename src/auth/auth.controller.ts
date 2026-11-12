import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PublicUser } from '../users/public-user.js';
import type { AuthTokens, AuthUser } from './auth.types.js';
import { AuthService, type AuthSession } from './auth.service.js';
import {
  type LoginInput,
  type RefreshTokenInput,
  type RegisterInput,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
} from './auth.schemas.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Create an account and sign in' })
  register(
    @Body({ schema: registerSchema }) body: RegisterInput,
  ): Promise<AuthSession> {
    return this.auth.register(body);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with email and password' })
  login(@Body({ schema: loginSchema }) body: LoginInput): Promise<AuthSession> {
    return this.auth.login(body);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new access and refresh token',
  })
  refresh(
    @Body({ schema: refreshTokenSchema }) body: RefreshTokenInput,
  ): Promise<{ tokens: AuthTokens }> {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'End the session that owns this refresh token' })
  logout(
    @Body({ schema: refreshTokenSchema }) body: RefreshTokenInput,
  ): Promise<void> {
    return this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in user' })
  me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.auth.me(user.id);
  }
}
