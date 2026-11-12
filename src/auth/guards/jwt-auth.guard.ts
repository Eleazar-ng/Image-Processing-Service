import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedRequest } from '../auth.types.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { TokenService } from '../token.service.js';

export function extractBearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

/**
 * Registered globally: every route requires a valid access token unless it
 * is marked @Public(), so new routes are protected by default.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Authentication required', {
        errorCode: 'UNAUTHENTICATED',
      });
    }

    try {
      const claims = await this.tokens.verifyAccessToken(token);
      request.user = { id: claims.sub, role: claims.role };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token', {
        errorCode: 'INVALID_ACCESS_TOKEN',
      });
    }
  }
}
