import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest, Role } from '../auth.types.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

/**
 * Registered globally after JwtAuthGuard. Routes without @Roles() are open to
 * any authenticated caller.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (user && required.includes(user.role)) {
      return true;
    }

    throw new ForbiddenException('Insufficient permissions', {
      errorCode: 'FORBIDDEN',
    });
  }
}
