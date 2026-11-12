import {
  type ExecutionContext,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { AuthUser, AuthenticatedRequest } from '../auth.types.js';

/** The authenticated caller. Only available on routes behind the JWT guard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new UnauthorizedException('Authentication required', {
        errorCode: 'UNAUTHENTICATED',
      });
    }
    return request.user;
  },
);
